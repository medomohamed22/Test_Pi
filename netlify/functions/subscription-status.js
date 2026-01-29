export async function handler(event) {
  try {
    if (event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, error: "Missing env vars" });
    }

    const merchant_id = (event.queryStringParameters?.merchant_id || "").trim();
    if (!merchant_id) return json(400, { ok: false, error: "Missing merchant_id" });

    // هات أحدث اشتراك نشط وغير منتهي
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/merchant_subscriptions?merchant_id=eq.${encodeURIComponent(merchant_id)}&status=eq.active&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=started_at.desc&limit=1`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Accept: "application/json",
        },
      }
    );

    const text = await res.text();
    if (!res.ok) return json(res.status, { ok: false, error: text });

    const arr = text ? JSON.parse(text) : [];
    const sub = Array.isArray(arr) && arr[0] ? arr[0] : null;

    return json(200, { ok: true, subscription: sub });
  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  };
}
