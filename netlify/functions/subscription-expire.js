import { createClient } from "@supabase/supabase-js";

export default async () => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ ok: false, error: "MISSING_SUPABASE_ENV" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("merchant_subscriptions")
      .update({ status: "expired", updated_at: nowIso })
      .eq("status", "active")
      .lte("expires_at", nowIso)
      .select("id");

    if (error) {
      console.error("subscription-expire update failed", error);
      return json({ ok: false, error: "EXPIRE_FAILED" }, 500);
    }

    return json({ ok: true, expired_count: data?.length || 0 }, 200);
  } catch (e) {
    console.error("subscription-expire exception", e);
    return json({ ok: false, error: "SERVER_ERROR" }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
