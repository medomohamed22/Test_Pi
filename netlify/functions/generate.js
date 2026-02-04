const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  try {
    const { prompt } = JSON.parse(event.body);

    // --- نظام تدوير المفاتيح لزيادة الليمت ---
    // يمكنك وضع مفتاح واحد أو عدة مفاتيح في Netlify (GEMINI_API_KEY, GEMINI_API_KEY_2, إلخ)
    const apiKeys = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2, // اختياري: أضف مفتاح ثانٍ من حساب جيميل آخر
    ].filter(k => k); // تصفية المفاتيح الموجودة فقط

    // اختيار مفتاح عشوائي عند كل طلب لتوزيع الضغط
    const selectedKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
    
    if (!selectedKey) throw new Error("API Key is missing!");

    const genAI = new GoogleGenerativeAI(selectedKey);

    // --- تغيير الموديل هنا لأنه المستقر حالياً لتوليد الصور ---
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    const response = await result.response;
    let imageBase64 = "";

    // استخراج الصورة من أجزاء الاستجابة
    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageBase64 = part.inlineData.data;
          break;
        }
      }
    }

    if (!imageBase64) {
        // لو الموديل رد بنص بس (مثلاً رفض يولد صورة بسبب سياسات المحتوى)
        const textResponse = response.text();
        throw new Error("جوجل رفضت توليد الصورة، الرد كان: " + textResponse);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ image: imageBase64 }),
    };

  } catch (error) {
    console.error("Gemini Error:", error.message);
    
    let userFriendlyError = error.message;
    if (userFriendlyError.includes("429")) {
        userFriendlyError = "تجاوزت الحد المسموح (Quota). انتظر 60 ثانية أو استخدم VPN أمريكا لتجديد الليمت.";
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: userFriendlyError }),
    };
  }
};
