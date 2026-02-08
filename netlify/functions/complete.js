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

    // 1. إكمال الدفع في Pi Network
    const piResponse = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    // ملاحظة: حتى لو ردت Pi بخطأ (مثلاً Payment already completed)، يجب أن نحاول تحديث قاعدتنا لضمان التزامن
    if (!piResponse.ok) {
        console.log("Pi API Warning:", await piResponse.text());
    }

    // 2. البحث عن سجل الدفع
    const { data: payRecord, error: findError } = await supabase
      .from('payments')
      .select('product_id')
      .eq('payment_id', paymentId)
      .single();

    // 🔴 تحسين 1: التعامل مع عدم وجود السجل
    if (findError || !payRecord) {
       console.error("Payment record not found:", findError);
       return { 
         statusCode: 404, 
         body: JSON.stringify({ error: "Payment record not found in database. Please contact support." }) 
       };
    }

    // 3. تحديث حالة الدفع
    const { error: paymentUpdateError } = await supabase
        .from('payments')
        .update({ status: 'completed', txid: txid })
        .eq('payment_id', paymentId);

    if (paymentUpdateError) console.error("Payment status update failed:", paymentUpdateError);

    // 4. تمييز المنتج
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 3);

    // 🔴 تحسين 2: التأكد من نجاح تحديث المنتج
    const { error: productUpdateError } = await supabase
      .from('products')
      .update({ promoted_until: expiry.toISOString() })
      .eq('id', payRecord.product_id);

    if (productUpdateError) {
      console.error("Product promotion failed:", productUpdateError);
      return { 
        statusCode: 500, 
        body: JSON.stringify({ error: "Payment succeeded but failed to promote product." }) 
      };
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
