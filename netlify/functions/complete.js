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

  try {
    const { paymentId, txid } = JSON.parse(event.body);
    console.log(`🔄 Completing Payment: ${paymentId}`);

    // 1. إبلاغ سيرفرات Pi باكتمال الدفع (أهم خطوة لضمان تحويل العملات)
    const piResponse = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    if (!piResponse.ok) {
        console.log("⚠️ Pi Complete Warning:", await piResponse.text());
        // نكمل حتى لو كان هناك تحذير (مثل "تم الإكمال مسبقاً")
    }

    // 2. محاولة جلب البيانات من قاعدة البيانات
    let payRecord = null;
    let productId = null;
    let amount = 0;

    const { data: dbData, error: dbError } = await supabase
      .from('payments')
      .select('product_id, amount')
      .eq('payment_id', paymentId)
      .single();

    if (dbData) {
        console.log("✅ Found record in DB");
        payRecord = dbData;
        productId = dbData.product_id;
        amount = Number(dbData.amount);
        
        // تحديث الحالة في الداتابيز
        await supabase.from('payments').update({ status: 'completed', txid: txid }).eq('payment_id', paymentId);
    
    } else {
        // 🔥 الإنقاذ الذكي: السجل غير موجود في الداتابيز؟ هاته من Pi مباشرة!
        console.log("⚠️ Record missing in DB! Fetching from Pi API...");
        
        const piInfoRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
            headers: { 'Authorization': `Key ${PI_API_KEY}` }
        });

        if (!piInfoRes.ok) throw new Error("Could not fetch payment data from Pi fallback");
        
        const piData = await piInfoRes.json();
        productId = piData.metadata.productId; // لاحظ: يجب أن تكون productId (case sensitive)
        amount = parseFloat(piData.amount);
        
        // تسجيل العملية في الداتابيز لتوثيقها (حتى لا تضيع)
        await supabase.from('payments').insert({
            payment_id: paymentId,
            user_id: piData.user_uid,
            product_id: productId,
            amount: amount,
            status: 'completed',
            txid: txid
        });
    }

    // 3. حساب مدة التمييز (المنطق الديناميكي)
    let daysToAdd = 3; // الافتراضي
    if (amount >= 4.9) { 
        daysToAdd = 7;
    }
    console.log(`🎁 Awarding ${daysToAdd} days for amount: ${amount}`);

    // 4. تحديث تاريخ انتهاء المنتج
    const { data: product } = await supabase.from('products').select('promoted_until').eq('id', productId).single();
    
    let expiry = new Date();
    // لو المنتج مميز بالفعل، نضيف المدة فوق التاريخ الحالي
    if (product && product.promoted_until && new Date(product.promoted_until) > new Date()) {
        expiry = new Date(product.promoted_until);
    }
    
    expiry.setDate(expiry.getDate() + daysToAdd);

    // 5. تطبيق التمييز في قاعدة البيانات
    const { error: updateError } = await supabase
      .from('products')
      .update({ promoted_until: expiry.toISOString() })
      .eq('id', productId);

    if (updateError) {
        console.error("❌ Promotion Failed:", updateError);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to promote product" }) };
    }

    console.log("✅ Product Promoted Successfully!");
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ completed: true, days: daysToAdd })
    };

  } catch (err) {
    console.error("💥 Complete Handler Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
