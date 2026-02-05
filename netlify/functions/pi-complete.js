const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PI_API_KEY = process.env.PI_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { paymentId, txid } = JSON.parse(event.body);

    // 1. إتمام الدفع عند Pi (Complete)
    const piRes = await axios.post(`https://api.minepi.com/v2/payments/${paymentId}/complete`, 
      { txid }, 
      { headers: { 'Authorization': `Key ${PI_API_KEY}` } }
    );
    
    // استخراج بيانات المستخدم والكمية من استجابة Pi API
    const uid = piRes.data.user_uid;
    // استخراج عدد التوكينات من الـ metadata التي أرسلتها من الفرونت إند
    const tokensToIncrease = piRes.data.metadata.quantity || 10; 

    // 2. تحديث حالة الدفع في قاعدة البيانات
    await supabase
      .from('payments')
      .update({ status: 'COMPLETED', txid: txid })
      .eq('payment_id', paymentId);

    // 3. إضافة الرصيد للمستخدم بشكل ديناميكي
    // ملاحظة: يفضل استخدام rpc (Database Function) لتفادي مشاكل التزامن، 
    // ولكن سنستخدم الطريقة البسيطة حالياً بناءً على كودك:
    
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('tokens')
      .eq('pi_id', uid)
      .single();

    if (fetchError) throw new Error("User not found");

    const newBalance = (user.tokens || 0) + tokensToIncrease;

    const { error: updateError } = await supabase
      .from('users')
      .update({ tokens: newBalance })
      .eq('pi_id', uid);
      
    if (updateError) throw new Error("Failed to update balance");

    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        success: true, 
        newBalance, 
        added: tokensToIncrease 
      }) 
    };

  } catch (error) {
    console.error("Payment Error:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
