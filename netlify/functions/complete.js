const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body);
    console.log(`🔄 Complete: ${paymentId}`);

    // 1. إنهاء الدفع في Pi فوراً
    await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    // 2. محاولة العثور على البيانات
    let productId = null;
    let amount = 0;

    // أ) من الداتابيز
    const { data: dbRecord } = await supabase.from('payments').select('*').eq('payment_id', paymentId).single();
    
    if (dbRecord && dbRecord.product_id) {
        productId = dbRecord.product_id;
        amount = Number(dbRecord.amount);
        // تحديث الحالة
        await supabase.from('payments').update({ status: 'completed', txid: txid }).eq('payment_id', paymentId);
    } else {
        // ب) من Pi مباشرة (Fallback)
        console.log("⚠️ Fetching missing info from Pi...");
        const piRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, { headers: { 'Authorization': `Key ${PI_API_KEY}` } });
        if (piRes.ok) {
            const piData = await piRes.json();
            amount = parseFloat(piData.amount);
            
            // معالجة ذكية للميتا داتا
            let meta = piData.metadata || {};
            if (typeof meta === 'string') {
                try { meta = JSON.parse(meta); } catch(e) {}
            }
            productId = meta.productId; // لاحظ: P capital أو small حسب الإرسال
            
            // محاولة التسجيل مرة أخرى
            if (productId) {
                await supabase.from('payments').upsert({
                    payment_id: paymentId,
                    user_id: piData.user_uid,
                    product_id: productId,
                    amount: amount,
                    status: 'completed',
                    txid: txid
                });
            }
        }
    }

    if (!productId) {
        console.error("❌ Still no Product ID found. Cannot promote.");
        // نرجع 200 لأن الدفع تم في Pi، فلا نريد أن يظن المستخدم أن العملية فشلت مالياً
        return { statusCode: 200, body: JSON.stringify({ completed: true, warning: "Product not found" }) };
    }

    // 3. التمييز
    const days = amount >= 4.9 ? 7 : 3;
    console.log(`🎁 Promoting Product ${productId} for ${days} days`);

    const { data: prod } = await supabase.from('products').select('promoted_until').eq('id', productId).single();
    let expiry = new Date();
    if (prod && prod.promoted_until && new Date(prod.promoted_until) > new Date()) {
        expiry = new Date(prod.promoted_until);
    }
    expiry.setDate(expiry.getDate() + days);

    await supabase.from('products').update({ promoted_until: expiry.toISOString() }).eq('id', productId);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ completed: true })
    };

  } catch (err) {
    console.error("Complete Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
