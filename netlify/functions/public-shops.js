const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "MISSING_SUPABASE_ENV" }, 500);
    }

    const limitParam = event.queryStringParameters?.limit;
    const limit = normalizeLimit(limitParam);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    let query = supabase
      .from("active_shops_public")
      .select("*")
.range(0, 200)
      .order("created_at", { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) {
      console.error("public-shops list failed", error);
      return json({ ok: false, error: "LIST_FAILED" }, 500);
    }

    return json({ ok: true, shops: data || [] }, 200);
  } catch (error) {
    console.error("public-shops error", error);
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

function normalizeLimit(value) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, 200);
}
