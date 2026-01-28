// netlify/functions/pi-approve.js
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing paymentId" }) };
    }

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Missing PI_SECRET_KEY" }) };
    }

    const PI_API_BASE = "https://api.minepi.com/v2";

    const r = await fetch(`${PI_API_BASE}/payments/${encodeURIComponent(paymentId)}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const data = await r.json().catch(() => ({}));

    // Pi أحيانًا يرجّع خطأ لو already approved — نعتبرها ok
    if (r.ok) {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, approved: true, data }),
      };
    }

    // لو already approved (حسب شكل الرسالة) تعامل كـ ok
    const msg = JSON.stringify(data || {}).toLowerCase();
    if (msg.includes("already") && msg.includes("approve")) {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, approved: true, data, note: "already_approved" }),
      };
    }

    return {
      statusCode: r.status || 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: "Approve failed", data }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: "Server error", details: String(err?.message || err) }),
    };
  }
};
