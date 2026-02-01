const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";
const PI_SANDBOX = false;

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

let supabase = null;
let currentUser = null;
let lastModalText = "";

// ===== Debug helpers =====
function nowTime(){ return new Date().toLocaleString("ar-EG"); }
function logDebug(title, details=""){
  const line = `[${nowTime()}] ${title}${details? "\n"+details:""}\n\n`;
  debugLogEl.textContent = line + debugLogEl.textContent;
  console.log(title, details);
}
function toast(msg, ms=2600){
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
  if(where.includes("Supabase") || m.includes("supabase") || m.includes("apikey")){
    if(m.includes("umd") || m.includes("createclient") || m.includes("not loaded")){
      return "- مكتبة supabase-js مش اتحملت.\n- تأكد من ترتيب scripts.\n- جرّب fallback (unpkg).";
    }
    if(m.includes("invalid api key") || m.includes("apikey") && m.includes("invalid")){
      return "- المفتاح غلط.\n- خده من Dashboard > Settings > API Keys.";
    }
    return "- راجع URL.\n- راجع RLS/SQL.";
  }
  if(where.includes("Pi") || m.includes("pi")){
    return "- لازم Pi Browser.\n- راجع Developer Portal URLs.\n- sandbox صح؟";
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
  modalTitleEl.textContent = "حصلت مشكلة";
  modalBodyEl.textContent = body;
  modalEl.classList.remove("hidden");
  logDebug("❌ ERROR @ " + where, body);
}

debugBtn?.addEventListener("click", ()=> debugPanel.classList.toggle("hidden"));
clearDebug?.addEventListener("click", ()=> (debugLogEl.textContent="", toast("تم مسح الـ Debug")));
closeBtn?.addEventListener("click", ()=> modalEl.classList.add("hidden"));
copyBtn?.addEventListener("click", async ()=>{
  try{ await navigator.clipboard.writeText(lastModalText||""); toast("تم النسخ ✅"); }
  catch{ alert("انسخ يدويًا من التنبيه."); }
});

envChip.textContent = `Env: ${PI_SANDBOX ? "Sandbox" : "Production"}`;
piChip.textContent = `Pi: ${window.Pi ? "جاهز" : "غير موجود"}`;
sbChip.textContent = `Supabase: ...`;

// ✅ انتظار تحميل supabase-js (UMD)
async function waitForSupabaseUMD(timeoutMs = 2500){
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    if(window.supabase?.createClient) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

(async function boot(){
  try{
    const ok = await waitForSupabaseUMD();
    if(!ok){
      sbChip.textContent = "Supabase: مش محمّل";
      showError(
        "Supabase Init",
        "Supabase UMD غير محمّل (window.supabase.createClient غير موجود)",
        "✅ تأكد إن supabase-js script موجود قبل app.js\n✅ لو jsdelivr محظور، fallback هيشتغل خلال ثواني\n✅ جرّب تحديث الصفحة من Pi Browser"
      );
      return;
    }

    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    sbChip.textContent = "Supabase: جاهز";
    logDebug("✅ Supabase client created", SUPABASE_URL);

  }catch(e){
    sbChip.textContent = "Supabase: مشكلة";
    showError("Supabase Init", e, `URL=${SUPABASE_URL}\nKeyPrefix=${String(SUPABASE_KEY).slice(0,12)}...`);
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

  // Bind actions
  loginBtn?.addEventListener("click", loginWithPi);
  postBtn?.addEventListener("click", createPost);
  refreshBtn?.addEventListener("click", loadPosts);
})();

async function loginWithPi(){
  try{
    if(!window.Pi){
      showError("Pi Login", "Pi SDK غير موجود — لازم Pi Browser.");
      return;
    }

    toast("جاري تسجيل الدخول...");
    const auth = await window.Pi.authenticate(["username"], () => {});
    if(!auth?.user?.uid || !auth?.user?.username){
      showError("Pi Login", "auth رجع بدون uid/username", JSON.stringify(auth,null,2));
      return;
    }

    currentUser = auth.user;
    loginBtn.style.display = "none";
    appRoot.classList.remove("hidden");

    usernameEl.textContent = currentUser.username;
    useridEl.textContent = `uid: ${currentUser.uid}`;
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
    if(!supabase) return showError("Supabase SaveProfile","Supabase client غير جاهز.");
    if(!currentUser) return showError("Supabase SaveProfile","لا يوجد مستخدم.");

    const payload = {
      pi_uid: String(currentUser.uid),
      pi_username: currentUser.username,
      name: currentUser.username,
      avatar: avatarEl.src
    };

    const { error } = await supabase.from("profiles").upsert(payload, { onConflict:"pi_uid" });
    if(error) return showError("Supabase SaveProfile", error, "تأكد إن SQL فيه profiles(pi_uid text primary key) ...");

    sbChip.textContent = "Supabase: شغال";
    logDebug("✅ profiles.upsert OK");

  }catch(e){
    showError("Supabase SaveProfile", e);
  }
}

async function createPost(){
  try{
    if(!currentUser) return showError("CreatePost","لازم تسجل دخول الأول.");
    if(!supabase) return showError("CreatePost","Supabase client غير جاهز.");

    const text = (postTextEl.value||"").trim();
    if(!text){ toast("اكتب نص للبوست"); return; }

    const payload = { user_id: String(currentUser.uid), content: text };
    const { error } = await supabase.from("posts").insert(payload);
    if(error) return showError("Supabase CreatePost", error, "تأكد إن posts.user_id text references profiles(pi_uid)");

    toast("تم نشر البوست ✅");
    postTextEl.value = "";
    await loadPosts();

  }catch(e){
    showError("CreatePost", e);
  }
}

async function loadPosts(){
  try{
    if(!supabase) return showError("LoadPosts","Supabase client غير جاهز.");

    const { data, error } = await supabase
      .from("posts")
      .select("id, content, created_at, user_id, profiles(name, avatar)")
      .order("created_at", { ascending:false });

    if(error) return showError("Supabase LoadPosts", error, "لو العلاقة مش شغالة: راجع foreign key + اسم الجداول.");

    renderFeed(data||[]);
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

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
