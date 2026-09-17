// 1. الجلسة الحالية (مين مسجل دخول في المتصفح ده) - دي بس اللي بتفضل محلية
// (تحديد مين المستخدم الحالي)، أما بيانات الحساب والتقدّم واللوحة كلها بقت
// على Firebase (مشتركة بين كل الطلبة وكل الأجهزة)
let activeSession = JSON.parse(localStorage.getItem('net_academy_session')) || null;

let currentStudent = activeSession ? activeSession.name : null;
let currentEmail = activeSession ? activeSession.email : null;
let currentBranch = activeSession ? activeSession.branch : null;
let isRegisterMode = true;

let selectedDifficulty = 'easy';
let currentUnit = null;
let activeLessonIdx = null;
let timerInterval = null;
let timeElapsed = 0;
let userAnswers = {};
let activeExamQuestions = [];

let unlockedStages = { easy: true, medium: false, hard: false };

// لوحة الصدارة بقت بتتحمّل وتتحدّث لحظيًا (Real-time) من Firebase - أي طالب
// يخلّص يونيت، كل الطلبة التانيين هيشوفوا التحديث فورًا من غير Refresh
let byUnitLeaderboard = [];
let overallLeaderboard = [];

// تقدّم الطالب الحالي بس (بيتحمّل من Firebase بعد تسجيل الدخول ويفضل في الذاكرة)
let allProgress = {};

// Data Storage
let unitsData = [];
let questionsPool = [];

// تحويل الإيميل لصيغة صالحة كـ Firebase key (النقطة والرموز دي ممنوعة في مفاتيح Firebase)
function sanitizeEmailKey(email) {
    return email.replace(/\./g, ',').replace(/[#$\[\]]/g, '_');
}

// ===== الترجمة الفورية (Google Translate) =====
let isTranslatedToArabic = false;
function toggleTranslation() {
    const select = document.querySelector('#google_translate_element select.goog-te-combo');
    if (!select) {
        alert('⏳ الترجمة لسه بتتجهز، استنى ثانية وجرّب تاني.');
        return;
    }

    const btnLabel = document.getElementById('translate-btn-label');

    if (!isTranslatedToArabic) {
        select.value = 'ar';
        select.dispatchEvent(new Event('change'));
        isTranslatedToArabic = true;
        btnLabel.innerText = 'English';
    } else {
        // الرجوع للنص الأصلي (الخيار الأول في القايمة بيبقى "Show original" افتراضيًا)
        select.value = select.options[0].value;
        select.dispatchEvent(new Event('change'));
        isTranslatedToArabic = false;
        btnLabel.innerText = 'العربية';
    }
}

// بينتظر لحد ما Firebase (اللي بيتحمّل في module منفصل) يخلص تجهيز نفسه
function waitForFirebase() {
    return new Promise(resolve => {
        if (window.fbDB) return resolve();
        window.addEventListener('firebase-ready', () => resolve(), { once: true });
    });
}

// تشفير الباسورد بـ SHA-256 قبل ما يتبعت لـ Firebase - عشان الباسورد الحقيقي
// ميتخزنش كنص واضح خالص، حتى لو حد دخل على قاعدة البيانات مباشرة ميقدرش يشوفه
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper function to capitalize first letter of each word (Title Case)
function toTitleCase(str) {
    if (!str) return '';
    return str.replace(/\w\S*/g, function(txt) {
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
}

// 2. فحص الجلسة فوراً عند تشغيل السكريبت لإخفاء النافذة دون انتظار الـ Fetch
async function checkActiveSession() {
    const modal = document.getElementById('login-modal');
    const userDisplay = document.getElementById('user-display');
    const nameElem = document.getElementById('current-user-name');
    const branchElem = document.getElementById('current-user-branch');

    if (currentStudent && currentBranch) {
        if (nameElem) nameElem.innerText = currentStudent;
        if (branchElem) branchElem.innerText = currentBranch;
        if (userDisplay) userDisplay.style.display = 'flex';
        if (modal) modal.style.display = 'none';
        await loadUserProgress();
        // نملّي خانات الفيدباك تلقائيًا ببيانات الطالب عشان ميكتبهاش كل مرة
        const fbName = document.getElementById('feedback-name');
        const fbEmail = document.getElementById('feedback-email');
        if (fbName && !fbName.value) fbName.value = currentStudent;
        if (fbEmail && !fbEmail.value) fbEmail.value = currentEmail;
    } else {
        if (modal) modal.style.display = 'flex';
        if (userDisplay) userDisplay.style.display = 'none';
    }
}

// تحميل تقدّم الطالب الحالي من Firebase (بيتحمّل مرة واحدة بعد تسجيل الدخول
// ويفضل في الذاكرة عشان باقي دوال الموقع تشتغل عادي زي ما هي)
async function loadUserProgress() {
    if (!currentEmail) return;
    await waitForFirebase();
    try {
        const snap = await window.fbGet(window.fbRef(window.fbDB, 'progress/' + sanitizeEmailKey(currentEmail)));
        allProgress[currentEmail] = snap.exists() ? snap.val() : {};
    } catch (err) {
        console.error('Failed to load progress from Firebase:', err);
        if (!allProgress[currentEmail]) allProgress[currentEmail] = {};
    }
}

// حفظ تقدّم الطالب الحالي (حالة الدروس + المراحل المفتوحة + نتايج الامتحانات)
// لليونيت المفتوحة حاليًا - على Firebase مباشرة عشان يبقى متاح من أي جهاز
function saveUserProgress() {
    if (!currentEmail || !currentUnit) return;
    if (!allProgress[currentEmail]) allProgress[currentEmail] = {};
    if (!allProgress[currentEmail].units) allProgress[currentEmail].units = {};

    const existing = allProgress[currentEmail].units[currentUnit.id] || {};
    allProgress[currentEmail].units[currentUnit.id] = {
        lessons: currentUnit.lessons.map(l => ({ unlocked: l.unlocked, completed: l.completed })),
        stages: unlockedStages,
        examResults: existing.examResults || {},
        seenQuestions: existing.seenQuestions || {},
        leaderboardRecorded: existing.leaderboardRecorded || false
    };

    if (window.fbDB) {
        window.fbSet(window.fbRef(window.fbDB, 'progress/' + sanitizeEmailKey(currentEmail)), allProgress[currentEmail])
            .catch(err => console.error('Failed to save progress to Firebase:', err));
    }
}

// إعادة تطبيق التقدّم المحفوظ لوحدة معيّنة بعد تحميلها من units.json
// (حالة الدروس + المراحل المفتوحة الخاصة باليونيت دي تحديدًا)
function applySavedUnitProgress(unit) {
    // نرجّع الحالة الافتراضية الأول (يونيت جديدة لسه ملهاش تقدّم = Easy بس متاحة)
    unlockedStages = { easy: true, medium: false, hard: false };

    const saved = currentEmail && allProgress[currentEmail] && allProgress[currentEmail].units
        ? allProgress[currentEmail].units[unit.id]
        : null;
    if (!saved) return;

    if (saved.stages) unlockedStages = saved.stages;
    if (saved.lessons) {
        unit.lessons.forEach((l, i) => {
            if (saved.lessons[i]) {
                l.unlocked = saved.lessons[i].unlocked;
                l.completed = saved.lessons[i].completed;
            }
        });
    }
}

// تشغيل فحص الجلسة فور تجهيز الـ DOM مباشرة
document.addEventListener('DOMContentLoaded', () => {
    checkActiveSession();
    loadAppData();
    waitForFirebase().then(() => {
        initLeaderboardListeners();
        trackSiteVisit();
    });
});

// تسجيل زيارة جديدة للموقع (عداد بسيط - كل تحميل صفحة يزوّد العدد بواحد
// بشكل ذرّي (Atomic) عن طريق increment عشان ميحصلش تضارب لو فيه زوار كتير
// في نفس اللحظة)
function trackSiteVisit() {
    if (!window.fbDB) return;
    window.fbUpdate(window.fbRef(window.fbDB, 'stats'), { totalVisits: window.fbIncrement(1) })
        .catch(err => console.error('Visit tracking failed:', err));
}

// ===== إرسال الفيدباك عن طريق EmailJS =====
// الرسالة بتتبعت مباشرة على الإيميل، وكمان بتتحفظ نسخة منها في Firebase
// كنسخة احتياطية (لو الإيميل فشل لأي سبب، الرسالة متضيعش)
let selectedFeedbackRating = 0;

function setFeedbackRating(value) {
    selectedFeedbackRating = value;
    document.querySelectorAll('#feedback-star-rating .star-icon').forEach(star => {
        const starValue = Number(star.dataset.value);
        star.classList.toggle('filled', starValue <= value);
        star.className = star.className.replace(/fa-(regular|solid)/, starValue <= value ? 'fa-solid' : 'fa-regular');
    });
    document.getElementById('feedback-rating-label').innerText = `${value} / 5`;
}

function resetFeedbackRating() {
    selectedFeedbackRating = 0;
    document.querySelectorAll('#feedback-star-rating .star-icon').forEach(star => {
        star.classList.remove('filled');
        star.className = star.className.replace('fa-solid', 'fa-regular');
    });
    document.getElementById('feedback-rating-label').innerText = 'Not rated';
}

async function sendFeedback() {
    const nameInput = document.getElementById('feedback-name').value.trim();
    const emailInput = document.getElementById('feedback-email').value.trim();
    const messageInput = document.getElementById('feedback-message').value.trim();
    const statusBox = document.getElementById('feedback-status');
    const submitBtn = document.getElementById('feedback-submit-btn');

    function showStatus(text, type) {
        statusBox.style.display = 'block';
        statusBox.className = 'mono ' + type;
        statusBox.innerHTML = text;
    }

    if (!nameInput) { showStatus('⚠️ من فضلك اكتب اسمك.', 'error'); return; }
    if (!emailInput || !emailInput.includes('@')) { showStatus('⚠️ من فضلك اكتب بريد إلكتروني صحيح.', 'error'); return; }
    if (!messageInput) { showStatus('⚠️ من فضلك اكتب رسالتك.', 'error'); return; }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
    statusBox.style.display = 'none';

    // نسخة احتياطية في Firebase (بتتم بالتوازي ومش بتوقف الإرسال لو فشلت)
    if (window.fbDB && window.fbPush) {
        window.fbPush(window.fbRef(window.fbDB, 'feedback'), {
            name: nameInput,
            email: emailInput,
            message: messageInput,
            rating: selectedFeedbackRating || null,
            student: currentStudent || '(not logged in)',
            branch: currentBranch || '-',
            sentAt: new Date().toISOString()
        }).catch(err => console.error('Feedback backup to Firebase failed:', err));
    }

    try {
        await emailjs.send('service_d7907c4', 'template_a0ic8op', {
            // الأسماء دي مستخدمة في جسم الرسالة (Content) في الـ template
            from_name: nameInput,
            from_email: emailInput,
            reply_to: emailInput,
            message: messageInput,
            student_branch: currentBranch || '-',
            // ودي مستخدمة في الـ Subject و From Name و Reply To في إعدادات الـ template
            name: nameInput,
            email: emailInput,
            branch: currentBranch || 'Guest',
            rating: selectedFeedbackRating ? `${selectedFeedbackRating} / 5 ⭐` : 'Not rated'
        });

        showStatus('✅ تم إرسال رسالتك بنجاح. شكرًا لك!', 'success');
        document.getElementById('feedback-name').value = '';
        document.getElementById('feedback-email').value = '';
        document.getElementById('feedback-message').value = '';
        resetFeedbackRating();
    } catch (err) {
        console.error('EmailJS send failed:', err);
        showStatus('⚠️ حصلت مشكلة أثناء الإرسال. تأكد من اتصال الإنترنت وحاول تاني.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Feedback';
    }
}

// Fetch Curriculum and Questions Data
// ملحوظة: تحميل الوحدات (units) والأسئلة (questions) بقى منفصل عن بعض
// عشان لو ملف الأسئلة فاضي أو فيه مشكلة، الوحدات والدروس تفضل شغالة عادي
async function loadAppData() {
    try {
        const unitsRes = await fetch('./data/units.json');
        if (!unitsRes.ok) throw new Error("Failed to load units.json");
        unitsData = await unitsRes.json();
        renderUnits();
    } catch (error) {
        console.error("Units fetch error:", error);
    }

    try {
        const questionsRes = await fetch('./data/questions.json');
        if (!questionsRes.ok) throw new Error("Failed to load questions.json");
        questionsPool = await questionsRes.json();
    } catch (error) {
        console.error("Questions fetch error (exams won't work until this is fixed):", error);
    }

    updateLeaderboardUI();
}

// Toggle Password Field Visibility
function togglePasswordVisibility() {
    const passInput = document.getElementById('student-pass');
    const passIcon = document.getElementById('pass-icon');
    if (passInput.type === 'password') {
        passInput.type = 'text';
        passIcon.className = 'fa-solid fa-eye-slash';
    } else {
        passInput.type = 'password';
        passIcon.className = 'fa-solid fa-eye';
    }
}

// Password Complexity Rule
function validateComplexPassword(password) {
    const complexRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
    return complexRegex.test(password);
}

// Switch Auth Modes
function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    
    const title = document.getElementById('modal-title');
    const subtitle = document.getElementById('modal-subtitle');
    const submitBtn = document.getElementById('submitBtn');
    const nameGroup = document.getElementById('name-group');
    const branchGroup = document.getElementById('branch-group');
    const nameInput = document.getElementById('student-name');
    const branchInput = document.getElementById('student-branch');
    const questionText = document.getElementById('mode-question');
    const toggleBtn = document.getElementById('mode-toggle-btn');
    const passError = document.getElementById('pass-error');
    const passInput = document.getElementById('student-pass');

    passError.style.display = 'none';

    if (isRegisterMode) {
        title.innerText = 'Create Account';
        subtitle.innerText = 'First-time student? Register your details below.';
        submitBtn.innerText = 'Register & Enter';
        nameGroup.style.display = 'flex';
        branchGroup.style.display = 'flex';
        nameInput.required = true;
        branchInput.required = true;
        questionText.innerText = 'Already registered?';
        toggleBtn.innerText = 'Sign in here';
        passInput.autocomplete = 'new-password';
    } else {
        title.innerText = 'Student Login';
        subtitle.innerText = 'Welcome back! Enter your email and password.';
        submitBtn.innerText = 'Login';
        nameGroup.style.display = 'none';
        branchGroup.style.display = 'none';
        nameInput.required = false;
        branchInput.required = false;
        questionText.innerText = 'First time here?';
        toggleBtn.innerText = 'Create an account';
        passInput.autocomplete = 'current-password';
    }
}

// Form Submission Handling with Persistence
async function handleAuthSubmit(event) {
    event.preventDefault();

    const emailInput = document.getElementById('student-email').value.trim().toLowerCase();
    const passInput = document.getElementById('student-pass').value;
    const passError = document.getElementById('pass-error');
    const submitBtn = document.getElementById('submitBtn');

    // تحقق واضح من الإيميل (كان معتمد على تحقق المتصفح التلقائي بس، وده
    // بيتعطّل دلوقتي بـ novalidate عشان نضمن ظهور رسالة واضحة دايمًا)
    if (!emailInput || !emailInput.includes('@')) {
        alert("⚠️ من فضلك اكتب بريد إلكتروني صحيح.");
        return;
    }
    if (!passInput) {
        alert("⚠️ من فضلك اكتب كلمة المرور.");
        return;
    }

    // تحقق واضح من الاسم والفرع في وضع التسجيل، مع رسالة تنبيه بدل الاعتماد
    // على تحقق المتصفح الصامت (اللي كان ممكن ميوريش أي رد فعل ظاهر للمستخدم)
    if (isRegisterMode) {
        const nameVal = document.getElementById('student-name').value.trim();
        const branchVal = document.getElementById('student-branch').value;
        if (!nameVal) {
            alert("⚠️ من فضلك اكتب الاسم بالكامل.");
            return;
        }
        if (!branchVal) {
            alert("⚠️ من فضلك اختر فرع الأكاديمي من القائمة.");
            return;
        }
    }

    // شرط تعقيد الباسورد يتفحص فقط عند إنشاء حساب جديد
    if (isRegisterMode && !validateComplexPassword(passInput)) {
        passError.style.display = 'block';
        return;
    } else {
        passError.style.display = 'none';
    }

    // الحسابات بقت متخزّنة على Firebase (مشتركة بين كل الطلبة)، فلازم ننتظر
    // اتصال Firebase ونجيب/نتحقق من الحساب منه بدل الـ LocalStorage المحلي
    submitBtn.disabled = true;
    submitBtn.innerText = 'Please wait...';
    await waitForFirebase();

    // تشفير الباسورد قبل أي حفظ أو مقارنة (SHA-256) - الباسورد الحقيقي
    // مايتبعتش ولا يتخزّن كنص واضح خالص
    let hashedPass;
    try {
        hashedPass = await hashPassword(passInput);
    } catch (err) {
        console.error('Password hashing failed:', err);
        alert("⚠️ حصلت مشكلة تقنية أثناء تأمين كلمة المرور. جرّب من متصفح تاني أو تأكد إن الموقع بيفتح عن طريق https أو localhost.");
        submitBtn.disabled = false;
        submitBtn.innerText = isRegisterMode ? 'Register & Enter' : 'Login';
        return;
    }

    const accountKey = sanitizeEmailKey(emailInput);
    let accountSnap;
    try {
        accountSnap = await window.fbGet(window.fbRef(window.fbDB, 'accounts/' + accountKey));
    } catch (err) {
        console.error('Firebase accounts fetch error:', err);
        alert("⚠️ حصلت مشكلة في الاتصال بقاعدة البيانات. تأكد من اتصال الإنترنت وحاول تاني.");
        submitBtn.disabled = false;
        submitBtn.innerText = isRegisterMode ? 'Register & Enter' : 'Login';
        return;
    }

    if (isRegisterMode) {
        if (accountSnap.exists()) {
            alert("⚠️ This email address is already registered! Please switch to Login mode.");
            toggleAuthMode();
            document.getElementById('student-email').value = emailInput;
            submitBtn.disabled = false;
            return;
        }

        const nameInput = toTitleCase(document.getElementById('student-name').value.trim());
        const branchInput = document.getElementById('student-branch').value;

        // حفظ الحساب الجديد على Firebase (بالباسورد المشفّر بس، مش النص الأصلي)
        try {
            await window.fbSet(window.fbRef(window.fbDB, 'accounts/' + accountKey), {
                name: nameInput, password: hashedPass, branch: branchInput, email: emailInput
            });
        } catch (err) {
            console.error('Firebase account save error:', err);
            alert("⚠️ حصلت مشكلة في حفظ الحساب. حاول تاني.");
            submitBtn.disabled = false;
            submitBtn.innerText = 'Register & Enter';
            return;
        }

        currentStudent = nameInput;
        currentBranch = branchInput;
        currentEmail = emailInput;
    } else {
        if (!accountSnap.exists()) {
            alert("⚠️ Account not found! Please check your email or create a new account first.");
            submitBtn.disabled = false;
            submitBtn.innerText = 'Login';
            return;
        }

        const account = accountSnap.val();
        if (account.password !== hashedPass) {
            alert("❌ Incorrect password! Please try again.");
            submitBtn.disabled = false;
            submitBtn.innerText = 'Login';
            return;
        }

        currentStudent = account.name;
        currentBranch = account.branch;
        currentEmail = emailInput;
    }

    submitBtn.disabled = false;
    submitBtn.innerText = isRegisterMode ? 'Register & Enter' : 'Login';

    // حفظ بيانات الجلسة الحالية (محلي بس - يحدد مين مسجل دخول في المتصفح ده)
    const sessionData = { name: currentStudent, email: currentEmail, branch: currentBranch };
    localStorage.setItem('net_academy_session', JSON.stringify(sessionData));

    checkActiveSession();
}

function logoutStudent() {
    currentStudent = null;
    currentEmail = null;
    currentBranch = null;

    // حذف الجلسة الحالية فقط مع إبقاء الحسابات المسجلة
    localStorage.removeItem('net_academy_session');

    document.getElementById('registrationForm').reset();
    checkActiveSession();
}

// Dynamic Question Generation
// إرجاع مجموعة نصوص الأسئلة اللي الطالب شافها قبل كده في محاولات سابقة لنفس
// اليونيت والمرحلة (Easy/Medium/Hard) - عشان نتجنب تكرارها في المحاولة الجديدة
function getSeenQuestionTexts(diff) {
    if (!currentEmail || !currentUnit || !allProgress[currentEmail] || !allProgress[currentEmail].units) {
        return new Set();
    }
    const unitProgress = allProgress[currentEmail].units[currentUnit.id];
    if (!unitProgress || !unitProgress.seenQuestions || !unitProgress.seenQuestions[diff]) {
        return new Set();
    }
    return new Set(unitProgress.seenQuestions[diff]);
}

// تسجيل الأسئلة اللي ظهرت للطالب في المحاولة دي، عشان محاولة قادمة تتجنبها.
// لو كل أسئلة البنك اتشافت خلاص (مفيش أسئلة جديدة تانية)، بندوّر الدورة من
// الأول تلقائيًا بدل ما نفضل نضيف على قايمة فاضلها أسئلة مش موجودة
function markQuestionsAsSeen(diff, questionTexts) {
    if (!currentEmail || !currentUnit) return;
    if (!allProgress[currentEmail]) allProgress[currentEmail] = {};
    if (!allProgress[currentEmail].units) allProgress[currentEmail].units = {};
    if (!allProgress[currentEmail].units[currentUnit.id]) {
        allProgress[currentEmail].units[currentUnit.id] = { lessons: [], stages: unlockedStages, examResults: {}, leaderboardRecorded: false };
    }
    const unitProgress = allProgress[currentEmail].units[currentUnit.id];
    if (!unitProgress.seenQuestions) unitProgress.seenQuestions = {};

    const unitPool = questionsPool.filter(item => item.unitId === currentUnit.id && item.difficulty === diff);
    const totalAvailable = unitPool.length;

    let updatedSeen = new Set(unitProgress.seenQuestions[diff] || []);
    questionTexts.forEach(t => updatedSeen.add(t));

    // لو خلّص كل البنك المتاح، ندوّر الدورة تاني (نصفّر القايمة) بدل ما تفضل
    // ثابتة وملهاش أسئلة جديدة تتقدملها أبدًا
    if (totalAvailable > 0 && updatedSeen.size >= totalAvailable) {
        updatedSeen = new Set();
    }

    unitProgress.seenQuestions[diff] = Array.from(updatedSeen);
}

function generateDynamicQuestionsFromCurriculum(diff) {
    if (!questionsPool || questionsPool.length === 0) return [];

    let targetCount = diff === 'hard' ? 10 : 20;

    // فلترة الأسئلة أولاً حسب اليونيت المفتوحة حاليًا (unitId) عشان امتحان كل
    // يونيت يسحب من بنك أسئلته هو بس، مش من بنك الأسئلة المشترك لكل الوحدات
    let unitPool = currentUnit
        ? questionsPool.filter(item => item.unitId === currentUnit.id)
        : questionsPool;
    // فولباك: لو اليونيت دي لسه ملهاش بنك أسئلة خاص بيها (unitId مش موجود
    // في أي سؤال)، نرجع نستخدم كل البنك عشان الامتحان ميفضلش فاضي تمامًا
    if (unitPool.length === 0) unitPool = questionsPool;

    // فلترة حسب مستوى الصعوبة المطلوب (easy/medium/hard) بدل ما ناخد عشوائي
    // من كل البنك. لو مفيش أسئلة كفاية بالمستوى ده، نكمل من باقي بنك اليونيت
    let difficultyPool = unitPool.filter(item => item.difficulty === diff);
    let fallbackPool = unitPool.filter(item => item.difficulty !== diff);
    let combinedPool = difficultyPool.length >= targetCount
        ? difficultyPool
        : [...difficultyPool, ...fallbackPool];

    // نستبعد الأسئلة اللي الطالب شافها في محاولات سابقة لنفس اليونيت/المرحلة،
    // عشان محاولة جديدة تجيبله تشكيلة مختلفة قدر الإمكان بدل ما يتكرر عليه
    // نفس الأسئلة. لو خلّص كل البنك المتاح (شاف كل حاجة قبل كده)، بندوّر
    // الدورة تاني من الأول تلقائيًا (نعتبر إنه ملوش أسئلة "متشافة" حاليًا)
    const seenTexts = getSeenQuestionTexts(diff);
    let unseenPool = combinedPool.filter(item => !seenTexts.has(item.q));
    let seenPool = combinedPool.filter(item => seenTexts.has(item.q));

    // بنخلط كل مجموعة لوحدها ونرتّبهم "الجديدة الأول" - عشان نضمن إن كل
    // الأسئلة الجديدة المتاحة تتاخد قبل ما نضطر نرجع لأسئلة اتشافت قبل كده
    // (لو خلطنا الاتنين مع بعض في قايمة واحدة قبل الاختيار، كان ممكن يطلع
    // عشوائي أسئلة متشافة بدل الجديدة رغم وجودها)
    unseenPool = [...unseenPool].sort(() => 0.5 - Math.random());
    seenPool = [...seenPool].sort(() => 0.5 - Math.random());
    let pool = [...unseenPool, ...seenPool];

    // لو عدد الأسئلة المتاحة أقل من المطلوب، ناخد كل الأسئلة المتاحة بدون تكرار
    // بدل ما نلف على نفس البنك (كان بيسبب تكرار نفس السؤال جوه الامتحان الواحد)
    targetCount = Math.min(targetCount, pool.length);

    let selectedQuestions = [];
    let shuffledPool = pool.slice(0, targetCount).sort(() => 0.5 - Math.random());

    for (let i = 0; i < targetCount; i++) {
        let item = shuffledPool[i];
        
        let rawOptions = [...item.options];
        let correctText = rawOptions[item.ans];
        
        let shuffledOptions = [...rawOptions].sort(() => 0.5 - Math.random());
        let newCorrectIndex = shuffledOptions.indexOf(correctText);

        selectedQuestions.push({
            q: item.q,
            options: shuffledOptions,
            ans: newCorrectIndex,
            reviewRef: item.ref
        });
    }

    return selectedQuestions;
}

function renderUnits(filter = 'all') {
    const grid = document.getElementById('units-grid');
    if (!grid) return;
    const list = filter === 'all' ? unitsData : unitsData.filter(u => u.group === filter);

    grid.innerHTML = list.map(u => `
        <div class="card" onclick="openUnit(${u.id})">
            <div>
                <span class="unit-tag mono">${u.unitNumber}</span>
                <h3>${u.title}</h3>
                <p>${u.description}</p>
            </div>
            <button class="btn mono"><i class="fa-solid fa-folder-open"></i> Explore Module</button>
        </div>
    `).join('');
}

function filterUnits(group, btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderUnits(group);
}

function hideAll() {
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('unit-view').classList.remove('active');
    document.getElementById('lesson-view').classList.remove('active');
    document.getElementById('quiz-view').classList.remove('active');
}

function showHome() {
    // وقف تشغيل الصوت لو كان شغال قبل الرجوع للصفحة الرئيسية
    const audioPlayer = document.getElementById('unit-audio-player');
    if (audioPlayer) audioPlayer.pause();
    const playIcon = document.getElementById('audio-play-icon');
    if (playIcon) playIcon.className = 'fa-solid fa-play';
    hideAll();
    document.getElementById('home-view').style.display = 'block';
}

function openUnit(id) {
    if (!currentStudent) {
        alert("⚠️ Please authenticate first!");
        return;
    }
    currentUnit = unitsData.find(u => u.id === id);
    applySavedUnitProgress(currentUnit);
    renderUnitDetails();
    hideAll();
    document.getElementById('unit-view').classList.add('active');
}

// ===== Custom Audio Player (Unit Explanation) =====
let currentAudioBlobUrl = null;

function resetAudioPlayer() {
    const audioPlayer = document.getElementById('unit-audio-player');
    audioPlayer.pause();
    audioPlayer.removeAttribute('src');
    document.getElementById('audio-play-icon').className = 'fa-solid fa-play';
    document.getElementById('audio-progress-fill').style.width = '0%';
    document.getElementById('audio-progress-handle').style.left = '0%';
    document.getElementById('audio-current-time').innerText = '0:00';
    document.getElementById('audio-duration').innerText = '0:00';
    document.getElementById('audio-loading-msg').style.display = 'none';
    if (currentAudioBlobUrl) {
        URL.revokeObjectURL(currentAudioBlobUrl);
        currentAudioBlobUrl = null;
    }
}

function formatAudioTime(seconds) {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// تحميل ملف الصوت كـ Blob جوه المتصفح بدل ما نديله كـ رابط مباشر.
// ده بيحل مشكلة برامج تحميل زي IDM اللي بتحاول تمسك أي رابط صوت/فيديو
// مباشر وتقاطع تشغيله؛ الـ Blob مالوش رابط شبكة ظاهر تقدر تمسكه.
async function loadUnitAudio(audioPath) {
    resetAudioPlayer();
    const audioPlayer = document.getElementById('unit-audio-player');
    const loadingMsg = document.getElementById('audio-loading-msg');
    loadingMsg.style.display = 'block';
    loadingMsg.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading audio... 0%';

    try {
        const response = await fetch(audioPath);
        if (!response.ok) throw new Error('Audio fetch failed: ' + response.status);

        const totalBytes = Number(response.headers.get('Content-Length')) || 0;

        // نقرأ الملف على أجزاء (Stream) عشان نقدر نحسب نسبة التحميل الحقيقية
        // ونوريها للطالب، بدل ما يفضل شايف "Loading..." ثابتة من غير أي مؤشر
        if (response.body && totalBytes > 0) {
            const reader = response.body.getReader();
            const chunks = [];
            let receivedBytes = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedBytes += value.length;
                const pct = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
                loadingMsg.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading audio... ${pct}%`;
            }

            const blob = new Blob(chunks);
            currentAudioBlobUrl = URL.createObjectURL(blob);
            audioPlayer.src = currentAudioBlobUrl;
        } else {
            // فولباك: لو السيرفر مبعتش Content-Length، منقدرش نحسب نسبة حقيقية
            const blob = await response.blob();
            currentAudioBlobUrl = URL.createObjectURL(blob);
            audioPlayer.src = currentAudioBlobUrl;
        }
    } catch (err) {
        // فولباك: لو الـ fetch فشل لأي سبب (مثلاً فتح الملف مباشرة بدون سيرفر محلي)
        // نرجع للطريقة العادية بدل ما الصوت يفضل مش شغال خالص
        console.error('Falling back to direct audio src:', err);
        audioPlayer.src = audioPath;
    } finally {
        loadingMsg.style.display = 'none';
    }
}

function toggleAudioPlay() {
    const audioPlayer = document.getElementById('unit-audio-player');
    const icon = document.getElementById('audio-play-icon');
    if (audioPlayer.paused) {
        audioPlayer.play();
        icon.className = 'fa-solid fa-pause';
    } else {
        audioPlayer.pause();
        icon.className = 'fa-solid fa-play';
    }
}

function seekAudio(event) {
    const audioPlayer = document.getElementById('unit-audio-player');
    if (!audioPlayer.duration) return;
    const bar = document.getElementById('audio-progress-bar');
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    audioPlayer.currentTime = ratio * audioPlayer.duration;
}

document.addEventListener('DOMContentLoaded', () => {
    const audioPlayer = document.getElementById('unit-audio-player');
    if (!audioPlayer) return;

    audioPlayer.addEventListener('timeupdate', () => {
        if (!audioPlayer.duration) return;
        const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        document.getElementById('audio-progress-fill').style.width = pct + '%';
        document.getElementById('audio-progress-handle').style.left = pct + '%';
        document.getElementById('audio-current-time').innerText = formatAudioTime(audioPlayer.currentTime);
    });

    audioPlayer.addEventListener('loadedmetadata', () => {
        document.getElementById('audio-duration').innerText = formatAudioTime(audioPlayer.duration);
    });

    audioPlayer.addEventListener('ended', () => {
        document.getElementById('audio-play-icon').className = 'fa-solid fa-play';
        document.getElementById('audio-progress-fill').style.width = '0%';
        document.getElementById('audio-progress-handle').style.left = '0%';
    });
});

function renderUnitDetails() {
    document.getElementById('unit-badge').innerText = currentUnit.unitNumber;
    document.getElementById('unit-title').innerText = currentUnit.title;
    document.getElementById('unit-desc').innerText = currentUnit.description;

    // عرض مشغل الصوت بس لو الوحدة عندها ملف صوتي (حقل audio في units.json)
    const audioBox = document.getElementById('unit-audio-box');
    if (currentUnit.audio) {
        audioBox.style.display = 'block';
        loadUnitAudio(currentUnit.audio);
    } else {
        audioBox.style.display = 'none';
        resetAudioPlayer();
    }

    const container = document.getElementById('lessons-container');
    let completedCount = 0;

    container.innerHTML = currentUnit.lessons.map((l, i) => {
        let classList = "lesson-item";
        let statusMarkup = `<span class="status-badge unlocked mono">Start <i class="fa-solid fa-chevron-right"></i></span>`;

        if (l.completed) {
            classList += " completed";
            statusMarkup = `<span class="status-badge done-text mono">Completed <i class="fa-solid fa-circle-check"></i></span>`;
            completedCount++;
        } else if (!l.unlocked) {
            classList += " locked";
            statusMarkup = `<span class="status-badge locked-text mono">Locked <i class="fa-solid fa-lock"></i></span>`;
        }

        return `
            <div class="${classList}" onclick="openLesson(${i})">
                <div><span class="lesson-number mono">Lesson ${i + 1}</span><strong>${l.title}</strong></div>
                ${statusMarkup}
            </div>
        `;
    }).join('');

    const quizBox = document.getElementById('quiz-activation-wrapper');
    const lockedNotice = document.getElementById('quiz-locked-box');
    const progressStatus = document.getElementById('quiz-progress-status');

    if (completedCount === currentUnit.lessons.length) {
        quizBox.style.display = 'block';
        lockedNotice.style.display = 'none';
        updateStageSelectorUI();
    } else {
        quizBox.style.display = 'none';
        lockedNotice.style.display = 'flex';
        progressStatus.innerText = `Current Progress: [${completedCount}/${currentUnit.lessons.length} lessons completed] - Complete all lessons to unlock exams.`;
    }
}

function updateStageSelectorUI() {
    ['easy', 'medium', 'hard'].forEach(stage => {
        const btn = document.getElementById(`diff-${stage}`);
        if (unlockedStages[stage]) {
            btn.classList.remove('locked');
            if (stage === selectedDifficulty) btn.classList.add('selected');
        } else {
            btn.classList.add('locked');
            btn.classList.remove('selected');
        }
    });
}

function selectDifficulty(level) {
    if (!unlockedStages[level]) {
        alert(`🔒 Stage Locked! You must pass the previous stage with at least 65%.`);
        return;
    }
    selectedDifficulty = level;
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById(`diff-${level}`).classList.add('selected');
}

function openLesson(idx) {
    const lesson = currentUnit.lessons[idx];
    if (!lesson.unlocked) {
        alert("⚠️ Please complete the previous lesson first.");
        return;
    }

    activeLessonIdx = idx;
    document.getElementById('lesson-title').innerText = lesson.title;
    document.getElementById('lesson-content').innerHTML = lesson.content;

    const btn = document.getElementById('complete-btn');
    if (lesson.completed) {
        btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Lesson Completed`;
        btn.style.background = "var(--success)";
    } else {
        btn.innerHTML = `Mark Lesson as Completed`;
        btn.style.background = "var(--primary-accent)";
    }

    hideAll();
    document.getElementById('lesson-view').classList.add('active');
}

function completeCurrentLesson() {
    if (activeLessonIdx === null) return;
    currentUnit.lessons[activeLessonIdx].completed = true;

    if (activeLessonIdx + 1 < currentUnit.lessons.length) {
        currentUnit.lessons[activeLessonIdx + 1].unlocked = true;
    }

    saveUserProgress();
    renderUnitDetails();
    showUnitView();
}

function showUnitView() {
    hideAll();
    document.getElementById('unit-view').classList.add('active');
}

function startQuiz() {
    const diffText = toTitleCase(selectedDifficulty);
    activeExamQuestions = generateDynamicQuestionsFromCurriculum(selectedDifficulty);

    document.getElementById('quiz-title').innerText = `${currentUnit.unitNumber} - Dynamic Exam Stage (${diffText}) - ${activeExamQuestions.length} Questions`;
    const container = document.getElementById('quiz-questions-container');
    userAnswers = {};
    timeElapsed = 0;

    startTimer();

    container.innerHTML = activeExamQuestions.map((q, qIdx) => `
        <div class="quiz-card" id="q-card-${qIdx}">
            <p class="mono" style="margin-bottom: 15px; color: var(--primary-accent);">Q${qIdx + 1}: ${q.q}</p>
            ${q.options.map((opt, oIdx) => `
                <button class="opt-btn mono" id="opt-${qIdx}-${oIdx}" onclick="selectOption(${qIdx}, ${oIdx})">
                    [ ] ${opt}
                </button>
            `).join('')}
        </div>
    `).join('');

    document.getElementById('quiz-result').style.display = 'none';
    hideAll();
    document.getElementById('quiz-view').classList.add('active');
}

function selectOption(qIdx, oIdx) {
    userAnswers[qIdx] = oIdx;
    const qList = activeExamQuestions[qIdx].options;
    qList.forEach((_, i) => {
        const btn = document.getElementById(`opt-${qIdx}-${i}`);
        btn.classList.remove('selected-opt');
        btn.innerText = `[ ] ${qList[i]}`;
    });

    const selectedBtn = document.getElementById(`opt-${qIdx}-${oIdx}`);
    selectedBtn.classList.add('selected-opt');
    selectedBtn.innerText = `[✔] ${qList[oIdx]}`;
}

function startTimer() {
    clearInterval(timerInterval);
    updateTimerDisplay();

    timerInterval = setInterval(() => {
        timeElapsed++;
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const mins = Math.floor(timeElapsed / 60);
    const secs = timeElapsed % 60;
    document.getElementById('timer-display').innerHTML = `<i class="fa-solid fa-stopwatch"></i> Time Elapsed: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function getNextStage(diff) {
    if (diff === 'easy') return 'medium';
    if (diff === 'medium') return 'hard';
    return null;
}

function startNextStage() {
    const nextStage = getNextStage(selectedDifficulty);
    if (!nextStage || !unlockedStages[nextStage]) return;
    selectedDifficulty = nextStage;
    startQuiz();
}

function abortQuiz() {
    clearInterval(timerInterval);
    // إعادة رسم تفاصيل الوحدة عشان بادچ حالة القفل (Locked/Unlocked) يتحدّث
    // لو المستخدم نجح في مرحلة وخرج بدل ما يدوس زرار المرحلة التالية
    renderUnitDetails();
    showUnitView();
}

function submitQuiz() {
    // لازم يجاوب على كل الأسئلة الأول قبل ما يقدر يعمل Submit
    const unansweredIndexes = activeExamQuestions
        .map((_, idx) => idx)
        .filter(idx => userAnswers[idx] === undefined);

    if (unansweredIndexes.length > 0) {
        // شيل أي تلوين قديم من محاولة سابقة
        activeExamQuestions.forEach((_, idx) => {
            const card = document.getElementById(`q-card-${idx}`);
            if (card) card.classList.remove('unanswered-highlight');
        });
        // لوّن كل الأسئلة الناقصة عشان الطالب يلاقيها بسهولة
        unansweredIndexes.forEach(idx => {
            const card = document.getElementById(`q-card-${idx}`);
            if (card) card.classList.add('unanswered-highlight');
        });
        alert(`⚠️ لازم تجاوب على كل الأسئلة الأول. لسه فاضل ${unansweredIndexes.length} سؤال من غير إجابة.`);
        const firstCard = document.getElementById(`q-card-${unansweredIndexes[0]}`);
        if (firstCard && firstCard.scrollIntoView) {
            firstCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    clearInterval(timerInterval);
    let score = 0;
    let mistakes = [];

    // تسجيل الأسئلة اللي ظهرت في المحاولة دي كـ"متشافة" عشان محاولة قادمة
    // (لو رسب وأعاد، أو حتى لو نجح وحب يمتحن تاني) تجيبله تشكيلة مختلفة
    markQuestionsAsSeen(selectedDifficulty, activeExamQuestions.map(q => q.q));

    activeExamQuestions.forEach((q, idx) => {
        if (userAnswers[idx] === q.ans) {
            score++;
        } else {
            mistakes.push({
                qNum: idx + 1,
                question: q.q,
                userAns: userAnswers[idx] !== undefined ? q.options[userAnswers[idx]] : "Not Answered",
                correctAns: q.options[q.ans],
                ref: q.reviewRef
            });
        }
    });

    const percentage = (score / activeExamQuestions.length) * 100;
    const passed = percentage >= 65;
    const timeFormatted = `${Math.floor(timeElapsed / 60)}m ${timeElapsed % 60}s`;

    if (passed) {
        if (selectedDifficulty === 'easy') unlockedStages.medium = true;
        if (selectedDifficulty === 'medium') unlockedStages.hard = true;

        // سجّل نتيجة المرحلة دي في تقدّم الطالب الخاص باليونيت الحالية
        if (!currentEmail || !allProgress[currentEmail]) allProgress[currentEmail] = {};
        if (!allProgress[currentEmail].units) allProgress[currentEmail].units = {};
        if (!allProgress[currentEmail].units[currentUnit.id]) {
            allProgress[currentEmail].units[currentUnit.id] = { lessons: [], stages: unlockedStages, examResults: {}, leaderboardRecorded: false };
        }
        allProgress[currentEmail].units[currentUnit.id].examResults[selectedDifficulty] = {
            percentage: percentage,
            timeSec: timeElapsed
        };

        // تحديث فوري لحالة الأزرار (Locked/Unlocked) حتى لو الطالب لسه في شاشة
        // النتيجة ومارجعش لصفحة الوحدة، عشان تبقى جاهزة أول ما يرجع
        updateStageSelectorUI();

        // لو خلص الـ 3 مراحل (Easy+Medium+Hard) بتاعت اليونيت دي، يتسجّل في اللوحة
        checkAndRecordUnitCompletion(currentUnit.id);
    }

    // الحفظ بيحصل دايمًا (نجح أو رسب) عشان قايمة "الأسئلة اللي اتشافت"
    // تتسجّل بشكل دائم حتى لو رسب، مش بس وقت النجاح
    saveUserProgress();

    updateLeaderboardUI();

    const res = document.getElementById('quiz-result');
    res.style.display = 'block';
    res.style.background = passed ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)';
    res.style.border = passed ? '1px solid var(--primary-accent)' : '1px solid var(--danger)';

    let mistakesHTML = mistakes.length === 0 ?
        `<div class="perfect-score-msg"><i class="fa-solid fa-circle-check"></i> Perfect score! All answers are correct.</div>` :
        `<h4 class="mistakes-heading"><i class="fa-solid fa-triangle-exclamation"></i> Detailed Performance Breakdown & Study Recommendations:</h4>` +
        mistakes.map(m => `
            <div class="review-item">
                <p class="review-q">Q${m.qNum}: ${m.question}</p>
                <p class="review-your-ans"><span class="review-label">Your Answer</span>${m.userAns}</p>
                <p class="review-correct-ans"><span class="review-label">Correct Answer</span>${m.correctAns}</p>
                <p class="review-ref"><span class="review-label">📖 Review</span>${m.ref}</p>
            </div>
        `).join('');

    const nextStage = getNextStage(selectedDifficulty);
    const canAdvance = passed && nextStage && unlockedStages[nextStage];
    const nextStageBtn = canAdvance ? `
        <button class="btn mono next-stage-btn" onclick="startNextStage()">
            <i class="fa-solid fa-forward"></i> Start Next Stage: ${toTitleCase(nextStage)}
        </button>` : '';

    res.innerHTML = `
        <h3><i class="fa-solid fa-clipboard-check"></i> Stage Assessment Result</h3>
        <div class="status-pill ${passed ? 'pass' : 'fail'}">
            <i class="fa-solid ${passed ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
            ${passed ? 'Passed' : 'Failed — 65% required to pass'}
        </div>
        <div class="result-stats-grid">
            <div class="result-stat">
                <div class="stat-label">Student</div>
                <div class="stat-value" style="font-size: 1rem;">${currentStudent}</div>
            </div>
            <div class="result-stat">
                <div class="stat-label">Branch</div>
                <div class="stat-value" style="font-size: 1rem;">${currentBranch}</div>
            </div>
            <div class="result-stat">
                <div class="stat-label">Score</div>
                <div class="stat-value">${score} / ${activeExamQuestions.length}</div>
            </div>
            <div class="result-stat">
                <div class="stat-label">Percentage</div>
                <div class="stat-value" style="color: ${passed ? 'var(--success)' : 'var(--danger)'};">${percentage.toFixed(1)}%</div>
            </div>
            <div class="result-stat">
                <div class="stat-label">Time Taken</div>
                <div class="stat-value">${timeFormatted}</div>
            </div>
        </div>
        ${nextStageBtn}
        ${mistakesHTML}
    `;
}

// Render Leaderboard
// تتحقق لو الطالب خلّص الـ 3 مراحل بتاعت اليونيت دي بنجاح، ولو كده يسجّله
// في اللوحتين (By Unit + Overall) - مرة واحدة بس لكل يونيت (leaderboardRecorded)
function checkAndRecordUnitCompletion(unitId) {
    if (!currentEmail || !allProgress[currentEmail] || !allProgress[currentEmail].units) return;
    const unitProgress = allProgress[currentEmail].units[unitId];
    if (!unitProgress || unitProgress.leaderboardRecorded) return;

    const results = unitProgress.examResults || {};
    if (!results.easy || !results.medium || !results.hard) return; // لسه مخلصش الـ 3 مراحل

    const avgScore = (results.easy.percentage + results.medium.percentage + results.hard.percentage) / 3;
    const totalTimeSec = results.easy.timeSec + results.medium.timeSec + results.hard.timeSec;

    if (!window.fbDB) return; // من غير Firebase مينفعش نسجّل في لوحة مشتركة

    // 1) سطر جديد في "By Unit" (لكل الطلبة)
    window.fbPush(window.fbRef(window.fbDB, 'leaderboard/byUnit'), {
        name: currentStudent,
        branch: currentBranch,
        unitId: unitId,
        unitNumber: currentUnit.unitNumber,
        avgScore: avgScore,
        totalTimeSec: totalTimeSec
    }).catch(err => console.error('Failed to push by-unit leaderboard entry:', err));

    // 2) تحديث/إنشاء سطر الطالب في "Overall" - بنستخدم update بمسارات متداخلة
    // عشان نعدّل بس unitScores/unitTimes بتاعة اليونيت دي من غير ما نمسح باقي يونتسه
    const overallKey = sanitizeEmailKey(currentEmail);
    const updates = {
        name: currentStudent,
        branch: currentBranch,
        [`unitScores/${unitId}`]: avgScore,
        [`unitTimes/${unitId}`]: totalTimeSec
    };
    window.fbUpdate(window.fbRef(window.fbDB, 'leaderboard/overall/' + overallKey), updates)
        .catch(err => console.error('Failed to update overall leaderboard entry:', err));

    unitProgress.leaderboardRecorded = true;
    saveUserProgress();
}

// الاستماع اللحظي (Real-time) لتغيّرات لوحة الصدارة على Firebase - أي طالب في
// أي جهاز يخلّص يونيت، كل الطلبة الفاتحين الموقع هيشوفوا التحديث فورًا
function initLeaderboardListeners() {
    if (!window.fbDB) return;

    window.fbOnValue(window.fbRef(window.fbDB, 'leaderboard/byUnit'), (snapshot) => {
        const val = snapshot.val() || {};
        byUnitLeaderboard = Object.values(val);
        updateLeaderboardUI();
    });

    window.fbOnValue(window.fbRef(window.fbDB, 'leaderboard/overall'), (snapshot) => {
        const val = snapshot.val() || {};
        overallLeaderboard = Object.values(val);
        updateLeaderboardUI();
    });
}

function switchLeaderboardTab(tab) {
    document.getElementById('lb-tab-unit').classList.toggle('active', tab === 'unit');
    document.getElementById('lb-tab-overall').classList.toggle('active', tab === 'overall');
    document.getElementById('lb-table-unit').style.display = tab === 'unit' ? 'table' : 'none';
    document.getElementById('lb-table-overall').style.display = tab === 'overall' ? 'table' : 'none';
}

function updateLeaderboardUI() {
    // --- By Unit table ---
    const tbodyUnit = document.getElementById('leaderboard-body-unit');
    if (tbodyUnit && byUnitLeaderboard.length > 0) {
        const sorted = [...byUnitLeaderboard].sort((a, b) => {
            if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
            return a.totalTimeSec - b.totalTimeSec;
        });
        tbodyUnit.innerHTML = sorted.slice(0, 15).map((entry, index) => `
            <tr>
                <td><strong>#${index + 1}</strong></td>
                <td>${entry.name}</td>
                <td><span style="color: var(--text-muted);">${entry.branch}</span></td>
                <td><span class="unit-tag mono">${entry.unitNumber}</span></td>
                <td>${entry.avgScore.toFixed(1)}%</td>
                <td><i class="fa-solid fa-stopwatch" style="font-size:0.75rem;"></i> ${formatSecondsToMinSec(entry.totalTimeSec)}</td>
            </tr>
        `).join('');
    }

    // --- Overall table ---
    const tbodyOverall = document.getElementById('leaderboard-body-overall');
    if (tbodyOverall && overallLeaderboard.length > 0) {
        const withStats = overallLeaderboard.map(e => {
            const unitIds = Object.keys(e.unitScores || {});
            const count = unitIds.length;
            const avg = count > 0 ? unitIds.reduce((sum, id) => sum + e.unitScores[id], 0) / count : 0;
            const totalTime = unitIds.reduce((sum, id) => sum + (e.unitTimes[id] || 0), 0);
            return { ...e, unitsCompletedCount: count, overallAvg: avg, overallTotalTime: totalTime };
        }).sort((a, b) => {
            if (b.unitsCompletedCount !== a.unitsCompletedCount) return b.unitsCompletedCount - a.unitsCompletedCount;
            return b.overallAvg - a.overallAvg;
        });

        tbodyOverall.innerHTML = withStats.slice(0, 15).map((entry, index) => `
            <tr>
                <td><strong>#${index + 1}</strong></td>
                <td>${entry.name}</td>
                <td><span style="color: var(--text-muted);">${entry.branch}</span></td>
                <td>${entry.unitsCompletedCount} / ${unitsData.length || '-'}</td>
                <td>${entry.overallAvg.toFixed(1)}%</td>
                <td><i class="fa-solid fa-stopwatch" style="font-size:0.75rem;"></i> ${formatSecondsToMinSec(entry.overallTotalTime)}</td>
            </tr>
        `).join('');
    }
}

function formatSecondsToMinSec(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s}s`;
}