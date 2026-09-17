// ===== Admin Control Panel Logic (Firebase Authentication) =====

let allStudents = []; // { key, name, email, branch, unitsCompleted }

function waitForFirebase() {
    return new Promise(resolve => {
        if (window.fbDB) return resolve();
        window.addEventListener('firebase-ready', () => resolve(), { once: true });
    });
}

async function attemptAdminLogin() {
    const emailInput = document.getElementById('admin-email-input').value.trim();
    const passInput = document.getElementById('admin-pass-input').value;

    if (!emailInput || !passInput) {
        alert('⚠️ اكتب الإيميل والباسورد.');
        return;
    }

    await waitForFirebase();
    try {
        await window.fbSignIn(window.fbAuth, emailInput, passInput);
        // onAuthStateChanged (تحت) هو اللي هيتكفّل بعرض الداشبورد أوتوماتيك
    } catch (err) {
        console.error(err);
        alert('❌ الإيميل أو الباسورد غلط.');
    }
}

function logoutAdmin() {
    window.fbSignOut();
}

function grantAdminAccess() {
    document.getElementById('admin-login-view').style.display = 'none';
    document.getElementById('admin-dashboard-view').style.display = 'block';
    loadDashboardData();
}

function showLoginScreen() {
    document.getElementById('admin-login-view').style.display = 'block';
    document.getElementById('admin-dashboard-view').style.display = 'none';
}

async function loadDashboardData() {
    await waitForFirebase();

    // إجمالي الزيارات
    try {
        const visitsSnap = await window.fbGet(window.fbRef(window.fbDB, 'stats/totalVisits'));
        document.getElementById('stat-total-visits').innerText = visitsSnap.exists() ? visitsSnap.val() : '0';
    } catch (e) { console.error(e); }

    // بيانات الحسابات والتقدّم
    try {
        const [accountsSnap, overallSnap] = await Promise.all([
            window.fbGet(window.fbRef(window.fbDB, 'accounts')),
            window.fbGet(window.fbRef(window.fbDB, 'leaderboard/overall'))
        ]);

        const accounts = accountsSnap.exists() ? accountsSnap.val() : {};
        const overall = overallSnap.exists() ? overallSnap.val() : {};

        allStudents = Object.keys(accounts).map(key => {
            const acc = accounts[key];
            const overallEntry = overall[key];
            const unitsCompleted = overallEntry && overallEntry.unitScores
                ? Object.keys(overallEntry.unitScores).length : 0;
            return {
                key,
                name: acc.name,
                email: acc.email,
                branch: acc.branch,
                unitsCompleted
            };
        });

        document.getElementById('stat-total-students').innerText = allStudents.length;
        const totalCompletions = allStudents.reduce((sum, s) => sum + s.unitsCompleted, 0);
        document.getElementById('stat-total-completions').innerText = totalCompletions;

        renderStudentsTable();
    } catch (e) {
        console.error(e);
        document.getElementById('admin-students-body').innerHTML =
            '<tr><td colspan="5" style="text-align:center; color: var(--danger);">Failed to load student data.</td></tr>';
    }
}

function renderStudentsTable() {
    const searchTerm = (document.getElementById('admin-search-input').value || '').toLowerCase().trim();
    const tbody = document.getElementById('admin-students-body');

    const filtered = allStudents.filter(s =>
        !searchTerm ||
        s.name.toLowerCase().includes(searchTerm) ||
        s.email.toLowerCase().includes(searchTerm) ||
        s.branch.toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">No students found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(s => `
        <tr>
            <td>${s.name}</td>
            <td>${s.email}</td>
            <td>${s.branch}</td>
            <td>${s.unitsCompleted}</td>
            <td><button class="delete-btn mono" onclick="deleteStudent('${s.key}', '${s.name.replace(/'/g, "\\'")}')">
                <i class="fa-solid fa-trash"></i> Delete
            </button></td>
        </tr>
    `).join('');
}

async function deleteStudent(key, name) {
    const confirmed = confirm(`متأكد إنك عايز تمسح حساب "${name}" نهائيًا؟\nده هيمسح حسابه وكل تقدّمه ونتايجه - الإجراء ده مينفعش يترجع.`);
    if (!confirmed) return;

    try {
        await Promise.all([
            window.fbRemove(window.fbRef(window.fbDB, 'accounts/' + key)),
            window.fbRemove(window.fbRef(window.fbDB, 'progress/' + key)),
            window.fbRemove(window.fbRef(window.fbDB, 'leaderboard/overall/' + key))
        ]);
        allStudents = allStudents.filter(s => s.key !== key);
        document.getElementById('stat-total-students').innerText = allStudents.length;
        renderStudentsTable();
        alert(`✅ اتمسح حساب "${name}" بنجاح.`);
    } catch (err) {
        console.error(err);
        alert('⚠️ حصلت مشكلة أثناء الحذف - تأكد إن الـ Security Rules مظبوطة صح على Firebase.');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await waitForFirebase();
    // Firebase Authentication بيحتفظ بالجلسة تلقائيًا (حتى بعد إغلاق المتصفح)،
    // فمش محتاجين نتعامل مع أي تخزين محلي بنفسنا زي الأول
    window.fbOnAuthChange((user) => {
        if (user) {
            grantAdminAccess();
        } else {
            showLoginScreen();
        }
    });
});