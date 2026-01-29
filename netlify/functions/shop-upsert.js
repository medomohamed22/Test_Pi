import { createClient } from "@supabase/supabase-js";

export default async (req) => {
  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const body = await safeJson(req);
    const merchantId = String(body.merchant_id || "").trim();
    const shop = body.shop || {};

    if (!merchantId) {
      return json({ ok: false, error: "MISSING_MERCHANT_ID" }, 400);
    }
    if (!shop || !shop.name || !shop.lat || !shop.lng) {
      return json({ ok: false, error: "MISSING_SHOP_FIELDS" }, 400);
    }
    if (shop.owner_username !== merchantId || shop.merchant_id !== merchantId) {
      return json({ ok: false, error: "MERCHANT_MISMATCH" }, 403);
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: false, error: "MISSING_SUPABASE_ENV" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    const nowIso = new Date().toISOString();

    const { data: subscription, error: subError } = await supabase
      .from("merchant_subscriptions")
      .select("*")
      .eq("merchant_id", merchantId)
      .eq("status", "active")
      .gt("expires_at", nowIso)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subError) {
      console.error("shop-upsert subscription lookup failed", subError);
      return json({ ok: false, error: "SUBSCRIPTION_LOOKUP_FAILED" }, 500);
    }

    if (!subscription) {
      return json({ ok: false, error: "SUBSCRIPTION_REQUIRED" }, 403);
    }

    const isInsert = !shop.id;
    if (isInsert) {
      const { count, error: countError } = await supabase
        .from("shops")
        .select("id", { count: "exact", head: true })
        .eq("merchant_id", merchantId)
        .eq("status", "active");

      if (countError) {
        console.error("shop-upsert count failed", countError);
        return json({ ok: false, error: "STORE_COUNT_FAILED" }, 500);
      }

      if ((count || 0) >= Number(subscription.store_limit || 0)) {
        return json({ ok: false, error: "STORE_LIMIT_REACHED" }, 403);
      }
    }

    const payload = {
      ...shop,
      merchant_id: merchantId,
      owner_username: merchantId,
      status: shop.status || "active",
      updated_at: nowIso
    };

    let result;
    if (isInsert) {
      result = await supabase.from("shops").insert(payload).select("*").single();
    } else {
      result = await supabase.from("shops").update(payload).eq("id", shop.id).select("*").single();
    }

    if (result.error) {
      console.error("shop-upsert write failed", result.error);
      return json({ ok: false, error: "SHOP_UPSERT_FAILED" }, 500);
    }

    return json({ ok: true, shop: result.data }, 200);
  } catch (e) {
    console.error("shop-upsert exception", e);
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
