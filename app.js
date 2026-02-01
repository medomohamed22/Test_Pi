/******** CONFIG ********/
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";
const PI_SANDBOX = false;

/******** ELEMENTS ********/
const el = (id) => document.getElementById(id);

const loginBtn   = el("loginBtn");
const debugBtn   = el("debugBtn");
const appRoot    = el("app");
const usernameEl = el("username");
const useridEl   = el("userid");
const avatarEl   = el("avatar");
const postTextEl = el("postText");
const postBtn    = el("postBtn");
const refreshBtn = el("refreshBtn");
const feedEl     = el("feed");

const piChip  = el("piChip");
const sbChip  = el("sbChip");
const envChip = el("envChip");

const toastEl = el("toast");
const debugPanel = el("debugPanel");
const debugLogEl = el("debugLog");
const clearDebug = el("clearDebug");

const modalEl = el("modal");
const modalTitleEl = el("modalTitle");
const modalBodyEl  = el("modalBody");
const closeBtn = el("closeBtn");
const copyBtn  = el("copyBtn");

/******** STATE ********/
let supabase = null;
let currentUser = null;
let lastModalText = "";

/******** ERROR/DEBUG ********/
function nowTime(){ return new Date().toLocaleString("ar-EG"); }
function logDebug(title, details=""){
  const line = `[${nowTime()}] ${title}${details? "\n"+details:""}\n\n`;
  if (debugLogEl) debugLogEl.textContent = line + debugLogEl.textContent;
  console.log(title, details);
}
function toast(msg, ms=2600){
  if(!toastEl){ alert(msg); return; }
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(()=>toastEl.classList.add("hidden"), ms);
}
function normalizeError(err){
  if(!err) return "Unknown error";
  if(typeof err==="string") return err;
  if(err.message) return err.message;
  try{ return JSON.stringify(err,null,2);}catch{ return String(err); }
}
function suggest(where, msg){
  const m=(msg||"").toLowerCase();

  if(where.includes("Supabase") || m.includes("supabase") || m.includes("apikey") || m.includes("rls")){
    if(m.includes("umd") || m.includes("createclient") || m.includes("not loaded") || m.includes("غير محمّل")){
      return "- مكتبة supabase-js مش اتحملت.\n- تأكد app.js بعد سكربت supabase.\n- جرّب fallback.\n- أو حمّل supabase-js محليًا.";
    }
    if(m.includes("invalid api key") || (m.includes("apikey") && m.includes("invalid"))){
      return "- المفتاح غير صحيح.\n- خده من Dashboard > Settings > API.\n- جرّب anon القديم (eyJ...).";
    }
    if(m.includes("permission") || m.includes("denied") || m.includes("rls")){
      return "- RLS policy مانعة.\n- لازم سياسات insert/select للجداول.";
    }
    if(m.includes("relation") || m.includes("does not exist") || m.includes("column")){
      return "- SQL مش مطابق للكود.\n- لازم profiles(pi_uid) و posts(user_id) ...";
    }
    return "- راجع URL + Keys + RLS + SQL.";
  }

  if(where.includes("Pi") || m.includes("pi")){
    return "- لازم تفتح من Pi Browser.\n- راجع Developer Portal URLs.\n- sandbox صح؟";
  }

  if(where.includes("DOM")){
    return "- عنصر ناقص في HTML (id غلط).\n- راجع index.html.";
  }

  return "- انسخ التفاصيل وابعتها.";
}
function showError(where, err, extra=""){
  const msg = normalizeError(err);
  const body =
`📍 المكان: ${where}

🧾 التفاصيل:
${msg}

🧩 اقتراحات:
${suggest(where, msg)}

${extra ? "\n📌 معلومات إضافية:\n"+extra : ""}`;

  lastModalText = body;
  if(modalEl){
    modalTitleEl.textContent = "حصلت مشكلة";
    modalBodyEl.textContent = body;
    modalEl.classList.remove("hidden");
  } else {
    alert(body);
  }
  logDebug("❌ ERROR @ " + where, body);
}
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/******** UI EVENTS ********/
debugBtn?.addEventListener("click", ()=> debugPanel.classList.toggle("hidden"));
clearDebug?.addEventListener("click", ()=> (debugLogEl.textContent="", toast("تم مسح الـ Debug")));
closeBtn?.addEventListener("click", ()=> modalEl.classList.add("hidden"));
copyBtn?.addEventListener("click", async ()=>{
  try{ await navigator.clipboard.writeText(lastModalText||""); toast("تم نسخ التفاصيل ✅"); }
  catch{ alert("انسخ يدويًا من التنبيه."); }
});

/******** SUPABASE GLOBAL DETECT ********/
function getSupabaseGlobal(){
  // بعض النسخ: window.supabaseJs
  if(window.supabaseJs?.createClient) return window.supabaseJs;
  // بعض النسخ: window.supabase
  if(window.supabase?.createClient) return window.supabase;
  return null;
}
async function waitForSupabaseGlobal(timeoutMs=3500){
  const start = Date.now();
  while(Date.now()-start < timeoutMs){
    const g = getSupabaseGlobal();
    if(g) return g;
    await new Promise(r=>setTimeout(r,100));
  }
  return null;
}

/******** BOOT ********/
(async function boot(){
  try{
    envChip.textContent = `Env: ${PI_SANDBOX ? "Sandbox" : "Production"}`;
    piChip.textContent  = `Pi: ${window.Pi ? "موجود" : "غير موجود"}`;
    sbChip.textContent  = "Supabase: ...";

    // انتظر supabase-js
    const g = await waitForSupabaseGlobal(3500);
    if(!g){
      sbChip.textContent = "Supabase: مش محمّل";
      showError(
        "Supabase Init",
        "Supabase UMD غير محمّل (لا window.supabaseJs ولا window.supabase)",
        "✅ تأكد إن سكربت supabase-js موجود قبل app.js\n✅ جرّب إنترنت مختلف أو حمّل supabase-js محليًا\n✅ في Pi Browser أحيانًا بعض CDN بتتحظر"
      );
      return;
    }

    supabase = g.createClient(SUPABASE_URL, SUPABASE_KEY);
    sbChip.textContent = "Supabase: جاهز";
    logDebug("✅ Supabase client created", "global=" + (g===window.supabaseJs ? "supabaseJs" : "supabase"));

  }catch(e){
    sbChip.textContent = "Supabase: مشكلة";
    showError("Supabase Init", e, `URL=${SUPABASE_URL}\nKeyPrefix=${String(SUPABASE_KEY).slice(0,12)}...`);
    return;
  }

  // Pi init
  try{
    if(window.Pi){
      window.Pi.init({ version:"2.0", sandbox: PI_SANDBOX });
      piChip.textContent = "Pi: جاهز";
      logDebug("✅ Pi.init done", `sandbox=${PI_SANDBOX}`);
    } else {
      piChip.textContent = "Pi: غير موجود";
      logDebug("ℹ️ Pi غير موجود", "افتح من Pi Browser");
    }
  }catch(e){
    piChip.textContent = "Pi: مشكلة";
    showError("Pi Init", e);
  }

  // Actions
  loginBtn?.addEventListener("click", loginWithPi);
  postBtn?.addEventListener("click", createPost);
  refreshBtn?.addEventListener("click", loadPosts);
})();

/******** FEATURES ********/
async function loginWithPi(){
  try{
    if(!window.Pi){
      showError("Pi Login", "Pi SDK غير موجود — لازم Pi Browser.");
      return;
    }

    toast("جاري تسجيل الدخول...");
    logDebug("➡️ Pi.authenticate start");

    const auth = await window.Pi.authenticate(["username"], () => {});
    if(!auth?.user?.uid || !auth?.user?.username){
      showError("Pi Login", "auth رجع بدون uid/username", JSON.stringify(auth,null,2));
      return;
    }

    currentUser = auth.user;

    // UI
    loginBtn.style.display = "none";
    appRoot.classList.remove("hidden");
    usernameEl.textContent = currentUser.username;
    useridEl.textContent   = `uid: ${currentUser.uid}`;
    avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.username)}`;

    toast("تم تسجيل الدخول ✅");
    logDebug("✅ Pi Login OK", `uid=${currentUser.uid}\nusername=${currentUser.username}`);

    await saveProfileSafe();
    await loadPosts();

  }catch(e){
    showError("Pi Login", e);
  }
}

async function saveProfileSafe(){
  try{
    if(!supabase) return showError("Supabase SaveProfile", "Supabase client غير جاهز.");
    if(!currentUser) return showError("Supabase SaveProfile", "لا يوجد مستخدم مسجّل.");

    const payload = {
      pi_uid: String(currentUser.uid),
      pi_username: currentUser.username,
      name: currentUser.username,
      avatar: avatarEl.src
    };

    const { error } = await supabase.from("profiles").upsert(payload, { onConflict:"pi_uid" });
    if(error){
      showError("Supabase SaveProfile", error, "✅ تأكد إن SQL عندك: profiles(pi_uid text primary key, ...)");
      return;
    }

    sbChip.textContent = "Supabase: شغال";
    logDebug("✅ profiles.upsert OK");

  }catch(e){
    showError("Supabase SaveProfile", e);
  }
}

async function createPost(){
  try{
    if(!currentUser) return showError("CreatePost", "لازم تسجل دخول الأول.");
    if(!supabase) return showError("CreatePost", "Supabase client غير جاهز.");

    const text = (postTextEl.value||"").trim();
    if(!text){ toast("اكتب نص للبوست"); return; }

    const payload = { user_id: String(currentUser.uid), content: text };
    const { error } = await supabase.from("posts").insert(payload);

    if(error){
      showError("Supabase CreatePost", error, "✅ تأكد إن SQL: posts.user_id text references profiles(pi_uid)");
      return;
    }

    toast("تم نشر البوست ✅");
    postTextEl.value = "";
    await loadPosts();

  }catch(e){
    showError("CreatePost", e);
  }
}

async function loadPosts(){
  try{
    if(!supabase) return showError("LoadPosts", "Supabase client غير جاهز.");

    const { data, error } = await supabase
      .from("posts")
      .select("id, content, created_at, user_id, profiles(name, avatar)")
      .order("created_at", { ascending:false });

    if(error){
      showError("Supabase LoadPosts", error, "لو العلاقة مش شغالة: راجع foreign key + RLS + أسماء الجداول.");
      return;
    }

    renderFeed(data || []);
    logDebug("✅ posts loaded", `count=${(data||[]).length}`);

  }catch(e){
    showError("LoadPosts", e);
  }
}

function renderFeed(posts){
  feedEl.innerHTML = "";

  if(!posts.length){
    feedEl.innerHTML = `<div class="post">لا يوجد منشورات بعد.</div>`;
    return;
  }

  posts.forEach(p=>{
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
        <p class="postText">${escapeHtml(p.content||"")}</p>
      </div>
    `;
  });
}
