const StellarSdk = require("stellar-sdk");
const { createClient } = require("@supabase/supabase-js");

const PI_HORIZON_URL = "https://api.testnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Testnet";

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing in environment variables`);
  return v;
}

function getSupabaseAdmin() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE");

  // مهم: ما تطبعش url ولا key في logs
  return createClient(url, key, { auth: { persistSession: false } });
}

function isValidStellarAddress(addr) {
  try {
    return StellarSdk.StrKey.isValidEd25519PublicKey(addr);
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const uid = String(body.uid || "").trim();
    const username = String(body.username || "").trim();
    const walletAddress = String(body.walletAddress || "").trim();
    const withdrawAmount = Number(body.amount);

    if (!uid || !walletAddress) {
      return { statusCode: 400, body: JSON.stringify({ error: "بيانات ناقصة" }) };
    }

    if (!Number.isFinite(withdrawAmount) || withdrawAmount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "قيمة السحب غير صحيحة" }) };
    }

    if (!isValidStellarAddress(walletAddress)) {
      return { statusCode: 400, body: JSON.stringify({ error: "عنوان المحفظة غير صحيح" }) };
    }

    const APP_WALLET_SECRET = getEnv("APP_WALLET_SECRET");
    const supabase = getSupabaseAdmin();

    // --- check platform balance ---
    const { data: donations, error: e1 } = await supabase
      .from("donations")
      .select("amount")
      .eq("pi_user_id", uid);

    if (e1) throw new Error("Supabase donations error: " + e1.message);

    const { data: withdrawals, error: e2 } = await supabase
      .from("withdrawals")
      .select("amount")
      .eq("pi_user_id", uid);

    if (e2) throw new Error("Supabase withdrawals error: " + e2.message);

    const totalIn = (donations || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalOut = (withdrawals || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const balance = totalIn - totalOut;

    if (balance < withdrawAmount) {
      return { statusCode: 400, body: JSON.stringify({ error: "رصيد حسابك غير كافٍ", balance }) };
    }

    // --- send on chain ---
    const server = new StellarSdk.Horizon.Server(PI_HORIZON_URL);
    const sourceKeys = StellarSdk.Keypair.fromSecret(APP_WALLET_SECRET);
    const sourceAccount = await server.loadAccount(sourceKeys.publicKey());

    let fee = "100000";
    try {
      fee = String(await server.fetchBaseFee());
    } catch {
      // keep fallback
    }

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: walletAddress,
          asset: StellarSdk.Asset.native(),
          amount: withdrawAmount.toFixed(7),
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(sourceKeys);
    const result = await server.submitTransaction(tx);

    // --- log in DB ---
    const { error: insErr } = await supabase.from("withdrawals").insert([{
      pi_user_id: uid,
      username: username || null,
      amount: withdrawAmount,
      wallet_address: walletAddress,
      status: "sent",
      txid: result.hash
    }]);

    if (insErr) {
      // التحويل تم، لكن التسجيل فشل — رجع txid عشان تتابع
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          txid: result.hash,
          message: "تم التحويل على الشبكة، لكن فشل تسجيله في قاعدة البيانات",
          db_error: insErr.message
        })
      };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, txid: result.hash }) };

  } catch (err) {
    // ما تطبعش env secrets هنا
    return { statusCode: 500, body: JSON.stringify({ error: "فشلت المعاملة", details: err.message }) };
  }
};
