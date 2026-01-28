const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_KEY';
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;

// 1. Initialize Pi SDK
Pi.init({ version: "2.0", sandbox: false });

const statusText = document.getElementById('status-text');
const loginBtn = document.getElementById('login-btn');
const donateBtn = document.getElementById('donate-btn');
const customAmount = document.getElementById('custom-amount');
const donorsList = document.getElementById('donors-list');

// 2. Authentication Logic
async function authUser() {
    try {
        const scopes = ['username', 'payments'];
        const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);
        currentUser = auth.user;
        statusText.innerText = `Logged in as: ${currentUser.username}`;
        loginBtn.style.display = 'none';
        donateBtn.disabled = false;
        
        // Upsert user into Supabase
        await supabase.from('users').upsert([
            { id: currentUser.uid, username: currentUser.username, last_login: new Date() }
        ]);

        fetchDonations();
    } catch (err) {
        console.error(err);
        statusText.innerText = 'Authentication failed.';
        loginBtn.style.display = 'block';
    }
}

loginBtn.onclick = authUser;
window.onload = authUser;

function onIncompletePaymentFound(payment) {
    console.log('Incomplete payment found:', payment);
    // In a real app, send payment to your backend to complete it
}

function setAmount(val) {
    customAmount.value = val;
}

// 3. Payment Logic
donateBtn.onclick = async () => {
    const amount = parseFloat(customAmount.value);
    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount');
        return;
    }

    try {
        const payment = await Pi.createPayment({
            amount: amount,
            memo: `Donation to Project from ${currentUser.username}`,
            metadata: { type: "donation" },
        }, {
            onReadyForServerApproval: function(paymentId) {
                // Contact your backend to approve the payment
                fetch('/api/payment/approve', {
                    method: 'POST',
                    body: JSON.stringify({ paymentId: paymentId })
                }).then(() => console.log('Approved by backend'));
            },
            onReadyForServerCompletion: function(paymentId, txid) {
                // Contact your backend to complete the transaction
                fetch('/api/payment/complete', {
                    method: 'POST',
                    body: JSON.stringify({ paymentId, txid })
                }).then(async () => {
                    showToast('Thank you for your donation!');
                    saveDonationToSupabase(currentUser.username, amount);
                });
            },
            onCancel: function(paymentId) { console.log('Payment Cancelled'); },
            onError: function(error, payment) { console.error('Payment Error', error); }
        });
    } catch (err) {
        console.error(err);
        showToast('Transaction failed');
    }
};

async function saveDonationToSupabase(username, amount) {
    const { error } = await supabase
        .from('donations')
        .insert([{ username, amount, created_at: new Date() }]);
    
    if (!error) fetchDonations();
}

async function fetchDonations() {
    const { data, error } = await supabase
        .from('donations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    if (data) {
        donorsList.innerHTML = data.map(d => `
            <li>
                <span>@${d.username}</span>
                <strong>${d.amount} π</strong>
            </li>
        `).join('');
    } else {
        donorsList.innerHTML = '<li>No donations yet. Be the first!</li>';
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}
