
const { getStore } = require("@netlify/blobs");
const store = getStore({ name: "ultra-ai" });

exports.handler = async () => {
  try {
    // امسح index
    await store.delete("index");
    
    // امسح docs (best-effort: list كل keys)
    const listed = await store.list({ prefix: "docs/" });
    for (const k of listed.blobs || []) {
      await store.delete(k.key);
    }
    
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
