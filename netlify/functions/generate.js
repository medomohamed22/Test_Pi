exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers };

  try {
    const body = JSON.parse(event.body);
    const prompt = encodeURIComponent(body.prompt || "cat");
    const seed = Math.floor(Math.random() * 1000000);
    
    // الرابط المباشر
    const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: imageUrl }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
