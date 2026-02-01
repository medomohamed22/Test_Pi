// ✅ لازم تكون محمّل UMD صح من CDN اللي فوق
const supabase = supabaseJs.createClient(
  "https://xncapmzlwuisupkjlftb.supabase.co",
  "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS"
);

let currentUser = null;

document.getElementById("loginBtn").onclick = async () => {
  try {
    // 1) تأكد إنك داخل Pi Browser
    if (!window.Pi) {
      alert("لازم تفتح الموقع من Pi Browser.");
      return;
    }

    // 2) Pi init
    Pi.init({ version: "2.0", sandbox: false });

    // 3) authenticate
    const auth = await Pi.authenticate(["username"], () => {});
    currentUser = auth.user;

    // UI
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("app").classList.remove("hidden");

    document.getElementById("username").innerText = currentUser.username;
    document.getElementById("avatar").src =
      `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.username)}`;

    // ✅ ما نخليش Supabase failure يوقف الموقع
    const ok = await saveProfileSafe();
    if (!ok) {
      // هنكمل عادي، بس هنقولك إن فيه مشكلة في key/RLS
      console.warn("Profile not saved (Supabase issue).");
    }

    await loadPosts();

  } catch (e) {
    console.error("PI LOGIN ERROR:", e);
    alert("افتح الموقع من Pi Browser + راجع إعدادات Pi App.");
  }
};

// ✅ حفظ بروفايل بشكل آمن + طباعة الخطأ الحقيقي
async function saveProfileSafe() {
  try {
    // ⚠️ لو جدولك معرف id كـ uuid، و Pi uid مش UUID => هيعمل error
    // الأفضل يكون عندك profiles.pi_uid (text) بدل uuid
    const { error } = await supabase.from("profiles").upsert({
      // غيّرها حسب SQL بتاعك:
      pi_uid: String(currentUser.uid),
      pi_username: currentUser.username,
      name: currentUser.username,
      avatar: document.getElementById("avatar").src
    }, { onConflict: "pi_uid" });

    if (error) {
      console.error("SUPABASE saveProfile ERROR:", error);
      alert("Supabase مشكلة: " + (error.message || JSON.stringify(error)));
      return false;
    }
    return true;
  } catch (e) {
    console.error("SUPABASE saveProfile EXCEPTION:", e);
    alert("Supabase exception: " + (e.message || e.toString()));
    return false;
  }
}

async function createPost() {
  const text = (postText.value || "").trim();
  if (!text) return alert("اكتب البوست الأول.");

  const { error } = await supabase.from("posts").insert({
    user_id: String(currentUser.uid),
    content: text
  });

  if (error) {
    console.error("CREATE POST ERROR:", error);
    alert("فشل نشر البوست: " + (error.message || JSON.stringify(error)));
    return;
  }

  postText.value = "";
  loadPosts();
}

async function loadPosts() {
  const { data, error } = await supabase
    .from("posts")
    .select("*, profiles(name, avatar)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("LOAD POSTS ERROR:", error);
    alert("فشل تحميل البوستات: " + (error.message || JSON.stringify(error)));
    return;
  }

  feed.innerHTML = "";

  (data || []).forEach(p => {
    feed.innerHTML += `
      <div class="post">
        <b>${p.profiles?.name || "مستخدم"}</b>
        <p>${p.content || ""}</p>
      </div>
    `;
  });
}
