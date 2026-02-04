const { GoogleGenAI } = require("@google/genai");

exports.handler = async (event, context) => {
  // السماح بطلبات التصفح (CORS)
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  
  // التعامل مع طلبات التحقق من الاتصال
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers };
  }
  
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  
  try {
    const { prompt } = JSON.parse(event.body);
    
    // نيتليفاي ستقرأ المفتاح من الإعدادات التي سنضعها في لوحة التحكم
    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);
    
    // ملاحظة: تأكد من اسم الموديل الصحيح المتاح لك 
    // الموديل الحالي المستقر لتوليد المحتوى المتعدد هو gemini-2.0-flash
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    let imageBase64 = "";
    
    // استخراج الصورة من الاستجابة
    const parts = response.candidates[0].content.parts;
    for (const part of parts) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        break;
      }
    }
    
    if (!imageBase64) {
      throw new Error("لم يتم العثور على بيانات صورة في رد جوجل");
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ image: imageBase64 }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
