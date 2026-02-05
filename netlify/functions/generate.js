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

// Hugging Face Inference API endpoint (free tier w/ HF_TOKEN)
function hfUrl(model) {
  return `https://api-inference.huggingface.co/models/${model}`;
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
 * img2img في HF Inference API: أفضل صيغة “آمنة” هي إرسال multipart/form-data
 * لأن بعض موديلات img2img بتتوقع صورة ملف + prompt.
 */
async function hfImageToImage({ token, model, prompt, imageDataUrl, steps }) {
  const base64 = String(imageDataUrl || "").split(",")[1] || "";
  const imageBuf = Buffer.from(base64, "base64");

  const form = new FormData();
  form.append("inputs", prompt);

  // بعض السيرفرات بتفهم parameters كـ JSON string داخل multipart
  form.append("parameters", JSON.stringify({ num_inference_steps: steps }));

  // اسم الحقل الشائع للصورة: "image"
  form.append("image", new Blob([imageBuf]), "image.png");

  const resp = await fetch(hfUrl(model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      // لا تضيف Content-Type هنا، fetch هيحطه تلقائيًا مع boundary
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
  // Text→Image
  sdxl: [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "stabilityai/stable-diffusion-xl-refiner-1.0",
    "runwayml/stable-diffusion-v1-5",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
  ],
  sd15: [
    "runwayml/stable-diffusion-v1-5",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
    "stabilityai/stable-diffusion-xl-base-1.0",
  ],
  auto: [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "runwayml/stable-diffusion-v1-5",
    "stable-diffusion-v1-5/stable-diffusion-v1-5",
  ],

  // Image→Image / Edit
  pix2pix: [
    "timbrooks/instruct-pix2pix",
    // fallback عام: img2img شائع (لو احتجته)
    "runwayml/stable-diffusion-v1-5",
  ],

  // mapping IDs القديمة اللي كنت حاططها
  lightning: [
    "stabilityai/stable-diffusion-xl-base-1.0",
    "runwayml/stable-diffusion-v1-5",
  ],
  hypersd: [
    "runwayml/stable-diffusion-v1-5",
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
    const modelId = String(body.modelId || "auto").toLowerCase();

    if (!prompt) return json(400, { error: "الرجاء كتابة وصف للصورة" });

    const width = clamp(Number(body.width || 1024), 256, 1536);
    const height = clamp(Number(body.height || 1024), 256, 1536);

    // خطوات أقل = أسرع (ومناسب للـ free tier)
    const steps = clamp(Number(body.steps || (modelId === "sd15" ? 18 : 22)), 8, 35);

    const isImg2Img = modelId === "pix2pix";
    if (isImg2Img && !image) return json(400, { error: "نموذج التعديل يحتاج صورة" });

    const tryModels = MODELS[modelId] || MODELS.auto;

    let lastErr = null;

    for (const m of tryModels) {
      try {
        console.log(`[HF] mode=${isImg2Img ? "img2img" : "txt2img"} modelId=${modelId} model=${m}`);

        const base64 = !isImg2Img
          ? await hfTextToImage({ token, model: m, prompt, width, height, steps })
          : await hfImageToImage({ token, model: m, prompt, imageDataUrl: image, steps });

        return json(200, { dataUrl: `data:image/png;base64,${base64}` });
      } catch (e) {
        lastErr = e;
        console.error(`[HF] failed model=${m} =>`, e?.message || e);
      }
    }

    return json(502, {
      error: "الموديلات مجانية لكنها مش متاحة/مزدحمة حاليًا. جرّب بعد دقيقة أو غيّر الموديل.",
      detail: String(lastErr?.message || lastErr || "unknown"),
    });
  } catch (err) {
    console.error("Server Error:", err);
    return json(500, { error: "فشل في معالجة الطلب" });
  }
}
