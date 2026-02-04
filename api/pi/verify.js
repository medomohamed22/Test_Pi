// ==============================
// Next.js API Route: /api/pi/verify
// ==============================
// ENV REQUIRED:
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// (optional) PI_API_KEY / PI_SECRET_KEY

import { createClient } from '@supabase/supabase-js';

// ---------- App Router (app/api/pi/verify/route.js) ----------
export async function POST(req) {
  const body = await req.json();
  const { pi_uid, pi_username, supabase_access_token } = body || {};
  
  if (!pi_uid || !pi_username || !supabase_access_token) {
    return new Response(JSON.stringify({ error: 'invalid_payload' }), { status: 400 });
  }
  
  // TODO: Plug real Pi server-side verification here using PI_API_KEY
  // Placeholder validation:
  if (typeof pi_uid !== 'string' || typeof pi_username !== 'string') {
    return new Response(JSON.stringify({ error: 'invalid_pi_user' }), { status: 401 });
  }
  
  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  // Verify Supabase access token
  const { data: userData, error: authErr } =
  await admin.auth.getUser(supabase_access_token);
  
  if (authErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'invalid_session' }), { status: 401 });
  }
  
  const authUid = userData.user.id;
  
  await admin.from('users').upsert({
    owner_auth_uid: authUid,
    pi_uid,
    pi_username
  });
  
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

// ---------- Pages Router (pages/api/pi/verify.js) ----------
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { pi_uid, pi_username, supabase_access_token } = req.body || {};
  if (!pi_uid || !pi_username || !supabase_access_token) {
    return res.status(400).json({ error: 'invalid_payload' });
  }
  
  const admin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  const { data, error } = await admin.auth.getUser(supabase_access_token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'invalid_session' });
  }
  
  await admin.from('users').upsert({
    owner_auth_uid: data.user.id,
    pi_uid,
    pi_username
  });
  
  res.json({ ok: true });
}
