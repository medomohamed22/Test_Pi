
const cheerio = require("cheerio");
const { getStore } = require("@netlify/blobs");

// Store ثابت لكل الدبلويز
const store = getStore({ name: "ultra-ai" });

function cleanText(s) {
  return (s || "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; UltraAI/1.0; +https://netlify.com)"
    }
  });
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  return await r.text();
}

function extractMainText(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,canvas,iframe").remove();
  const text = cleanText($("body").text());
  // قص عشان التخزين يكون عملي
  return text.slice(0, 12000);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { url } = JSON.parse(event.body || "{}");
    const u = safeUrl(url);
    if (!u) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "Invalid URL" })
      };
    }

    const html = await fetchHtml(u);
    const text = extractMainText(html);

    if (!text || text.length < 200) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: false,
          error: "Page text too short or blocked"
        })
      };
    }

    // خزّن doc منفصل + حدّث فهرس بسيط
    const id = "doc_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    await store.setJSON(`docs/${id}`, { id, url: u, text, ts: Date.now() });

    // index list (آخر 200 مصدر مثلاً)
    const index = (await store.getJSON("index", { consistency: "strong" })) || [];
    index.unshift({ id, url: u, ts: Date.now() });
    await store.setJSON("index", index.slice(0, 200));

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        source: u,
        tokensApprox: Math.round(text.length / 4)
      })
    };
  } catch (e) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, error: e.message })
    };
  }
};
