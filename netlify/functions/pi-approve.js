
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PI_API_KEY = process.env.PI_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  
  try {
    const { paymentId } = JSON.parse(event.body);
    
    // 1. التحقق من الدفع عند Pi
    const piRes = await axios.get(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });
    const payment = piRes.data;
    
    // 2. تسجيل العملية في قاعدة البيانات (PENDING)
    await supabase.from('payments').insert([{
      payment_id: paymentId,
      user_uid: payment.user_uid,
      amount: payment.amount,
      status: 'PENDING'
    }]);
    
    // 3. الموافقة (Approve)
    await axios.post(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {}, {
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });
    
    return { statusCode: 200, body: JSON.stringify({ message: 'Approved' }) };
    
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
