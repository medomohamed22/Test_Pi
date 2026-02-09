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
    console.log(`🔄 Complete Request: ${paymentId}`);

    // 1. إبلاغ Pi بالاكتمال
    await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    // 2. جلب البيانات (من DB أو Pi)
    let productId, amount;
    
    // محاولة من الداتابيز
    const { data: dbData } = await supabase.from('payments').select('*').eq('payment_id', paymentId).single();
    
    if (dbData) {
        productId = dbData.product_id;
        amount = Number(dbData.amount);
        // تحديث الحالة
        await supabase.from('payments').update({ status: 'completed', txid: txid }).eq('payment_id', paymentId);
    } else {
        // لو مش موجودة، هاتها من Pi
        const piRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, { headers: { 'Authorization': `Key ${PI_API_KEY}` } });
        const piData = await piRes.json();
        productId = piData.metadata.productId;
        amount = parseFloat(piData.amount);
    }

    if (!productId) throw new Error("Product ID not found");

    // 3. تحديد المدة (المنطق الجديد)
    // لو المبلغ 5 (أو أكبر من 4.9) -> 7 أيام، غير كده -> 3 أيام
    const days = amount >= 4.9 ? 7 : 3;

    // 4. تحديث المنتج
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
      body: JSON.stringify({ success: true })
    };

  } catch (err) {
    console.error("Complete Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
