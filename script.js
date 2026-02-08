// --- 1. إعدادات Supabase ---
const supabaseUrl = 'https://xncapmzlwuisupkjlftb.supabase.co';
// مفتاح anon key الصحيح
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuY2FwbXpsd3Vpc3Vwa2psZnRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0Mzk0MzcsImV4cCI6MjA4NDAxNTQzN30.JVhiue90DHvEirIAeCPSBnJxXvO2RMPvRFu5RMulfig';

const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// --- 2. متغيرات الحالة ---
let currentUser = null; 
let activeChatParams = null;

// --- 3. عند تحميل الصفحة ---
document.addEventListener('DOMContentLoaded', () => {
    // محاولة تهيئة Pi Network فور تحميل الصفحة
    initPi();
    setupEventListeners();
});

// --- 4. دالة تهيئة Pi وتسجيل الدخول (الوضع الحقيقي) ---
async function initPi() {
    const loginBtn = document.getElementById('pi-login-btn');
    
    // التحقق: هل مكتبة Pi موجودة؟
    if (!window.Pi) {
        alert("تنبيه هام: يجب فتح هذا الموقع داخل تطبيق Pi Browser لكي يعمل تسجيل الدخول.");
        loginBtn.innerHTML = "يرجى الفتح من متصفح Pi";
        loginBtn.disabled = true;
        return;
    }

    try {
        const Pi = window.Pi;
        
        // 🔴🔴 تفعيل الوضع الحقيقي (Production) بناءً على طلبك 🔴🔴
        await Pi.init({ version: "2.0", sandbox: false });
        
        // تفعيل الزر عند نجاح الـ Init
        loginBtn.addEventListener('click', async () => {
            // تغيير نص الزر ليعرف المستخدم أن شيئاً يحدث
            const originalText = loginBtn.innerHTML;
            loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الاتصال بـ Pi...';
            
            try {
                // طلب الصلاحيات
                const scopes = ['username', 'payments'];
                const authResult = await Pi.authenticate(scopes, onIncompletePaymentFound);
                
                // نجاح التسجيل
                console.log("Auth Success:", authResult);
                
                currentUser = {
                    uid: authResult.user.uid,
                    username: authResult.user.username
                };
                
                showApp(); // الانتقال للتطبيق
                
            } catch (error) {
                console.error('Pi Auth Failed:', error);
                // إظهار رسالة الخطأ للمستخدم
                alert('فشل تسجيل الدخول: ' + error.message);
                loginBtn.innerHTML = originalText; // إعادة الزر لطبيعته
            }
        });
        
    } catch (err) {
        console.error('Pi Init Error:', err);
        alert("حدث خطأ في تهيئة Pi SDK: " + err.message);
    }
}

// دالة مطلوبة لـ Pi SDK
function onIncompletePaymentFound(payment) { 
    console.log("Incomplete payment found", payment);
    // يمكن هنا إضافة كود لاستكمال الدفعات المعلقة لاحقاً
}

// --- 5. تشغيل واجهة التطبيق ---
function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    document.getElementById('display-username').textContent = currentUser.username;
    
    fetchProducts();
    setupRealtimeSubscription();
}

// --- 6. إدارة المنتجات ---
async function fetchProducts() {
    const grid = document.getElementById('products-grid');
    const loading = document.getElementById('loading');
    
    grid.innerHTML = '';
    loading.classList.remove('hidden');

    try {
        const { data: products, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });

        loading.classList.add('hidden');

        if (error) throw error;

        if (!products || products.length === 0) {
            grid.innerHTML = '<p style="text-align:center; width:100%;">لا توجد إعلانات حالياً.</p>';
            return;
        }

        products.forEach(p => {
            const isOwner = currentUser && p.seller_pi_id === currentUser.uid;
            const card = document.createElement('div');
            card.className = 'product-card';
            
            const imgUrl = p.image_url || 'https://via.placeholder.com/300?text=No+Image';

            card.innerHTML = `
                ${isOwner ? '<span class="owner-badge">إعلاني</span>' : ''}
                <img src="${imgUrl}" class="card-img" alt="${p.name}">
                <div class="card-body">
                    <h3>${p.name}</h3>
                    <div class="card-price">${p.price} Pi</div>
                    <p style="color:#666; font-size:14px;">${p.description || ''}</p>
                    ${isOwner ? `
                        <button class="btn-danger" style="width:100%; margin-top:10px;" onclick="deleteProduct(${p.id})">
                            <i class="fas fa-trash"></i> حذف الإعلان
                        </button>
                    ` : `
                        <button class="btn-chat-start" onclick="openChat(${p.id}, '${p.seller_pi_id}', '${p.name}')">
                            <i class="fas fa-comment"></i> تواصل مع البائع
                        </button>
                    `}
                </div>
            `;
            grid.appendChild(card);
        });

    } catch (err) {
        console.error('Fetch Error:', err);
        loading.innerText = 'حدث خطأ في التحميل';
    }
}

// إضافة منتج جديد
const addForm = document.getElementById('add-product-form');
if (addForm) {
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('submit-btn');
        const originalText = btn.innerHTML;
        
        btn.disabled = true; 
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري النشر...';

        const name = document.getElementById('p-name').value;
        const price = document.getElementById('p-price').value;
        const desc = document.getElementById('p-desc').value;
        const phone = document.getElementById('p-phone').value;
        const fileInput = document.getElementById('p-image');

        try {
            let finalImageUrl = '';

            if (fileInput.files && fileInput.files[0]) {
                const file = fileInput.files[0];
                const fileExt = file.name.split('.').pop();
                const fileName = `img_${Date.now()}.${fileExt}`;

                const { data, error: uploadError } = await supabase.storage
                    .from('images')
                    .upload(fileName, file);

                if (uploadError) throw uploadError;

                const { data: publicUrlData } = supabase.storage
                    .from('images')
                    .getPublicUrl(fileName);
                
                finalImageUrl = publicUrlData.publicUrl;
            }

            const { error: insertError } = await supabase
                .from('products')
                .insert([{
                    name: name,
                    price: price,
                    description: desc,
                    phone: phone,
                    image_url: finalImageUrl,
                    seller_pi_id: currentUser.uid,
                    seller_username: currentUser.username
                }]);

            if (insertError) throw insertError;

            alert('تم نشر الإعلان بنجاح!');
            document.getElementById('add-modal').style.display = 'none';
            addForm.reset();
            fetchProducts();

        } catch (err) {
            console.error(err);
            alert('حدث خطأ أثناء النشر: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    });
}

// حذف منتج
window.deleteProduct = async (id) => {
    if (!confirm('هل أنت متأكد من حذف هذا الإعلان؟')) return;

    try {
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', id)
            .eq('seller_pi_id', currentUser.uid);

        if (error) throw error;
        
        alert('تم الحذف');
        fetchProducts();
    } catch (err) {
        alert('فشل الحذف: ' + err.message);
    }
};

// --- 7. نظام الشات ---
window.openChat = async (productId, otherUserId, productName) => {
    if (!currentUser) return;

    activeChatParams = {
        productId: productId,
        otherUser: otherUserId,
        productName: productName
    };

    const chatModal = document.getElementById('chat-modal');
    document.getElementById('chat-title').innerText = productName;
    chatModal.style.display = 'flex';
    
    loadMessages();
};

async function loadMessages() {
    const container = document.getElementById('messages-container');
    container.innerHTML = '<div style="text-align:center; padding:20px;">جاري تحميل الرسائل...</div>';

    const { productId, otherUser } = activeChatParams;
    const myId = currentUser.uid;

    const { data: msgs, error } = await supabase
        .from('messages')
        .select('*')
        .eq('product_id', productId)
        .or(`and(sender_pi_id.eq.${myId},receiver_pi_id.eq.${otherUser}),and(sender_pi_id.eq.${otherUser},receiver_pi_id.eq.${myId})`)
        .order('created_at', { ascending: true });

    container.innerHTML = '';

    if (msgs) {
        msgs.forEach(displayMessage);
        scrollToBottom();
    }
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const text = input.value.trim();

    if (!text || !activeChatParams) return;

    const { error } = await supabase
        .from('messages')
        .insert([{
            product_id: activeChatParams.productId,
            sender_pi_id: currentUser.uid,
            receiver_pi_id: activeChatParams.otherUser,
            content: text
        }]);

    if (!error) {
        input.value = '';
    }
});

function setupRealtimeSubscription() {
    supabase
        .channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            const newMsg = payload.new;
            if (activeChatParams && 
                newMsg.product_id === activeChatParams.productId &&
                (newMsg.sender_pi_id === activeChatParams.otherUser || newMsg.sender_pi_id === currentUser.uid)) {
                displayMessage(newMsg);
                scrollToBottom();
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

function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

// --- 8. لوحة التحكم ---
window.switchTab = (tabName) => {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    
    const btns = document.querySelectorAll('.tab-btn');
    if(tabName === 'my-chats') btns[0].classList.add('active');
    if(tabName === 'my-ads') btns[1].classList.add('active');

    if (tabName === 'my-ads') loadMyAds();
    if (tabName === 'my-chats') loadMyChats();
};

async function loadMyAds() {
    const list = document.getElementById('my-ads-list');
    list.innerHTML = 'جاري التحميل...';

    const { data: ads } = await supabase
        .from('products')
        .select('*')
        .eq('seller_pi_id', currentUser.uid);

    list.innerHTML = '';
    if (!ads || ads.length === 0) {
        list.innerHTML = '<p style="padding:10px">لا توجد إعلانات لك.</p>';
        return;
    }

    ads.forEach(ad => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <span><strong>${ad.name}</strong> (${ad.price} Pi)</span>
            <button class="btn-danger" onclick="deleteProduct(${ad.id})">حذف</button>
        `;
        list.appendChild(item);
    });
}

async function loadMyChats() {
    const list = document.getElementById('chats-list');
    list.innerHTML = 'جاري التحميل...';

    const { data: messages } = await supabase
        .from('messages')
        .select(`id, content, created_at, sender_pi_id, receiver_pi_id, product_id, products (name)`)
        .or(`sender_pi_id.eq.${currentUser.uid},receiver_pi_id.eq.${currentUser.uid}`)
        .order('created_at', { ascending: false });

    list.innerHTML = '';
    if (!messages || messages.length === 0) {
        list.innerHTML = '<p style="padding:10px">لا توجد محادثات.</p>';
        return;
    }

    const uniqueChats = {};
    messages.forEach(m => {
        const otherUser = m.sender_pi_id === currentUser.uid ? m.receiver_pi_id : m.sender_pi_id;
        const key = `${m.product_id}_${otherUser}`;
        
        if (!uniqueChats[key]) {
            uniqueChats[key] = {
                productId: m.product_id,
                productName: m.products ? m.products.name : 'منتج محذوف',
                otherUser: otherUser,
                lastMsg: m.content,
                date: new Date(m.created_at).toLocaleDateString('ar-EG')
            };
        }
    });

    Object.values(uniqueChats).forEach(chat => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.style.cursor = 'pointer';
        item.innerHTML = `
            <div onclick="openChat(${chat.productId}, '${chat.otherUser}', '${chat.productName}')" style="width:100%">
                <div style="font-weight:bold; color:#6a1b9a;">${chat.productName}</div>
                <div style="font-size:13px; color:#555; margin-top:4px;">${chat.lastMsg.substring(0, 30)}...</div>
                <div style="font-size:11px; color:#999; text-align:left; margin-top:5px;">${chat.date}</div>
            </div>
        `;
        list.appendChild(item);
    });
}

// --- 9. أدوات مساعدة ---
function setupEventListeners() {
    document.getElementById('open-dashboard').addEventListener('click', () => {
        document.getElementById('dashboard-modal').style.display = 'flex';
        switchTab('my-chats');
    });
    document.getElementById('open-add-modal').addEventListener('click', () => {
        document.getElementById('add-modal').style.display = 'flex';
    });
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            this.closest('.modal').style.display = 'none';
        });
    });
    window.onclick = function(event) {
        if (event.target.classList.contains('modal')) {
            event.target.style.display = 'none';
        }
    }
}
