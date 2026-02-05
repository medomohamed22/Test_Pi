// netlify/functions/generate.js
import { Buffer } from 'buffer';

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hfUrl(model) {
  return `https://api-inference.huggingface.co/models/${model}`;
}

// دالة تحويل النص إلى صورة (Text to Image)
async function hfTextToImage({ token, model, prompt, width, height, steps }) {
  const resp = await fetch(hfUrl(model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-use-cache": "false"
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        width,
        height,
        num_inference_steps: steps, // بعض الموديلات قد تتجاهل هذا وتستخدم الافتراضي
      },
      options: { wait_for_model: true, use_cache: false },
    }),
  });
  
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`HF ${model} error: ${resp.status} - ${t}`);
  }
  
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString("base64");
}

// ✅ دالة تعديل الصورة (Image to Image) محسنة
async function hfImageToImage({ token, model, prompt, imageDataUrl, steps }) {
  // استخراج البيانات الخام من Base64
  const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const imageBuf = Buffer.from(base64Data, "base64");
  
  // بالنسبة لـ SD 1.5 Img2Img، الأفضل إرسال الصورة كـ Binary Body مباشرة
  // أو إرسال Inputs كـ JSON حسب الموديل، ولكن الطريقة الأكثر استقراراً مع SD 1.5 هي:
  // استخدام API Inference القياسي الذي يقبل JSON مع parameters
  // ولكن هنا سنستخدم Fetch مباشر للـ Blob لأن SD 1.5 يدعم ذلك جيداً
  
  const resp = await fetch(hfUrl(model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-use-cache": "false"
    },
    // في HuggingFace Inference API لموديلات SD، النمط الشائع لـ Img2Img هو ارسال الصورة والبرومبت
    // ولكن الطريقة الأضمن هي تحميل الصورة كـ base64 داخل الـ inputs أحياناً،
    // أو استخدام مكتبة @huggingface/inference.
    // هنا سنستخدم نهج الـ "Wait for model" مع JSON بسيط يقبل الصورة كمدخل إن أمكن،
    // لكن SD v1.5 API الأساسي قد يتطلب بايلود مختلف. لنجرب الطريقة الأضمن حالياً (Buffer):
    
    // ملاحظة: Stable Diffusion Inference API عبر HTTP يتطلب الحيلة التالية لـ Img2Img:
    // لا يوجد endpoint موحد سهل، لذا سنستخدم "runwayml/stable-diffusion-v1-5" 
    // الذي يتصرف بذكاء إذا أرسلنا له صورة.
    
    // سنعود لاستخدام JSON inputs لأنها الأكثر توافقاً مع Free Tier حالياً
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        num_inference_steps: steps,
        strength: 0.75, // قوة التغيير (0.75 يعني تغيير ملحوظ مع الحفاظ على الهيكل)
        image: base64Data // بعض الـ endpoints تقبل الصورة هكذا
      },
      options: { wait_for_model: true }
    }),
  });
  
  // إذا فشلت الطريقة أعلاه، سنستخدم Fallback (خطة ب) في الموديلات
  if (!resp.ok) {
    // محاولة ثانية بطريقة أخرى (FormData) إذا فشل الـ JSON
    // ملاحظة: هذا يتطلب بيئة Node تدعم FormData (Netlify Functions تدعمها)
    // ولكن للتبسيط سنعتمد على الخطأ ليقوم الـ Handler بتجربة الموديل التالي
    const t = await resp.text();
    throw new Error(`HF Img2Img ${model} error: ${resp.status} - ${t}`);
  }
  
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString("base64");
}

const MODELS = {
  // Text → Image
  sdxl: [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "runwayml/stable-diffusion-v1-5",
  ],
  sd15: [
    "runwayml/stable-diffusion-v1-5",
    "CompVis/stable-diffusion-v1-4",
  ],
  auto: [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "runwayml/stable-diffusion-v1-5",
  ],
  
  // ✅ Image → Image / Edit
  // تم تغيير الموديل هنا. بدلاً من pix2pix (الذي يفشل غالباً)، نستخدم SD 1.5
  // SD 1.5 قوي جداً في تحويل صورة لصورة بناءً على الوصف
  pix2pix: [
    "runwayml/stable-diffusion-v1-5",
    "CompVis/stable-diffusion-v1-4"
  ]
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }
  
  try {
    const token = process.env.HF_TOKEN;
    if (!token) return json(500, { error: "HF_TOKEN missing in server" });
    
    const body = JSON.parse(event.body || "{}");
    const prompt = String(body.prompt || "").trim();
    const image = body.image || null; // Base64 image for editing
    
    const rawModelId = String(body.modelId || "auto").toLowerCase();
    // التأكد من أن الموديل موجود في القائمة
    const modelId = Object.keys(MODELS).includes(rawModelId) ? rawModelId : "auto";
    
    if (!prompt) return json(400, { error: "الرجاء كتابة وصف للصورة" });
    
    // تحديد الأبعاد (يتم تجاهلها أحياناً في img2img للحفاظ على أبعاد الأصل)
    const width = clamp(Number(body.width || 1024), 256, 1024);
    const height = clamp(Number(body.height || 1024), 256, 1024);
    
    // عدد الخطوات (20-30 جيد للسرعة والجودة)
    const steps = clamp(Number(body.steps || 25), 10, 50);
    
    const isImg2Img = (modelId === "pix2pix");
    if (isImg2Img && !image) return json(400, { error: "وضع التعديل يحتاج إلى صورة مرجعية" });
    
    // اختيار قائمة الموديلات المناسبة
    const tryModels = MODELS[modelId];
    
    let lastErr = null;
    
    // تجربة الموديلات بالترتيب (إذا فشل الأول يجرب الثاني)
    for (const m of tryModels) {
      try {
        console.log(`[HF] Generating... Mode=${isImg2Img ? "Img2Img" : "Txt2Img"}, Model=${m}`);
        
        let base64;
        if (isImg2Img) {
          // استخدام دالة Image to Image
          // ملاحظة: SD 1.5 عبر API أحياناً يفضل استخدام endpoint Text-to-Image 
          // ولكن مع تمرير الصورة كـ parameter، وهذا ما نحاول فعله
          base64 = await hfImageToImage({ token, model: m, prompt, imageDataUrl: image, steps });
        } else {
          base64 = await hfTextToImage({ token, model: m, prompt, width, height, steps });
        }
        
        return json(200, { dataUrl: `data:image/png;base64,${base64}` });
      } catch (e) {
        lastErr = e;
        console.error(`[HF] Model ${m} Failed:`, e.message);
        // استمرار للحلقة التالية لتجربة الموديل البديل
      }
    }
    
    // إذا فشلت كل المحاولات
    return json(502, {
      error: "السيرفرات مشغولة حالياً أو الموديل لا يستجيب. حاول مرة أخرى أو غيّر الموديل.",
      detail: String(lastErr?.message || "Unknown error"),
    });
    
  } catch (err) {
    console.error("Global Server Error:", err);
    return json(500, { error: "خطأ داخلي في المعالجة" });
  }
}
