const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "MISSING_SUPABASE_ENV" }, 500);
    }

    const token = getBearerToken(event.headers || {});
    if (!token) {
      return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }

    const username = await verifyPiToken(token);
    if (!username) {
      return json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    const method = event.httpMethod || "GET";
    if (method === "GET") {
      const { data, error } = await supabase
        .from("shops")
        .select("*")
        .or(`merchant_id.eq.${username},owner_username.eq.${username}`)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("my-shops list failed", error);
        return json({ ok: false, error: "LIST_FAILED" }, 500);
      }

      return json({ ok: true, shops: data || [] }, 200);
    }

    if (method === "POST") {
      const body = safeJson(event.body);
      const name = String(body.name || "").trim();
      const lat = body.lat;
      const lng = body.lng;

      if (!name || typeof lat !== "number" || typeof lng !== "number") {
        return json({ ok: false, error: "MISSING_SHOP_FIELDS" }, 400);
      }

      const nowIso = new Date().toISOString();

      const { data: subscription, error: subError } = await supabase
        .from("merchant_subscriptions")
        .select("*")
        .eq("merchant_id", username)
        .eq("status", "active")
        .gt("expires_at", nowIso)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subError) {
        console.error("my-shops subscription lookup failed", subError);
        return json({ ok: false, error: "SUBSCRIPTION_LOOKUP_FAILED" }, 500);
      }

      if (!subscription) {
        return json({ ok: false, error: "SUBSCRIPTION_REQUIRED" }, 403);
      }

      const { count, error: countError } = await supabase
        .from("shops")
        .select("id", { count: "exact", head: true })
        .eq("merchant_id", username)
        .eq("status", "active");

      if (countError) {
        console.error("my-shops count failed", countError);
        return json({ ok: false, error: "STORE_COUNT_FAILED" }, 500);
      }

      if ((count || 0) >= Number(subscription.store_limit || 0)) {
        return json({ ok: false, error: "STORE_LIMIT_REACHED" }, 403);
      }

      const payload = buildShopPayload(body, username);
      const { data, error } = await supabase
        .from("shops")
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        console.error("my-shops insert failed", error);
        return json({ ok: false, error: "SHOP_CREATE_FAILED" }, 500);
      }

      return json({ ok: true, shop: data }, 200);
    }

    if (method === "PUT") {
      const body = safeJson(event.body);
      const id = body.id;
      if (!id) {
        return json({ ok: false, error: "MISSING_SHOP_ID" }, 400);
      }

      const { data: existing, error: findError } = await supabase
        .from("shops")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (findError) {
        console.error("my-shops lookup failed", findError);
        return json({ ok: false, error: "SHOP_LOOKUP_FAILED" }, 500);
      }

      if (!existing) {
        return json({ ok: false, error: "SHOP_NOT_FOUND" }, 404);
      }

      if (existing.merchant_id !== username && existing.owner_username !== username) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }

      const updates = buildShopUpdates(body);
      if (!Object.keys(updates).length) {
        return json({ ok: false, error: "NO_UPDATES" }, 400);
      }

      updates.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from("shops")
        .update(updates)
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        console.error("my-shops update failed", error);
        return json({ ok: false, error: "SHOP_UPDATE_FAILED" }, 500);
      }

      return json({ ok: true, shop: data }, 200);
    }

    if (method === "DELETE") {
      const id = event.queryStringParameters?.id;
      if (!id) {
        return json({ ok: false, error: "MISSING_SHOP_ID" }, 400);
      }

      const { data: existing, error: findError } = await supabase
        .from("shops")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (findError) {
        console.error("my-shops lookup failed", findError);
        return json({ ok: false, error: "SHOP_LOOKUP_FAILED" }, 500);
      }

      if (!existing) {
        return json({ ok: false, error: "SHOP_NOT_FOUND" }, 404);
      }

      if (existing.merchant_id !== username && existing.owner_username !== username) {
        return json({ ok: false, error: "FORBIDDEN" }, 403);
      }

      const { data, error } = await supabase
        .from("shops")
        .update({ status: "inactive", updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();

      if (error) {
        console.error("my-shops delete failed", error);
        return json({ ok: false, error: "SHOP_DELETE_FAILED" }, 500);
      }

      return json({ ok: true, shop: data }, 200);
    }

    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  } catch (error) {
    console.error("my-shops error", error);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
};

function json(body, statusCode = 200) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

function safeJson(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function getBearerToken(headers) {
  const auth = headers.authorization || headers.Authorization || "";
  const [type, token] = auth.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
}

async function verifyPiToken(token) {
  try {
    const res = await fetch("https://api.minepi.com/v2/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.username || data?.user?.username || null;
  } catch (error) {
    console.error("Pi verify failed", error);
    return null;
  }
}

function buildShopPayload(body, username) {
  return {
    merchant_id: username,
    owner_username: username,
    name: String(body.name || "").trim(),
    description: body.description ? String(body.description).trim() : null,
    address: body.address ? String(body.address).trim() : null,
    lat: body.lat,
    lng: body.lng,
    image_url: body.image_url ? String(body.image_url).trim() : null,
    status: body.status ? String(body.status).trim() : "active"
  };
}

function buildShopUpdates(body) {
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    updates.name = String(body.name || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    updates.description = body.description ? String(body.description).trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "address")) {
    updates.address = body.address ? String(body.address).trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "lat")) {
    updates.lat = body.lat;
  }
  if (Object.prototype.hasOwnProperty.call(body, "lng")) {
    updates.lng = body.lng;
  }
  if (Object.prototype.hasOwnProperty.call(body, "image_url")) {
    updates.image_url = body.image_url ? String(body.image_url).trim() : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    updates.status = body.status ? String(body.status).trim() : null;
  }
  return updates;
}
