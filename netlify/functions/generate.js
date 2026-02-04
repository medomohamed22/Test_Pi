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
    
    // تأكد من وجود مفتاح الـ API في إعدادات Netlify
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("API Key is missing. Please add GEMINI_API_KEY to Netlify Environment Variables.");
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // ⚠️ ملاحظة هامة: Gemini 2.0 Flash هو الوحيد الذي يولد صور حالياً
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // إرسال الطلب لجوجل
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    let imageBase64 = "";

    // استخراج بيانات الصورة إذا وجدت
    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageBase64 = part.inlineData.data;
          break;
        }
      }
    }

    // إذا لم يرجع صورة (بسبب ضغط على السيرفر أو قيود المنطقة)
    if (!imageBase64) {
      throw new Error("السيرفر لم يرسل صورة. جرب وصفاً آخر أو انتظر دقيقة (قد يكون هناك ضغط على الخطة المجانية).");
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ image: imageBase64 }),
    };

  } catch (error) {
    console.error("Gemini Error:", error.message);
    
    // تخصيص رسالة الخطأ للمستخدم
    let userMessage = error.message;
    if (userMessage.includes("429")) userMessage = "تجاوزت الحد المسموح به (Quota). انتظر دقيقة وجرب مرة أخرى.";
    if (userMessage.includes("404")) userMessage = "الموديل غير متاح حالياً لتوليد الصور.";

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: userMessage }),
    };
  }
};
