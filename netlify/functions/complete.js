
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  // السماح فقط بطلبات POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    
    // جلب المتغيرات السرية من بيئة Netlify
    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    const SB_URL = process.env.medo; 
    const SB_SERVICE_KEY = process.env.mohamed;

    const sb = createClient(SB_URL, SB_SERVICE_KEY);

    // 1. التحقق من حالة الدفع من سيرفرات Pi
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });
    
    const payment = await response.json();
    if (!response.ok) {
      return { statusCode: 400, body: JSON.stringify({ error: "فشل التحقق من الدفعة" }) };
    }

    // استخراج البيانات من الميتاداتا
    const projectId = payment.metadata.projectId; // الـ UUID الخاص بالمشروع
    const amount = Number(payment.amount);

    // 2. إرسال أمر الإكمال (Complete) لشبكة Pi
    const completeRes = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ txid: txid || payment.txid }),
    });

    if (!completeRes.ok) {
      return { statusCode: 400, body: JSON.stringify({ error: "فشل تأكيد الإكمال في شبكة Pi" }) };
    }

    // 3. تحديث إجمالي التبرعات في جدول المشاريع (الربط باستخدام UUID)
    // نجلب القيمة الحالية أولاً
    const { data: project } = await sb
      .from("projects")
      .select("raised_pi")
      .eq("id", projectId)
      .single();

    if (project) {
      const newTotal = (Number(project.raised_pi) || 0) + amount;
      await sb
        .from("projects")
        .update({ raised_pi: newTotal })
        .eq("id", projectId);
    }

    // 4. تسجيل العملية في جدول المدفوعات للتوثيق
    await sb.from("pi_payments").insert([{
      payment_id: paymentId,
      txid: txid || payment.txid,
      project_id: projectId,
      username: payment.user_uid,
      amount: amount,
      status: "completed"
    }]);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "تم تحديث المشروع وتسجيل الدفع" }),
    };

  } catch (error) {
    console.error("Internal Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "خطأ داخلي في السيرفر", details: error.message }),
    };
  }
};
