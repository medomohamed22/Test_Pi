// netlify/functions/generate.js
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  
  try {
    const { prompt, image, modelId } = JSON.parse(event.body || "{}");
    
    if (!prompt || !prompt.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "الرجاء كتابة وصف للصورة" }) };
    }
    
    const token = process.env.HF_TOKEN;
    if (!token) {
      return { statusCode: 500, body: JSON.stringify({ error: "HF_TOKEN missing" }) };
    }

    // تحديد الموديل بناءً على اختيار المستخدم
    let modelUrl = "";
    let payload = {};

    if (modelId === 'pix2pix') {
        // نموذج تعديل الصور (يحتاج صورة + نص)
        if (!image) {
            return { statusCode: 400, body: JSON.stringify({ error: "هذا النموذج يتطلب رفع صورة لتعديلها" }) };
        }
        modelUrl = "https://router.huggingface.co/hf-inference/models/timbrooks/instruct-pix2pix";
        
        // HuggingFace Inference API for Pix2Pix often requires specific handling.
        // We send inputs as parameters. Note: Free API might be slow.
        payload = {
            inputs: prompt,
            image: image.split(',')[1] // Remove 'data:image/png;base64,' prefix if present
        };

    } else {
        // الافتراضي: SDXL (توليد من النص)
        modelUrl = "https://router.huggingface.co/hf-inference/models/stabilityai/stable-diffusion-xl-base-1.0";
        payload = {
            inputs: prompt,
            // SDXL doesn't take 'image' input directly in standard text-to-image mode
        };
    }
    
    // استدعاء Hugging Face API
    const resp = await fetch(modelUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    
    // معالجة الأخطاء من المصدر
    if (!resp.ok) {
        const errText = await resp.text();
        console.error("HF Error:", errText);
        
        // إذا كان الموديل قيد التحميل (Loading)
        if (errText.includes("loading")) {
             return { statusCode: 503, body: JSON.stringify({ error: "الموديل قيد التشغيل، حاول مجدداً بعد 30 ثانية" }) };
        }
        
        return { statusCode: 502, body: JSON.stringify({ error: "فشل الاتصال بموديل الذكاء الاصطناعي" }) };
    }
    
    // تحويل الاستجابة (Binary) إلى Base64
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
    console.error("Server Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "خطأ في السيرفر" })
    };
  }
}
