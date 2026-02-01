
// netlify/functions/approve.js
export default async (req) => {
  try {
    if (req.method !== "POST") {
      // عشان الفرونت مايفشلش
      return json({ ok: true, note: "method_not_allowed_but_ok" }, 200);
    }

    const { paymentId } = await safeJson(req);
    if (!paymentId) return json({ ok: true, note: "missing_paymentId" }, 200);

    // ✅ Pi Secret Key (رجعناه)
    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) return json({ ok: true, note: "missing_PI_SECRET_KEY" }, 200);

    // ✅ Approve on Pi API
    const r = await fetch(
      `https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/approve`,
      {
        method: "POST",
        headers: {
          Authorization: `Key ${PI_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await r.json().catch(() => ({}));

    // ✅ مهم: حتى لو approve فشل، منرجعش fail للفرونت
    // بس بنوضح note + status
    return json(
      { ok: true, pi_ok: !!r.ok, status: r.status, data },
      200
    );
  } catch (e) {
    // ✅ حتى لو حصل خطأ… الفرونت مايفشلش
    return json({ ok: true, note: "approve_exception", error: String(e) }, 200);
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
