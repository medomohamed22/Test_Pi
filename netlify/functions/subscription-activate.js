import { createClient } from "@supabase/supabase-js";

export default async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const body = await safeJson(req);
    const required = [
      "merchant_id",
      "plan_code",
      "plan_name_ar",
      "store_limit",
      "price_pi",
      "payment_id",
      "payment_txid"
    ];
    for (const key of required) {
      if (body[key] === undefined || body[key] === null || body[key] === "") {
        return json({ ok: false, error: `MISSING_${key.toUpperCase()}` }, 400);
      }
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: false, error: "MISSING_SUPABASE_ENV" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    const now = new Date();
    const startedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const paymentId = String(body.payment_id).trim();
    const paymentTxid = String(body.payment_txid).trim();

    const { data: existing, error: findError } = await supabase
      .from("merchant_subscriptions")
      .select("*")
      .or(`payment_id.eq.${paymentId},payment_txid.eq.${paymentTxid}`)
      .limit(1)
      .maybeSingle();

    if (findError) {
      console.error("subscription-activate lookup failed", findError);
      return json({ ok: false, error: "LOOKUP_FAILED" }, 500);
    }

    if (existing) {
      return json({ ok: true, subscription: existing }, 200);
    }

    const { error: expireError } = await supabase
      .from("merchant_subscriptions")
      .update({ status: "expired", updated_at: now.toISOString() })
      .eq("merchant_id", body.merchant_id)
      .eq("status", "active");

    if (expireError) {
      console.error("subscription-activate expire failed", expireError);
      return json({ ok: false, error: "EXPIRE_FAILED" }, 500);
    }

    const insertPayload = {
      merchant_id: String(body.merchant_id).trim(),
      plan_code: String(body.plan_code).trim(),
      plan_name_ar: String(body.plan_name_ar).trim(),
      store_limit: Number(body.store_limit),
      price_pi: Number(body.price_pi),
      status: "active",
      started_at: startedAt,
      expires_at: expiresAt,
      payment_id: paymentId,
      payment_txid: paymentTxid,
      updated_at: now.toISOString()
    };

    const { data: inserted, error: insertError } = await supabase
      .from("merchant_subscriptions")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError) {
      console.error("subscription-activate insert failed", insertError);
      return json({ ok: false, error: "INSERT_FAILED" }, 500);
    }

    return json({ ok: true, subscription: inserted }, 200);
  } catch (e) {
    console.error("subscription-activate exception", e);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function safeJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
