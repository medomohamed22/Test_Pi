
const { getStore } = require("@netlify/blobs");
const store = getStore({ name: "ultra-ai" });

exports.handler = async () => {
  try {
    const index = (await store.getJSON("index", { consistency: "strong" })) || [];
    // تقدير حجم تقريبي
    let bytes = 0;
    for (const it of index.slice(0, 30)) {
      const doc = await store.getJSON(`docs/${it.id}`);
      if (doc?.text) bytes += doc.text.length;
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, docs: index.length, bytesApprox: bytes })
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
