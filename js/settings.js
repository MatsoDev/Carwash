import {
  db, getAllSettings, setSettings, listCategories, listServices,
  listSizes, listWorkers, listUsers, priceMatrix, setServicePrice, logAudit,
  resetInvoiceCounter
} from './db.js';
import {
  esc, icon, toast, fmtMoney, fmtDateTime, openModal, confirmDialog,
  promptDialog, onlyDigits, applyTheme, resizeImageFile,
  badge, emptyState, setBusy
} from './ui.js';
import {
  getCurrentUser, isAdmin, createUser, updateUser, deleteUser, changePin
} from './auth.js';
import * as escpos from './escpos.js';
import { testPrint } from './print.js';
import {
  NOTIFY_EVENTS, notifyEvent, sendTestMessage, detectChatIds,
  pendingNotifications, retryNotification, deleteNotification,
  clearSentNotifications, processOutbox
} from './notifications.js';
import { exportBackup, restoreBackupFile } from './backup.js';
import {
  checkForUpdates, showUpdateModal, showChangelog
} from './updater.js';

const TABS = [
  { id: 'business', label: 'بيانات المغسلة', icon: 'car' },
  { id: 'catalog', label: 'الخدمات والأسعار', icon: 'tag' },
  { id: 'workers', label: 'الموظفين', icon: 'users' },
  { id: 'users', label: 'المستخدمين', icon: 'key' },
  { id: 'printing', label: 'الطباعة', icon: 'print' },
  { id: 'notifications', label: 'الإشعارات', icon: 'bell' },
  { id: 'backup', label: 'النسخ الاحتياطي', icon: 'database' },
  { id: 'updates', label: 'التحديثات', icon: 'cloud' },
  { id: 'about', label: 'عن التطبيق', icon: 'info' }
];

const LEGACY_TABS = {
  services: 'catalog',
  prices: 'catalog',
  telegram: 'notifications',
  update: 'updates',
  users: 'users'
};

const ROLE_LABELS = { admin: 'مدير', cashier: 'كاشير' };

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function roundPrice(n) {
  return Math.round(Number(n) * 100) / 100;
}

function parsePrice(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) throw new Error('السعر لازم يكون رقم موجب');
  return roundPrice(n);
}

function switchRow({ title, hint = '', key, checked, attrs = '' }) {
  return `<div class="setting-row">
    <div class="setting-text"><strong>${esc(title)}</strong>${hint ? `<small>${esc(hint)}</small>` : ''}</div>
    <div class="setting-control">
      <label class="switch"><input type="checkbox" data-setting="${esc(key)}" ${checked ? 'checked' : ''} ${attrs}><span></span></label>
    </div>
  </div>`;
}

export async function renderSettings(container, options = {}) {
  const user = getCurrentUser();
  if (!isAdmin()) {
    container.innerHTML = emptyState('lock', 'الإعدادات للمدير فقط', 'سجل دخول بحساب مدير.');
    return;
  }

  let settings = await getAllSettings(true);
  let categories = await listCategories();
  let services = await listServices();
  let sizes = await listSizes();
  let workers = await listWorkers();
  let users = await listUsers();
  let matrix = await priceMatrix();
  let selectedCategoryId = categories[0]?.id ?? null;
  let logoTemp = settings.logoDataUrl || '';

  const initialRaw = String(options.sub || '').split('/')[0];
  const initialTab = TABS.some((t) => t.id === initialRaw)
    ? initialRaw
    : (LEGACY_TABS[initialRaw] || 'business');

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>الإعدادات</h1>
        <p>كل حاجة في المغسلة تحت إيدك — من الأسعار لحد النسخ الاحتياطي.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-sm btn-ghost" href="#/cashier">${icon('cart', 16)} رجوع للكاشير</a>
      </div>
    </div>

    <div class="settings-layout">
      <nav class="settings-nav" id="settings-nav" aria-label="أقسام الإعدادات">
        ${TABS.map((t) => `<button type="button" data-tab="${t.id}">${icon(t.icon, 17)} ${esc(t.label)}</button>`).join('')}
      </nav>
      <div class="settings-content" id="settings-content">

        <section class="settings-section" data-section="business">
          <div class="panel settings-card">
            <h2>بيانات المغسلة</h2>
            <p class="hint">الاسم واللوجو والتليفون بيظهروا في الفاتورة وشاشة الدخول.</p>
            <form id="business-form" autocomplete="off">
              <div class="field-grid">
                <label class="field"><span>اسم المغسلة</span>
                  <input id="s-business-name" type="text" maxlength="60" value="${esc(settings.businessName)}" required>
                </label>
                <label class="field"><span>تليفون المغسلة</span>
                  <input id="s-business-phone" type="tel" maxlength="20" value="${esc(settings.businessPhone)}" placeholder="01000000000">
                </label>
                <label class="field"><span>واتساب صاحب المغسلة</span>
                  <input id="s-owner-phone" type="tel" maxlength="20" value="${esc(settings.ownerPhone)}" placeholder="01000000000">
                  <small class="muted">الرقم اللي هيتبعتله ملخص الفاتورة كرابط واتساب يدوي.</small>
                </label>
              </div>
              <label class="field" style="margin-top:12px"><span>العنوان</span>
                <input id="s-business-address" type="text" maxlength="120" value="${esc(settings.businessAddress)}">
              </label>
              <label class="field" style="margin-top:12px"><span>تذييل الفاتورة</span>
                <input id="s-receipt-footer" type="text" maxlength="100" value="${esc(settings.receiptFooter)}">
              </label>
              <div class="row" style="margin-top:16px;align-items:flex-start;gap:18px">
                <div class="logo-preview" id="logo-preview">
                  ${logoTemp ? `<img src="${esc(logoTemp)}" alt="">` : icon('image', 28)}
                </div>
                <div class="field" style="flex:1;min-width:200px">
                  <span>لوجو المغسلة</span>
                  <div class="row">
                    <label class="btn btn-sm btn-secondary" style="cursor:pointer">
                      ${icon('upload', 15)} اختار صورة
                      <input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
                    </label>
                    <button class="btn btn-sm btn-ghost" type="button" id="remove-logo">${icon('trash', 15)} شيل اللوجو</button>
                  </div>
                  <small>PNG أو JPG — يتم تصغيرها تلقائيًا.</small>
                </div>
              </div>
              <div class="field-grid" style="margin-top:16px">
                <label class="field"><span>الوضع</span>
                  <select id="s-theme">
                    <option value="auto" ${settings.theme === 'auto' ? 'selected' : ''}>تلقائي حسب النظام</option>
                    <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>نهاري</option>
                    <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>ليلي</option>
                  </select>
                </label>
              </div>
              <div class="settings-actions">
                <button class="btn btn-primary" type="submit" id="save-business">${icon('save', 17)} حفظ البيانات</button>
              </div>
            </form>
          </div>
        </section>

        <section class="settings-section" data-section="catalog">
          <div class="panel settings-card" id="catalog-body"></div>
        </section>

        <section class="settings-section" data-section="workers">
          <div class="panel settings-card" id="workers-body"></div>
        </section>

        <section class="settings-section" data-section="users">
          <div class="panel settings-card" id="users-body"></div>
        </section>

        <section class="settings-section" data-section="printing">
          <div class="panel settings-card">
            <h2>الطباعة</h2>
            <p class="hint">اختار مقاس الورق وطريقة الطباعة. المعاينة بتظهر قبل الطباعة لو فعّلتها.</p>
            <form id="printing-form">
              <div class="field-grid">
                <label class="field"><span>مقاس الورق</span>
                  <select id="s-paper">
                    <option value="80" ${String(settings.paperWidth) === '80' ? 'selected' : ''}>80 مم</option>
                    <option value="58" ${String(settings.paperWidth) === '58' ? 'selected' : ''}>58 مم</option>
                  </select>
                </label>
                <label class="field"><span>طريقة الطباعة</span>
                  <select id="s-receipt-mode">
                    <option value="browser" ${settings.receiptMode === 'browser' ? 'selected' : ''}>طباعة المتصفح (موصى بها)</option>
                    <option value="escpos" ${settings.receiptMode === 'escpos' ? 'selected' : ''}>ESC/POS مباشر (تجريبي)</option>
                  </select>
                </label>
                <label class="field"><span>ESC/POS Baud Rate</span>
                  <select id="s-baud">
                    ${[9600, 19200, 38400, 57600, 115200].map((b) => `<option value="${b}" ${Number(settings.escposBaud) === b ? 'selected' : ''}>${b}</option>`).join('')}
                  </select>
                </label>
              </div>
              <div class="settings-group">
                ${switchRow({ title: 'معاينة قبل الطباعة', hint: 'تفتح نافذة فيها الفاتورة قبل ما تتبعت للطابعة.', key: 'printPreview', checked: settings.printPreview })}
                ${switchRow({ title: 'طباعة تلقائية بعد الحفظ', hint: 'لو المعاينة مقفولة، الفاتورة بتطبع على طول.', key: 'autoPrint', checked: settings.autoPrint })}
                ${switchRow({ title: 'QR على الفاتورة', hint: 'كود QR محلي فيه بيانات الفاتورة.', key: 'showQr', checked: settings.showQr })}
                ${switchRow({ title: 'إظهار إصدار التطبيق', hint: 'رقم النسخة أسفل الفاتورة.', key: 'showAppVersion', checked: settings.showAppVersion })}
                ${switchRow({ title: 'إخفاء تليفون العميل', hint: 'مفيد لو الفاتورة بتتسلم للعميل ومش عايز الرقم يظهر.', key: 'hideCustomerPhone', checked: settings.hideCustomerPhone })}
                ${switchRow({ title: 'إخفاء الإجمالي لو مفيش أسعار', hint: 'لو الخدمات من غير سعر، متطبعش إجمالي صفر.', key: 'hideUnpricedTotals', checked: settings.hideUnpricedTotals })}
              </div>
              <div class="settings-actions">
                <button class="btn btn-primary" type="submit" id="save-printing">${icon('save', 17)} حفظ إعدادات الطباعة</button>
                <button class="btn btn-secondary" type="button" id="test-print">${icon('print', 17)} طباعة تجريبية</button>
              </div>
            </form>
          </div>
          <div class="panel settings-card" style="margin-top:14px">
            <h2>طباعة ESC/POS مباشرة</h2>
            <p class="hint">اختياري — Web Serial أو Web Bluetooth (Chrome / Edge). الفاتورة بتتحول لصورة عشان العربي يطلع صح.</p>
            <div id="escpos-status"></div>
          </div>
        </section>

        <section class="settings-section" data-section="notifications">
          <div class="panel settings-card">
            <h2>إشعارات تليجرام</h2>
            <p class="hint">بعت ملخص الفواتير والإلغاءات والمصاريف على تليجرام. لو مش عايز تعرّض التوكن على الجهاز، استخدم Cloudflare Worker.</p>
            <div class="help-card">
              <h4>خطوات سريعة</h4>
              <ol>
                <li>اعمل بوت من <code>@BotFather</code> وهات الـ Token.</li>
                <li>افتح محادثة البوت وابعتله <code>/start</code> من كل حساب أو جروب عايز الإشعارات توصله.</li>
                <li>بعد كده دوس "اكتشف Chat ID" — لو لقى أكثر من محادثة راجعها واحفظ الصح.</li>
                <li>استخدم Cloudflare Worker لو مش عايز التوكن يتحفظ على الجهاز.</li>
              </ol>
              <p class="small muted" style="margin:8px 0 0">التوكن بيتخزن محليًا في المتصفح فقط. متحطوش في صورة أو نسخة احتياطية تتبعت لحد، ويفضل استخدام Proxy على الأجهزة المشتركة.</p>
              <a href="docs/telegram-setup-ar.md" target="_blank" rel="noopener">دليل الإعداد بالتفصيل</a>
            </div>
            <form id="notify-form" autocomplete="off" style="margin-top:14px">
              <label class="field"><span>Bot Token</span>
                <div class="token-field">
                  <input id="s-tg-token" type="password" dir="ltr" value="${esc(settings.telegramToken)}" placeholder="123456:ABC...">
                  <button class="icon-btn sm" type="button" id="toggle-token" aria-label="إظهار التوكن">${icon('eye', 16)}</button>
                </div>
              </label>
              <label class="field" style="margin-top:10px"><span>Chat IDs <small class="muted">(مفصولة بفاصلة أو مسافة — كل محادثة بتاخد الرسالة مرة)</small></span>
                <input id="s-tg-chats" type="text" dir="ltr" value="${esc(settings.telegramChatIds)}" placeholder="123456789, -100123456">
              </label>
              <div class="field-grid" style="margin-top:10px">
                <label class="field"><span>Cloudflare Worker URL</span>
                  <input id="s-tg-proxy" type="url" dir="ltr" value="${esc(settings.telegramProxyUrl)}" placeholder="https://...workers.dev">
                </label>
                <label class="field"><span>Proxy Secret</span>
                  <input id="s-tg-secret" type="password" dir="ltr" value="${esc(settings.telegramProxySecret)}" placeholder="اختياري">
                </label>
                <label class="field"><span>مستوى التفاصيل</span>
                  <select id="s-privacy">
                    <option value="summary" ${settings.privacyLevel === 'summary' ? 'selected' : ''}>ملخص (بدون تفاصيل العملاء)</option>
                    <option value="detailed" ${settings.privacyLevel === 'detailed' ? 'selected' : ''}>تفصيلي (يشمل التليفون)</option>
                  </select>
                </label>
              </div>
              <div class="settings-actions">
                <button class="btn btn-primary" type="submit" id="save-notify">${icon('save', 17)} حفظ</button>
                <button class="btn btn-secondary" type="button" id="detect-chats">${icon('search', 17)} اكتشف Chat ID</button>
                <button class="btn btn-secondary" type="button" id="test-telegram">${icon('send', 17)} رسالة تجريبية</button>
              </div>
            </form>
            <div class="settings-group">
              <h3 style="font-size:.9rem">إشعارات تتبعت إمتى؟</h3>
              ${NOTIFY_EVENTS.map((ev) => switchRow({
                title: ev.label,
                hint: ev.hint,
                key: ev.key,
                checked: Boolean(settings[ev.key])
              })).join('')}
              <div class="setting-row">
                <div class="setting-text"><strong>حد "الخصم الكبير"</strong><small>النسبة المئوية اللي لو الخصم عدّاها يتبعت إشعار.</small></div>
                <div class="setting-control" style="width:100px">
                  <input id="s-discount-threshold" class="input" type="number" min="0" max="100" step="any" value="${esc(settings.discountThreshold)}">
                </div>
              </div>
              <div class="settings-actions">
                <button class="btn btn-primary" type="button" id="save-notify-toggles">${icon('save', 17)} حفظ الإشعارات</button>
              </div>
            </div>
            <div class="settings-group">
              <div class="row" style="justify-content:space-between">
                <h3 style="font-size:.9rem;margin:0">قائمة الإرسال</h3>
                <div class="row">
                  <button class="btn btn-sm btn-ghost" type="button" id="process-queue">${icon('send', 15)} إرسال الكل</button>
                  <button class="btn btn-sm btn-ghost" type="button" id="clear-sent">${icon('trash', 15)} مسح المُرسل</button>
                </div>
              </div>
              <div id="pending-body" style="margin-top:10px"></div>
            </div>
          </div>
        </section>

        <section class="settings-section" data-section="backup">
          <div class="panel settings-card">
            <h2>النسخ الاحتياطي</h2>
            <p class="hint">نسخة JSON فيها كل البيانات. خزنها على فلاشة أو جوجل درايف — الاستعادة بترجع كل حاجة.</p>
            <div class="about-list" style="margin-bottom:14px">
              <div><span>آخر نسخة احتياطية</span><b id="last-backup">${settings.lastBackupAt ? esc(fmtDateTime(settings.lastBackupAt)) : 'لسه مفيش'}</b></div>
              <div><span>حجم البيانات</span><b id="storage-size">—</b></div>
            </div>
            <div class="settings-actions">
              <button class="btn btn-primary" type="button" id="quick-backup">${icon('download', 17)} نزّل نسخة احتياطية</button>
              <label class="btn btn-secondary" style="cursor:pointer">
                ${icon('upload', 17)} استعادة من ملف
                <input id="restore-file" type="file" accept="application/json,.json" hidden>
              </label>
            </div>
            <div class="settings-group">
              ${switchRow({ title: 'تنبيه نسخة احتياطية يومي', hint: 'بنبّهك في أول فتح للتطبيق لو عدّى 24 ساعة من غير نسخة.', key: 'dailyBackupReminder', checked: settings.dailyBackupReminder })}
              <div class="settings-actions">
                <button class="btn btn-sm btn-secondary" type="button" id="save-backup-settings">${icon('save', 15)} حفظ الإعداد</button>
              </div>
            </div>
            <div class="danger-zone" style="margin-top:16px">
              <h3>إعادة ترقيم الفواتير</h3>
              <p class="small muted">بيأثر على الفواتير الجديدة فقط. الفواتير القديمة بتحتفظ بأرقامها.</p>
              <button class="btn btn-sm btn-danger" type="button" id="reset-counter">${icon('refresh', 15)} إعادة ضبط العداد</button>
            </div>
          </div>
        </section>

        <section class="settings-section" data-section="updates">
          <div class="panel settings-card">
            <div class="update-box">
              <div class="update-icon">${icon('cloud', 30)}</div>
              <h2>التحديثات</h2>
              <p class="muted small">النسخة الحالية <b id="upd-current"></b></p>
              <p class="hint">التحديث بينزل من GitHub. بياناتك مش بتتمسح — خد نسخة احتياطية قبل أي تحديث مهم.</p>
              <button class="btn btn-primary" type="button" id="check-updates">${icon('refresh', 17)} افحص التحديثات</button>
              <div class="update-result" id="update-result"></div>
            </div>
            <div class="settings-group">
              ${switchRow({ title: 'فحص تلقائي عند فتح البرنامج', hint: 'بيتم الفحص في الخلفية مرة واحدة كل تشغيل.', key: 'autoUpdateCheck', checked: settings.autoUpdateCheck })}
              <div class="settings-actions">
                <button class="btn btn-sm btn-secondary" type="button" id="save-update-settings">${icon('save', 15)} حفظ الإعداد</button>
                <button class="btn btn-sm btn-ghost" type="button" id="show-current-changelog">${icon('info', 15)} جديد النسخة الحالية</button>
              </div>
            </div>
            <div class="help-card">
              <h4>طريقة التحديث على ويندوز</h4>
              <div class="update-steps">
                <div class="update-step">اقفل البرنامج من شريط المهام.</div>
                <div class="update-step">شغّل <code>update.bat</code> — بينزّل آخر إصدار ويحتفظ بنسخة من بياناتك.</div>
                <div class="update-step">شغّل <code>start.bat</code> وافتح <code dir="ltr">http://localhost:8080</code>.</div>
              </div>
              <a href="https://github.com/MatsoDev/Carwash" target="_blank" rel="noopener">صفحة المشروع على GitHub</a>
            </div>
          </div>
        </section>

        <section class="settings-section" data-section="about">
          <div class="panel settings-card">
            <div class="about-hero">
              <div class="brand-logo">${settings.logoDataUrl ? `<img src="${esc(settings.logoDataUrl)}" alt="">` : icon('car', 30)}</div>
              <div>
                <h2 style="margin:0">${esc(settings.businessName || 'مغسلة سيارات')}</h2>
                <p class="muted small" style="margin:0">نظام كاشير محلي — نسخة <b id="about-version"></b></p>
              </div>
            </div>
            <div class="about-list">
              <div><span>التطبيق</span><b>Carwash POS</b></div>
              <div><span>البيانات</span><b>IndexedDB على الجهاز</b></div>
              <div><span>الطباعة</span><b>58 / 80 مم + ESC/POS اختياري</b></div>
              <div><span>الإنترنت</span><b>اختياري (تحديثات + تليجرام فقط)</b></div>
            </div>
            <p class="hint" style="margin-top:14px">صفحات مساعدة: <a href="README.md" target="_blank" rel="noopener">الدليل الكامل</a> —
              <a href="docs/telegram-setup-ar.md" target="_blank" rel="noopener">إعداد تليجرام</a> —
              <a href="docs/cloudflare-worker.js" target="_blank" rel="noopener">كود Worker</a></p>
            <div class="help-card">
              <h4>أمان مهم</h4>
              <p style="margin:0">غيّر PIN المدير الافتراضي فورًا. لو استخدمت Telegram Token مباشرة، أي حد على الجهاز يقدر يشوفه — الأفضل تستخدم Proxy.</p>
            </div>
          </div>
        </section>

      </div>
    </div>
  `;

  const content = container.querySelector('#settings-content');
  const nav = container.querySelector('#settings-nav');
  const el = (sel) => container.querySelector(sel);

  async function saveEntries(entries, message = 'اتحفظ') {
    await setSettings(entries);
    settings = await getAllSettings(true);
    if ('theme' in entries) applyTheme(entries.theme);
    toast(message, 'success');
  }

  function switchTab(tab, updateHash = true) {
    const target = TABS.some((t) => t.id === tab) ? tab : 'business';
    nav.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === target);
    });
    content.querySelectorAll('[data-section]').forEach((sec) => {
      sec.classList.toggle('active', sec.dataset.section === target);
    });
    if (updateHash) {
      try { history.replaceState(null, '', `#/settings/${target}`); } catch (e) { /* ignore */ }
    }
    if (target === 'catalog') renderCatalog();
    if (target === 'workers') renderWorkers();
    if (target === 'users') renderUsers();
    if (target === 'printing') renderEscpos();
    if (target === 'notifications') {
      renderPending();
      loadStorage();
    }
    if (target === 'backup') loadStorage();
    if (target === 'updates') loadVersionLabels();
  }

  nav.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* ---------------- Business ---------------- */
  const logoPreview = el('#logo-preview');
  el('#logo-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('اختار صورة صحيحة', 'error'); return; }
    try {
      logoTemp = await resizeImageFile(file, 420);
      logoPreview.innerHTML = `<img src="${esc(logoTemp)}" alt="">`;
      toast('الصورة جاهزة — دوس حفظ', 'info');
    } catch (err) {
      toast('مش قادر أقرأ الصورة', 'error');
    }
  });
  el('#remove-logo').addEventListener('click', () => {
    logoTemp = '';
    logoPreview.innerHTML = icon('image', 28);
    toast('اللوجو هيتشال بعد الحفظ', 'info');
  });
  el('#business-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('#s-business-name').value.trim();
    if (!name) { toast('اسم المغسلة مطلوب', 'error'); el('#s-business-name').focus(); return; }
    const btn = el('#save-business');
    setBusy(btn, true, 'بنحفظ…');
    try {
      await saveEntries({
        businessName: name,
        businessPhone: el('#s-business-phone').value.trim(),
        ownerPhone: onlyDigits(el('#s-owner-phone').value),
        businessAddress: el('#s-business-address').value.trim(),
        receiptFooter: el('#s-receipt-footer').value.trim(),
        logoDataUrl: logoTemp,
        theme: el('#s-theme').value
      });
      const brand = document.getElementById('brand-name');
      if (brand) brand.textContent = name;
    } catch (err) {
      toast(err.message || 'مش قادر أحفظ', 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  /* ---------------- Catalog ---------------- */
  function selectedCategory() {
    return categories.find((c) => c.id === selectedCategoryId) || categories[0] || null;
  }

  function categoryServices() {
    return services
      .filter((s) => s.categoryId === selectedCategoryId)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || a.id - b.id);
  }

  function catalogBodyHTML() {
    const cat = selectedCategory();
    const list = categoryServices();
    const perSize = Boolean(settings.perSizePricing);
    const priceInput = (svc, size) => {
      const key = size ? `${svc.id}:${size.id}` : '';
      const value = size ? (matrix.get(key) ?? '') : (svc.price ?? '');
      return `<input type="number" min="0" step="any" inputmode="decimal"
        data-price="${svc.id}" ${size ? `data-size="${size.id}"` : ''} value="${value === null ? '' : esc(value)}"
        placeholder="بدون">`;
    };
    return `
      <h2>الخدمات والأسعار</h2>
      <p class="hint">الأسعار اختيارية تمامًا. سيب الخانة فاضية لو الخدمة بدون سعر، والمبلغ مش هيظهر في الفاتورة.</p>
      <div class="settings-group">
        ${switchRow({ title: 'تفعيل الأسعار', hint: 'لو مقفولة، الكاشير والتقارير بيشتغلوا بالعدد فقط.', key: 'pricingEnabled', checked: settings.pricingEnabled, attrs: 'data-immediate="1"' })}
        ${switchRow({ title: 'السماح للكاشير بتعديل السعر', hint: 'بيظهر مربع سعر في السلة. استخدمه بحرص.', key: 'allowCashierPrice', checked: settings.allowCashierPrice, attrs: 'data-immediate="1"' })}
        ${switchRow({ title: 'أسعار حسب حجم العربية', hint: 'كل خدمة يبقى لها سعر مختلف لكل حجم (صغيرة/ملاكي/ربع نقل/ميكروباص).', key: 'perSizePricing', checked: settings.perSizePricing, attrs: 'data-immediate="1"' })}
      </div>
      <div class="settings-group">
        <div class="category-manager">
          ${categories.map((c) => `<button class="category-chip ${c.id === selectedCategoryId ? 'active' : ''}" type="button" data-cat="${c.id}">${esc(c.icon || '🚗')} ${esc(c.name)}</button>`).join('')}
          <button class="category-chip" type="button" id="add-category">${icon('plus', 14)} قسم</button>
        </div>
        <div class="row" style="justify-content:space-between;margin-bottom:10px">
          <div class="small muted">${cat ? `خدمات قسم ${esc(cat.name)} — ${list.length}` : 'اختار قسم'}</div>
          <button class="btn btn-sm btn-primary" type="button" id="add-service" ${cat ? '' : 'disabled'}>${icon('plus', 15)} خدمة جديدة</button>
        </div>
        <div class="bulk-price">
          <label class="field"><span>سعر جماعي للقسم</span>
            <input id="bulk-price-value" type="number" min="0" step="any" placeholder="مثال: 50">
          </label>
          <button class="btn btn-sm btn-secondary" type="button" id="apply-bulk-price">${icon('tag', 15)} طبّق على ${list.length} خدمة</button>
          <small class="muted">بيغيّر السعر الأساسي فقط — أسعار الأحجام لو مفعّلة بتفضل زي ما هي.</small>
        </div>
        <div class="table-wrap">
          <table class="data price-table">
            <thead><tr>
              <th>الخدمة</th>
              <th>السعر${perSize ? ' الأساسي' : ''}</th>
              ${perSize ? sizes.map((s) => `<th>${esc(s.name)}</th>`).join('') : ''}
              <th>مفعّلة</th>
              <th>ترتيب</th>
            </tr></thead>
            <tbody>
              ${list.length ? list.map((svc, idx) => `
                <tr class="${svc.active ? '' : 'inactive-row'}">
                  <td style="min-width:190px"><input type="text" data-name="${svc.id}" value="${esc(svc.name)}" maxlength="80"></td>
                  <td>${priceInput(svc, null)}</td>
                  ${perSize ? sizes.map((s) => `<td>${priceInput(svc, s)}</td>`).join('') : ''}
                  <td><label class="switch"><input type="checkbox" data-active="${svc.id}" ${svc.active ? 'checked' : ''}><span></span></label></td>
                  <td>
                    <div class="order-btns">
                      <button class="icon-btn" type="button" data-move="${svc.id}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} aria-label="لأعلى">${icon('up', 13)}</button>
                      <button class="icon-btn" type="button" data-move="${svc.id}" data-dir="1" ${idx === list.length - 1 ? 'disabled' : ''} aria-label="لأسفل">${icon('down', 13)}</button>
                    </div>
                  </td>
                </tr>`).join('') : `<tr><td colspan="${4 + (perSize ? sizes.length : 0)}">${emptyState('tag', 'مفيش خدمات', 'ضيف خدمة جديدة من فوق.')}</td></tr>`}
            </tbody>
          </table>
        </div>
        <p class="small muted" style="margin-top:8px">أي تعديل سعر بيتسجل في سجل التغييرات وبيتبعت إشعار لو إشعارات الأسعار مفعّلة.</p>
      </div>`;
  }

  async function renderCatalog() {
    const body = el('#catalog-body');
    if (!body) return;
    body.innerHTML = catalogBodyHTML();
    bindCatalog();
  }

  function bindCatalog() {
    const body = el('#catalog-body');

    body.querySelectorAll('[data-immediate]').forEach((input) => {
      input.addEventListener('change', async () => {
        const key = input.dataset.setting;
        const value = input.checked;
        try {
          await setSettings({ [key]: value });
          settings = await getAllSettings(true);
          toast('اتحفظ', 'success', 1400);
          renderCatalog();
        } catch (e) {
          toast(e.message || 'مش قادر أحفظ', 'error');
          input.checked = !value;
        }
      });
    });

    body.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedCategoryId = Number(btn.dataset.cat);
        renderCatalog();
      });
    });

    body.querySelector('#add-category')?.addEventListener('click', async () => {
      const name = await promptDialog('اسم القسم الجديد', { title: 'قسم جديد', placeholder: 'مثال: خدمة خارجية' });
      if (!name) return;
      const maxOrder = categories.reduce((m, c) => Math.max(m, Number(c.order) || 0), 0);
      const id = await db.categories.add({ name, icon: '🚗', order: maxOrder + 1 });
      categories = await listCategories();
      selectedCategoryId = id;
      toast('القسم اتضاف', 'success');
      renderCatalog();
    });

    body.querySelector('#add-service')?.addEventListener('click', async () => {
      if (!selectedCategoryId) return;
      const name = await promptDialog('اسم الخدمة الجديدة', { title: 'خدمة جديدة', placeholder: 'مثال: غسيل موتور' });
      if (!name) return;
      const list = categoryServices();
      const maxOrder = list.reduce((m, s) => Math.max(m, Number(s.order) || 0), 0);
      await db.services.add({
        categoryId: selectedCategoryId,
        name,
        price: null,
        active: true,
        order: maxOrder + 1
      });
      services = await listServices();
      toast('الخدمة اتضافت', 'success');
      renderCatalog();
    });

    body.querySelector('#apply-bulk-price')?.addEventListener('click', async () => {
      const input = body.querySelector('#bulk-price-value');
      let price;
      try { price = parsePrice(input.value); } catch (e) { toast(e.message, 'error'); return; }
      if (price == null) { toast('اكتب السعر الأول', 'error'); input.focus(); return; }
      const list = categoryServices();
      if (!list.length) return;
      const cat = selectedCategory();
      if (!await confirmDialog(`تحط سعر ${fmtMoney(price)} على ${list.length} خدمة في قسم ${cat?.name}؟`, { title: 'سعر جماعي', confirmLabel: 'طبّق' })) return;
      for (const svc of list) {
        await setServicePrice(svc.id, null, price);
        svc.price = price;
      }
      await logAudit('price.bulk', { categoryId: selectedCategoryId, price, count: list.length }, user);
      notifyEvent('price.change', {
        categoryName: cat?.name,
        count: list.length,
        newPrice: price,
        by: user?.name
      });
      toast('السعر الجماعي اتطبق', 'success');
      renderCatalog();
    });

    body.querySelectorAll('[data-price]').forEach((input) => {
      input.addEventListener('change', async () => {
        const svc = services.find((s) => s.id === Number(input.dataset.price));
        if (!svc) return;
        const size = input.dataset.size ? sizes.find((s) => s.id === Number(input.dataset.size)) : null;
        let value;
        try { value = parsePrice(input.value); } catch (e) {
          toast(e.message, 'error');
          input.value = size ? (matrix.get(`${svc.id}:${size.id}`) ?? '') : (svc.price ?? '');
          return;
        }
        const oldPrice = size ? (matrix.get(`${svc.id}:${size.id}`) ?? null) : (svc.price ?? null);
        if (oldPrice === value) return;
        try {
          await setServicePrice(svc.id, size ? size.id : null, value);
          if (size) {
            if (value == null) matrix.delete(`${svc.id}:${size.id}`);
            else matrix.set(`${svc.id}:${size.id}`, value);
          } else {
            svc.price = value;
          }
          const label = svc.name + (size ? ` (${size.name})` : '');
          await logAudit('price.change', {
            serviceId: svc.id, sizeId: size?.id ?? null, serviceName: label, oldPrice, newPrice: value
          }, user);
          notifyEvent('price.change', { serviceName: label, oldPrice, newPrice: value, by: user?.name });
          toast('السعر اتحدث', 'success', 1400);
        } catch (e) {
          toast(e.message || 'مش قادر أحفظ السعر', 'error');
        }
      });
    });

    body.querySelectorAll('[data-name]').forEach((input) => {
      input.addEventListener('change', async () => {
        const svc = services.find((s) => s.id === Number(input.dataset.name));
        if (!svc) return;
        const name = input.value.trim();
        if (!name) { input.value = svc.name; toast('اسم الخدمة مطلوب', 'error'); return; }
        try {
          await db.services.update(svc.id, { name });
          svc.name = name;
          toast('اسم الخدمة اتحدث', 'success', 1300);
        } catch (e) {
          toast(e.message || 'مش قادر أحفظ', 'error');
        }
      });
    });

    body.querySelectorAll('[data-active]').forEach((input) => {
      input.addEventListener('change', async () => {
        const svc = services.find((s) => s.id === Number(input.dataset.active));
        if (!svc) return;
        try {
          await db.services.update(svc.id, { active: input.checked });
          svc.active = input.checked;
          input.closest('tr')?.classList.toggle('inactive-row', !input.checked);
          toast(input.checked ? 'الخدمة اتفعّلت' : 'الخدمة اتوقفت', 'success', 1200);
        } catch (e) {
          toast(e.message || 'مش قادر أحفظ', 'error');
          input.checked = !input.checked;
        }
      });
    });

    body.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const list = categoryServices();
        const idx = list.findIndex((s) => s.id === Number(btn.dataset.move));
        const target = idx + Number(btn.dataset.dir);
        if (idx < 0 || target < 0 || target >= list.length) return;
        const a = list[idx];
        const b = list[target];
        const ao = Number(a.order) || idx + 1;
        const bo = Number(b.order) || target + 1;
        await db.transaction('rw', db.services, async () => {
          await db.services.update(a.id, { order: bo });
          await db.services.update(b.id, { order: ao });
        });
        services = await listServices();
        renderCatalog();
      });
    });
  }

  /* ---------------- Workers ---------------- */
  async function renderWorkers() {
    workers = await listWorkers();
    const body = el('#workers-body');
    if (!body) return;
    body.innerHTML = `
      <h2>الموظفين</h2>
      <p class="hint">اختار الموظف في الفاتورة عشان تعرف مين عمل إيه في التقارير.</p>
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <span class="small muted">${workers.length} موظف</span>
        <button class="btn btn-sm btn-primary" type="button" id="add-worker">${icon('plus', 15)} موظف جديد</button>
      </div>
      <div class="table-wrap">
        <table class="data" style="min-width:440px">
          <thead><tr><th>الاسم</th><th></th></tr></thead>
          <tbody>
            ${workers.length ? workers.map((w) => `
              <tr>
                <td><b>${esc(w.name)}</b></td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-sm btn-ghost" type="button" data-edit-worker="${w.id}">${icon('edit', 14)} تعديل</button>
                    <button class="btn btn-sm btn-ghost" type="button" data-del-worker="${w.id}">${icon('trash', 14)} حذف</button>
                  </div>
                </td>
              </tr>`).join('') : `<tr><td colspan="2">${emptyState('users', 'مفيش موظفين', 'ضيف أسماء العاملين عشان التقارير تبقى أدق.')}</td></tr>`}
          </tbody>
        </table>
      </div>`;

    body.querySelector('#add-worker')?.addEventListener('click', async () => {
      const name = await promptDialog('اسم الموظف', { title: 'موظف جديد', placeholder: 'مثال: أحمد' });
      if (!name) return;
      await db.workers.add({ name });
      toast('الموظف اتضاف', 'success');
      renderWorkers();
    });

    body.querySelectorAll('[data-edit-worker]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const worker = workers.find((w) => w.id === Number(btn.dataset.editWorker));
        if (!worker) return;
        const name = await promptDialog('اسم الموظف', { title: 'تعديل موظف', value: worker.name });
        if (!name || name === worker.name) return;
        await db.workers.update(worker.id, { name });
        toast('الاسم اتحدث', 'success');
        renderWorkers();
      });
    });

    body.querySelectorAll('[data-del-worker]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const worker = workers.find((w) => w.id === Number(btn.dataset.delWorker));
        if (!worker) return;
        if (!await confirmDialog(`تحذف الموظف "${worker.name}"؟ الفواتير القديمة مش هتتأثر.`, {
          title: 'حذف موظف', confirmLabel: 'احذف', danger: true
        })) return;
        await db.workers.delete(worker.id);
        toast('الموظف اتحذف', 'success');
        renderWorkers();
      });
    });
  }

  /* ---------------- Users ---------------- */
  async function renderUsers() {
    users = await listUsers();
    const me = getCurrentUser();
    const body = el('#users-body');
    if (!body) return;
    body.innerHTML = `
      <h2>المستخدمين والصلاحيات</h2>
      <p class="hint">المدير بيشوف كل حاجة. الكاشير بيشوف الكاشير والفواتير فقط.</p>
      <div class="help-card" style="margin-bottom:12px">
        <h4>مهم</h4>
        غير PIN المدير الافتراضي (1234) والكاشير (1111) لو لسه مستخدمهم.
      </div>
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <span class="small muted">${users.length} مستخدم</span>
        <button class="btn btn-sm btn-primary" type="button" id="add-user">${icon('plus', 15)} مستخدم جديد</button>
      </div>
      <div class="table-wrap">
        <table class="data" style="min-width:500px">
          <thead><tr><th>الاسم</th><th>الدور</th><th>إجراءات</th></tr></thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td><b>${esc(u.name)}</b>${u.id === me?.id ? ' <span class="badge primary">إنت</span>' : ''}</td>
                <td>${u.role === 'admin' ? badge('مدير', 'primary') : badge('كاشير', '')}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-sm btn-ghost" type="button" data-edit-user="${u.id}">${icon('edit', 14)} تعديل</button>
                    <button class="btn btn-sm btn-ghost" type="button" data-pin-user="${u.id}">${icon('key', 14)} PIN</button>
                    ${u.id === me?.id ? '' : `<button class="btn btn-sm btn-ghost" type="button" data-del-user="${u.id}">${icon('trash', 14)}</button>`}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    body.querySelector('#add-user')?.addEventListener('click', () => openUserModal());
    body.querySelectorAll('[data-edit-user]').forEach((btn) => {
      btn.addEventListener('click', () => openUserModal(users.find((u) => u.id === Number(btn.dataset.editUser))));
    });
    body.querySelectorAll('[data-pin-user]').forEach((btn) => {
      btn.addEventListener('click', () => openPinModal(users.find((u) => u.id === Number(btn.dataset.pinUser))));
    });
    body.querySelectorAll('[data-del-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const target = users.find((u) => u.id === Number(btn.dataset.delUser));
        if (!target) return;
        if (!await confirmDialog(`تحذف المستخدم "${target.name}"؟`, {
          title: 'حذف مستخدم', confirmLabel: 'احذف', danger: true
        })) return;
        try {
          await deleteUser(target.id);
          toast('المستخدم اتحذف', 'success');
          renderUsers();
        } catch (e) {
          toast(e.message || 'مش قادر أحذف', 'error');
        }
      });
    });
  }

  function pinFields(prefix, labels = true) {
    return `
      <label class="field"><span>${labels ? 'PIN جديد (4 أرقام)' : 'PIN'}</span>
        <input id="${prefix}" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••">
      </label>`;
  }

  function openUserModal(target = null) {
    const editing = Boolean(target);
    const modal = openModal({
      title: editing ? 'تعديل مستخدم' : 'مستخدم جديد',
      size: 'sm',
      iconName: 'key',
      body: `
        <label class="field"><span>الاسم</span>
          <input id="u-name" type="text" maxlength="40" value="${esc(target?.name || '')}" placeholder="اسم المستخدم" autofocus>
        </label>
        <label class="field" style="margin-top:10px"><span>الدور</span>
          <select id="u-role">
            <option value="cashier" ${target?.role !== 'admin' ? 'selected' : ''}>كاشير</option>
            <option value="admin" ${target?.role === 'admin' ? 'selected' : ''}>مدير</option>
          </select>
        </label>
        ${editing ? '' : `<label class="field" style="margin-top:10px"><span>PIN (4 أرقام)</span>
          <input id="u-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••">
        </label>`}
        <p class="field-error" id="u-error" hidden></p>`,
      actions: [
        { label: 'إلغاء', kind: 'btn-ghost', onClick: (close) => close() },
        {
          label: editing ? 'حفظ' : 'إضافة',
          kind: 'btn-primary',
          icon: 'save',
          busyText: 'بنحفظ…',
          onClick: async (close, handle) => {
            const name = handle.body.querySelector('#u-name').value.trim();
            const role = handle.body.querySelector('#u-role').value;
            const error = handle.body.querySelector('#u-error');
            const pin = onlyDigits(handle.body.querySelector('#u-pin')?.value || '');
            try {
              if (!name) throw new Error('الاسم مطلوب');
              if (editing) await updateUser(target.id, { name, role });
              else {
                if (!/^\d{4}$/.test(pin)) throw new Error('PIN لازم 4 أرقام');
                await createUser({ name, role, pin });
              }
              toast(editing ? 'المستخدم اتحدث' : 'المستخدم اتضاف', 'success');
              close();
              renderUsers();
            } catch (e) {
              error.textContent = e.message || 'مش قادر أحفظ';
              error.hidden = false;
            }
          }
        }
      ]
    });
    setTimeout(() => modal.body.querySelector('#u-name')?.focus(), 80);
  }

  function openPinModal(target) {
    if (!target) return;
    const modal = openModal({
      title: `تغيير PIN — ${target.name}`,
      size: 'sm',
      iconName: 'key',
      body: `
        ${pinFields('p-new')}
        <label class="field" style="margin-top:10px"><span>تأكيد PIN</span>
          <input id="p-confirm" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" placeholder="••••">
        </label>
        <p class="field-error" id="p-error" hidden></p>`,
      actions: [
        { label: 'إلغاء', kind: 'btn-ghost', onClick: (close) => close() },
        {
          label: 'حفظ PIN',
          kind: 'btn-primary',
          icon: 'check',
          busyText: 'بنحفظ…',
          onClick: async (close, handle) => {
            const a = onlyDigits(handle.body.querySelector('#p-new').value);
            const b = onlyDigits(handle.body.querySelector('#p-confirm').value);
            const error = handle.body.querySelector('#p-error');
            try {
              if (!/^\d{4}$/.test(a)) throw new Error('PIN لازم 4 أرقام');
              if (a !== b) throw new Error('PIN مش متطابق');
              await changePin(target.id, a);
              toast('PIN اتغير', 'success');
              close();
            } catch (e) {
              error.textContent = e.message || 'مش قادر أغير PIN';
              error.hidden = false;
            }
          }
        }
      ]
    });
    setTimeout(() => modal.body.querySelector('#p-new')?.focus(), 80);
  }

  /* ---------------- Printing ---------------- */
  function renderEscpos() {
    const box = el('#escpos-status');
    if (!box) return;
    const supported = escpos.isSupported();
    const connected = escpos.isConnected();
    box.innerHTML = `
      <div class="row" style="margin-bottom:10px">
        ${badge(escpos.connectionLabel(), connected ? 'success' : '')}
        ${escpos.isSerialSupported() ? badge('Web Serial متاح', 'primary') : badge('Web Serial غير متاح', 'warn')}
        ${escpos.isBluetoothSupported() ? badge('Bluetooth متاح', 'primary') : badge('Bluetooth غير متاح', 'warn')}
      </div>
      <div class="settings-actions" style="margin-top:0">
        <button class="btn btn-sm btn-secondary" type="button" id="escpos-serial" ${escpos.isSerialSupported() ? '' : 'disabled'}>${icon('wifi', 15)} توصيل USB / Serial</button>
        <button class="btn btn-sm btn-secondary" type="button" id="escpos-bt" ${escpos.isBluetoothSupported() ? '' : 'disabled'}>${icon('wifi', 15)} توصيل Bluetooth</button>
        <button class="btn btn-sm btn-ghost" type="button" id="escpos-disconnect" ${connected ? '' : 'disabled'}>${icon('x', 15)} فصل</button>
        <button class="btn btn-sm btn-primary" type="button" id="escpos-test" ${connected ? '' : 'disabled'}>${icon('print', 15)} طباعة تجريبية</button>
      </div>
      ${supported ? '' : '<p class="unpriced-note">المتصفح ده مش بيدعم Web Serial/Bluetooth. استخدم Chrome أو Edge على الكمبيوتر، أو Chrome على أندرويد.</p>'}`;

    box.querySelector('#escpos-serial')?.addEventListener('click', async () => {
      const baud = Number(el('#s-baud')?.value || settings.escposBaud || 9600);
      try {
        await escpos.connectSerial(baud);
        toast('الطابعة اتوصلت', 'success');
        renderEscpos();
      } catch (e) {
        toast(e.message || 'مش قادر أوصل الطابعة', 'error');
      }
    });
    box.querySelector('#escpos-bt')?.addEventListener('click', async () => {
      try {
        await escpos.connectBluetooth();
        toast('الطابعة اتوصلت', 'success');
        renderEscpos();
      } catch (e) {
        toast(e.message || 'مش قادر أوصل الطابعة', 'error');
      }
    });
    box.querySelector('#escpos-disconnect')?.addEventListener('click', async () => {
      await escpos.disconnect();
      toast('الطابعة اتفصلت', 'info');
      renderEscpos();
    });
    box.querySelector('#escpos-test')?.addEventListener('click', async () => {
      try {
        await escpos.printTest(settings);
        toast('أمر الطباعة اتبعت', 'success');
      } catch (e) {
        toast(e.message || 'فشل اختبار الطابعة', 'error');
      }
    });
  }

  el('#printing-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el('#save-printing');
    setBusy(btn, true, 'بنحفظ…');
    try {
      await saveEntries({
        paperWidth: el('#s-paper').value,
        receiptMode: el('#s-receipt-mode').value,
        escposBaud: Number(el('#s-baud').value) || 9600,
        printPreview: el('[data-setting="printPreview"]').checked,
        autoPrint: el('[data-setting="autoPrint"]').checked,
        showQr: el('[data-setting="showQr"]').checked,
        showAppVersion: el('[data-setting="showAppVersion"]').checked,
        hideCustomerPhone: el('[data-setting="hideCustomerPhone"]').checked,
        hideUnpricedTotals: el('[data-setting="hideUnpricedTotals"]').checked
      });
    } catch (err) {
      toast(err.message || 'مش قادر أحفظ', 'error');
    } finally {
      setBusy(btn, false);
    }
  });
  el('#test-print').addEventListener('click', async () => {
    try { await testPrint(); } catch (e) { toast(e.message || 'فشلت الطباعة التجريبية', 'error'); }
  });

  /* ---------------- Notifications ---------------- */
  el('#toggle-token').addEventListener('click', () => {
    const input = el('#s-tg-token');
    input.type = input.type === 'password' ? 'text' : 'password';
    el('#toggle-token').innerHTML = icon(input.type === 'password' ? 'eye' : 'eyeOff', 16);
  });

  function notificationEntries() {
    const entries = {
      telegramToken: el('#s-tg-token').value.trim(),
      telegramChatIds: el('#s-tg-chats').value.trim(),
      telegramProxyUrl: el('#s-tg-proxy').value.trim(),
      telegramProxySecret: el('#s-tg-secret').value.trim(),
      privacyLevel: el('#s-privacy').value,
      discountThreshold: Number(el('#s-discount-threshold')?.value) || 0
    };
    for (const ev of NOTIFY_EVENTS) {
      const input = container.querySelector(`[data-setting="${ev.key}"]`);
      if (input) entries[ev.key] = input.checked;
    }
    return entries;
  }

  async function saveNotifications(silent = false) {
    await setSettings(notificationEntries());
    settings = await getAllSettings(true);
    if (!silent) toast('إعدادات الإشعارات اتحفظت', 'success');
    updateAppNotifyButton();
  }

  function updateAppNotifyButton() {
    window.dispatchEvent(new CustomEvent('cw:settings'));
  }

  el('#notify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await saveNotifications(); } catch (err) { toast(err.message || 'مش قادر أحفظ', 'error'); }
  });
  el('#save-notify-toggles').addEventListener('click', async () => {
    try { await saveNotifications(); } catch (err) { toast(err.message || 'مش قادر أحفظ', 'error'); }
  });

  el('#detect-chats').addEventListener('click', async () => {
    const btn = el('#detect-chats');
    setBusy(btn, true, 'بندور…');
    try {
      await saveNotifications(true);
      const ids = await detectChatIds();
      if (!ids.length) {
        toast('مفيش محادثات — ابعت رسالة للبوت الأول', 'info', 5000);
        return;
      }
      el('#s-tg-chats').value = ids.join(', ');
      await saveNotifications(true);
      toast(`لقينا ${ids.length} محادثة`, 'success');
    } catch (err) {
      toast(err.message || 'مش قادر أجيب المحادثات', 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  el('#test-telegram').addEventListener('click', async () => {
    const btn = el('#test-telegram');
    setBusy(btn, true, 'بنبعت…');
    try {
      await saveNotifications(true);
      const count = await sendTestMessage();
      toast(`الرسالة اتبعتت لـ ${count} محادثة`, 'success');
    } catch (err) {
      toast(err.message || 'فشل الإرسال', 'error', 5000);
    } finally {
      setBusy(btn, false);
    }
  });

  el('#process-queue').addEventListener('click', async () => {
    try {
      await processOutbox({ manual: true });
      toast('بنحاول نبعت القائمة', 'info');
      setTimeout(renderPending, 900);
    } catch (e) {
      toast(e.message || 'فشل الإرسال', 'error');
    }
  });
  el('#clear-sent').addEventListener('click', async () => {
    await clearSentNotifications();
    toast('المُرسل اتمسح', 'success');
    renderPending();
  });

  async function renderPending() {
    const body = el('#pending-body');
    if (!body || !body.isConnected) return;
    try {
      const rows = await pendingNotifications(60);
      if (!rows.length) {
        body.innerHTML = '<p class="muted small">مفيش إشعارات في القائمة.</p>';
        return;
      }
      body.innerHTML = `<div class="pending-list">${rows.map((row) => {
        const ev = NOTIFY_EVENTS.find((x) => x.type === row.type);
        const status = row.status === 'sent' ? badge('اتبعت', 'success')
          : row.status === 'failed' ? badge('فشل', 'danger') : badge('مستني', 'warn');
        return `<div class="pending-item">
          <div class="row" style="justify-content:space-between">
            <div class="row">${status}<span class="small">${esc(ev?.label || row.type)}</span></div>
            <span class="tiny muted">${esc(fmtDateTime(row.createdAt))}</span>
          </div>
          <div class="pending-text">${esc(String(row.text || '').replace(/<[^>]+>/g, ''))}</div>
          ${row.error ? `<div class="pending-error">${esc(row.error)}</div>` : ''}
          <div class="row" style="margin-top:6px">
            ${row.status !== 'sent' ? `<button class="btn btn-sm btn-ghost" type="button" data-retry="${row.id}">${icon('refresh', 13)} إعادة</button>` : ''}
            <button class="btn btn-sm btn-ghost" type="button" data-del-notify="${row.id}">${icon('trash', 13)} حذف</button>
            <span class="tiny muted">محاولات: ${row.attempts || 0}</span>
          </div>
        </div>`;
      }).join('')}</div>`;
      body.querySelectorAll('[data-retry]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await retryNotification(Number(btn.dataset.retry));
            toast('اتعادت المحاولة', 'success');
            setTimeout(renderPending, 700);
          } catch (e) {
            toast(e.message || 'فشلت المحاولة', 'error');
          }
        });
      });
      body.querySelectorAll('[data-del-notify]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await deleteNotification(Number(btn.dataset.delNotify));
          renderPending();
        });
      });
    } catch (e) {
      body.innerHTML = `<p class="muted small">${esc(e.message || 'مش قادر أجيب القائمة')}</p>`;
    }
  }

  const onNotify = () => { renderPending(); };
  window.addEventListener('cw:notify', onNotify);

  /* ---------------- Backup ---------------- */
  async function loadStorage() {
    try {
      if (navigator.storage?.estimate) {
        const { usage } = await navigator.storage.estimate();
        const mb = usage ? (usage / (1024 * 1024)).toFixed(2) + ' م.ب' : '—';
        const sizeEl = document.getElementById('storage-size');
        if (sizeEl) sizeEl.textContent = mb;
      }
    } catch (e) { /* ignore */ }
  }

  el('#quick-backup').addEventListener('click', async () => {
    const btn = el('#quick-backup');
    setBusy(btn, true, 'بنجهز…');
    try {
      await exportBackup(user);
      settings = await getAllSettings(true);
      const label = el('#last-backup');
      if (label) label.textContent = fmtDateTime(settings.lastBackupAt);
      toast('النسخة الاحتياطية اتنزلت', 'success');
    } catch (e) {
      toast(e.message || 'مش قادر أعمل نسخة', 'error');
    } finally {
      setBusy(btn, false);
    }
  });

  el('#restore-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const done = await restoreBackupFile(file, user);
      if (done) {
        toast('البيانات اترجعت — بنعيد تشغيل البرنامج', 'success', 4000);
        setTimeout(() => location.reload(), 1300);
      }
    } catch (err) {
      toast(err.message || 'فشلت الاستعادة', 'error', 5000);
    }
  });

  el('#save-backup-settings').addEventListener('click', async () => {
    const input = container.querySelector('[data-setting="dailyBackupReminder"]');
    await setSettings({ dailyBackupReminder: input.checked });
    settings = await getAllSettings(true);
    toast('اتحفظ', 'success');
  });

  el('#reset-counter').addEventListener('click', async () => {
    const raw = await promptDialog('ابدأ الترقيم من كام؟', {
      title: 'إعادة ضبط العداد', value: '1', inputType: 'number', confirmLabel: 'اضبط'
    });
    if (raw == null) return;
    const value = Math.max(1, Number(onlyDigits(raw)) || 1);
    await resetInvoiceCounter(value);
    toast(`العداد اترجع لـ ${value}`, 'success');
  });

  /* ---------------- Updates ---------------- */
  function loadVersionLabels() {
    const current = document.getElementById('upd-current');
    const about = document.getElementById('about-version');
    const v = (window.__cwVersion || null);
    if (current && v) current.textContent = v;
    if (about && v) about.textContent = v;
  }

  el('#check-updates').addEventListener('click', async () => {
    const btn = el('#check-updates');
    const result = el('#update-result');
    setBusy(btn, true, 'بنفحص…');
    result.textContent = '';
    try {
      const info = await checkForUpdates({ manual: true });
      if (info.update) {
        result.textContent = `فيه تحديث جديد: v${info.remote.version}`;
        showUpdateModal(info);
      } else {
        result.textContent = `إنت على أحدث نسخة (v${info.current}).`;
      }
    } catch (e) {
      result.textContent = e.message || 'مش قادر أفحص التحديثات';
      toast(e.message || 'فشل فحص التحديثات', 'error');
    } finally {
      setBusy(btn, false);
    }
  });
  el('#save-update-settings').addEventListener('click', async () => {
    const input = container.querySelector('[data-setting="autoUpdateCheck"]');
    await setSettings({ autoUpdateCheck: input.checked });
    settings = await getAllSettings(true);
    toast('اتحفظ', 'success');
  });
  el('#show-current-changelog').addEventListener('click', () => showChangelog());

  /* ---------------- Boot tab ---------------- */
  switchTab(initialTab, false);
  loadStorage();
  renderEscpos();
  import('./version.js').then(({ getCachedVersion }) => {
    const v = getCachedVersion().version;
    window.__cwVersion = v;
    loadVersionLabels();
  }).catch(() => {});

  return () => {
    window.removeEventListener('cw:notify', onNotify);
  };
}
