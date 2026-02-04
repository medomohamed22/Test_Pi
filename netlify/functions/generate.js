async function generate() {
    const promptInput = document.getElementById('prompt');
    const btn = document.getElementById('genBtn');
    const loader = document.getElementById('loader');
    const img = document.getElementById('resultImg');
    const placeholder = document.getElementById('placeholder');
    const dlBtn = document.getElementById('dlBtn');

    const text = promptInput.value.trim();
    if (!text) return alert("اكتب وصفاً أولاً");

    // 1. تجهيز الواجهة
    btn.disabled = true;
    btn.innerHTML = "⏳ جاري الرسم...";
    img.style.display = "none";
    placeholder.style.display = "none";
    loader.style.display = "block";
    dlBtn.style.display = "none";

    try {
        // 2. طلب الرابط من السيرفر
        const res = await fetch('/.netlify/functions/generate', {
            method: 'POST',
            body: JSON.stringify({ prompt: text })
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        // 3. وضع الرابط في الصورة وانتظار التحميل
        img.src = data.url;
        
        img.onload = () => {
            img.style.display = "block";
            dlBtn.style.display = "block";
            loader.style.display = "none";
            btn.innerHTML = "🎨 توليد صورة جديدة";
            btn.disabled = false;
        };

        img.onerror = () => {
            throw new Error("فشل تحميل الصورة من المصدر");
        };

    } catch (e) {
        alert("خطأ: " + e.message);
        placeholder.style.display = "block";
        loader.style.display = "none";
        btn.disabled = false;
        btn.innerHTML = "توليد";
    }
}

// دالة التحميل المحسنة
async function download() {
    const imageUrl = document.getElementById('resultImg').src;
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ai-image.png';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
    } catch (e) {
        window.open(imageUrl, '_blank'); // فتح الصورة في صفحة جديدة كحل احتياطي
    }
}
