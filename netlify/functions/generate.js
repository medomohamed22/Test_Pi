// تغيير السطر الأول ليصبح هكذا:
const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async (event, context) => {
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
      throw new Error("API Key is missing in Netlify settings");
    }

    // إعداد المكتبة
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // الموديل الذي يدعم توليد الصور حالياً (Experimental)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    let imageBase64 = "";

    // استخراج بيانات الصورة من الرد
    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageBase64 = part.inlineData.data;
          break;
        }
      }
    }

    if (!imageBase64) {
      throw new Error("لم يتم إرسال صورة. تأكد أن الموديل يدعم توليد الصور في حسابك.");
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ image: imageBase64 }),
    };
  } catch (error) {
    console.error("Error Details:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
