

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

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body);

    // 1. إكمال الدفع في Pi
    const piResponse = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    if (!piResponse.ok) {
        console.log("Pi API Warning:", await piResponse.text());
    }

    // 2. البحث عن سجل الدفع (لاحظ: نستخدم payment_id كما في جدول payments في الصورة)
    const { data: payRecord, error: findError } = await supabase
      .from('payments')
      .select('product_id')
      .eq('payment_id', paymentId)
      .single();

    if (findError || !payRecord) {
       console.error("Payment record not found:", findError);
       return { statusCode: 404, body: JSON.stringify({ error: "Payment record not found in database." }) };
    }

    // 3. تحديث حالة الدفع
    // (ملاحظة: جدول payments في الصورة لا يحتوي على txid، لذا سنحدث status فقط)
    // إذا أضفت عمود txid يدوياً، يمكنك إضافته للكود: , txid: txid
    await supabase.from('payments').update({ status: 'completed' }).eq('payment_id', paymentId);

    // 4. تمييز المنتج (باستخدام الاسم الصحيح promoted_until)
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 3);

    const { error: updateError } = await supabase
      .from('products')
      .update({ promoted_until: expiry.toISOString() }) // ✅ تأكد أنك سميت العمود هكذا في Supabase
      .eq('id', payRecord.product_id);

    if (updateError) {
      console.error("Product promotion failed:", updateError);
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to promote product." }) };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ completed: true })
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
