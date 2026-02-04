
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY" });
    }
    
    const { message, history } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing message" });
    }
    
    const contents = [];
    
    if (Array.isArray(history)) {
      for (const h of history) {
        if (!h?.text) continue;
        contents.push({
          role: h.role === "user" ? "user" : "model",
          parts: [{ text: String(h.text) }]
        });
      }
    }
    
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });
    
    // ✅ موديل شغال حاليًا
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    // بديل: "gemini-2.5-flash"
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey
        },
        body: JSON.stringify({ contents })
      }
    );
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error("Gemini API Error:", data);
      return res.status(500).json({ error: "Gemini API Error", details: data });
    }
    
    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "مفيش رد من Gemini.";
    
    return res.status(200).json({ reply });
  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ error: "Server crash", details: String(err?.message || err) });
  }
}
