exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };
  
  try {
    const { prompt } = JSON.parse(event.body);
    
    // إضافة لمسة جمالية للوصف لضمان جودة عالية
    const enhancedPrompt = encodeURIComponent(`${prompt}, high resolution, 8k, highly detailed, masterpiece`);
    
    // إنشاء رابط الصورة (نستخدم موديل flux لضمان جودة عالمية)
    const imageUrl = `https://image.pollinations.ai/prompt/${enhancedPrompt}?model=flux&width=1024&height=1024&nologo=true`;
    
    // سنجلب الصورة ونحولها لـ Base64 لكي لا نغير أي شيء في كود الفرونت إند الخاص بك
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const imageBase64 = buffer.toString('base64');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ image: imageBase64 }),
    };
    
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "حدث خطأ أثناء توليد الصورة: " + error.message }),
    };
  }
};
