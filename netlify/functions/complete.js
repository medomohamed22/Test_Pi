import { createClient } from "@supabase/supabase-js";

export const handler = async (event) => {
  // CORS (اختياري لو بتستدعي من متصفح)
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
      return { statusCode: 400, body: JSON.stringify({ error: "Missing paymentId" }) };
    }

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;

    // انت قلت: "خليه موجود عادي دول بس"
    const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";

    if (!PI_SECRET_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing PI_SECRET_KEY" }) };
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing Supabase URL or key" }) };
    }

    // ✅ هنا استخدمنا publishable/anon
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Get payment info from Pi
    const pr = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });

    const p = await pr.json().catch(() => null);
    if (!pr.ok || !p) {
      return {
        statusCode: pr.status || 500,
        body: JSON.stringify({ error: "Failed to fetch payment", raw: p }),
      };
    }

    // Expected fields from front metadata
    const meta = p.metadata || {};
    const purpose = String(p.purpose || meta.purpose || "");
    const amount = Number(p.amount);

    const adId = meta.adId || meta.ad_id;
    const username = String(meta.username || "");

    if (!adId) return { statusCode: 400, body: JSON.stringify({ error: "Missing adId in payment metadata" }) };
    if (purpose !== "PROMOTE_AD") return { statusCode: 400, body: JSON.stringify({ error: "Invalid purpose", purpose }) };
    if (amount !== 5) return { statusCode: 400, body: JSON.stringify({ error: "Invalid amount", amount }) };
    if (!username) return { statusCode: 400, body: JSON.stringify({ error: "Missing username in metadata" }) };

    // 2) Complete
    const cr = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ txid: txid || p.txid || null }),
    });

    const cdata = await cr.json().catch(() => ({}));

    // لو complete فشل: نحاول نسجل failed (ده محتاج RLS يسمح insert/upsert)
    if (!cr.ok) {
      await sb.from("pi_payments").upsert(
        [{
          payment_id: paymentId,
          txid: txid || null,
          ad_id: adId,
          username,
          amount,
          purpose,
          status: "failed",
          raw: { payment: p, complete: cdata },
        }],
        { onConflict: "payment_id" }
      );

      return { statusCode: cr.status, body: JSON.stringify({ ok: false, error: "Complete failed", data: cdata }) };
    }

    // 3) Verify ad belongs to this seller
    const { data: ad, error: adErr } = await sb
      .from("ads")
      .select("id,seller_username")
      .eq("id", adId)
      .single();

    if (adErr || !ad) return { statusCode: 404, body: JSON.stringify({ error: "Ad not found" }) };
    if (ad.seller_username !== username) return { statusCode: 403, body: JSON.stringify({ error: "Not ad owner" }) };

    // 4) Set promoted for 3 days
    const promotedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const { error: upErr } = await sb
      .from("ads")
      .update({ promoted_until: promotedUntil, promoted_by: username })
      .eq("id", adId);

    if (upErr) {
      return { statusCode: 500, body: JSON.stringify({ error: "Failed to update ad", details: upErr.message }) };
    }

    // 5) Save payment record
    await sb.from("pi_payments").upsert(
      [{
        payment_id: paymentId,
        txid: txid || cdata.txid || p.txid || null,
        ad_id: adId,
        username,
        amount,
        purpose,
        status: "completed",
        approved_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        raw: { payment: p, complete: cdata },
      }],
      { onConflict: "payment_id" }
    );

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: true, promoted_until: promotedUntil }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: String(e) }) };
  }
};
