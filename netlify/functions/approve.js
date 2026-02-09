const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
// ⚠️ تأكد أن هذا المفتاح هو Service Role Key في إعدادات Netlify
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  // إعدادات CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { paymentId } = JSON.parse(event.body);

    // 1. جلب بيانات الدفع من Pi للتأكد من المبلغ الحقيقي
    const paymentInfoRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      method: 'GET',
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });

    if (!paymentInfoRes.ok) throw new Error('Failed to fetch payment info');
    
    const paymentData = await paymentInfoRes.json();
    const amount = parseFloat(paymentData.amount);
    const productId = paymentData.metadata?.productId;

    // 🔥 التعديل هنا: السماح بـ 3 أو 5 باي 🔥
    const validAmounts = [3, 5]; 
    if (!validAmounts.includes(amount) || !productId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount (must be 3 or 5) or missing product ID' }) };
    }

    // 2. تسجيل الدفع في قاعدة البيانات (بالمبلغ الفعلي سواء 3 أو 5)
    const { error: dbError } = await supabase.from('payments').insert({
      payment_id: paymentId,
      user_id: paymentData.user_uid,
      product_id: productId,
      amount: amount, // سيتم حفظ المبلغ المختار هنا
      status: 'approved'
    });

    if (dbError) {
        console.error("DB Insert Error:", dbError);
        // لا نوقف العملية هنا، نكمل الموافقة في Pi حتى لو فشل التسجيل (لتجنب ضياع حق المستخدم)
        // لكن الأفضل التأكد من الجدول والصلاحيات
    }

    // 3. إرسال الموافقة النهائية لـ Pi
    const approveRes = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!approveRes.ok) throw new Error('Approve failed from Pi side');

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ approved: true })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
