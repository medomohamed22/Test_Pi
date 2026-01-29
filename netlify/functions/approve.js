
// netlify/functions/approve.js
export default async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ ok: true, note: "method_not_allowed_but_ok" }, 200);
    }

    const { paymentId } = await safeJson(req);
    if (!paymentId) return json({ ok: true, note: "missing_paymentId" }, 200);

    // هنا المفروض تعمل call لـ Pi approve على سيرفرك الحقيقي (Pi Platform API)
    // بس انت قلت: المهم يرجع ok:true عشان الفرونت مايفشلش
    return json({ ok: true }, 200);
  } catch (e) {
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
