// ====== SUPABASE ======
const supabase = supabaseJs.createClient(
  "https://xncapmzlwuisupkjlftb.supabase.co",
  "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS"
);

let currentUser = null;

// عناصر (تأكد إنها موجودة في HTML)
const loginBtn = document.getElementById("loginBtn");
const appRoot  = document.getElementById("app");
const usernameEl = document.getElementById("username");
const avatarEl   = document.getElementById("avatar");
const feedEl     = document.getElementById("feed");
const postTextEl = document.getElementById("postText");

// ✅ خليها false لو على الدومين النهائي (Production)
// ✅ خليها true لو بتجرب على Dev URL / Sandbox
const PI_SANDBOX = false;

// ====== LOGIN ======
loginBtn.onclick = async () => {
  try {
    // 1) لازم Pi Browser
    if (!window.Pi) {
      alert("لازم تفتح الموقع من Pi Browser (مش Chrome).");
      return;
    }

    // 2) init
    window.Pi.init({ version: "2.0", sandbox: PI_SANDBOX });

    // 3) authenticate
    const auth = await window.Pi.authenticate(["username"], () => {});
    currentUser = auth.user;

    if (!currentUser?.uid || !currentUser?.username) {
      console.log("AUTH:", auth);
      alert("تم تسجيل الدخول لكن بيانات المستخدم ناقصة. افتح Console وشوف AUTH.");
      return;
    }

    // UI
    loginBtn.style.display = "none";
    appRoot.classList.remove("hidden");

    usernameEl.innerText = currentUser.username;
    avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.username)}`;

    // حفظ بروفايل + تحميل البوستات
    await saveProfile();
    await loadPosts();

  } catch (e) {
    console.error("PI LOGIN ERROR:", e);
    alert(
      "حصل خطأ في تسجيل الدخول.\n\n" +
      "تأكد إنك فاتح من Pi Browser، وإن App URL/Dev URL متسجلين في Developer Portal.\n\n" +
      "تفاصيل: " + (e?.message || e?.toString() || "unknown")
    );
  }
};

// ====== SAVE PROFILE ======
async function saveProfile() {
  // ✅ نخزن pi_uid كنص بدل UUID
  const payload = {
    pi_uid: String(currentUser.uid),
    pi_username: currentUser.username,
    name: currentUser.username,
    avatar: avatarEl.src
  };

  const { error } = await supabase.from("profiles").upsert(payload, {
    onConflict: "pi_uid"
  });

  if (error) {
    console.error("SAVE PROFILE ERROR:", error);
    alert(
      "تم تسجيل الدخول ✅ لكن حفظ البروفايل فشل.\n" +
      "غالبًا SQL الجداول مش متظبط (pi_uid).\n\n" +
      "تفاصيل: " + (error.message || JSON.stringify(error))
    );
  }
}

// ====== CREATE POST ======
async function createPost() {
  if (!currentUser) {
    alert("سجل دخول الأول.");
    return;
  }

  const text = (postTextEl?.value || "").trim();
  if (!text) {
    alert("اكتب حاجة في البوست.");
    return;
  }

  const { error } = await supabase.from("posts").insert({
    user_id: String(currentUser.uid), // ✅ نص
    content: text
  });

  if (error) {
    console.error("CREATE POST ERROR:", error);
    alert("فشل نشر البوست: " + (error.message || JSON.stringify(error)));
    return;
  }

  postTextEl.value = "";
  await loadPosts();
}

// ====== LOAD POSTS ======
async function loadPosts() {
  const { data, error } = await supabase
    .from("posts")
    .select("id, content, image, video, created_at, user_id, profiles(name, avatar)")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("LOAD POSTS ERROR:", error);
    alert("فشل تحميل البوستات: " + (error.message || JSON.stringify(error)));
    return;
  }

  feedEl.innerHTML = "";

  (data || []).forEach(p => {
    const name = p.profiles?.name || "مستخدم";
    const avatar = p.profiles?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}`;
    const content = p.content ? escapeHtml(p.content) : "";

    feedEl.innerHTML += `
      <div class="post">
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:8px;">
          <img src="${avatar}" style="width:38px;height:38px;border-radius:50%;" />
          <b>${escapeHtml(name)}</b>
          <span style="margin-right:auto; font-size:12px; opacity:.7;">
            ${new Date(p.created_at).toLocaleString("ar-EG")}
          </span>
        </div>
        <p>${content}</p>
      </div>
    `;
  });
}

// ====== SAFE HTML ======
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
