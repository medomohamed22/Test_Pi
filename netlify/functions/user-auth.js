const { createClient } = require('@supabase/supabase-js');

// استخدم مفتاح SERVICE_ROLE لكي يمتلك الباك اند صلاحية التعديل
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  
  try {
    const { uid, username } = JSON.parse(event.body);
    
    // التحقق هل المستخدم موجود؟
    let { data: user } = await supabase.from('users').select('*').eq('pi_id', uid).single();
    
    if (!user) {
      // إنشاء مستخدم جديد (يتم هنا في السيرفر لضمان الأمان)
      const { data: newUser, error } = await supabase
        .from('users')
        .insert([{ pi_id: uid, username: username, tokens: 0 }]) // 0 توكين هدية
        .select().single();
      
      if (error) throw error;
      user = newUser;
    }
    
    return { statusCode: 200, body: JSON.stringify(user) };
    
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
