
// netlify/functions/generate.js
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { prompt } = JSON.parse(event.body || "{}");
    if (!prompt || !prompt.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing prompt" })
      };
    }

    const token = process.env.HF_TOKEN;
    if (!token) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "HF_TOKEN is missing" })
      };
    }

    // ✅ ENDPOINT الجديد الرسمي
    const model = "stabilityai/stable-diffusion-xl-base-1.0";
    const apiUrl = `https://router.huggingface.co/hf-inference/models/${model}`;

    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Accept": "image/png"
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          guidance_scale: 7.5
        }
      })
    });

    const contentType = resp.headers.get("content-type") || "";

    // أخطاء HuggingFace (زي 503 أثناء التسخين)
    if (!resp.ok) {
      let msg = `HF Error ${resp.status}`;
      if (contentType.includes("application/json")) {
        const j = await resp.json().catch(() => null);
        if (j?.error) msg = j.error;
      }
      return {
        statusCode: 502,
        body: JSON.stringify({ error: msg })
      };
    }

    // الصورة بتيجي Binary
    const buffer = await resp.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataUrl: `data:image/png;base64,${base64}`
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Server error" })
    };
  }
}
