const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);

    // 1. جلب بيانات الدفع من Pi API للتأكد
    const pr = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });
    const p = await pr.json();

    if (!pr.ok) return { statusCode: 400, body: JSON.stringify({ error: "Pi Payment not found" }) };

    const meta = p.metadata || {};
    const projectId = meta.projectId; // هذا هو الـ UUID
    const amount = Number(p.amount);

    // 2. إرسال أمر الإكمال لـ Pi Network
    const cr = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ txid: txid || p.txid }),
    });
    const cdata = await cr.json();

    if (!cr.ok) return { statusCode: 400, body: JSON.stringify({ error: "Complete step failed" }) };

    // 3. تحديث رصيد المشروع في قاعدة البيانات باستخدام RPC أو Update
    // نقوم بجلب الرصيد الحالي أولاً
    const { data: project, error: fetchErr } = await sb
      .from("projects")
      .select("raised_pi")
      .eq("id", projectId)
      .single();

    if (project) {
      const newRaised = (Number(project.raised_pi) || 0) + amount;
      await sb.from("projects").update({ raised_pi: newRaised }).eq("id", projectId);
    }

    // 4. تسجيل العملية في جدول المدفوعات
    await sb.from("pi_payments").insert([{
      payment_id: paymentId,
      txid: txid || p.txid,
      project_id: projectId,
      username: p.user_uid,
      amount: amount,
      status: "completed",
      raw: { payment: p, complete: cdata }
    }]);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, message: "Payment processed and project updated" }),
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server Error", details: String(e) }) };
  }
};
