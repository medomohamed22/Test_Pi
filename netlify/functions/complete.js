// netlify/functions/complete.js
export default async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ ok: true, note: "method_not_allowed_but_ok" }, 200);
    }

    const { paymentId, txid } = await safeJson(req);
    if (!paymentId) return json({ ok: true, note: "missing_paymentId" }, 200);

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) return json({ ok: true, note: "missing_PI_SECRET_KEY" }, 200);

    const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL; // ✅ صح
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: true, note: "missing_env" }, 200);
    }

    // 0) Get payment from Pi (for metadata username)
    const pr = await fetch(
      `https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `Key ${PI_SECRET_KEY}` } }
    );
    const p = await pr.json().catch(() => null);

    const meta = (p && typeof p === "object") ? (p.metadata || {}) : {};
    const metaUser = String(meta.username || meta.pi_username || meta.user || "").trim();

    // 1) read from merchant_payments
    const payRow = await sbSelectOne(
      SUPABASE_URL,
      SERVICE_KEY,
      "merchant_payments",
      `payment_id=eq.${encodeURIComponent(paymentId)}`
    );

    const pi_username = String(payRow?.pi_username || metaUser || "unknown").trim() || "unknown";

    // 2) Complete on Pi
    const cr = await fetch(
      `https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/complete`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${PI_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ txid: txid || p?.txid || null }),
      }
    );
    const cdata = await cr.json().catch(() => ({}));

    const payStatus = cr.ok ? "completed" : "complete_failed";

    // 3) upsert merchant_payments (بدون raw)
    await sbUpsertOrThrow(
      SUPABASE_URL,
      SERVICE_KEY,
      "merchant_payments",
      {
        payment_id: paymentId,
        pi_username,
        status: payStatus,
        txid: txid || cdata?.txid || p?.txid || null,
        error_message: cr.ok ? null : String(cdata?.error || cdata?.message || "pi_complete_failed"),
        updated_at: new Date().toISOString(),
      },
      ["payment_id"]
    );

    // 4) activate subscription only if complete ok
    if (cr.ok) {
      await sbUpsertOrThrow(
        SUPABASE_URL,
        SERVICE_KEY,
        "merchant_subscriptions",
        {
          pi_username,
          status: "active",
          activated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        ["pi_username"]
      );
    }

    return json({ ok: true, pi_ok: !!cr.ok, pi_status: cr.status }, 200);
  } catch (e) {
    return json({ ok: true, note: "complete_exception", error: String(e) }, 200);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}

// -------- Supabase REST helpers --------

async function sbSelectOne(url, key, table, filterQuery) {
  const r = await fetch(`${url}/rest/v1/${table}?select=*&${filterQuery}&limit=1`, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "count=none",
    },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) return null;
  return Array.isArray(j) ? (j[0] || null) : null;
}

async function sbUpsertOrThrow(url, key, table, payload, onConflictCols = []) {
  const onConflict = onConflictCols.length ? `?on_conflict=${onConflictCols.join(",")}` : "";
  const r = await fetch(`${url}/rest/v1/${table}${onConflict}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Supabase upsert failed (${table}) status=${r.status} body=${t}`);
  }
}
