const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
// ⚠️ تأكد في إعدادات Netlify أن SUPABASE_KEY يحتوي على الـ Service Role Key
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body);

    // 1. إخبار سيرفرات Pi باكتمال الدفع
    const piResponse = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    if (!piResponse.ok) {
        console.log("Pi API Warning:", await piResponse.text());
    }

    // 2. البحث عن سجل الدفع
    // 🔥 التعديل الأول: نطلب (amount) أيضاً لنعرف المستخدم دفع كام
    const { data: payRecord, error: findError } = await supabase
      .from('payments')
      .select('product_id, amount') 
      .eq('payment_id', paymentId)
      .single();

    if (findError || !payRecord) {
       console.error("Payment record not found:", findError);
       return { statusCode: 404, body: JSON.stringify({ error: "Payment record not found." }) };
    }

    // 3. تحديث حالة الدفع إلى مكتمل
    await supabase.from('payments').update({ status: 'completed' }).eq('payment_id', paymentId);

    // 4. 🔥 التعديل الثاني (المنطق الديناميكي): تحديد الأيام بناءً على المبلغ
    let daysToAdd = 3; // الافتراضي
    
    // إذا كان المبلغ 5 (أو قريب منه احتياطياً) نعطيه 7 أيام
    if (Number(payRecord.amount) >= 5) {
        daysToAdd = 7;
    }

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + daysToAdd);

    // 5. تحديث المنتج بتاريخ الانتهاء الجديد
    const { error: updateError } = await supabase
      .from('products')
      .update({ promoted_until: expiry.toISOString() })
      .eq('id', payRecord.product_id);

    if (updateError) {
      console.error("Product promotion failed:", updateError);
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to promote product." }) };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ completed: true, daysAdded: daysToAdd })
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
