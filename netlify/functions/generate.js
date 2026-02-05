// netlify/functions/generate.js
export async function handler(event) {
  // 1. التعامل مع طلبات Preflight (CORS)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
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
    
    // --- تم التعديل هنا ليعمل مع العنوان الجديد ---
    const modelUrl = "https://router.huggingface.co/models/runwayml/stable-diffusion-v1-5";
    
    let payload = {
      inputs: prompt,
      options: {
        wait_for_model: true, 
        use_cache: false
      }
    };
    
    // إذا كان هناك صورة واختار المستخدم وضع التعديل
    if (modelId === 'pix2pix' && image) {
      console.log("Using Image-to-Image mode with SD 1.5");
      payload.inputs = prompt;
    }
    
    console.log("Sending request to:", modelUrl);
    
    const resp = await fetch(modelUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-use-cache": "false"
      },
      body: JSON.stringify(payload)
    });
    
    if (!resp.ok) {
      const errText = await resp.text();
      console.error("HF Error:", errText);
      
      if (errText.includes("loading")) {
        return {
          statusCode: 503,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: "الموديل يتم تجهيزه.. انتظر 20 ثانية وحاول مجدداً" })
        };
      }
      
      return {
        statusCode: 502,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: `خطأ من الموديل: ${resp.status} - حاول تغيير الوصف` })
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
