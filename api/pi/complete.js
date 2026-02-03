export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const { paymentId, txid } = req.body || {};
    if (!paymentId || !txid) {
      return res.status(400).json({ error: 'Missing paymentId or txid' });
    }

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) {
      return res.status(500).json({ error: 'Missing PI_SECRET_KEY' });
    }

    const PI_API_BASE = 'https://api.minepi.com/v2';

    const r = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${PI_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ txid }),
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) {
      return res.status(r.status).json({ error: data });
    }

    return res.status(200).json({ completed: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
