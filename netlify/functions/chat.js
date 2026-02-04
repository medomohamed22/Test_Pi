export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    
    const { message, history } = req.body || {};
    if (!message) return res.status(400).json({ error: "Missing message" });
    
    const contents = [];
    if (Array.isArray(history)) {
      for (const h of history) {
        if (!h?.text) continue;
        contents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: String(h.text) }] });
      }
    }
    contents.push({ role: "user", parts: [{ text: String(message) }] });
    
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
      body: JSON.stringify({ contents })
    });
    
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: "Gemini API Error", details: data });
    
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return res.status(200).json({ reply });
    
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e?.message || e) });
  }
}
