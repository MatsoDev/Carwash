import { db, listUsers, getUser, getSetting } from './db.js';
import { randomSalt, hashPin, verifyPin, PIN_ITERATIONS } from './crypto.js';
import { esc, icon, toast, applyTheme, normalizeDigits } from './ui.js';
import { getCachedVersion } from './version.js';

const SESSION_KEY = 'cw:session';
const FAIL_KEY = 'cw:pinFails';
const LOCK_KEY = 'cw:pinLockUntil';
const NOTIFY_KEY = 'cw:pinNotifyAt';

let currentUser = null;

export function getCurrentUser() {
  if (currentUser) return currentUser;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    currentUser = JSON.parse(raw);
    return currentUser;
  } catch (e) {
    return null;
  }
}

export function isAdmin() {
  return getCurrentUser()?.role === 'admin';
}

export function setSession(user) {
  currentUser = { id: user.id, name: user.name, role: user.role };
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(currentUser)); } catch (e) { /* ignore */ }
  return currentUser;
}

export function logout() {
  currentUser = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  try { sessionStorage.removeItem(FAIL_KEY); } catch (e) { /* ignore */ }
}

export async function restoreSession() {
  const cached = getCurrentUser();
  if (!cached) return null;
  const user = await getUser(cached.id);
  if (!user) { logout(); return null; }
  return setSession(user);
}

/* ---------------- User administration ---------------- */
function assertAdmin() {
  if (!isAdmin()) throw new Error('العملية دي للمدير فقط');
}

function validatePin(pin) {
  if (!/^\d{4}$/.test(String(pin || ''))) throw new Error('الـ PIN لازم يكون 4 أرقام');
}

export async function createUser({ name, pin, role }) {
  assertAdmin();
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('اسم المستخدم مطلوب');
  validatePin(pin);
  if (!['admin', 'cashier'].includes(role)) throw new Error('الدور غير صحيح');
  const salt = randomSalt();
  const pinHash = await hashPin(pin, salt);
  const id = await db.users.add({
    name: cleanName,
    role,
    salt,
    pinHash,
    iterations: PIN_ITERATIONS,
    createdAt: new Date().toISOString()
  });
  return getUser(id);
}

export async function changePin(userId, pin) {
  const me = getCurrentUser();
  if (!me) throw new Error('لازم تسجل دخول الأول');
  if (me.id !== Number(userId) && !isAdmin()) throw new Error('مش مسموح');
  validatePin(pin);
  const salt = randomSalt();
  const pinHash = await hashPin(pin, salt);
  await db.users.update(Number(userId), { salt, pinHash, iterations: PIN_ITERATIONS });
  return true;
}

export async function updateUser(userId, { name, role }) {
  assertAdmin();
  const user = await getUser(userId);
  if (!user) throw new Error('المستخدم مش موجود');
  const updates = {};
  if (name != null) {
    const cleanName = String(name).trim();
    if (!cleanName) throw new Error('الاسم مطلوب');
    updates.name = cleanName;
  }
  if (role != null) {
    if (!['admin', 'cashier'].includes(role)) throw new Error('الدور غير صحيح');
    if (user.role === 'admin' && role !== 'admin') {
      const admins = (await listUsers()).filter((u) => u.role === 'admin');
      if (admins.length <= 1) throw new Error('لازم يفضل مدير واحد على الأقل');
    }
    updates.role = role;
  }
  await db.users.update(userId, updates);
  return true;
}

export async function deleteUser(userId) {
  assertAdmin();
  const user = await getUser(userId);
  if (!user) throw new Error('المستخدم مش موجود');
  if (user.role === 'admin') {
    const admins = (await listUsers()).filter((u) => u.role === 'admin');
    if (admins.length <= 1) throw new Error('مش مسموح تحذف آخر مدير');
  }
  if (getCurrentUser()?.id === Number(userId)) throw new Error('مش مسموح تحذف حسابك وإنت داخل بيه');
  await db.users.delete(Number(userId));
  return true;
}

/* ---------------- Login screen ---------------- */
function initial(name) {
  const s = String(name || '؟').trim();
  return s ? s[0] : '؟';
}

export function renderLockScreen({ container, onLogin }) {
  let selectedUser = null;
  let pin = '';
  let verifying = false;
  let timer = 0;
  let keyHandler = null;

  const cleanup = () => {
    clearInterval(timer);
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  };

  const fails = () => Number(sessionStorage.getItem(FAIL_KEY) || 0);
  const setFails = (n) => { try { sessionStorage.setItem(FAIL_KEY, String(n)); } catch (e) { /* ignore */ } };
  const lockRemaining = () => {
    const until = Number(localStorage.getItem(LOCK_KEY) || 0);
    return Math.max(0, until - Date.now());
  };
  const setLock = (ms) => { try { localStorage.setItem(LOCK_KEY, String(Date.now() + ms)); } catch (e) { /* ignore */ } };

  function maybeNotifyFailed(user, count) {
    if (count < 3) return;
    const last = Number(localStorage.getItem(NOTIFY_KEY) || 0);
    if (Date.now() - last < 10 * 60 * 1000) return;
    try { localStorage.setItem(NOTIFY_KEY, String(Date.now())); } catch (e) { /* ignore */ }
    import('./notifications.js')
      .then((mod) => mod.notifyEvent('security.failedPin', {
        userName: user.name,
        attempts: count
      }))
      .catch(() => {});
  }

  function shell(content) {
    const settings = container._cwSettings || {};
    const logo = settings.logoDataUrl
      ? `<img src="${settings.logoDataUrl}" alt="" class="lock-logo-img">`
      : `<div class="lock-logo">${icon('car', 34)}</div>`;
    const version = getCachedVersion().version;
    return `
      <div class="lock-bg" aria-hidden="true"></div>
      <div class="lock-card">
        <div class="lock-brand">
          ${logo}
          <div>
            <h1>${esc(settings.businessName || 'مغسلة سيارات')}</h1>
            <p>نظام الكاشير</p>
          </div>
          <button class="icon-btn lock-theme" type="button" data-action="theme" aria-label="تغيير الوضع">${icon('moon')}</button>
        </div>
        <div class="lock-content">${content}</div>
        <div class="lock-foot">
          <span>النسخة ${esc(version)}</span>
          <span class="dot-sep">•</span>
          <span>بياناتك محفوظة على الجهاز</span>
        </div>
      </div>`;
  }

  function renderUsers() {
    selectedUser = null;
    pin = '';
    verifying = false;
    cleanup();
    localStorage.removeItem('__cw_unused');
    const users = container._cwUsers || [];
    const locked = lockRemaining();
    const list = users.map((u) => `
      <button class="user-tile" type="button" data-user="${u.id}" ${locked ? 'disabled' : ''}>
        <span class="avatar">${esc(initial(u.name))}</span>
        <span class="user-tile-name">${esc(u.name)}</span>
        <span class="user-role">${u.role === 'admin' ? 'مدير' : 'كاشير'}</span>
      </button>`).join('');
    container.innerHTML = shell(`
      <h2 class="lock-title">مين اللي بيسجل الدخول؟</h2>
      <div class="user-grid">${list}</div>
      ${locked ? `<div class="lock-warning">${icon('lock', 18)} محاولات كتير — استنى <b data-lock-count>${Math.ceil(locked / 1000)}</b> ثانية وجرّب تاني.</div>` : ''}
      <details class="first-hint">
        <summary>أول مرة تستخدم البرنامج؟</summary>
        <div>
          <p>PIN المدير الافتراضي: <b>1234</b> — PIN الكاشير: <b>1111</b>.</p>
          <p>غيّرهم فورًا من الإعدادات ← المستخدمين.</p>
        </div>
      </details>
    `);
    container.querySelector('[data-action="theme"]')?.addEventListener('click', handleTheme);
    container.querySelectorAll('[data-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const user = users.find((u) => String(u.id) === btn.dataset.user);
        if (user) renderPin(user);
      });
    });
    if (locked) {
      timer = setInterval(() => {
        const left = lockRemaining();
        const el = container.querySelector('[data-lock-count]');
        if (el) el.textContent = Math.ceil(left / 1000);
        if (left <= 0) renderUsers();
      }, 500);
    }
  }

  function renderPin(user) {
    selectedUser = user;
    pin = '';
    cleanup();
    const locked = lockRemaining();
    container.innerHTML = shell(`
      <div class="pin-panel">
        <button class="btn btn-ghost btn-back" type="button" data-action="back">${icon('up', 16)} رجوع</button>
        <div class="avatar avatar-lg">${esc(initial(user.name))}</div>
        <h2 class="lock-title">${esc(user.name)}</h2>
        <p class="lock-sub">${user.role === 'admin' ? 'مدير' : 'كاشير'} — اكتب الـ PIN</p>
        <div class="pin-dots" aria-label="PIN" data-pin-dots>
          ${[0, 1, 2, 3].map(() => '<span></span>').join('')}
        </div>
        <p class="field-error pin-error" data-pin-error hidden></p>
        <div class="pin-pad" data-pad>
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-digit="${n}">${n}</button>`).join('')}
          <button type="button" class="pin-util" data-action="clear" aria-label="مسح">C</button>
          <button type="button" data-digit="0">0</button>
          <button type="button" class="pin-util" data-action="backspace" aria-label="مسح رقم">⌫</button>
        </div>
      </div>
    `);
    container.querySelector('[data-action="theme"]')?.addEventListener('click', handleTheme);
    container.querySelector('[data-action="back"]')?.addEventListener('click', renderUsers);

    const dots = () => {
      container.querySelectorAll('[data-pin-dots] span').forEach((s, i) => {
        s.classList.toggle('filled', i < pin.length);
      });
    };
    const showError = (msg) => {
      const el = container.querySelector('[data-pin-error]');
      if (!el) return;
      el.textContent = msg;
      el.hidden = false;
    };
    const clearError = () => {
      const el = container.querySelector('[data-pin-error]');
      if (el) el.hidden = true;
    };
    const padLocked = () => {
      const remaining = lockRemaining();
      if (remaining > 0) {
        showError(`محاولات كتير. استنى ${Math.ceil(remaining / 1000)} ثانية.`);
        renderPin(user);
        return true;
      }
      return false;
    };

    const submit = async () => {
      if (verifying) return;
      if (pin.length !== 4) {
        showError('الـ PIN 4 أرقام');
        return;
      }
      if (padLocked()) return;
      verifying = true;
      container.classList.add('verifying');
      try {
        const ok = await verifyPin(pin, user);
        if (ok) {
          setFails(0);
          try { localStorage.removeItem(LOCK_KEY); } catch (e) { /* ignore */ }
          cleanup();
          setSession(user);
          onLogin(getCurrentUser());
          return;
        }
        const n = fails() + 1;
        setFails(n);
        maybeNotifyFailed(user, n);
        pin = '';
        dots();
        container.classList.remove('verifying');
        container.querySelector('.pin-dots')?.classList.add('shake');
        setTimeout(() => container.querySelector('.pin-dots')?.classList.remove('shake'), 380);
        if (n >= 5) {
          setLock(60000);
          setFails(0);
          toast('قفلنا الدخول دقيقة بعد 5 محاولات غلط', 'error');
          renderPin(user);
        } else {
          showError(`PIN غلط. باقي ${5 - n} محاولات.`);
        }
      } catch (e) {
        showError(e.message || 'حصل خطأ في التحقق');
      } finally {
        verifying = false;
        container.classList.remove('verifying');
      }
    };

    const press = (digit) => {
      if (verifying || pin.length >= 4) return;
      clearError();
      pin += digit;
      dots();
      if (pin.length === 4) setTimeout(submit, 90);
    };

    container.querySelectorAll('[data-digit]').forEach((btn) => {
      btn.addEventListener('click', () => press(btn.dataset.digit));
    });
    container.querySelector('[data-action="clear"]')?.addEventListener('click', () => {
      if (verifying) return;
      pin = '';
      dots();
      clearError();
    });
    container.querySelector('[data-action="backspace"]')?.addEventListener('click', () => {
      if (verifying) return;
      pin = pin.slice(0, -1);
      dots();
      clearError();
    });

    keyHandler = (e) => {
      if (!container.classList.contains('active')) return;
      const digit = normalizeDigits(e.key);
      if (/^\d$/.test(digit)) { e.preventDefault(); press(digit); }
      else if (e.key === 'Backspace') { e.preventDefault(); pin = pin.slice(0, -1); dots(); clearError(); }
      else if (e.key === 'Escape') { renderUsers(); }
    };
    document.addEventListener('keydown', keyHandler);
    dots();
  }

  async function handleTheme(e) {
    const btn = e.currentTarget;
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    btn.innerHTML = icon(next === 'dark' ? 'sun' : 'moon');
    try {
      const { setSetting } = await import('./db.js');
      await setSetting('theme', next, { silent: true });
    } catch (err) { /* ignore */ }
  }

  return (async () => {
    container.classList.add('active');
    container.hidden = false;
    container._cwSettings = {
      businessName: await getSetting('businessName'),
      logoDataUrl: await getSetting('logoDataUrl')
    };
    const users = await listUsers();
    container._cwUsers = users;
    if (!users.length) {
      container.innerHTML = `<div class="lock-card"><div class="lock-content">
        <h2 class="lock-title">مفيش مستخدمين</h2>
        <p class="muted">حصلت مشكلة في تهيئة البيانات. اقفل البرنامج وافتحه تاني.</p>
      </div></div>`;
      return;
    }
    renderUsers();
  })();
}
