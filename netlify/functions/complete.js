const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // ✅ المفتاح القوي
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body);
    console.log(`Completing Payment: ${paymentId}`);

    // 1. إبلاغ Pi بالاكتمال (ضروري جداً)
    const piResponse = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    if (!piResponse.ok) console.log("Pi Complete Warning:", await piResponse.text());

    // 2. جلب بيانات الدفع لمعرفة المبلغ المدفوع
    const { data: payRecord, error: findError } = await supabase
      .from('payments')
      .select('product_id, amount')
      .eq('payment_id', paymentId)
      .single();

    if (findError || !payRecord) {
       console.error("Record not found:", findError);
       return { statusCode: 404, body: JSON.stringify({ error: "Payment record not found" }) };
    }

    // 3. تحديث حالة الدفع
    await supabase.from('payments').update({ status: 'completed', txid: txid }).eq('payment_id', paymentId);

    // 4. حساب مدة التمييز (3 أيام أو 7 أيام)
    let daysToAdd = 3;
    const amount = Number(payRecord.amount);
    
    // إذا كان المبلغ 5 أو أكثر، نمنح 7 أيام
    if (amount >= 4.9) { 
        daysToAdd = 7;
    }

    // 5. حساب تاريخ الانتهاء
    // نجلب تاريخ الانتهاء الحالي للمنتج (إذا كان مميزاً بالفعل) لنضيف عليه
    const { data: product } = await supabase.from('products').select('promoted_until').eq('id', payRecord.product_id).single();
    
    let expiry = new Date();
    // لو المنتج لسه مميز، نبدأ العد من تاريخ انتهائه الحالي
    if (product && product.promoted_until && new Date(product.promoted_until) > new Date()) {
        expiry = new Date(product.promoted_until);
    }
    
    // إضافة الأيام
    expiry.setDate(expiry.getDate() + daysToAdd);

    // 6. تحديث المنتج
    const { error: updateError } = await supabase
      .from('products')
      .update({ promoted_until: expiry.toISOString() })
      .eq('id', payRecord.product_id);

    if (updateError) {
        console.error("Product Update Failed:", updateError);
        return { statusCode: 500, body: JSON.stringify({ error: "Product update failed" }) };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ completed: true, days: daysToAdd })
    };

  } catch (err) {
    console.error("Complete Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
