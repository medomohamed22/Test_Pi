export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    
    const { message, history } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing message" });
    }
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY in Vercel env vars" });
    }
    
    // نحول history لصيغة Gemini contents
    const contents = [];
    
    if (Array.isArray(history)) {
      for (const h of history) {
        if (!h?.text) continue;
        const role = h.role === "user" ? "user" : "model";
        contents.push({ role, parts: [{ text: String(h.text) }] });
      }
    }
    
    // آخر رسالة من المستخدم
    contents.push({ role: "user", parts: [{ text: message }] });
    
    // موديل سريع ومجاني غالبًا
    const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
    
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents }),
      }
    );
    
    const data = await r.json();
    if (!r.ok) {
      return res.status(500).json({ error: "Gemini error", details: data });
    }
    
    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "مفيش رد رجع من Gemini.";
    
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: String(e?.message || e) });
  }
}
