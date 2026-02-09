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
    console.log(`🔄 Completing: ${paymentId}`);

    // 1. إكمال الدفع في Pi
    await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    // 2. محاولة جلب البيانات من DB
    let payRecord = null;
    const { data: dbData } = await supabase
      .from('payments')
      .select('product_id, amount')
      .eq('payment_id', paymentId)
      .single();

    if (dbData) {
        payRecord = dbData;
        await supabase.from('payments').update({ status: 'completed', txid: txid }).eq('payment_id', paymentId);
    } else {
        // 🔥 محاولة الإنقاذ (Fallback)
        console.log("⚠️ DB record missing, fetching from Pi...");
        const piRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, { headers: { 'Authorization': `Key ${PI_API_KEY}` } });
        
        if (piRes.ok) {
            const piData = await piRes.json();
            // تأكد من المسار الصحيح للميتا داتا
            payRecord = {
                product_id: piData.metadata?.productId, 
                amount: parseFloat(piData.amount)
            };
            
            // تسجيلها في الداتا بيز الآن
            if (payRecord.product_id) {
                await supabase.from('payments').insert({
                    payment_id: paymentId,
                    user_id: piData.user_uid,
                    product_id: payRecord.product_id,
                    amount: payRecord.amount,
                    status: 'completed',
                    txid: txid
                });
            }
        }
    }

    // 3. التحقق الأخير قبل التحديث (لمنع خطأ 400)
    if (!payRecord || !payRecord.product_id) {
        console.error("❌ Critical: Product ID not found anywhere.");
        return { statusCode: 400, body: JSON.stringify({ error: "Product ID missing" }) };
    }

    // 4. حساب الأيام
    let daysToAdd = 3;
    if (Number(payRecord.amount) >= 4.9) daysToAdd = 7;

    console.log(`🎁 Promoting Product ${payRecord.product_id} for ${daysToAdd} days`);

    // 5. حساب التاريخ
    const { data: prod } = await supabase.from('products').select('promoted_until').eq('id', payRecord.product_id).single();
    let expiry = new Date();
    if (prod && prod.promoted_until && new Date(prod.promoted_until) > new Date()) {
        expiry = new Date(prod.promoted_until);
    }
    expiry.setDate(expiry.getDate() + daysToAdd);

    // 6. التحديث النهائي
    await supabase.from('products').update({ promoted_until: expiry.toISOString() }).eq('id', payRecord.product_id);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ completed: true })
    };

  } catch (err) {
    console.error("Handler Crash:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
