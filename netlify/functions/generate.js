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

    // --- الحل النهائي للمشكلة ---
    // 1. استخدمنا الرابط الجديد (router)
    // 2. استخدمنا موديل SDXL الأساسي لأنه الموديل المدعوم رسمياً الآن على الروتر الجديد
    const modelUrl = "https://router.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0";
    
    let payload = {
      inputs: prompt,
      options: {
        wait_for_model: true,
        use_cache: false
      }
    };
    
    // وضع التعديل (Pix2Pix) سنحوله ليعتمد على قوة وصف SDXL حالياً
    if (modelId === 'pix2pix' && image) {
      console.log("Image-to-Image mode requested via SDXL");
      payload.inputs = prompt;
    }
    
    console.log("Sending request to:", modelUrl);
    
    const resp = await fetch(modelUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    
    if (!resp.ok) {
      const errText = await resp.text();
      console.error("HF Error Details:", errText);
      
      // إذا كان الموديل لا يزال يحمل (Loading)
      if (errText.includes("loading") || resp.status === 503) {
        return {
          statusCode: 503,
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: "الموديل يستيقظ من النوم.. حاول مجدداً خلال 10 ثوانٍ" })
        };
      }
      
      return {
        statusCode: resp.status,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: `حدث خطأ في الاتصال: ${resp.status}` })
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
      body: JSON.stringify({ error: "فشل السيرفر في معالجة الطلب" })
    };
  }
}
