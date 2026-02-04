const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async (event, context) => {
  // إعدادات الـ CORS للسماح بالاتصال من واجهة الموقع
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers };
  }

  try {
    const { prompt } = JSON.parse(event.body);

    if (!process.env.GEMINI_API_KEY) {
      throw new Error("API Key is missing in Netlify environment variables.");
    }

    // إعداد الـ AI باستخدام المفتاح الخاص بك
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // استخدام النموذج الذي طلبته بالضبط
    // ملاحظة: إذا ظهر خطأ 404، استبدله بـ "gemini-2.0-flash"
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });

    // إرسال الطلب بنفس هيكلة الكود الخاص بك
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    const response = await result.response;
    let imageBase64 = "";

    // البحث عن الصورة داخل أجزاء الاستجابة (Parts) كما في الكود الخاص بك
    const parts = response.candidates[0].content.parts;
    for (const part of parts) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data; // استخراج بيانات الـ Base64
        break;
      }
    }

    if (!imageBase64) {
      // محاولة استخراج النص إذا لم تكن هناك صورة (ربما الموديل رد بنص فقط)
      let textResponse = response.text();
      throw new Error("الموديل لم يرسل صورة، الرد كان: " + textResponse);
    }

    // إرسال الصورة بنجاح
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ image: imageBase64 }),
    };

  } catch (error) {
    console.error("Error Details:", error);
    
    // معالجة خطأ الليمت (Quota) لتنبيه المستخدم
    let errorMessage = error.message;
    if (errorMessage.includes("429")) {
      errorMessage = "تجاوزت الحد المسموح به. انتظر دقيقة ثم حاول مجدداً.";
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: errorMessage }),
    };
  }
};
