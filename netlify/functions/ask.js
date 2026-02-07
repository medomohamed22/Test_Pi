
const { getStore } = require("@netlify/blobs");

const store = getStore({ name: "ultra-ai" });

function clean(s) { return (s || "").replace(/\s+/g, " ").trim(); }

function scoreDoc(q, text) {
  // Scoring بسيط (تقدر تطوره بعدين)
  const Q = q.toLowerCase();
  const T = text.toLowerCase();
  const words = Q.split(/\s+/).filter(w => w.length > 2);
  let s = 0;
  for (const w of words) {
    const m = T.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
    if (m) s += m.length;
  }
  return s;
}

async function autoLearnFromWeb(q) {
  // تعلم تلقائي: Wikipedia summary + DuckDuckGo abstract (من داخل Function -> مفيش CORS)
  let learned = [];
  
  // Wikipedia (عربي)
  try {
    const w = await fetch(`https://ar.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
    if (w.ok) {
      const j = await w.json();
      const text = clean(j.extract || "");
      if (text.length > 150) {
        const id = "auto_wiki_" + Date.now();
        await store.setJSON(`docs/${id}`, { id, url: j.content_urls?.desktop?.page || "wikipedia", text, ts: Date.now() });
        learned.push({ id, src: "wikipedia" });
      }
    }
  } catch {}
  
  // DuckDuckGo instant answer
  try {
    const d = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`);
    if (d.ok) {
      const j = await d.json();
      const text = clean(j.AbstractText || j.Answer || "");
      if (text.length > 150) {
        const id = "auto_ddg_" + Date.now();
        await store.setJSON(`docs/${id}`, { id, url: "duckduckgo", text, ts: Date.now() });
        learned.push({ id, src: "duckduckgo" });
      }
    }
  } catch {}
  
  if (learned.length) {
    const index = (await store.getJSON("index", { consistency: "strong" })) || [];
    for (const x of learned) {
      index.unshift({ id: x.id, url: x.src, ts: Date.now() });
    }
    await store.setJSON("index", index.slice(0, 200));
  }
  
  return learned.length;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  
  try {
    const { q } = JSON.parse(event.body || "{}");
    const question = clean(q);
    if (!question) return { statusCode: 200, body: JSON.stringify({ ok: false, error: "Empty question" }) };
    
    // حمّل index
    const index = (await store.getJSON("index", { consistency: "strong" })) || [];
    
    // لو مفيش مصادر كفاية -> تعلم تلقائي
    if (index.length < 3) {
      await autoLearnFromWeb(question);
    }
    
    // هات آخر 40 doc (عشان الأداء)
    const recent = index.slice(0, 40);
    let best = null;
    let bestScore = 0;
    
    for (const it of recent) {
      const doc = await store.getJSON(`docs/${it.id}`);
      if (!doc?.text) continue;
      const s = scoreDoc(question, doc.text);
      if (s > bestScore) {
        bestScore = s;
        best = doc;
      }
    }
    
    if (!best || bestScore === 0) {
      // جرّب تعلم تلقائي مرة كمان
      await autoLearnFromWeb(question);
      
      const index2 = (await store.getJSON("index", { consistency: "strong" })) || [];
      const recent2 = index2.slice(0, 40);
      
      for (const it of recent2) {
        const doc = await store.getJSON(`docs/${it.id}`);
        if (!doc?.text) continue;
        const s = scoreDoc(question, doc.text);
        if (s > bestScore) {
          bestScore = s;
          best = doc;
        }
      }
    }
    
    if (!best) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, answer: "لسه معنديش معرفة كفاية. استخدم زر (تعلم من رابط) وضيف مصادر.", meta: "No knowledge yet" })
      };
    }
    
    // “تلخيص” بسيط (قص + جُمَل أولى)
    const raw = best.text;
    const answer = raw.length > 700 ? raw.slice(0, 700) + "…" : raw;
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        answer,
        meta: `المصدر: ${best.url || "unknown"} | Score: ${bestScore}`
      })
    };
    
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
