exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing GEMINI_API_KEY" })
      };
    }

    const body = JSON.parse(event.body || "{}");
    const systemFromClient = String(body.system || "");
    const message = String(body.message || "");
    const history = Array.isArray(body.history) ? body.history : [];

    // defaults
    const temperature =
      typeof body.temperature === "number" ? body.temperature : 0.35;

    let maxOutputTokens =
      typeof body.maxOutputTokens === "number" ? body.maxOutputTokens : 700;

    if (!message.trim()) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing message" })
      };
    }

    // ✅ Detect code requests
    const wantsCode =
      /(\bكود\b|\bcode\b|\bhtml\b|\bcss\b|\bjavascript\b|\bjs\b|\breact\b|\bnode\b|\bapi\b)/i.test(
        message
      );

    // ✅ If wants code, boost tokens
    if (wantsCode) {
      maxOutputTokens = Math.max(maxOutputTokens, 1400);
    } else {
      maxOutputTokens = Math.max(maxOutputTokens, 700);
    }

    // ✅ Base system instruction (forces code fences)
    const baseSystem =
      "أنت مساعد مفيد ودقيق.\n" +
      "لو المستخدم طلب كود: لازم تبعت الكود كامل داخل Markdown code fences مثل ```html``` أو ```js``` أو ```css```.\n" +
      "ممنوع تبعت تمهيد طويل قبل الكود. سطر واحد كحد أقصى ثم الكود.\n" +
      "لو الكود طويل: ابعته بالكامل ولا تقطعه، وإن اضطررت قسّمه إلى أكثر من code block.\n";

    const system =
      (baseSystem + (systemFromClient ? "\n" + systemFromClient : "")).trim();

    // ✅ Trim history to avoid token waste (keep last 10 msgs max)
    const trimmedHistory = history.slice(-10);

    const contents = [];
    for (const h of trimmedHistory) {
      if (!h?.text) continue;
      const role = h.role === "user" ? "user" : "model";
      contents.push({ role, parts: [{ text: String(h.text).slice(0, 6000) }] });
    }
    contents.push({ role: "user", parts: [{ text: message.slice(0, 12000) }] });

    const modelEnv = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";

    async function callGemini(modelName, payload) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": apiKey
          },
          body: JSON.stringify(payload)
        }
      );

      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    }

    const payload = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: { temperature, maxOutputTokens }
    };

    // ✅ 1st call
    let { ok, data, status } = await callGemini(modelEnv, payload);

    // ✅ fallback if model not found / not supported
    if (!ok && (status === 404 || data?.error?.status === "NOT_FOUND")) {
      const second = await callGemini(fallbackModel, payload);
      ok = second.ok;
      data = second.data;
      status = second.status;
    }

    if (!ok) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Gemini API Error", details: data })
      };
    }

    const cand = data?.candidates?.[0] || {};
    let reply =
      cand?.content?.parts?.map((p) => p.text || "").join("") || "";

    const finishReason = cand?.finishReason || "";

    // ✅ If truncated, try to continue ONCE
    const truncated =
      finishReason === "MAX_TOKENS" ||
      (wantsCode && reply.length > 50 && !reply.includes("```") && /<html|function|const|class|body|head/i.test(reply));

    if (truncated) {
      const continueMsg =
        "كمّل من حيث توقفت بدون تكرار، وأكمل نفس الإجابة. لو كود: كمّله داخل ``` ```.";
      const contPayload = {
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [
          ...contents,
          { role: "model", parts: [{ text: reply.slice(-4000) }] },
          { role: "user", parts: [{ text: continueMsg }] }
        ],
        generationConfig: { temperature, maxOutputTokens: Math.max(900, maxOutputTokens) }
      };

      let cont = await callGemini(modelEnv, contPayload);
      if (!cont.ok && (cont.status === 404 || cont.data?.error?.status === "NOT_FOUND")) {
        cont = await callGemini(fallbackModel, contPayload);
      }
      if (cont.ok) {
        const c2 = cont.data?.candidates?.[0] || {};
        const more =
          c2?.content?.parts?.map((p) => p.text || "").join("") || "";
        if (more.trim()) reply = reply + "\n" + more;
      }
    }

    // ✅ Final response
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply,
        meta: {
          modelUsed: ok ? (data?.modelVersion || modelEnv) : modelEnv,
          finishReason
        }
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Server error",
        details: String(e?.message || e)
      })
    };
  }
};
