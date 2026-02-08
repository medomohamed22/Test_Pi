

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Service Role Key
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  // تفعيل CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body);

    // 1. Complete في Pi Network
    const piResponse = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    if (!piResponse.ok) throw new Error('Pi Complete failed');
    const piData = await piResponse.json();

    // 2. تحديث Supabase (تمييز المنتج)
    const { data: payRecord } = await supabase.from('payments').select('product_id').eq('payment_id', paymentId).single();
    
    if (payRecord) {
        await supabase.from('payments').update({ status: 'completed', txid: txid }).eq('payment_id', paymentId);
        
        // تمييز المنتج لمدة 3 أيام
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 3);
        
        await supabase.from('products').update({ promoted_until: expiry.toISOString() }).eq('id', payRecord.product_id);
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ completed: true })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
