const { createClient } = require('@supabase/supabase-js');

const PI_API_BASE = 'https://api.minepi.com/v2';

function json(statusCode, payload, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // CORS
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE)');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

exports.handler = async (event) => {
  // ✅ CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return json(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body || '{}');

    if (!paymentId || !txid) {
      return json(400, { error: 'Missing paymentId or txid' });
    }

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) {
      return json(500, { error: 'PI_SECRET_KEY is missing' });
    }

    const supabase = getSupabaseAdmin();

    /* =========================================================
       1) COMPLETE PAYMENT (idempotent)
    ========================================================= */
    const completeRes = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ txid }),
    });

    if (!completeRes.ok) {
      const err = await safeJson(completeRes);

      // ✅ already_completed مش fatal — نكمّل عادي
      if (err?.error !== 'already_completed') {
        return json(completeRes.status, { error: err || { message: 'Pi complete failed' } });
      }

      console.log('[Pi] payment already completed, continue safely');
    }

    /* =========================================================
       2) FETCH PAYMENT INFO (metadata / amount)
    ========================================================= */
    const infoRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });

    const payment = await safeJson(infoRes);
    if (!infoRes.ok) {
      // لو Pi رجع error هنا، ده مهم نطلّعه
      return json(infoRes.status, { error: payment || { message: 'Failed to fetch payment info' } });
    }

    const meta = payment?.metadata || {};

    // ✅ amount أحيانًا يطلع string
    // ✅ fallback: meta.amount لو انت حاططها
    const amount = Number(payment?.amount ?? meta?.amount ?? 0);

    /* =========================================================
       3) HANDLE P2P ESCROW DEPOSIT
       metadata.type === "p2p_escrow_deposit"
    ========================================================= */
    if (meta.type === 'p2p_escrow_deposit' && meta.ad_id) {
      const adId = Number(meta.ad_id);

      if (!adId || !Number.isFinite(adId)) {
        return json(400, { error: 'Invalid ad_id in metadata' });
      }

      // seller_uid مهم جدًا للـ escrow
      const sellerUid = meta.seller_uid;
      if (!sellerUid) {
        return json(400, { error: 'Missing seller_uid in metadata' });
      }

      if (!amount || amount <= 0) {
        return json(400, { error: 'Invalid amount from Pi payment (amount <= 0)' });
      }

      // ✅ تأكد إن الإعلان موجود ومملوك للبائع (اختياري لكن مفيد)
      const { data: adRow, error: adGetErr } = await supabase
        .from('p2p_ads')
        .select('id, seller_uid, status, pi_amount')
        .eq('id', adId)
        .maybeSingle();

      if (adGetErr) throw new Error(adGetErr.message);
      if (!adRow) return json(404, { error: 'Ad not found' });

      // ⚠️ لو عايز تمنع أي حد يكمّل على إعلان مش بتاعه:
      if (adRow.seller_uid && adRow.seller_uid !== sellerUid) {
        return json(400, { error: 'seller_uid mismatch with ad owner' });
      }

      // ✅ Idempotency أقوى: لو escrow موجود بالفعل لنفس paymentId خلاص
      const { data: existingEscrow, error: escErr } = await supabase
        .from('escrows')
        .select('id, status')
        .eq('payment_id', paymentId)
        .maybeSingle();

      if (escErr) throw new Error(escErr.message);

      if (!existingEscrow) {
        // 1) إنشاء escrow (الأهم: يتسجل الأول)
        const { error: insErr } = await supabase
          .from('escrows')
          .insert([{
            ad_id: adId,
            seller_uid: sellerUid,
            buyer_uid: null,
            pi_amount: amount,
            status: 'funded',
            payment_id: paymentId,
            txid: String(txid),
          }]);

        if (insErr) throw new Error(insErr.message);
      }

      // 2) بعد ما escrow اتسجل، افتح الإعلان
      const { error: adUpErr } = await supabase
        .from('p2p_ads')
        .update({ status: 'open' })
        .eq('id', adId);

      if (adUpErr) throw new Error(adUpErr.message);

      return json(200, {
        completed: true,
        kind: 'p2p_escrow_deposit',
        ad_id: adId,
        amount,
      });
    }

    /* =========================================================
       4) DEFAULT (لو مش Escrow)
    ========================================================= */
    return json(200, {
      completed: true,
      kind: 'generic',
      payment,
    });

  } catch (err) {
    console.error('Complete Error:', err);
    return json(500, {
      error: 'Complete failed',
      details: err?.message || String(err),
    });
  }
};
