import { createClient } from "@supabase/supabase-js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  
  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
    
    // 1) جلب تفاصيل الدفعة من API الخاص بـ Pi
    const pr = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });
    const p = await pr.json();
    
    const meta = p.metadata || {};
    const projectId = meta.projectId;
    const amount = Number(p.amount);

    // 2) إكمال الدفعة (Complete)
    const cr = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/complete`, {
      method: "POST",
      headers: { Authorization: `Key ${PI_SECRET_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ txid: txid || p.txid }),
    });
    const cdata = await cr.json();

    if (!cr.ok) return { statusCode: 400, body: JSON.stringify({ error: "Complete failed" }) };

    // 3) تحديث رصيد المشروع في Supabase (زيادة المبلغ الحالي)
    const { data: project, error: getErr } = await sb.from("projects").select("raised_pi").eq("id", projectId).single();
    if (!getErr && project) {
      const newTotal = Number(project.raised_pi || 0) + amount;
      await sb.from("projects").update({ raised_pi: newTotal }).eq("id", projectId);
    }

    // 4) تسجيل الدفعة في جدول pi_payments
    await sb.from("pi_payments").insert([{
      payment_id: paymentId,
      txid: txid || p.txid,
      project_id: projectId,
      username: p.user_uid, // أو الاسم من الميتاداتا
      amount: amount,
      status: "completed",
      raw: { payment: p, complete: cdata }
    }]);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
