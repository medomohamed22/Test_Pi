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
    console.log("🚀 Starting Approve...");
    const { paymentId } = JSON.parse(event.body);

    // 1. جلب البيانات من Pi
    const paymentInfoRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      method: 'GET',
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });

    if (!paymentInfoRes.ok) throw new Error('Pi API Error');
    
    const paymentData = await paymentInfoRes.json();
    const amount = parseFloat(paymentData.amount);
    // تأكد من قراءة productId سواء كان نصاً أو رقماً
    const productId = paymentData.metadata?.productId; 

    // التحقق من المبلغ (3 أو 5)
    const cleanAmount = Math.round(amount);
    if (cleanAmount !== 3 && cleanAmount !== 5) {
      return { statusCode: 400, body: JSON.stringify({ error: `Invalid amount: ${amount}` }) };
    }

    if (!productId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing product ID in metadata' }) };
    }

    // 2. تسجيل الدفع (Upsert لتجنب الأخطاء عند التكرار)
    // ⚠️ هذا الجزء هو الأهم: لن ننتقل للخطوة التالية إذا فشل هذا
    const { error: dbError } = await supabase.from('payments').upsert({
      payment_id: paymentId,
      user_id: paymentData.user_uid,
      product_id: productId,
      amount: amount,
      status: 'approved'
    }, { onConflict: 'payment_id' });

    if (dbError) {
        console.error("❌ DB Insert Error:", dbError);
        // نرجع خطأ للسيرفر ليقوم Pi بإعادة المحاولة لاحقاً بدلاً من إكمال عملية ناقصة
        return { statusCode: 500, body: JSON.stringify({ error: "Database Write Failed" }) };
    }

    // 3. الموافقة النهائية
    const approveRes = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!approveRes.ok) throw new Error('Pi Approve Failed');

    console.log("✅ Approved & Saved!");
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ approved: true })
    };

  } catch (err) {
    console.error("Handler Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
