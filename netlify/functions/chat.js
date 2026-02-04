exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GEMINI_API_KEY" }) };
    }
    
    const body = JSON.parse(event.body || "{}");
    const system = String(body.system || "");
    const message = String(body.message || "");
    const history = Array.isArray(body.history) ? body.history : [];
    const temperature = typeof body.temperature === "number" ? body.temperature : 0.35;
    const maxOutputTokens = typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : 450;
    
    if (!message) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing message" }) };
    }
    
    const contents = [];
    for (const h of history) {
      if (!h?.text) continue;
      const role = h.role === "user" ? "user" : "model";
      contents.push({ role, parts: [{ text: String(h.text) }] });
    }
    contents.push({ role: "user", parts: [{ text: message }] });
    
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
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
      }
    );
    
    const data = await r.json();
    if (!r.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: "Gemini API Error", details: data }) };
    }
    
    const reply =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };
    
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: String(e?.message || e) }) };
  }
};
