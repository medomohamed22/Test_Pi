
// netlify/functions/generate.js

export async function handler(event) {
  // ===== CORS =====
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }
  
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }
  
  try {
    const body = JSON.parse(event.body || "{}");
    const {
      prompt,
      image, // dataUrl or base64
      modelId, // optional: "sdxl" | "lightning" | "hypersd" | "sd15" | "pix2pix" | "auto"
      width,
      height,
      steps,
    } = body;
    
    if (!prompt || !String(prompt).trim()) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "الرجاء كتابة وصف للصورة" }),
      };
    }
    
    const token = process.env.HF_TOKEN;
    if (!token) {
      return {
        statusCode: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ error: "HF_TOKEN missing" }),
      };
    }
    
    // ===== Recommended free-ish models (best practical picks) =====
    // Text-to-Image (quality / speed)
    const TEXT_MODELS = {
      sdxl: "stabilityai/stable-diffusion-xl-base-1.0", // جودة عالية 1024
      lightning: "ByteDance/SDXL-Lightning", // سريع جدًا
      hypersd: "ByteDance/Hyper-SD", // سريع + جيد
      sd15: "stable-diffusion-v1-5/stable-diffusion-v1-5", // أخف
    };
    
    // Image-to-Image (prompt-based edit/variation)
    const IMG2IMG_MODELS = {
      pix2pix: "timbrooks/instruct-pix2pix",
    };
    
    // ===== Model selection + fallback order =====
    const hasImage = !!image && String(image).includes("base64");
    const mode = hasImage ? "img2img" : "txt2img";
    
    // لو المستخدم مختار موديل معيّن
    const requestedId = (modelId || "auto").toLowerCase();
    
    // ترتيب fallback عملي
    const fallbackOrderTxt = ["sdxl", "lightning", "hypersd", "sd15"];
    const fallbackOrderImg = ["pix2pix"]; // تقدر تزود لاحقًا لو ضفت موديلات img2img تانية
    
    const candidates =
      mode === "txt2img" ?
      (requestedId !== "auto" && TEXT_MODELS[requestedId] ?
        [requestedId, ...fallbackOrderTxt.filter((x) => x !== requestedId)] :
        fallbackOrderTxt) :
      (requestedId !== "auto" && IMG2IMG_MODELS[requestedId] ?
        [requestedId, ...fallbackOrderImg.filter((x) => x !== requestedId)] :
        fallbackOrderImg);
    
    // ===== Helpers =====
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    
    const W = clamp(Number(width || 1024), 256, 1536);
    const H = clamp(Number(height || 1024), 256, 1536);
    
    // خطوات أقل للموديلات السريعة
    const defaultSteps =
      mode === "txt2img" ?
      (requestedId === "lightning" || requestedId === "hypersd" ? 8 : 30) :
      20;
    
    const STEPS = clamp(Number(steps || defaultSteps), 1, 50);
    
    function extractBase64(dataUrlOrBase64) {
      const s = String(dataUrlOrBase64 || "");
      if (!s) return "";
      if (s.startsWith("data:image")) {
        return s.split(",")[1] || "";
      }
      // لو المستخدم بعت base64 فقط
      return s;
    }
    
    async function callHFModel(modelRepo) {
      const modelUrl = `https://router.huggingface.co/models/${modelRepo}`;
      
      let payload;
      
      if (mode === "txt2img") {
        payload = {
          inputs: String(prompt),
          parameters: {
            width: W,
            height: H,
            num_inference_steps: STEPS,
          },
          options: {
            wait_for_model: true,
            use_cache: false,
          },
        };
      } else {
        // img2img spec: inputs = image base64, parameters.prompt = prompt
        payload = {
          inputs: extractBase64(image),
          parameters: {
            prompt: String(prompt),
            num_inference_steps: STEPS,
            guidance_scale: 7,
            // target_size مش كل الموديلات لازم تدعمه، بس غالبًا مفيد
            target_size: { width: W, height: H },
          },
          options: {
            wait_for_model: true,
            use_cache: false,
          },
        };
      }
      
      const resp = await fetch(modelUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      
      // بعض الردود بتكون JSON error
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        return {
          ok: false,
          status: resp.status,
          text: txt,
          modelUrl,
        };
      }
      
      const contentType = resp.headers.get("content-type") || "";
      // معظم الوقت بيرجع image bytes
      if (contentType.includes("application/json")) {
        const j = await resp.json().catch(() => null);
        // لو رجع JSON بدل صورة (أحيانًا يحصل)
        return {
          ok: false,
          status: 502,
          text: JSON.stringify(j),
          modelUrl,
        };
      }
      
      const buffer = await resp.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return {
        ok: true,
        status: 200,
        modelUrl,
        base64,
      };
    }
    
    function isRetryable(status, text) {
      const t = String(text || "").toLowerCase();
      // حالات زحمة/تحميل/مشكلة راوتر
      return (
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        t.includes("loading") ||
        t.includes("currently loading") ||
        t.includes("model is loading") ||
        t.includes("overloaded") ||
        t.includes("rate limit") ||
        t.includes("router.huggingface.co") ||
        t.includes("not found")
      );
    }
    
    // ===== Try models with fallback =====
    let lastErr = null;
    
    for (const id of candidates) {
      const repo =
        mode === "txt2img" ? TEXT_MODELS[id] : IMG2IMG_MODELS[id];
      
      if (!repo) continue;
      
      console.log(`[HF] mode=${mode} try=${id} repo=${repo}`);
      
      const r = await callHFModel(repo);
      
      if (r.ok) {
        return {
          statusCode: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            ok: true,
            mode,
            usedModelId: id,
            usedModelRepo: repo,
            dataUrl: `data:image/png;base64,${r.base64}`,
          }),
        };
      }
      
      console.error(`[HF] failed model=${id} status=${r.status} body=${r.text?.slice?.(0, 300)}`);
      
      lastErr = r;
      
      // لو خطأ مش قابل للتجربة، اقطع فورًا
      if (!isRetryable(r.status, r.text)) break;
    }
    
    // ===== Final error =====
    const userMsg =
      mode === "img2img" ?
      "حصلت مشكلة في تعديل الصورة (الضغط عالي/الموديل بيحمّل). جرّب تاني أو غيّر الموديل." :
      "حصلت مشكلة في توليد الصورة (الضغط عالي/الموديل بيحمّل). جرّب تاني أو غيّر الموديل.";
    
    return {
      statusCode: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        error: userMsg,
        details: lastErr ?
          {
            status: lastErr.status,
            modelUrl: lastErr.modelUrl,
            raw: (lastErr.text || "").slice(0, 800),
          } :
          null,
      }),
    };
  } catch (err) {
    console.error("Server Error:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "فشل في معالجة الطلب" }),
    };
  }
}
