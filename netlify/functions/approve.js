const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // المفتاح القوي
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  // 1. إعدادات CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  try {
    const { paymentId } = JSON.parse(event.body);
    console.log(`🚀 Approve Request: ${paymentId}`);

    // 2. جلب تفاصيل الدفع من Pi
    const paymentRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });
    
    if (!paymentRes.ok) throw new Error("Failed to verify with Pi");
    const paymentData = await paymentRes.json();
    
    const amount = parseFloat(paymentData.amount);
    const productId = paymentData.metadata?.productId;

    // 3. التحقق البسيط (نقبل 3 أو 5)
    if (Math.round(amount) !== 3 && Math.round(amount) !== 5) {
        return { statusCode: 400, body: JSON.stringify({ error: "Amount must be 3 or 5" }) };
    }

    // 4. تسجيل الدفع في قاعدة البيانات (Upsert لمنع الأخطاء)
    // حتى لو فشل التسجيل، سنكمل الموافقة لكي لا يخسر المستخدم أمواله
    await supabase.from('payments').upsert({
      payment_id: paymentId,
      user_id: paymentData.user_uid,
      product_id: productId,
      amount: amount,
      status: 'approved'
    }, { onConflict: 'payment_id' });

    // 5. إرسال الموافقة لـ Pi (أهم خطوة)
    const approveRes = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!approveRes.ok) console.log("Pi Approve Warning:", await approveRes.text());

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ approved: true })
    };

  } catch (err) {
    console.error("Approve Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
