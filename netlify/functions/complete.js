const { createClient } = require('@supabase/supabase-js');

const PI_API_BASE = 'https://api.minepi.com/v2';

function getSupabaseAdmin(){
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { persistSession: false } });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body || '{}');

    if (!paymentId || !txid) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing paymentId or txid' })
      };
    }

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'PI_SECRET_KEY is missing' })
      };
    }

    const supabase = getSupabaseAdmin();

    /* =========================================================
       1) COMPLETE PAYMENT (idempotent)
    ========================================================= */
    let completeData = null;

    const completeRes = await fetch(
      `${PI_API_BASE}/payments/${paymentId}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${PI_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ txid })
      }
    );

    if (completeRes.ok) {
      completeData = await completeRes.json().catch(() => ({}));
    } else {
      const err = await completeRes.json().catch(() => ({}));

      // 👇 الحل هنا: already_completed مش Error قاتل
      if (err?.error === 'already_completed') {
        console.log('[Pi] payment already completed, continue safely');
      } else {
        return {
          statusCode: completeRes.status,
          body: JSON.stringify({ error: err })
        };
      }
    }

    /* =========================================================
       2) FETCH PAYMENT INFO (metadata / amount)
    ========================================================= */
    const infoRes = await fetch(
      `${PI_API_BASE}/payments/${paymentId}`,
      {
        headers: { Authorization: `Key ${PI_SECRET_KEY}` }
      }
    );

    const payment = await infoRes.json().catch(() => ({}));
    const meta = payment?.metadata || {};
    const amount = Number(payment?.amount || 0);

    /* =========================================================
       3) HANDLE P2P ESCROW DEPOSIT
       metadata.type === "p2p_escrow_deposit"
    ========================================================= */
    if (meta.type === 'p2p_escrow_deposit' && meta.ad_id) {
      const adId = Number(meta.ad_id);

      // 🔒 منع التكرار (Idempotency على مستوى DB)
      const { data: existingEscrow, error: escErr } = await supabase
        .from('escrows')
        .select('id')
        .eq('payment_id', paymentId)
        .maybeSingle();

      if (escErr) throw new Error(escErr.message);

      if (existingEscrow) {
        // escrow متسجل قبل كده
        return {
          statusCode: 200,
          body: JSON.stringify({
            completed: true,
            note: 'Escrow already recorded'
          })
        };
      }

      // فتح الإعلان
      const { error: adErr } = await supabase
        .from('p2p_ads')
        .update({ status: 'open' })
        .eq('id', adId);

      if (adErr) throw new Error(adErr.message);

      // إنشاء escrow
      const { error: insErr } = await supabase
        .from('escrows')
        .insert([{
          ad_id: adId,
          seller_uid: meta.seller_uid,
          buyer_uid: null,
          pi_amount: amount,
          status: 'funded',
          payment_id: paymentId,
          txid
        }]);

      if (insErr) throw new Error(insErr.message);

      return {
        statusCode: 200,
        body: JSON.stringify({
          completed: true,
          kind: 'p2p_escrow_deposit'
        })
      };
    }

    /* =========================================================
       4) DEFAULT (لو مش Escrow)
    ========================================================= */
    return {
      statusCode: 200,
      body: JSON.stringify({
        completed: true,
        kind: 'generic',
        data: completeData || payment
      })
    };

  } catch (err) {
    console.error('Complete Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Complete failed',
        details: err.message
      })
    };
  }
};
