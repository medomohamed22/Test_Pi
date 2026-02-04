export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.statusCode = 500;
      return res.end("Missing GEMINI_API_KEY");
    }
    
    const body = req.body || {};
    const system = String(body.system || "");
    const message = String(body.message || "");
    const history = Array.isArray(body.history) ? body.history : [];
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.35;
    const maxOutputTokens = typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : 450;
    
    if (!message) {
      res.statusCode = 400;
      return res.end("Missing message");
    }
    
    const contents = [];
    
    // نضيف history (user/model)
    for (const h of history) {
      if (!h?.text) continue;
      const role = h.role === "user" ? "user" : "model";
      contents.push({ role, parts: [{ text: String(h.text) }] });
    }
    
    // نضيف آخر رسالة
    contents.push({ role: "user", parts: [{ text: message }] });
    
    // موديل افتراضي (تقدر تغيره من Vercel env: GEMINI_MODEL)
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
    
    // تجهيز response streaming
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    
    // نستخدم streamGenerateContent
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
    
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens
        }
      })
    });
    
    if (!upstream.ok) {
      const errText = await upstream.text();
      res.statusCode = 500;
      return res.end(errText);
    }
    
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    
    // Google بيرجع JSON chunks متتالية، هنلمّها ونطلع delta
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      
      // نحاول نجزّأ: غالبًا chunk عبارة عن JSONs متلاصقة
      // هنفصلهم بشكل بسيط: كل ما نلاقي "}\n" أو "}\r\n" أو "}"
      // (البارسر هنا مرن علشان اختلافات التنسيق)
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      
      for (const line of parts) {
        const s = line.trim();
        if (!s) continue;
        let obj;
        try { obj = JSON.parse(s); } catch { continue; }
        
        const text =
          obj?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
        
        if (text) {
          res.write(JSON.stringify({ delta: text }) + "\n");
        }
      }
    }
    
    // آخر flush لو باقي JSON في buffer
    try {
      const s = buffer.trim();
      if (s) {
        const obj = JSON.parse(s);
        const text =
          obj?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
        if (text) res.write(JSON.stringify({ delta: text }) + "\n");
      }
    } catch {}
    
    res.write(JSON.stringify({ done: true }) + "\n");
    res.end();
    
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e?.message || e));
  }
}
