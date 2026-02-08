// 1. إعدادات الاتصال
const supabaseUrl = 'https://xncapmzlwuisupkjlftb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuY2FwbXpsd3Vpc3Vwa2psZnRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0Mzk0MzcsImV4cCI6MjA4NDAxNTQzN30.JVhiue90DHvEirIAeCPSBnJxXvO2RMPvRFu5RMulfig';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// 2. المتغيرات العامة
let currentUser = null;
let activeChat = null;

// 3. عند بدء التطبيق
document.addEventListener('DOMContentLoaded', () => {
    initPi();
    setupUI();
});

// 4. تهيئة Pi Network
async function initPi() {
    const loginBtn = document.getElementById('pi-login-btn');
    
    // التحقق من البيئة (هل نحن داخل Pi Browser؟)
    if (window.Pi) {
        try {
            const Pi = window.Pi;
            // ⚠️ ملاحظة: استخدم sandbox: true للتجربة، و false للنشر النهائي
            await Pi.init({ version: "2.0", sandbox: false });

            loginBtn.addEventListener('click', async () => {
                loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الاتصال...';
                try {
                    const scopes = ['username', 'payments'];
                    const auth = await Pi.authenticate(scopes, onIncompletePayment);
                    
                    // تم تسجيل الدخول في Pi، الآن نحفظ المستخدم في قاعدة بياناتنا
                    await saveUserToDB(auth.user);

                    currentUser = {
                        uid: auth.user.uid,
                        username: auth.user.username
                    };
                    
                    launchApp();

                } catch (err) {
                    console.error(err);
                    alert("فشل تسجيل الدخول: " + err.message);
                    loginBtn.innerHTML = '<i class="fas fa-fingerprint"></i> تسجيل الدخول';
                }
            });
        } catch (err) {
            console.error(err);
        }
    } else {
        // وضع المطور (خارج متصفح Pi)
        loginBtn.innerHTML = "دخول تجريبي (Test Mode)";
        loginBtn.addEventListener('click', async () => {
            const fakeUser = { uid: "test_user_" + Date.now(), username: "Test_User" };
            await saveUserToDB(fakeUser);
            currentUser = fakeUser;
            launchApp();
        });
    }
}

function onIncompletePayment(payment) { console.log("Payment incomplete", payment); }

// 5. حفظ المستخدم في قاعدة البيانات (Upsert)
async function saveUserToDB(user) {
    // هذه الدالة مهمة جداً: تتأكد من أن المستخدم موجود في جدول users
    const { error } = await supabase
        .from('users')
        .upsert({ 
            pi_id: user.uid, 
            username: user.username,
            last_login: new Date().toISOString()
        }, { onConflict: 'pi_id' }); // إذا كان موجوداً، حدث تاريخ الدخول فقط

    if (error) console.error("Error saving user:", error);
}

// 6. تشغيل واجهة التطبيق
function launchApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('welcome-msg').textContent = `أهلاً، ${currentUser.username}`;
    fetchProducts();
    subscribeToMessages();
}

// 7. إدارة المنتجات
async function fetchProducts() {
    const grid = document.getElementById('products-grid');
    const loading = document.getElementById('loading');
    
    loading.classList.remove('hidden');
    grid.innerHTML = '';

    const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

    loading.classList.add('hidden');
    
    if (!products || products.length === 0) {
        grid.innerHTML = '<div style="width:100%; text-align:center;">لا توجد إعلانات بعد.</div>';
        return;
    }

    products.forEach(p => {
        const isOwner = currentUser && p.seller_pi_id === currentUser.uid;
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            ${isOwner ? '<span class="owner-tag">إعلاني</span>' : ''}
            <img src="${p.image_url || 'https://via.placeholder.com/300'}" class="card-img">
            <div class="card-body">
                <h3>${p.name}</h3>
                <div class="card-price">${p.price} Pi</div>
                <p style="font-size:14px; color:#666">${p.description}</p>
                ${isOwner ? 
                    `<button class="btn-danger full" onclick="deleteProduct(${p.id})">حذف</button>` : 
                    `<button class="btn-primary full" onclick="openChat(${p.id}, '${p.seller_pi_id}', '${p.name}')">
                        <i class="fas fa-comment"></i> تواصل
                    </button>`
                }
            </div>
        `;
        grid.appendChild(card);
    });
}

// إضافة إعلان
document.getElementById('add-product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.disabled = true; btn.textContent = 'جاري النشر...';

    const name = document.getElementById('p-name').value;
    const price = document.getElementById('p-price').value;
    const desc = document.getElementById('p-desc').value;
    const phone = document.getElementById('p-phone').value;
    const file = document.getElementById('p-image').files[0];

    try {
        let imgUrl = null;
        if (file) {
            const fileName = `prod_${Date.now()}.${file.name.split('.').pop()}`;
            const { error: upErr } = await supabase.storage.from('images').upload(fileName, file);
            if (upErr) throw upErr;
            const { data } = supabase.storage.from('images').getPublicUrl(fileName);
            imgUrl = data.publicUrl;
        }

        const { error } = await supabase.from('products').insert([{
            name, price, description: desc, phone, image_url: imgUrl,
            seller_pi_id: currentUser.uid,       // الربط الأجنبي
            seller_username: currentUser.username // للحفاظ على الاسم
        }]);

        if (error) throw error;
        
        alert("تم النشر بنجاح!");
        document.getElementById('add-modal').style.display = 'none';
        e.target.reset();
        fetchProducts();

    } catch (err) {
        alert("خطأ: " + err.message);
    } finally {
        btn.disabled = false; btn.textContent = 'نشر الإعلان';
    }
});

// حذف إعلان
window.deleteProduct = async (id) => {
    if (!confirm("حذف هذا الإعلان؟")) return;
    const { error } = await supabase.from('products').delete().eq('id', id).eq('seller_pi_id', currentUser.uid);
    if (!error) {
        alert("تم الحذف");
        fetchProducts();
    }
};

// 8. نظام الشات
window.openChat = async (prodId, sellerId, prodName) => {
    activeChat = { prodId, otherUser: sellerId, prodName };
    document.getElementById('chat-modal').style.display = 'flex';
    document.getElementById('chat-title').textContent = prodName;
    loadMessages();
};

async function loadMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = '<div style="text-align:center">جاري التحميل...</div>';
    
    // جلب الرسائل المرتبطة بهذا المنتج وبين الطرفين فقط
    const { data: msgs } = await supabase
        .from('messages')
        .select('*')
        .eq('product_id', activeChat.prodId)
        .or(`and(sender_pi_id.eq.${currentUser.uid},receiver_pi_id.eq.${activeChat.otherUser}),and(sender_pi_id.eq.${activeChat.otherUser},receiver_pi_id.eq.${currentUser.uid})`)
        .order('created_at', { ascending: true });

    container.innerHTML = '';
    if (msgs) {
        msgs.forEach(displayMsg);
        container.scrollTop = container.scrollHeight;
    }
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !activeChat) return;

    const { error } = await supabase.from('messages').insert([{
        product_id: activeChat.prodId,
        sender_pi_id: currentUser.uid,
        receiver_pi_id: activeChat.otherUser,
        content: text
    }]);

    if (!error) input.value = '';
});

function subscribeToMessages() {
    supabase.channel('chats').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const msg = payload.new;
        // إذا الرسالة تخص الشات المفتوح حالياً
        if (activeChat && msg.product_id === activeChat.prodId && 
           (msg.sender_pi_id === currentUser.uid || msg.sender_pi_id === activeChat.otherUser)) {
            displayMsg(msg);
            const box = document.getElementById('messages-container');
            box.scrollTop = box.scrollHeight;
        }
    }).subscribe();
}

function displayMsg(msg) {
    const div = document.createElement('div');
    const isMe = msg.sender_pi_id === currentUser.uid;
    div.className = `msg ${isMe ? 'sent' : 'received'}`;
    div.textContent = msg.content;
    document.getElementById('messages-container').appendChild(div);
}

// 9. لوحة التحكم
window.switchTab = (tab) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tab).classList.add('active');
    event.target.classList.add('active'); // تلوين الزر

    if (tab === 'my-ads') loadMyAds();
    if (tab === 'my-chats') loadMyChats();
};

async function loadMyAds() {
    const div = document.getElementById('my-ads');
    div.innerHTML = 'جاري التحميل...';
    const { data } = await supabase.from('products').select('*').eq('seller_pi_id', currentUser.uid);
    div.innerHTML = '';
    data.forEach(p => {
        div.innerHTML += `<div class="list-item"><span>${p.name}</span> <button class="btn-danger" onclick="deleteProduct(${p.id})">حذف</button></div>`;
    });
}

async function loadMyChats() {
    const div = document.getElementById('my-chats');
    div.innerHTML = 'جاري التحميل...';
    
    // جلب كل الرسائل الخاصة بي
    const { data: msgs } = await supabase
        .from('messages')
        .select('*, products(name)')
        .or(`sender_pi_id.eq.${currentUser.uid},receiver_pi_id.eq.${currentUser.uid}`)
        .order('created_at', {ascending: false});

    const uniqueChats = {};
    msgs.forEach(m => {
        const other = m.sender_pi_id === currentUser.uid ? m.receiver_pi_id : m.sender_pi_id;
        const key = `${m.product_id}_${other}`;
        if (!uniqueChats[key]) uniqueChats[key] = { name: m.products?.name, other, msg: m.content, pid: m.product_id };
    });

    div.innerHTML = '';
    Object.values(uniqueChats).forEach(c => {
        div.innerHTML += `<div class="list-item" onclick="openChat(${c.pid}, '${c.other}', '${c.name}')" style="cursor:pointer">
            <div><strong>${c.name}</strong><br><small>${c.msg.substring(0,20)}...</small></div>
        </div>`;
    });
}

// 10. أدوات واجهة المستخدم
function setupUI() {
    document.getElementById('open-add-modal').onclick = () => document.getElementById('add-modal').style.display = 'flex';
    document.getElementById('open-dashboard').onclick = () => {
        document.getElementById('dashboard-modal').style.display = 'flex';
        switchTab('my-ads');
    };
    document.querySelectorAll('.close-btn').forEach(b => b.onclick = function() { this.closest('.modal').style.display = 'none'; });
    window.onclick = (e) => { if(e.target.classList.contains('modal')) e.target.style.display = 'none'; };
}
