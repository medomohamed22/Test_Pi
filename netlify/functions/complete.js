const { createClient } = require("@supabase/supabase-js");
const fetch = require("node-fetch"); // تأكد من تثبيته أو استخدامه إذا كان متاحاً

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  
  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    const sb = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SECRETS_SCAN_OMIT_KEYS);

    // 1. التحقق من الدفعة
    const pr = await fetch(`https://api.minepi.com/v2/payments/${paymentId}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` }
    });
    const p = await pr.json();
    if (!pr.ok) return { statusCode: 400, body: "Payment verification failed" };

    const projectId = p.metadata.projectId;
    const amount = Number(p.amount);

    // 2. إكمال الدفعة في Pi Network
    const cr = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: "POST",
      headers: { Authorization: `Key ${PI_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ txid: txid || p.txid })
    });
    if (!cr.ok) return { statusCode: 400, body: "Completion failed" };

    // 3. تحديث الرصيد في قاعدة البيانات
    const { data: project } = await sb.from("projects").select("raised_pi").eq("id", projectId).single();
    const newTotal = (Number(project.raised_pi) || 0) + amount;
    
    await sb.from("projects").update({ raised_pi: newTotal }).eq("id", projectId);

    // 4. تسجيل الدفعة
    await sb.from("pi_payments").insert([{
      payment_id: paymentId,
      txid: txid || p.txid,
      project_id: projectId,
      amount: amount,
      status: "completed"
    }]);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
