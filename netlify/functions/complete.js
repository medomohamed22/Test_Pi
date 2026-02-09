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

    // 1. إبلاغ Pi بالاكتمال (أهم خطوة)
    const piResponse = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    // تجاهل خطأ "تم الإكمال مسبقاً" لنكمل باقي الخطوات
    if (!piResponse.ok) {
        console.log("⚠️ Pi API Msg:", await piResponse.text());
    }

    // 2. تحديد المنتج والمبلغ (من الداتا بيز أو من Pi)
    let productId = null;
    let amount = 0;
    let userId = null;

    // أ) نحاول نجيبهم من الداتا بيز
    const { data: dbData } = await supabase
      .from('payments')
      .select('product_id, amount, user_id')
      .eq('payment_id', paymentId)
      .single();

    // ب) لو البيانات موجودة وسليمة
    if (dbData && dbData.product_id) {
        console.log("✅ Found valid record in DB");
        productId = dbData.product_id;
        amount = Number(dbData.amount);
        userId = dbData.user_id;
        
        // تحديث الحالة
        await supabase.from('payments').update({ status: 'completed', txid: txid }).eq('payment_id', paymentId);
    
    } else {
        // ج) لو البيانات مش موجودة أو (product_id = null) -> نلجأ لـ Pi API
        console.log("⚠️ Data missing in DB. Fetching from Pi API...");
        
        const piInfoRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
            headers: { 'Authorization': `Key ${PI_API_KEY}` }
        });

        if (!piInfoRes.ok) throw new Error("Failed to recover payment data from Pi");
        
        const piData = await piInfoRes.json();
        
        // استخراج البيانات بدقة
        productId = piData.metadata?.productId; 
        amount = parseFloat(piData.amount);
        userId = piData.user_uid;

        if (!productId) {
            console.error("❌ Fatal: Product ID is missing in Pi Metadata");
            return { statusCode: 400, body: JSON.stringify({ error: "Product ID missing" }) };
        }

        // إصلاح/تسجيل السجل في الداتا بيز
        await supabase.from('payments').upsert({
            payment_id: paymentId,
            user_id: userId,
            product_id: productId,
            amount: amount,
            status: 'completed',
            txid: txid
        });
    }

    // تأكيد أخير قبل التحديث
    if (!productId) {
        return { statusCode: 400, body: JSON.stringify({ error: "Product ID not found" }) };
    }

    // 3. حساب مدة التمييز
    let daysToAdd = 3;
    if (amount >= 4.9) daysToAdd = 7;
    
    console.log(`🎁 Promoting Product ${productId} for ${daysToAdd} days`);

    // 4. تحديث المنتج
    const { data: product } = await supabase.from('products').select('promoted_until').eq('id', productId).single();
    
    let expiry = new Date();
    if (product && product.promoted_until && new Date(product.promoted_until) > new Date()) {
        expiry = new Date(product.promoted_until);
    }
    
    expiry.setDate(expiry.getDate() + daysToAdd);

    const { error: updateError } = await supabase
      .from('products')
      .update({ promoted_until: expiry.toISOString() })
      .eq('id', productId);

    if (updateError) {
        console.error("❌ Product Update Failed:", updateError);
        // لا نرجع خطأ هنا لأن الدفع تم بالفعل، فقط نسجل الخطأ
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ completed: true, days: daysToAdd })
    };

  } catch (err) {
    console.error("💥 Critical Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
