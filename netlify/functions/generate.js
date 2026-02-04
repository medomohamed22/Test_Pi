// netlify/functions/generate.js
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    const body = JSON.parse(event.body);
    const prompt = encodeURIComponent(body.prompt.trim());
    const seed = Math.floor(Math.random() * 1000000);
    
    // رابط سريع ومستقر من Pollinations
    const imageUrl = `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: imageUrl })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
