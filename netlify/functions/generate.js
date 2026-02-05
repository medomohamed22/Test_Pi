// netlify/functions/generate.js
export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }
  
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  
  try {
    const { prompt, image, modelId } = JSON.parse(event.body || "{}");
    
    if (!prompt || !prompt.trim()) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "الرجاء كتابة وصف للصورة" })
      };
    }
    
    const token = process.env.HF_TOKEN;
    if (!token) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "HF_TOKEN missing" })
      };
    }

    // --- التغيير الأساسي هنا ---
    // استخدمنا موديل SD 2.1 لأنه أكثر استقراراً حالياً على الـ API المجاني
    const modelUrl = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2-1";
    
    let payload = {
      inputs: prompt,
      options: {
        wait_for_model: true,
        use_cache: false
      }
    };
    
    if (modelId === 'pix2pix' && image) {
      console.log("Image-to-Image request received");
      payload.inputs = prompt;
    }
    
    console.log("Sending request to:", modelUrl);
    
    const resp = await fetch(modelUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0" // إضافة User-Agent لتجنب حظر الطلبات البرمجية
      },
      body: JSON.stringify(payload)
    });
    
    if (!resp.ok) {
      const errText = await resp.text();
      console.error("HF Error Details:", errText);
      
      // إذا استمرت مشكلة "التحويل للراوتر"، سنحاول توجيه الطلب يدوياً
      if (errText.includes("router.huggingface.co")) {
         return {
          statusCode: 502,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: "السيرفر يطلب تحديث الرابط، جاري الصيانة.." })
        };
      }

      return {
        statusCode: resp.status,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: `خطأ من الموديل: ${resp.status}` })
      };
    }
    
    const buffer = await resp.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        dataUrl: `data:image/png;base64,${base64}`
      })
    };
    
  } catch (err) {
    console.error("Server Error:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message || "خطأ في السيرفر الداخلي" })
    };
  }
}
