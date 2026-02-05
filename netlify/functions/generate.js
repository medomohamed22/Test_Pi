// netlify/functions/generate.js
import { InferenceClient } from "@huggingface/inference";

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

function dataUrlToBuffer(dataUrl) {
  const b64 = String(dataUrl || "").split(",")[1] || "";
  return Buffer.from(b64, "base64");
}

async function blobToBase64(blob) {
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab).toString("base64");
}

/**
 * ملاحظة مهمة:
 * - الموديلات هنا بتتطلب Provider عبر HF Inference Providers
 * - اخترت fal-ai لأنه غالبًا الأكثر استقرارًا في الصور عبر HF Providers
 */
const PROVIDER = "fal-ai";

// mapping من IDs القديمة اللي عندك في الفرونت
// إلى قوائم موديلات (fallback)
const PRESETS = {
  auto: [
    { model: "black-forest-labs/FLUX.1-schnell", provider: PROVIDER },
    { model: "ByteDance/SDXL-Lightning", provider: PROVIDER },
  ],
  sdxl: [
    { model: "black-forest-labs/FLUX.1-dev", provider: PROVIDER },
    { model: "black-forest-labs/FLUX.1-schnell", provider: PROVIDER },
  ],
  lightning: [
    { model: "ByteDance/SDXL-Lightning", provider: PROVIDER },
    { model: "black-forest-labs/FLUX.1-schnell", provider: PROVIDER },
  ],
  hypersd: [
    { model: "ByteDance/Hyper-SD", provider: PROVIDER },
    { model: "ByteDance/SDXL-Lightning", provider: PROVIDER },
  ],
  sd15: [
    // لو provider مش موفّر SD1.5 عندك، هيفشل ويروح للفولباك
    { model: "stable-diffusion-v1-5/stable-diffusion-v1-5", provider: PROVIDER },
    { model: "ByteDance/SDXL-Lightning", provider: PROVIDER },
  ],
  // تعديل الصور (img2img)
  pix2pix: [
    { model: "black-forest-labs/FLUX.1-Kontext-dev", provider: PROVIDER },
    // fallback تاني للتعديل
    { model: "fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA", provider: PROVIDER },
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
    const modelId = String(body.modelId || "auto").toLowerCase();

    if (!prompt) {
      return json(400, { error: "الرجاء كتابة وصف للصورة" });
    }

    const width = clamp(Number(body.width || 1024), 256, 1536);
    const height = clamp(Number(body.height || 1024), 256, 1536);

    const stepsDefault = (modelId === "lightning" || modelId === "hypersd") ? 10 : 20;
    const steps = clamp(Number(body.steps || stepsDefault), 5, 40);
    const guidance = clamp(Number(body.guidance || 6), 1, 12);

    const isImg2Img = modelId === "pix2pix";
    if (isImg2Img && !image) {
      return json(400, { error: "نموذج التعديل يحتاج صورة" });
    }

    const client = new InferenceClient(token);
    const tries = PRESETS[modelId] || PRESETS.auto;

    let lastErr = null;

    for (const t of tries) {
      try {
        console.log(`[HF] mode=${isImg2Img ? "img2img" : "txt2img"} modelId=${modelId} model=${t.model} provider=${t.provider}`);

        let outBlob;

        if (!isImg2Img) {
          outBlob = await client.textToImage({
            model: t.model,
            provider: t.provider,
            inputs: prompt,
            parameters: {
              width,
              height,
              num_inference_steps: steps,
              guidance_scale: guidance,
            },
          });
        } else {
          const imgBuf = dataUrlToBuffer(image);
          outBlob = await client.imageToImage({
            model: t.model,
            provider: t.provider,
            inputs: imgBuf,
            parameters: {
              prompt,
              num_inference_steps: steps,
              guidance_scale: guidance,
              target_size: { width, height },
            },
          });
        }

        const base64 = await blobToBase64(outBlob);
        return json(200, { dataUrl: `data:image/png;base64,${base64}` });
      } catch (e) {
        lastErr = e;
        console.error(`[HF] failed model=${t.model} =>`, e?.message || e);
      }
    }

    return json(502, {
      error: "الخدمة مشغولة أو الموديلات غير متاحة حالياً. جرّب تاني.",
      detail: String(lastErr?.message || lastErr || "unknown"),
    });
  } catch (err) {
    console.error("Server Error:", err);
    return json(500, { error: "فشل في معالجة الطلب" });
  }
}
