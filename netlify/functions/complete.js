import { createClient } from "@supabase/supabase-js";

const REQUIRED_PURPOSE = "MERCHANT_SUBSCRIPTION";
const REQUIRED_AMOUNT = 1;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId) return { statusCode: 400, body: JSON.stringify({ error: "Missing paymentId" }) };

    const PI_SECRET_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";
    const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
    const SUPABASE_SERVICE_ROLE = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    const pr = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });

    const p = await pr.json().catch(() => null);
    if (!pr.ok || !p) return { statusCode: pr.status || 500, body: JSON.stringify({ error: "Failed to fetch payment", raw: p }) };

    const meta = p.metadata || {};
    const purpose = String(p.purpose || meta.purpose || "");
    const amount = Number(p.amount);
    const username = String(meta.username || "");

    if (purpose !== REQUIRED_PURPOSE) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid purpose", purpose }) };
    }
    if (amount !== REQUIRED_AMOUNT) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid amount", amount }) };
    }
    if (!username) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing username in metadata" }) };
    }

    const cr = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ txid: txid || p.txid || null }),
    });

    const cdata = await cr.json().catch(() => ({}));
    if (!cr.ok) {
      await sb.from("merchant_payments").upsert([{
        payment_id: paymentId,
        pi_username: username,
        amount,
        purpose,
        status: "failed",
        txid: txid || null,
        raw: { payment: p, complete: cdata }
      }], { onConflict: "payment_id" });

      return { statusCode: cr.status, body: JSON.stringify({ ok: false, error: "Complete failed", data: cdata }) };
    }

    await sb.from("merchant_subscriptions").upsert([{
      pi_username: username,
      payment_id: paymentId,
      status: "active"
    }], { onConflict: "pi_username" });

    await sb.from("merchant_payments").upsert([{
      payment_id: paymentId,
      pi_username: username,
      amount,
      purpose,
      status: "completed",
      txid: txid || cdata.txid || p.txid || null,
      approved_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      raw: { payment: p, complete: cdata }
    }], { onConflict: "payment_id" });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: String(e) }) };
  }
};
