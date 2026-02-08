// 1. إعدادات Supabase
const supabaseUrl = 'https://xncapmzlwuisupkjlftb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuY2FwbXpsd3Vpc3Vwa2psZnRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0Mzk0MzcsImV4cCI6MjA4NDAxNTQzN30.JVhiue90DHvEirIAeCPSBnJxXvO2RMPvRFu5RMulfig';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// 2. المتغيرات العامة
let currentUser = null;
let activeChat = null;

// 3. عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    console.log("App Started...");
    fetchProducts(); // تحميل المنتجات للزوار
    initPi();        // تجهيز زر الدخول
    setupUI();       // تجهيز الأزرار والنوافذ
});

// 4. تهيئة Pi Network
async function initPi() {
    const loginBtn = document.getElementById('pi-login-btn');
    
    // دالة التعامل مع الضغط على الزر
    const handleLogin = async () => {
        // التحقق من وجود مكتبة Pi
        if (!window.Pi) {
            alert("⚠️ يجب فتح الموقع داخل تطبيق Pi Browser ليعمل تسجيل الدخول.");
            return;
        }

        const originalText = loginBtn.innerHTML;
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الاتصال...';
        loginBtn.disabled = true;

        try {
            const Pi = window.Pi;
            // 🔴 تفعيل الوضع الحقيقي
            await Pi.init({ version: "2.0", sandbox: false });
            
            const scopes = ['username', 'payments'];
            const auth = await Pi.authenticate(scopes, onIncompletePayment);
            
            console.log("Logged in user:", auth.user);
            
            // حفظ المستخدم
            await saveUserToDB(auth.user);

            // تحديث المتغيرات والواجهة
            currentUser = { uid: auth.user.uid, username: auth.user.username };
            updateUIForLoggedUser();

        } catch (err) {
            console.error("Login Error:", err);
            alert("فشل تسجيل الدخول: " + err.message);
            loginBtn.innerHTML = originalText;
            loginBtn.disabled = false;
        }
    };

    loginBtn.addEventListener('click', handleLogin);
    
    // زر الخروج
    document.getElementById('logout-btn').addEventListener('click', () => {
        location.reload();
    });
}

function onIncompletePayment(payment) { console.log("Payment incomplete", payment); }

// حفظ المستخدم في قاعدة البيانات
async function saveUserToDB(user) {
    const { error } = await supabase.from('users').upsert({ 
        pi_id: user.uid, 
        username: user.username 
    }, { onConflict: 'pi_id' });
    
    if (error) console.error("DB User Save Error:", error);
}

// تحديث الواجهة بعد الدخول
function updateUIForLoggedUser() {
    document.getElementById('pi-login-btn').classList.add('hidden');
    document.getElementById('user-area').classList.remove('hidden');
    document.getElementById('username-display').textContent = currentUser.username;
    
    // إعادة التحميل لتحديث حالة أزرار الحذف/الشات
    fetchProducts();
    subscribeToMessages();
}

// 5. جلب المنتجات (محسنة لكشف الأخطاء)
async function fetchProducts() {
    const grid = document.getElementById('products-grid');
    const loading = document.getElementById('loading');
    
    loading.classList.remove('hidden');
    grid.innerHTML = '';

    try {
        const { data: products, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });

        loading.classList.add('hidden');

        // إذا حدث خطأ في الاتصال
        if (error) {
            console.error("Supabase Fetch Error:", error);
            grid.innerHTML = `<div style="text-align:center; color:red; padding:20px;">
                خطأ في تحميل البيانات: ${error.message}
            </div>`;
            return;
        }

        // إذا لم توجد منتجات
        if (!products || products.length === 0) {
            grid.innerHTML = '<p style="text-align:center; width:100%; color:#777; margin-top:20px;">لا توجد إعلانات حالياً.</p>';
            return;
        }

        // عرض المنتجات
        products.forEach(p => {
            const isOwner = currentUser && p.seller_pi_id === currentUser.uid;
            
            const card = document.createElement('div');
            card.className = 'product-card';
            card.innerHTML = `
                <img src="${p.image_url || 'https://via.placeholder.com/300'}" class="card-img">
                <div class="card-body">
                    <h3>${p.name}</h3>
                    <div class="card-price">${p.price} Pi</div>
                    <p style="font-size:14px; color:#666">${p.description}</p>
                    
                    ${isOwner ? 
                        `<button class="btn-primary full" style="background:#d32f2f" onclick="deleteProduct(${p.id})">حذف إعلاني</button>` 
                        : 
                        `<button class="btn-chat" onclick="checkLoginAndChat(${p.id}, '${p.seller_pi_id}', '${p.name}')">
                            <i class="fas fa-comment"></i> تواصل مع البائع
                        </button>`
                    }
                </div>
            `;
            grid.appendChild(card);
        });

    } catch (err) {
        loading.classList.add('hidden');
        grid.innerHTML = `<p style="color:red">خطأ غير متوقع: ${err.message}</p>`;
        console.error(err);
    }
}

// 6. التحقق من تسجيل الدخول
function requireLogin() {
    if (!currentUser) {
        alert("🔒 يجب تسجيل الدخول عبر Pi أولاً!");
        return false;
    }
    return true;
}

// 7. إضافة إعلان
document.getElementById('open-add-modal').addEventListener('click', () => {
    if (requireLogin()) document.getElementById('add-modal').style.display = 'flex';
});

document.getElementById('add-product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireLogin()) return;

    const btn = document.getElementById('submit-btn');
    const originalText = btn.innerText;
    btn.disabled = true; btn.innerText = "جاري النشر...";

    const name = document.getElementById('p-name').value;
    const price = document.getElementById('p-price').value;
    const desc = document.getElementById('p-desc').value;
    const phone = document.getElementById('p-phone').value;
    const file = document.getElementById('p-image').files[0];

    try {
        let imgUrl = null;
        if (file) {
            // استخدام اسم آمن للملف (Timestamp)
            const fileName = `prod_${Date.now()}.${file.name.split('.').pop()}`;
            const { error: upErr } = await supabase.storage.from('images').upload(fileName, file);
            if (upErr) throw upErr;
            
            const { data } = supabase.storage.from('images').getPublicUrl(fileName);
            imgUrl = data.publicUrl;
        }

        const { error } = await supabase.from('products').insert([{
            name, price, description: desc, phone, image_url: imgUrl,
            seller_pi_id: currentUser.uid,
            seller_username: currentUser.username
        }]);

        if (error) throw error;
        
        alert("✅ تم نشر الإعلان!");
        document.getElementById('add-modal').style.display = 'none';
        e.target.reset();
        fetchProducts();

    } catch (err) {
        alert("❌ خطأ: " + err.message);
        console.error(err);
    } finally {
        btn.disabled = false; btn.innerText = originalText;
    }
});

// حذف إعلان
window.deleteProduct = async (id) => {
    if (!requireLogin()) return;
    if (confirm("هل أنت متأكد؟")) {
        const { error } = await supabase.from('products').delete().eq('id', id).eq('seller_pi_id', currentUser.uid);
        if (!error) fetchProducts();
        else alert("فشل الحذف: " + error.message);
    }
};

// 8. الشات
window.checkLoginAndChat = (pid, sellerId, pname) => {
    if (requireLogin()) openChat(pid, sellerId, pname);
};

function openChat(pid, sellerId, pname) {
    activeChat = { pid, other: sellerId, name: pname };
    document.getElementById('chat-modal').style.display = 'flex';
    document.getElementById('chat-title').innerText = pname;
    loadMessages();
}

async function loadMessages() {
    const box = document.getElementById('messages-container');
    box.innerHTML = '<div style="text-align:center">جاري التحميل...</div>';
    
    const { data: msgs, error } = await supabase.from('messages')
        .select('*')
        .eq('product_id', activeChat.pid)
        .or(`and(sender_pi_id.eq.${currentUser.uid},receiver_pi_id.eq.${activeChat.other}),and(sender_pi_id.eq.${activeChat.other},receiver_pi_id.eq.${currentUser.uid})`)
        .order('created_at', { ascending: true });

    if(error) {
        box.innerHTML = `<p style="color:red">خطأ في الشات: ${error.message}</p>`;
        return;
    }

    box.innerHTML = '';
    if(msgs) {
        msgs.forEach(displayMsg);
        box.scrollTop = box.scrollHeight;
    }
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!requireLogin()) return;
    
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;

    const { error } = await supabase.from('messages').insert([{
        product_id: activeChat.pid,
        sender_pi_id: currentUser.uid,
        receiver_pi_id: activeChat.other,
        content: text
    }]);
    
    if(error) alert("فشل الإرسال");
    else input.value = '';
});

function subscribeToMessages() {
    supabase.channel('public:messages').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new;
        if (activeChat && m.product_id === activeChat.pid && (m.sender_pi_id === currentUser.uid || m.sender_pi_id === activeChat.other)) {
            displayMsg(m);
            const box = document.getElementById('messages-container');
            box.scrollTop = box.scrollHeight;
        }
    }).subscribe();
}

function displayMsg(msg) {
    const div = document.createElement('div');
    const isMe = msg.sender_pi_id === currentUser.uid;
    div.className = `msg ${isMe ? 'sent' : 'received'}`;
    div.innerText = msg.content;
    document.getElementById('messages-container').appendChild(div);
}

// 9. واجهة المستخدم
function setupUI() {
    document.getElementById('open-dashboard').onclick = () => {
        if(requireLogin()) {
            document.getElementById('dashboard-modal').style.display = 'flex';
            loadMyAds();
        }
    };
    
    document.querySelectorAll('.close-btn').forEach(b => b.onclick = function() { this.closest('.modal').style.display = 'none'; });
    window.onclick = (e) => { if(e.target.classList.contains('modal')) e.target.style.display = 'none'; };
    
    window.switchTab = (tab) => {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(tab).classList.add('active');
        event.target.classList.add('active');
        if(tab === 'my-ads') loadMyAds();
        if(tab === 'my-chats') loadMyChats();
    };
}

async function loadMyAds() {
    const div = document.getElementById('my-ads');
    div.innerHTML = 'جاري التحميل...';
    const { data } = await supabase.from('products').select('*').eq('seller_pi_id', currentUser.uid);
    div.innerHTML = '';
    if(data.length === 0) div.innerHTML = 'لا توجد إعلانات';
    data.forEach(p => {
        div.innerHTML += `<div class="list-item"><span>${p.name}</span> <button class="btn-primary" style="background:red; padding:5px 10px" onclick="deleteProduct(${p.id})">حذف</button></div>`;
    });
}

async function loadMyChats() {
    const div = document.getElementById('my-chats');
    div.innerHTML = 'جاري التحميل...';
    const { data: msgs } = await supabase.from('messages')
        .select('*, products(name)')
        .or(`sender_pi_id.eq.${currentUser.uid},receiver_pi_id.eq.${currentUser.uid}`)
        .order('created_at', {ascending: false});

    const unique = {};
    msgs.forEach(m => {
        const other = m.sender_pi_id === currentUser.uid ? m.receiver_pi_id : m.sender_pi_id;
        const key = `${m.product_id}_${other}`;
        if (!unique[key]) unique[key] = { pid: m.product_id, name: m.products?.name, other, msg: m.content };
    });

    div.innerHTML = '';
    if(Object.keys(unique).length === 0) div.innerHTML = 'لا توجد رسائل';
    Object.values(unique).forEach(c => {
        div.innerHTML += `<div class="list-item" onclick="openChat(${c.pid}, '${c.other}', '${c.name}')" style="cursor:pointer">
            <div><strong>${c.name}</strong><br><small>${c.msg.substring(0,20)}...</small></div>
        </div>`;
    });
}
