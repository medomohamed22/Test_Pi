const supabase = supabaseJs.createClient(
  "https://xncapmzlwuisupkjlftb.supabase.co",
  "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS"
);

let currentUser = null;

// LOGIN
document.getElementById("loginBtn").onclick = async () => {
  try {
    Pi.init({ version: "2.0" });
    
    const auth = await Pi.authenticate(["username"], () => {});
    currentUser = auth.user;
    
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("app").classList.remove("hidden");
    
    document.getElementById("username").innerText = currentUser.username;
    document.getElementById("avatar").src =
      `https://ui-avatars.com/api/?name=${currentUser.username}`;
    
    await saveProfile();
    loadPosts();
  } catch {
    alert("افتح الموقع من Pi Browser");
  }
};

// SAVE PROFILE
async function saveProfile() {
  await supabase.from("profiles").upsert({
    id: currentUser.uid,
    pi_username: currentUser.username,
    name: currentUser.username,
    avatar: document.getElementById("avatar").src
  });
}

// CREATE POST
async function createPost() {
  const text = postText.value;
  
  await supabase.from("posts").insert({
    user_id: currentUser.uid,
    content: text
  });
  
  postText.value = "";
  loadPosts();
}

// LOAD POSTS
async function loadPosts() {
  const { data } = await supabase
    .from("posts")
    .select("*, profiles(name, avatar)")
    .order("created_at", { ascending: false });
  
  feed.innerHTML = "";
  
  data.forEach(p => {
    feed.innerHTML += `
      <div class="post">
        <b>${p.profiles.name}</b>
        <p>${p.content || ""}</p>
      </div>
    `;
  });
}
