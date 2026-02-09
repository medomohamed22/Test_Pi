const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // المفتاح القوي
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  // تفعيل CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  const { paymentId } = JSON.parse(event.body);
  console.log(`🚀 Starting Approve for: ${paymentId}`);

  try {
    // 1. تحقق أولاً: هل هذا الدفع مسجل عندنا بالفعل؟ (لمنع الأخطاء عند التكرار)
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('payment_id, status')
      .eq('payment_id', paymentId)
      .single();

    // إذا كان مسجلاً مسبقاً، لا داعي لجلب البيانات من Pi مرة أخرى، انتقل للموافقة فوراً
    let amount, productId, userId;

    if (!existingPayment) {
        console.log("Creating new DB record...");
        
        // جلب البيانات من Pi فقط إذا لم يكن مسجلاً
        const paymentInfoRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
          method: 'GET',
          headers: { 'Authorization': `Key ${PI_API_KEY}` }
        });

        if (!paymentInfoRes.ok) {
            const errText = await paymentInfoRes.text();
            console.error(`❌ Pi API Fetch Error: ${errText}`);
            throw new Error(`Pi API Error: ${errText}`);
        }
        
        const paymentData = await paymentInfoRes.json();
        amount = parseFloat(paymentData.amount);
        productId = paymentData.metadata?.productId;
        userId = paymentData.user_uid;

        // التحقق من المبلغ (3 أو 5)
        const cleanAmount = Math.round(amount);
        if (cleanAmount !== 3 && cleanAmount !== 5) {
          console.error(`❌ Invalid Amount: ${amount}`);
          return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
        }

        // تسجيل الدفع (Upsert لمنع مشاكل التكرار في اللحظة الأخيرة)
        const { error: dbError } = await supabase.from('payments').upsert({
          payment_id: paymentId,
          user_id: userId,
          product_id: productId,
          amount: amount,
          status: 'approved' // الحالة المبدئية
        }, { onConflict: 'payment_id' });

        if (dbError) {
            console.error("❌ DB Insert Error:", dbError);
            // لن نوقف العملية، سنحاول إكمال الموافقة في Pi لحفظ حق المستخدم
        }
    } else {
        console.log("✅ Record already exists in DB, proceeding to approve...");
    }

    // 2. إرسال الموافقة النهائية لـ Pi (أهم خطوة لإنهاء العداد)
    console.log("Sending Approve to Pi...");
    const approveRes = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!approveRes.ok) {
        const approveErr = await approveRes.text();
        console.error(`❌ Pi Approve Failed: ${approveErr}`);
        // ملاحظة: إذا كان الخطأ أن الدفع "تمت الموافقة عليه مسبقاً"، نعتبره نجاحاً
        if (!approveErr.includes("already approved")) {
             throw new Error(`Pi Approve Failed: ${approveErr}`);
        }
    }

    console.log("🎉 Approve Successful!");
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ approved: true })
    };

  } catch (err) {
    console.error("💥 Handler Crash:", err);
    // في حالة الخطأ القاتل، نرجع 500 ليعرف Pi أن هناك مشكلة
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
