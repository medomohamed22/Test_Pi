/******** CONFIG ********/
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";
const PI_SANDBOX = false;

/******** ELEMENTS ********/
const loginBtn = document.getElementById("loginBtn");
const appRoot = document.getElementById("app");
const usernameEl = document.getElementById("username");
const useridEl = document.getElementById("userid");
const avatarEl = document.getElementById("avatar");
const postTextEl = document.getElementById("postText");
const postBtn = document.getElementById("postBtn");
const refreshBtn = document.getElementById("refreshBtn");
const feedEl = document.getElementById("feed");

/******** STATE ********/
let supabase = null;
let currentUser = null;

/******** HELPERS ********/
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSupabaseGlobal() {
  if (window.supabaseJs?.createClient) return window.supabaseJs;
  if (window.supabase?.createClient) return window.supabase;
  return null;
}

async function waitForSupabaseGlobal(timeoutMs = 3500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const g = getSupabaseGlobal();
    if (g) return g;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

function errBox(where, e, extra = "") {
  const msg = (e?.message || e?.toString?.() || String(e || "Unknown"));
  alert(
    `المشكلة في: ${where}\n\n` +
    `التفاصيل:\n${msg}\n\n` +
    (extra ? `معلومات إضافية:\n${extra}\n\n` : "") +
    `نصايح سريعة:\n` +
    `- افتح من Pi Browser لتسجيل الدخول.\n` +
    `- تأكد supabase-js اتحمّل قبل app.js.\n` +
    `- لو invalid api key راجع المفتاح في Dashboard.\n` +
    `- لو permission denied راجع RLS policies.\n`
  );
  console.error("ERROR @", where, e);
}

/******** BOOT ********/
(async function boot() {
  try {
    const g = await waitForSupabaseGlobal(3500);
    if (!g) {
      errBox(
        "Supabase Init",
        "Supabase library not loaded (no supabaseJs/supabase global)",
        "جرّب تغيير شبكة/ VPN أو حمّل supabase-js محليًا داخل المشروع."
      );
      return;
    }
    supabase = g.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    errBox("Supabase Init", e, `URL=${SUPABASE_URL}`);
    return;
  }
  
  // Pi init (اختياري هنا)
  try {
    if (window.Pi) {
      window.Pi.init({ version: "2.0", sandbox: PI_SANDBOX });
    }
  } catch (e) {
    // مش هنوقف الموقع
    console.warn("Pi init warn:", e);
  }
  
  // events
  loginBtn.addEventListener("click", loginWithPi);
  postBtn.addEventListener("click", createPost);
  refreshBtn.addEventListener("click", loadPosts);
  
  // حمل البوستات حتى قبل اللوجين (اختياري)
  loadPosts();
})();

/******** FEATURES ********/
async function loginWithPi() {
  try {
    if (!window.Pi) {
      errBox("Pi Login", "Pi SDK غير موجود. لازم تفتح الموقع من Pi Browser.");
      return;
    }
    
    // init safe
    try { window.Pi.init({ version: "2.0", sandbox: PI_SANDBOX }); } catch {}
    
    const auth = await window.Pi.authenticate(["username"], () => {});
    if (!auth?.user?.uid || !auth?.user?.username) {
      errBox("Pi Login", "auth رجع بدون uid/username", JSON.stringify(auth, null, 2));
      return;
    }
    
    currentUser = auth.user;
    
    // UI
    loginBtn.style.display = "none";
    appRoot.classList.remove("hidden");
    usernameEl.textContent = currentUser.username;
    useridEl.textContent = `uid: ${currentUser.uid}`;
    avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.username)}`;
    
    await saveProfile();
    await loadPosts();
    
  } catch (e) {
    errBox("Pi Login", e);
  }
}

async function saveProfile() {
  try {
    if (!supabase) return errBox("SaveProfile", "Supabase client مش جاهز.");
    if (!currentUser) return errBox("SaveProfile", "لا يوجد مستخدم.");
    
    // ✅ يفترض SQL: profiles(pi_uid text primary key)
    const payload = {
      pi_uid: String(currentUser.uid),
      pi_username: currentUser.username,
      name: currentUser.username,
      avatar: avatarEl.src
    };
    
    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "pi_uid" });
    
    if (error) errBox("Supabase SaveProfile", error, "تأكد SQL: profiles(pi_uid, pi_username, name, avatar)");
    
  } catch (e) {
    errBox("SaveProfile", e);
  }
}

async function createPost() {
  try {
    if (!currentUser) return errBox("CreatePost", "لازم تسجل دخول الأول.");
    if (!supabase) return errBox("CreatePost", "Supabase client مش جاهز.");
    
    const text = (postTextEl.value || "").trim();
    if (!text) return alert("اكتب نص للبوست.");
    
    // ✅ يفترض SQL: posts(user_id text references profiles(pi_uid))
    const payload = { user_id: String(currentUser.uid), content: text };
    
    const { error } = await supabase.from("posts").insert(payload);
    if (error) return errBox("Supabase CreatePost", error, "تأكد SQL: posts.user_id text references profiles(pi_uid)");
    
    postTextEl.value = "";
    await loadPosts();
    
  } catch (e) {
    errBox("CreatePost", e);
  }
}

async function loadPosts() {
  try {
    if (!supabase) return;
    
    const { data, error } = await supabase
      .from("posts")
      .select("id, content, created_at, user_id, profiles(name, avatar)")
      .order("created_at", { ascending: false });
    
    if (error) return errBox("Supabase LoadPosts", error, "راجع foreign key + RLS + أسماء الجداول.");
    
    renderFeed(data || []);
    
  } catch (e) {
    errBox("LoadPosts", e);
  }
}

function renderFeed(posts) {
  feedEl.innerHTML = "";
  
  if (!posts.length) {
    feedEl.innerHTML = `<div class="post">لا يوجد منشورات بعد.</div>`;
    return;
  }
  
  posts.forEach(p => {
    const name = p.profiles?.name || "مستخدم";
    const avatar = p.profiles?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`;
    const time = new Date(p.created_at).toLocaleString("ar-EG");
    
    feedEl.innerHTML += `
      <div class="post">
        <div class="postHead">
          <img class="postAva" src="${escapeHtml(avatar)}" alt="ava" />
          <div class="postName">${escapeHtml(name)}</div>
          <div class="postTime">${escapeHtml(time)}</div>
        </div>
        <p class="postText">${escapeHtml(p.content || "")}</p>
      </div>
    `;
  });
}
