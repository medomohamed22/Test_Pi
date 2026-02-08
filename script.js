// --- إعدادات Supabase ---
const supabaseUrl = 'https://xncapmzlwuisupkjlftb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuY2FwbXpsd3Vpc3Vwa2psZnRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0Mzk0MzcsImV4cCI6MjA4NDAxNTQzN30.JVhiue90DHvEirIAeCPSBnJxXvO2RMPvRFu5RMulfig';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// --- متغيرات الحالة العامة ---
let currentUser = null; // سيحتوي على بيانات مستخدم Pi (uid, username)
let activeChatParams = null; // لتخزين بيانات الشات المفتوح حالياً

// --- تشغيل التطبيق عند التحميل ---
document.addEventListener('DOMContentLoaded', () => {
    initPi(); // محاولة تهيئة Pi SDK
    setupEventListeners();
});

// 1. إعداد Pi Network وتسجيل الدخول
async function initPi() {
    try {
        const Pi = window.Pi;
        Pi.init({ version: "2.0", sandbox: false }); // Sandbox للتجربة

        document.getElementById('pi-login-btn').addEventListener('click', async () => {
            try {
                // طلب صلاحيات المستخدم
                const scopes = ['username'];
                const authResult = await Pi.authenticate(scopes, onIncompletePaymentFound);
                
                // تم تسجيل الدخول بنجاح
                currentUser = {
                    uid: authResult.user.uid,
                    username: authResult.user.username
                };
                
                // إعداد Supabase للتعامل كأن هذا المستخدم هو المسجل (مهم لسياسات الأمان RLS)
                // ملحوظة: في التطبيق الحقيقي يجب استخدام Custom Claims، هنا نستخدم محاكاة بسيطة
                // سنقوم بتمرير الـ ID في كل استعلام للحماية
                
                showApp();
            } catch (error) {
                console.error('Pi Auth Failed:', error);
                alert('فشل تسجيل الدخول: ' + error.message);
            }
        });
    } catch (err) {
        console.warn('Pi SDK not found or not in Pi Browser. Using Mock for testing?');
        // للكود التجريبي خارج متصفح باي (اختياري)
    }
}

function onIncompletePaymentFound(payment) { /* معالجة المدفوعات المعلقة هنا */ }

function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('display-username').textContent = currentUser.username;
    fetchProducts();
    
    // إعداد قناة Realtime لاستقبال الرسائل
    setupRealtimeSubscription();
}

// 2. إدارة المنتجات
async function fetchProducts() {
    const grid = document.getElementById('products-grid');
    grid.innerHTML = '<div class="loading">جاري التحميل...</div>';

    const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) { console.error(error); return; }

    grid.innerHTML = '';
    products.forEach(p => {
        const isOwner = currentUser && p.seller_pi_id === currentUser.uid;
        const card = document.createElement('div');
        card.className = 'product-card';
        
        card.innerHTML = `
            ${isOwner ? '<span class="owner-badge">إعلاني</span>' : ''}
            <img src="${p.image_url || 'https://via.placeholder.com/300'}" class="card-img">
            <div class="card-body">
                <h3>${p.name}</h3>
                <div class="card-price">${p.price} Pi</div>
                <p>${p.description}</p>
                ${isOwner ? `
                    <button class="btn-danger" onclick="deleteProduct(${p.id})">حذف</button>
                    ` : `
                    <button class="btn-chat-start" onclick="openChat(${p.id}, '${p.seller_pi_id}', '${p.name}')">
                        <i class="fas fa-comment"></i> دردشة مع البائع
                    </button>
                `}
            </div>
        `;
        grid.appendChild(card);
    });
}

// إضافة منتج (مع ربطه بالمستخدم الحالي)
document.getElementById('add-product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    btn.disabled = true; btn.innerText = 'جاري النشر...';

    const name = document.getElementById('p-name').value;
    const price = document.getElementById('p-price').value;
    const desc = document.getElementById('p-desc').value;
    const phone = document.getElementById('p-phone').value;
    const file = document.getElementById('p-image').files[0];

    try {
        let imageUrl = '';
        if (file) {
            const fileName = `${Date.now()}.${file.name.split('.').pop()}`;
            await supabase.storage.from('images').upload(fileName, file);
            const { data } = supabase.storage.from('images').getPublicUrl(fileName);
            imageUrl = data.publicUrl;
        }

        // إرسال البيانات مع seller_pi_id
        await supabase.from('products').insert([{
            name, price, description: desc, phone, 
            image_url: imageUrl,
            seller_pi_id: currentUser.uid,
            seller_username: currentUser.username
        }]);

        closeModal('add-modal');
        fetchProducts();
        alert('تم النشر بنجاح!');
    } catch (err) {
        alert('خطأ: ' + err.message);
    } finally {
        btn.disabled = false; btn.innerText = 'نشر';
    }
});

// حذف منتج
window.deleteProduct = async (id) => {
    if(!confirm('هل أنت متأكد من حذف هذا الإعلان؟')) return;
    
    // نمرر ID المستخدم الحالي للسياسة في الـ Header (محاكاة)
    // أو نعتمد على RLS مع التحقق الإضافي
    const { error } = await supabase.from('products').delete().eq('id', id).eq('seller_pi_id', currentUser.uid);
    
    if(error) alert('فشل الحذف');
    else fetchProducts();
};

// 3. نظام الشات الحقيقي (Real-time)
window.openChat = async (productId, otherUserId, productName) => {
    if (!currentUser) return alert('يجب تسجيل الدخول أولاً');
    
    activeChatParams = {
        productId: productId,
        otherUser: otherUserId, // قد يكون البائع أو المشتري
        productName: productName
    };

    document.getElementById('chat-title').innerText = `بخصوص: ${productName}`;
    document.getElementById('chat-modal').style.display = 'flex';
    document.getElementById('messages-container').innerHTML = '<div class="loading">جاري تحميل الرسائل...</div>';

    loadMessages();
};

async function loadMessages() {
    const { productId, otherUser } = activeChatParams;

    // جلب الرسائل التي تخص هذا المنتج وبين هذين الطرفين
    // ملاحظة: الـ Query يبحث عن الرسائل حيث (sender=me AND receiver=other) OR (sender=other AND receiver=me)
    const { data: msgs, error } = await supabase
        .from('messages')
        .select('*')
        .eq('product_id', productId)
        .or(`and(sender_pi_id.eq.${currentUser.uid},receiver_pi_id.eq.${otherUser}),and(sender_pi_id.eq.${otherUser},receiver_pi_id.eq.${currentUser.uid})`)
        .order('created_at', { ascending: true });

    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    if (msgs) {
        msgs.forEach(displayMessage);
        container.scrollTop = container.scrollHeight;
    }
}

// إرسال رسالة
document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !activeChatParams) return;

    // إدراج الرسالة في قاعدة البيانات
    const { error } = await supabase.from('messages').insert([{
        product_id: activeChatParams.productId,
        sender_pi_id: currentUser.uid,
        receiver_pi_id: activeChatParams.otherUser,
        content: text
    }]);

    if (!error) {
        input.value = '';
        // لا نحتاج لإضافة الرسالة يدوياً للشاشة، الـ Realtime سيقوم بذلك
    }
});

// الاستماع للرسائل الجديدة (Realtime)
function setupRealtimeSubscription() {
    supabase
        .channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            const newMsg = payload.new;
            
            // هل الرسالة تخص الشات المفتوح حالياً؟
            if (activeChatParams && 
                newMsg.product_id === activeChatParams.productId &&
                (newMsg.sender_pi_id === activeChatParams.otherUser || newMsg.sender_pi_id === currentUser.uid)
            ) {
                displayMessage(newMsg);
                const container = document.getElementById('messages-container');
                container.scrollTop = container.scrollHeight;
            }
        })
        .subscribe();
}

function displayMessage(msg) {
    const container = document.getElementById('messages-container');
    const div = document.createElement('div');
    const isMe = msg.sender_pi_id === currentUser.uid;
    div.className = `msg ${isMe ? 'sent' : 'received'}`;
    div.textContent = msg.content;
    container.appendChild(div);
}

// 4. لوحة التحكم (إعلاناتي ومحادثاتي)
window.switchTab = (tabName) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    
    // تحديث حالة الزر النشط (بسيط)
    event.target.classList.add('active');

    if (tabName === 'my-ads') loadMyAds();
    if (tabName === 'my-chats') loadMyChats();
};

async function loadMyAds() {
    const container = document.getElementById('my-ads-list');
    container.innerHTML = 'جاري التحميل...';
    
    const { data: ads } = await supabase
        .from('products')
        .select('*')
        .eq('seller_pi_id', currentUser.uid);

    container.innerHTML = '';
    if(!ads || ads.length === 0) container.innerHTML = '<p style="padding:10px">لا توجد إعلانات</p>';
    
    ads.forEach(ad => {
        container.innerHTML += `
            <div class="list-item">
                <span>${ad.name} - ${ad.price} Pi</span>
                <button class="btn-danger" onclick="deleteProduct(${ad.id})">حذف</button>
            </div>
        `;
    });
}

async function loadMyChats() {
    const container = document.getElementById('chats-list');
    container.innerHTML = 'جاري التحميل...';

    // هذه استعلام معقد قليلاً لجلب "آخر المحادثات"
    // للتبسيط: سنجلب كل الرسائل التي يكون فيها المستخدم طرفاً، ثم نقوم بتصفيتها في الجافاسكريبت للحصول على المحادثات الفريدة
    const { data: messages } = await supabase
        .from('messages')
        .select('product_id, sender_pi_id, receiver_pi_id, content, created_at, products(name)')
        .or(`sender_pi_id.eq.${currentUser.uid},receiver_pi_id.eq.${currentUser.uid}`)
        .order('created_at', { ascending: false });

    if (!messages || messages.length === 0) {
        container.innerHTML = '<p style="padding:10px">لا توجد رسائل</p>';
        return;
    }

    // تصفية المحادثات الفريدة (Unique Chats)
    const uniqueChats = {};
    messages.forEach(m => {
        const otherUser = m.sender_pi_id === currentUser.uid ? m.receiver_pi_id : m.sender_pi_id;
        const key = `${m.product_id}_${otherUser}`; // مفتاح فريد لكل محادثة (منتج + شخص)
        
        if (!uniqueChats[key]) {
            uniqueChats[key] = {
                productId: m.product_id,
                productName: m.products?.name || 'منتج',
                otherUser: otherUser,
                lastMsg: m.content,
                date: new Date(m.created_at).toLocaleDateString()
            };
        }
    });

    container.innerHTML = '';
    Object.values(uniqueChats).forEach(chat => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.style.cursor = 'pointer';
        div.innerHTML = `
            <div>
                <strong>${chat.productName}</strong>
                <div style="font-size:12px; color:#777">${chat.lastMsg.substring(0, 30)}...</div>
            </div>
            <span style="font-size:12px">${chat.date}</span>
        `;
        div.onclick = () => openChat(chat.productId, chat.otherUser, chat.productName);
        container.appendChild(div);
    });
}

// Helper Functions
function setupEventListeners() {
    document.getElementById('open-dashboard').onclick = () => {
        document.getElementById('dashboard-modal').style.display = 'flex';
        switchTab('my-chats'); // Default Tab
    };
    document.getElementById('open-add-modal').onclick = () => document.getElementById('add-modal').style.display = 'flex';
    window.closeModal = (id) => document.getElementById(id).style.display = 'none';
}
