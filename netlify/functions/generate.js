// netlify/functions/generate.js

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

/**
 * ✅ HF Router (بديل api-inference القديم)
 * endpoint الصحيح:
 * https://router.huggingface.co/hf-inference/models/<model_id>
 */
function hfUrl(model) {
  return `https://router.huggingface.co/hf-inference/models/${model}`;
}

async function hfTextToImage({ token, model, prompt, width, height, steps }) {
  const resp = await fetch(hfUrl(model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "image/png",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        width,
        height,
        num_inference_steps: steps,
      },
      options: { wait_for_model: true, use_cache: false },
    }),
  });
  
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`HF ${model} ${resp.status}: ${t}`);
  }
  
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString("base64");
}

/**
 * img2img/edit: هنستخدم multipart/form-data
 * (ده الأكثر توافقًا لموديلات التعديل)
 */
async function hfImageToImage({ token, model, prompt, imageDataUrl, steps }) {
  const base64 = String(imageDataUrl || "").split(",")[1] || "";
  if (!base64) throw new Error("No image base64 provided");
  
  const imageBuf = Buffer.from(base64, "base64");
  
  const form = new FormData();
  form.append("inputs", prompt);
  form.append("parameters", JSON.stringify({ num_inference_steps: steps }));
  form.append("image", new Blob([imageBuf]), "image.png");
  
  const resp = await fetch(hfUrl(model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "image/png",
    },
    body: form,
  });
  
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`HF ${model} ${resp.status}: ${t}`);
  }
  
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString("base64");
}

const MODELS = {
  // Text → Image
  sdxl: [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
  ],
  sd15: [
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
    "stabilityai/stable-diffusion-xl-base-1.0",
  ],
  auto: [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
  ],
  
  // Image → Image / Edit
  pix2pix: [
    "timbrooks/instruct-pix2pix",
    // fallback (مش “edit” صريح، لكنه ينفع img2img في حالات)
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
  ],
  
  // توافق مع IDs قديمة عندك
  lightning: [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
  ],
  hypersd: [
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
    "stabilityai/stable-diffusion-xl-base-1.0",
  ],
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
    if (!token) return json(500, { error: "HF_TOKEN missing" });
    
    const body = JSON.parse(event.body || "{}");
    const prompt = String(body.prompt || "").trim();
    const image = body.image || null;
    
    // خليك متسامح مع أسماء modelId المختلفة اللي عندك في الواجهة
    const rawModelId = String(body.modelId || "auto").toLowerCase();
    const modelId = ["sdxl", "sd15", "pix2pix", "auto", "lightning", "hypersd"].includes(rawModelId) ?
      rawModelId :
      "auto";
    
    if (!prompt) return json(400, { error: "الرجاء كتابة وصف للصورة" });
    
    const width = clamp(Number(body.width || 1024), 256, 1536);
    const height = clamp(Number(body.height || 1024), 256, 1536);
    
    // خطوات أقل أسرع ومناسبة للتير المجاني
    const steps = clamp(Number(body.steps || (modelId === "sd15" ? 18 : 22)), 8, 35);
    
    const isImg2Img = modelId === "pix2pix";
    if (isImg2Img && !image) return json(400, { error: "نموذج التعديل يحتاج صورة" });
    
    const tryModels = MODELS[modelId] || MODELS.auto;
    
    let lastErr = null;
    
    for (const m of tryModels) {
      try {
        console.log(`[HF] mode=${isImg2Img ? "img2img" : "txt2img"} rawModelId=${rawModelId} modelId=${modelId} model=${m}`);
        
        const base64 = !isImg2Img ?
          await hfTextToImage({ token, model: m, prompt, width, height, steps }) :
          await hfImageToImage({ token, model: m, prompt, imageDataUrl: image, steps });
        
        return json(200, { dataUrl: `data:image/png;base64,${base64}` });
      } catch (e) {
        lastErr = e;
        console.error(`[HF] failed model=${m} =>`, e?.message || e);
      }
    }
    
    return json(502, {
      error: "الموديلات مجانية لكنها مش متاحة/مزدحمة أو مش مدعومة على حسابك حاليًا. جرّب بعد دقيقة أو بدّل الموديل.",
      detail: String(lastErr?.message || lastErr || "unknown"),
    });
  } catch (err) {
    console.error("Server Error:", err);
    return json(500, { error: "فشل في معالجة الطلب" });
  }
}
