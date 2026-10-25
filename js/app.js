import { initDB, getAllSettings, setSetting } from './db.js';
import { loadVersion, getCachedVersion, compareSemver } from './version.js';
import {
  esc, icon, toast, applyTheme, emptyState
} from './ui.js';
import {
  restoreSession, getCurrentUser, renderLockScreen, logout, isAdmin
} from './auth.js';
import {
  initNotifications, pendingCount, processOutbox, telegramConfigured, notifyEvent
} from './notifications.js';
import { renderCashier } from './cashier.js';
import { renderInvoices } from './invoices.js';
import { renderReports } from './reports.js';
import { renderExpenses } from './expenses.js';
import { renderCustomers } from './customers.js';
import { renderSettings } from './settings.js';
import { maybeBackupReminder } from './backup.js';

const ROUTES = {
  cashier: { title: 'الكاشير', icon: 'cart', render: renderCashier, adminOnly: false },
  invoices: { title: 'الفواتير', icon: 'receipt', render: renderInvoices, adminOnly: false },
  reports: { title: 'التقارير', icon: 'chart', render: renderReports, adminOnly: true },
  expenses: { title: 'المصاريف', icon: 'wallet', render: renderExpenses, adminOnly: true },
  customers: { title: 'العملاء والآجل', icon: 'users', render: renderCustomers, adminOnly: true },
  settings: { title: 'الإعدادات', icon: 'settings', render: renderSettings, adminOnly: true }
};

let currentCleanup = null;
let routeToken = 0;
let autoUpdateRan = false;
let whatsNewRan = false;
let settings = null;

const appShell = document.getElementById('app-shell');
const lockScreen = document.getElementById('lock-screen');
const bootScreen = document.getElementById('boot-screen');
const viewEl = document.getElementById('view');

function roleLabel(role) {
  return role === 'admin' ? 'مدير' : 'كاشير';
}

function initial(name) {
  const s = String(name || '؟').trim();
  return s ? s[0] : '؟';
}

function applyBrand() {
  if (!settings) return;
  const name = settings.businessName || 'مغسلة سيارات';
  document.getElementById('brand-name').textContent = name;
  const logo = document.getElementById('brand-logo');
  logo.innerHTML = settings.logoDataUrl
    ? `<img src="${esc(settings.logoDataUrl)}" alt="">`
    : icon('car', 24);
  document.title = `${name} — الكاشير`;
}

function updateUserUI() {
  const user = getCurrentUser();
  if (!user) return;
  const avatar = document.getElementById('user-avatar');
  avatar.textContent = initial(user.name);
  document.getElementById('user-name').textContent = user.name;
  document.getElementById('user-role').textContent = roleLabel(user.role);
}

function renderNav() {
  const user = getCurrentUser();
  if (!user) return;
  const nav = document.getElementById('main-nav');
  nav.innerHTML = Object.entries(ROUTES)
    .filter(([, def]) => !def.adminOnly || user.role === 'admin')
    .map(([key, def]) => `<a class="nav-link" href="#/${key}" data-nav="${key}">${icon(def.icon, 17)} ${esc(def.title)}</a>`)
    .join('');
}

function setActiveNav(route) {
  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === route);
  });
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  return { route: parts[0] || 'cashier', sub: parts.slice(1).join('/') };
}

function redirect(hash) {
  try { history.replaceState(null, '', hash); } catch (e) { location.hash = hash; }
}

function setBootError(err) {
  if (!bootScreen) return;
  bootScreen.hidden = false;
  bootScreen.innerHTML = `
    <div class="boot-logo" aria-hidden="true">${icon('info', 32)}</div>
    <h1>مش قادر أشغّل البرنامج</h1>
    <p class="boot-status">${esc(err?.message || String(err))}</p>
    <div class="boot-hint">
      اتأكد إنك فاتح <b dir="ltr">http://localhost:8080</b> وإن المتصفح مش في وضع خاص (Private).
      جرّب تقفل الصفحة وتشغّل <b>start.bat</b> تاني.
    </div>
    <div class="settings-actions" style="justify-content:center">
      <button class="btn btn-primary" type="button" onclick="location.reload()">${icon('refresh', 16)} جرّب تاني</button>
    </div>`;
}

async function navigate() {
  const user = getCurrentUser();
  if (!user) return;
  let { route, sub } = parseHash();
  const def = ROUTES[route];
  if (!def) {
    redirect('#/cashier');
    route = 'cashier';
    sub = '';
  } else if (def.adminOnly && user.role !== 'admin') {
    toast('القسم ده للمدير فقط', 'error');
    redirect('#/cashier');
    route = 'cashier';
    sub = '';
  }

  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (e) { /* ignore */ }
  }
  currentCleanup = null;
  const token = ++routeToken;

  setActiveNav(route);
  window.scrollTo(0, 0);
  viewEl.innerHTML = `<div class="empty"><span class="spinner"></span><span class="muted">بنجهز الصفحة…</span></div>`;

  try {
    settings = await getAllSettings();
    const cleanup = await ROUTES[route].render(viewEl, { sub, settings, user });
    if (token !== routeToken) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    currentCleanup = cleanup || null;
    if (user.role === 'admin' && route !== 'settings') {
      const banner = await maybeBackupReminder(user);
      if (banner && token === routeToken) viewEl.prepend(banner);
    }
    document.title = `${settings.businessName || 'مغسلة سيارات'} — ${ROUTES[route].title}`;
  } catch (err) {
    console.error(err);
    if (token !== routeToken) return;
    viewEl.innerHTML = emptyState('info', 'حصل خطأ في تحميل الصفحة', err?.message || String(err));
    toast('حصل خطأ — جرّب تحديث الصفحة', 'error');
    notifyErrorSafe(err, `route:${route}`);
  }
}

function notifyErrorSafe(err, context) {
  import('./notifications.js')
    .then(({ notifyError }) => notifyError(err?.message || String(err), context))
    .catch(() => {});
}

function setNetworkState() {
  const online = navigator.onLine;
  const bar = document.getElementById('offline-bar');
  if (bar) bar.hidden = online;
  const label = document.getElementById('net-label');
  if (label) label.textContent = online ? 'متصل' : 'بدون نت';
  if (online) processOutbox();
}

async function updateNotifyBadge() {
  const btn = document.getElementById('notify-btn');
  if (!btn) return;
  const user = getCurrentUser();
  const configured = settings && telegramConfigured(settings);
  btn.hidden = !(user?.role === 'admin' && configured);
  if (btn.hidden) return;
  try {
    const count = await pendingCount();
    btn.classList.toggle('has-pending', count > 0);
    btn.title = count ? `${count} إشعار مستني الإرسال` : 'إشعارات تليجرام';
  } catch (e) { /* ignore */ }
}

function setThemeButton() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  btn.innerHTML = icon(dark ? 'sun' : 'moon');
}

async function renderWhatsNewIfAny() {
  if (whatsNewRan) return;
  whatsNewRan = true;
  if (!isAdmin()) return;
  try {
    const mod = await import('./updater.js');
    await mod.maybeShowWhatsNew();
  } catch (e) { /* offline or unavailable */ }
}

async function autoUpdateIfNeeded() {
  if (autoUpdateRan) return;
  autoUpdateRan = true;
  if (!isAdmin()) return;
  if (!settings?.autoUpdateCheck) return;
  if (!navigator.onLine) return;
  try {
    const mod = await import('./updater.js');
    await mod.autoCheckForUpdates();
  } catch (e) { /* silent */ }
}

async function enterApp() {
  const user = getCurrentUser();
  if (!user) return;
  settings = await getAllSettings(true);
  applyTheme(settings.theme);
  applyBrand();
  updateUserUI();
  renderNav();
  setThemeButton();
  lockScreen.hidden = true;
  lockScreen.classList.remove('active');
  appShell.hidden = false;
  bootScreen.hidden = true;
  await navigate();
  updateNotifyBadge();
  renderWhatsNewIfAny();
  setTimeout(autoUpdateIfNeeded, 2200);
}

async function showLock() {
  appShell.hidden = true;
  bootScreen.hidden = true;
  lockScreen.hidden = false;
  lockScreen.innerHTML = '';
  await renderLockScreen({
    container: lockScreen,
    onLogin: () => enterApp()
  });
  document.title = `${settings?.businessName || 'مغسلة سيارات'} — الدخول`;
}

function closeUserMenu() {
  const menu = document.getElementById('user-dropdown');
  const chip = document.getElementById('user-chip');
  if (menu) menu.hidden = true;
  chip?.setAttribute('aria-expanded', 'false');
}

function bindHeader() {
  const themeBtn = document.getElementById('theme-btn');
  themeBtn.addEventListener('click', async () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setThemeButton();
    try {
      await setSetting('theme', next, { silent: true });
      if (settings) settings.theme = next;
    } catch (e) { /* ignore */ }
  });

  const userChip = document.getElementById('user-chip');
  const dropdown = document.getElementById('user-dropdown');
  userChip.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown.hidden;
    dropdown.hidden = !open;
    userChip.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.user-menu')) closeUserMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeUserMenu();
  });

  dropdown.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      closeUserMenu();
      const action = btn.dataset.action;
      if (action === 'settings') {
        if (isAdmin()) location.hash = '#/settings';
        else toast('الإعدادات للمدير فقط', 'error');
      } else if (action === 'lock') {
        await showLock();
      } else if (action === 'logout') {
        logout();
        await showLock();
      }
    });
  });

  document.getElementById('notify-btn').addEventListener('click', () => {
    if (isAdmin()) location.hash = '#/settings/notifications';
  });

  window.addEventListener('cw:notify', updateNotifyBadge);
  window.addEventListener('cw:settings', async () => {
    settings = await getAllSettings(true);
    applyTheme(settings.theme);
    applyBrand();
    setThemeButton();
    updateNotifyBadge();
  });
}

function bindNetwork() {
  window.addEventListener('online', () => {
    setNetworkState();
    toast('النت رجع — بنبعت الإشعارات المستنية', 'success');
    processSoonSafe();
  });
  window.addEventListener('offline', () => {
    setNetworkState();
    toast('مفيش نت — كل حاجة شغالة عادي', 'info');
  });
}

function processSoonSafe() {
  import('./notifications.js')
    .then(({ processSoon }) => processSoon())
    .catch(() => {});
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const host = location.hostname;
  if (!['localhost', '127.0.0.1'].includes(host)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}

async function trackInstalledVersion() {
  try {
    const current = getCachedVersion().version;
    const previous = String(settings.lastRunVersion || settings.lastSeenVersion || '');
    if (previous && compareSemver(current, previous) > 0) {
      await notifyEvent('update.installed', { version: current, previous });
    }
    if (previous !== current) {
      await setSetting('lastRunVersion', current, { silent: true });
      settings.lastRunVersion = current;
    }
  } catch (e) {
    console.warn('version tracking failed', e);
  }
}

async function boot() {
  try {
    await Promise.all([loadVersion(true), initDB()]);
    settings = await getAllSettings(true);
    applyTheme(settings.theme);
    applyBrand();
    document.getElementById('version-label').textContent = getCachedVersion().version;
    bindHeader();
    bindNetwork();
    initNotifications();
    await trackInstalledVersion();
    setNetworkState();
    updateNotifyBadge();
    const user = await restoreSession();
    if (user) await enterApp();
    else await showLock();
    window.addEventListener('hashchange', navigate);
    registerServiceWorker();
  } catch (err) {
    console.error(err);
    setBootError(err);
    notifyErrorSafe(err, 'boot');
  }
}

boot();
