const { createClient } = require("@supabase/supabase-js");

function sbAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  
  try {
    const { tradeId, sellerUid } = JSON.parse(event.body || "{}");
    if (!tradeId || !sellerUid) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing tradeId or sellerUid" }) };
    }
    
    const supabase = sbAdmin();
    
    // 1) load trade
    const { data: trade, error: tErr } = await supabase
      .from("trades")
      .select("*")
      .eq("id", tradeId)
      .single();
    
    if (tErr) return { statusCode: 400, body: JSON.stringify({ error: tErr.message }) };
    
    if (trade.seller_uid !== sellerUid) {
      return { statusCode: 403, body: JSON.stringify({ error: "Not your trade" }) };
    }
    
    if (trade.status !== "waiting_release") {
      return { statusCode: 400, body: JSON.stringify({ error: "Trade not releasable" }) };
    }
    
    // 2) find escrow
    const { data: escrow, error: eErr } = await supabase
      .from("escrows")
      .select("*")
      .eq("ad_id", trade.ad_id)
      .single();
    
    if (eErr) return { statusCode: 400, body: JSON.stringify({ error: eErr.message }) };
    
    if (escrow.status !== "locked_to_buyer" && escrow.status !== "funded") {
      return { statusCode: 400, body: JSON.stringify({ error: "Escrow status invalid" }) };
    }
    
    // 3) credit buyer platform balance (donations)
    const { error: dErr } = await supabase.from("donations").insert([{
      pi_user_id: trade.buyer_uid,
      username: null,
      amount: trade.pi_amount,
      payment_id: escrow.payment_id || null,
      note: "P2P release credit"
    }]);
    
    if (dErr) return { statusCode: 400, body: JSON.stringify({ error: dErr.message }) };
    
    // 4) update trade
    const { error: u1 } = await supabase
      .from("trades")
      .update({ status: "released" })
      .eq("id", trade.id);
    
    if (u1) return { statusCode: 400, body: JSON.stringify({ error: u1.message }) };
    
    // 5) update escrow
    const { error: u2 } = await supabase
      .from("escrows")
      .update({ status: "released" })
      .eq("id", escrow.id);
    
    if (u2) return { statusCode: 400, body: JSON.stringify({ error: u2.message }) };
    
    // 6) close ad
    await supabase.from("p2p_ads").update({ status: "closed" }).eq("id", trade.ad_id);
    
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
    
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Release failed", details: err.message }) };
  }
};
