exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  try {
    const { prompt } = JSON.parse(event.body);
    // تنظيف الوصف
    const cleanPrompt = encodeURIComponent(prompt.trim());
    // رقم عشوائي لضمان عدم تكرار الصورة
    const seed = Math.floor(Math.random() * 1000000);
    
    // رابط الصورة المباشر من سيرفر Pollinations
    const imageUrl = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: imageUrl }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "خطأ في السيرفر: " + err.message }),
    };
  }
};
