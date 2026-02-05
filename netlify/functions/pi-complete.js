
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
    
    const uid = piRes.data.user_uid;

    // 2. تحديث حالة الدفع إلى COMPLETED
    const { error: dbError } = await supabase
      .from('payments')
      .update({ status: 'COMPLETED', txid: txid })
      .eq('payment_id', paymentId);
      
    if(dbError) throw new Error("DB Error");

    // 3. إضافة الرصيد للمستخدم (هنا يتم التعديل الآمن)
    // سنجلب الرصيد الحالي ونضيف عليه
    const { data: user } = await supabase.from('users').select('tokens').eq('pi_id', uid).single();
    const newBalance = (user.tokens || 0) + 10; // 10 توكين لكل عملية

    await supabase.from('users').update({ tokens: newBalance }).eq('pi_id', uid);

    return { statusCode: 200, body: JSON.stringify({ success: true, newBalance }) };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
