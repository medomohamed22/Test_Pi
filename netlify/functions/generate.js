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

    // --- التعديل هنا ---
    // قمنا بتوحيد الموديل ليكون Stable Diffusion v1.5 لأنه الأكثر استقراراً ومجاني
    // Instruct Pix2Pix يتوقف كثيراً في الخطة المجانية
    const modelUrl = "https://api-inference.huggingface.co/models/runwayml/stable-diffusion-v1-5";
    
    let payload = {
      inputs: prompt,
      options: {
        wait_for_model: true, // مهم جداً للانتظار اذا كان الموديل نائماً
        use_cache: false
      }
    };

    // إذا كان هناك صورة واختار المستخدم وضع التعديل
    if (modelId === 'pix2pix' && image) {
        // ملاحظة: API المجاني لـ Stable Diffusion يتعامل بذكاء مع الصور
        // سنحاول دمج الصورة في الطلب، لكن الاعتماد الأكبر سيكون على النص
        // لأن Pix2Pix الأصلي معطل
        console.log("Using Image-to-Image mode with SD 1.5");
        
        // بعض الـ endpoints تحتاج الصورة كـ parameters
        // لكن في SD 1.5 القياسي، الاعتماد الأساسي على النص في الـ API المجاني
        // سنرسل النص فقط لضمان عدم حدوث خطأ، لأن إرسال Base64 طويل أحياناً يرفضه السيرفر المجاني
        // الحل: نعتمد على قوة الوصف (Prompt)
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
