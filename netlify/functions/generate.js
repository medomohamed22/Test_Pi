// netlify/functions/generate.js
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { prompt } = JSON.parse(event.body || "{}");
    if (!prompt || !prompt.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing prompt" }) };
    }

    const token = process.env.HF_TOKEN;
    if (!token) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing HF_TOKEN env var" }) };
    }

    // Model: SDXL (جودة عالية)
    const model = "stabilityai/stable-diffusion-xl-base-1.0";
    const apiUrl = `https://api-inference.huggingface.co/models/${model}`;

    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "image/png"
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { guidance_scale: 7.5 }
      })
    });

    const ct = resp.headers.get("content-type") || "";

    // أخطاء HF (زي 503 cold start) بتكون JSON غالبًا
    if (!resp.ok) {
      let msg = `HF error: ${resp.status}`;
      if (ct.includes("application/json")) {
        const j = await resp.json().catch(() => null);
        if (j?.error) msg = j.error;
      }
      return { statusCode: 502, body: JSON.stringify({ error: msg }) };
    }

    const arrayBuffer = await resp.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataUrl: `data:image/png;base64,${base64}`
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || "Server error" }) };
  }
}
