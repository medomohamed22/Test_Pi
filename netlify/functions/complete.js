// netlify/functions/pi-complete.js
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
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing paymentId" }) };
    }

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "Missing PI_SECRET_KEY" }) };
    }

    const PI_API_BASE = "https://api.minepi.com/v2";

    // 1) هات تفاصيل الدفع من Pi عشان نجيب txid لو مش متبعت
    const pr = await fetch(`${PI_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });
    const p = await pr.json().catch(() => ({}));

    if (!pr.ok) {
      return {
        statusCode: pr.status || 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: false, error: "Failed to fetch payment", data: p }),
      };
    }

    const effectiveTxid =
      txid ||
      p?.txid ||
      p?.transaction?.txid ||
      p?.transaction?.id ||
      null;

    // مهم: لو المستخدم لسه ما كملش من ناحية Pi، txid هتبقى null
    if (!effectiveTxid) {
      return {
        statusCode: 409,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          ok: false,
          error: "Missing txid (user likely hasn't completed payment in Pi yet)",
          hint: "Open the pending payment in Pi and complete it, then retry.",
          payment: p,
        }),
      };
    }

    // 2) Complete
    const cr = await fetch(`${PI_API_BASE}/payments/${encodeURIComponent(paymentId)}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ txid: effectiveTxid }),
    });

    const c = await cr.json().catch(() => ({}));

    if (cr.ok) {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, completed: true, txid: effectiveTxid, data: c }),
      };
    }

    // لو already completed نعتبرها ok
    const msg = JSON.stringify(c || {}).toLowerCase();
    if (msg.includes("already") && msg.includes("complete")) {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ ok: true, completed: true, txid: effectiveTxid, data: c, note: "already_completed" }),
      };
    }

    return {
      statusCode: cr.status || 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: "Complete failed", txid: effectiveTxid, data: c }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: "Server error", details: String(err?.message || err) }),
    };
  }
};
