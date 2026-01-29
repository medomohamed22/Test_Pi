// netlify/functions/complete.js
export default async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ ok: true, note: "method_not_allowed_but_ok" }, 200);
    }

    const { paymentId, txid } = await safeJson(req);
    if (!paymentId) return json({ ok: true, note: "missing_paymentId" }, 200);

    // ✅ Pi Secret Key (رجعناه)
    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) return json({ ok: true, note: "missing_PI_SECRET_KEY" }, 200);

    // ✅ Supabase Service Role
    const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY; // مهم: KEY مش ROLE

    if (!SUPABASE_URL || !SERVICE_KEY) {
      // عشان الفرونت مايفشلش
      return json({ ok: true, note: "missing_env" }, 200);
    }

    // 0) (اختياري لكن مفيد) هات تفاصيل الدفع من Pi عشان نجيب username من metadata لو مش موجود عندنا
    const pr = await fetch(
      `https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `Key ${PI_SECRET_KEY}` } }
    );
    const p = await pr.json().catch(() => null);

    // استخرج username من metadata لو موجود
    const meta = (p && typeof p === "object") ? (p.metadata || {}) : {};
    const metaUser =
      String(meta.username || meta.pi_username || meta.user || "").trim();

    // 1) اقرأ payment من جدول merchant_payments لو موجود عشان نجيب pi_username
    const payRow = await sbSelectOne(
      SUPABASE_URL,
      SERVICE_KEY,
      "merchant_payments",
      `payment_id=eq.${encodeURIComponent(paymentId)}`
    );

    const pi_username = (payRow?.pi_username || metaUser || "unknown").trim() || "unknown";

    // 2) Complete على Pi API
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

    // 3) سجّل في merchant_payments (upsert)
    // - لو Pi complete فشل: نخزن failed/complete_failed
    // - لو نجح: نخزن completed
    const status = cr.ok ? "completed" : "complete_failed";

    await sbUpsert(
      SUPABASE_URL,
      SERVICE_KEY,
      "merchant_payments",
      {
        payment_id: paymentId,
        pi_username,
        status,
        txid: txid || cdata?.txid || p?.txid || null,
        error_message: cr.ok ? null : (cdata?.error || cdata?.message || "pi_complete_failed"),
        updated_at: new Date().toISOString(),
        raw: { pi_payment: p, pi_complete: cdata }, // اختياري لو عندك عمود raw jsonb
      },
      ["payment_id"]
    );

    // 4) فعّل الاشتراك فقط لو الـ complete نجح
    if (cr.ok) {
      await sbUpsert(
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

    // ✅ أهم حاجة: الفرونت
    return json({ ok: true, pi_ok: !!cr.ok, status: cr.status }, 200);

  } catch (e) {
    // ✅ حتى لو حصل خطأ… الفرونت مايفشلش
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

// -------- Supabase REST helpers (بدون مكتبة) --------

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

async function sbUpsert(url, key, table, payload, onConflictCols = []) {
  const onConflict = onConflictCols.length ? `?on_conflict=${onConflictCols.join(",")}` : "";
  await fetch(`${url}/rest/v1/${table}${onConflict}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
  });
}
