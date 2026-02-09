const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // ✅ نستخدم المفتاح القوي مباشرة
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  // تفعيل CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  try {
    const { paymentId } = JSON.parse(event.body);
    console.log(`Starting Approve for: ${paymentId}`);

    // 1. جلب بيانات الدفع من سيرفرات Pi
    const paymentInfoRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      method: 'GET',
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });

    if (!paymentInfoRes.ok) throw new Error('Failed to verify payment with Pi');
    
    const paymentData = await paymentInfoRes.json();
    const amount = parseFloat(paymentData.amount);
    const productId = paymentData.metadata?.productId;

    // 2. التحقق من المبلغ (3 أو 5)
    // نستخدم Math.round للتأكد من الرقم (مثلاً 2.99999 يصبح 3)
    const cleanAmount = Math.round(amount);
    
    if (cleanAmount !== 3 && cleanAmount !== 5) {
      console.error(`Invalid Amount: ${amount}`);
      return { statusCode: 400, body: JSON.stringify({ error: 'Amount must be 3 or 5 Pi' }) };
    }

    if (!productId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing Product ID' }) };
    }

    // 3. تسجيل الدفع في قاعدة البيانات
    // بما أنك تستخدم المفتاح القوي، لن تواجه مشاكل صلاحيات (RLS)
    const { error: dbError } = await supabase.from('payments').insert({
      payment_id: paymentId,
      user_id: paymentData.user_uid,
      product_id: productId,
      amount: amount,
      status: 'approved'
    });

    if (dbError) {
        console.error("Database Insert Error:", dbError);
        // ملحوظة: لن نوقف العملية هنا حتى لو فشل التسجيل، لنضمن إتمام الدفع للمستخدم في Pi
    }

    // 4. إرسال الموافقة النهائية لـ Pi
    const approveRes = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!approveRes.ok) {
        const errText = await approveRes.text();
        console.error("Pi Approve API Error:", errText);
        throw new Error('Pi Approve Failed');
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ approved: true })
    };

  } catch (err) {
    console.error("Handler Error:", err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
