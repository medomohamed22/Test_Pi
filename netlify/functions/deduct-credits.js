
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  
  try {
    const { uid } = JSON.parse(event.body);
    
    // 1. جلب بيانات المستخدم
    const { data: user } = await supabase.from('users').select('tokens').eq('pi_id', uid).single();
    
    if (!user || user.tokens < 1) {
      return { statusCode: 403, body: JSON.stringify({ error: 'رصيد غير كافي' }) };
    }
    
    // 2. خصم 1 توكين
    const { error } = await supabase
      .from('users')
      .update({ tokens: user.tokens - 1 })
      .eq('pi_id', uid);
    
    if (error) throw error;
    
    return { statusCode: 200, body: JSON.stringify({ success: true, remaining: user.tokens - 1 }) };
    
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
