
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
    for (const h of history) {
      if (!h?.text) continue;
      const role = h.role === "user" ? "user" : "model";
      contents.push({ role, parts: [{ text: String(h.text) }] });
    }
    contents.push({ role: "user", parts: [{ text: message }] });

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

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
        generationConfig: { temperature, maxOutputTokens }
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

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        let obj;
        try { obj = JSON.parse(s); } catch { continue; }

        const text = obj?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
        if (text) res.write(JSON.stringify({ delta: text }) + "\n");
      }
    }

    try {
      const s = buffer.trim();
      if (s) {
        const obj = JSON.parse(s);
        const text = obj?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
        if (text) res.write(JSON.stringify({ delta: text }) + "\n");
      }
    } catch {}

    res.end(JSON.stringify({ done: true }) + "\n");
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e?.message || e));
  }
}
