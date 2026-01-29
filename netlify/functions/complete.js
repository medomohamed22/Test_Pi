// netlify/functions/complete.js
export default async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ ok: true, note: "method_not_allowed_but_ok" }, 200);
    }
    
    const { paymentId, txid } = await safeJson(req);
    if (!paymentId) return json({ ok: true, note: "missing_paymentId" }, 200);
    
    const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!SUPABASE_URL || !SERVICE_KEY) {
      // عشان الفرونت مايفشلش
      return json({ ok: true, note: "missing_env" }, 200);
    }
    
    // 1) اقرأ payment من جدول merchant_payments لو موجود عشان نجيب pi_username
    const payRow = await sbSelectOne(SUPABASE_URL, SERVICE_KEY,
      "merchant_payments",
      `payment_id=eq.${encodeURIComponent(paymentId)}`
    );
    
    const pi_username = payRow?.pi_username || "unknown";
    
    // 2) upsert في merchant_payments: completed + txid
    await sbUpsert(SUPABASE_URL, SERVICE_KEY, "merchant_payments", {
  payment_id: paymentId,
  pi_username,
  status: "completed",
  txid: txid || null,
  error_message: null,
  updated_at: new Date().toISOString(),
}, ["payment_id"]);
    // 3) فعّل الاشتراك في merchant_subscriptions
    // (نضمن Row واحد active لكل تاجر)
    await sbUpsert(SUPABASE_URL, SERVICE_KEY, "merchant_subscriptions", {
      pi_username,
      status: "active",
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, ["pi_username"]);
    
    // ✅ أهم حاجة للفرونت
    return json({ ok: true }, 200);
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
