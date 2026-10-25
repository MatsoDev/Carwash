import {
  getAllSettings, setSetting, dumpDatabase, replaceDatabase, logAudit
} from './db.js';
import {
  downloadText, readFileAsText, confirmDialog, fmtDateTime, toast, icon
} from './ui.js';

const SNOOZE_MS = 4 * 60 * 60 * 1000;
const MAX_RESTORE_BYTES = 60 * 1024 * 1024;

function stamp(date = new Date()) {
  const d = date;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function backupName(prefix = 'carwash-backup') {
  return `${prefix}-${stamp()}.json`;
}

function sameLocalDay(iso, date = new Date()) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === date.getFullYear()
    && d.getMonth() === date.getMonth()
    && d.getDate() === date.getDate();
}

function countRows(data) {
  return Object.values(data || {}).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
}

export async function exportBackup(user = null, { silent = false } = {}) {
  const payload = await dumpDatabase();
  payload.exportedBy = user?.name || '';
  const filename = backupName();
  downloadText(JSON.stringify(payload, null, 2), filename, 'application/json;charset=utf-8');

  const at = new Date().toISOString();
  await setSetting('lastBackupAt', at, { silent: true });
  await setSetting('lastBackupSnooze', '', { silent: true });
  try {
    await logAudit('backup.export', {
      filename,
      exportedAt: payload.exportedAt,
      rows: countRows(payload.data)
    }, user);
  } catch (e) { /* audit must not block a backup */ }

  if (!silent) toast('تم تنزيل نسخة احتياطية كاملة.', 'success');
  return filename;
}

function validateBackup(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('ملف النسخة الاحتياطية غير صالح.');
  }
  if (payload.app !== 'carwash-pos') {
    throw new Error('هذا الملف ليس نسخة احتياطية من Carwash POS.');
  }
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new Error('لا تحتوي النسخة الاحتياطية على بيانات قابلة للاستعادة.');
  }
  const schema = Number(payload.schema) || 1;
  if (schema > 1) {
    throw new Error('النسخة الاحتياطية أحدث من إصدار البرنامج الحالي. حدّث البرنامج أولًا.');
  }
  return schema;
}

export async function restoreBackupFile(file, user = null) {
  if (!file) throw new Error('لم يتم اختيار ملف.');
  if (file.size > MAX_RESTORE_BYTES) {
    throw new Error('حجم الملف أكبر من الحد المسموح (60 ميجابايت).');
  }

  let payload;
  try {
    payload = JSON.parse(await readFileAsText(file));
  } catch (e) {
    throw new Error('تعذر قراءة الملف. تأكد أنه ملف JSON صحيح.');
  }
  validateBackup(payload);

  const data = payload.data;
  const invoices = Array.isArray(data.invoices) ? data.invoices.length : 0;
  const customers = Array.isArray(data.customers) ? data.customers.length : 0;
  const exported = payload.exportedAt ? fmtDateTime(payload.exportedAt) : 'غير معروف';
  const confirmed = await confirmDialog(
    `سيتم استبدال كل البيانات الحالية ببيانات النسخة المصدّرة في ${exported}. `
    + `تحتوي النسخة على ${invoices} فاتورة و${customers} عميل. `
    + 'سيتم تنزيل نسخة أمان من البيانات الحالية أولًا، ثم تُعاد الصفحة.',
    { title: 'استعادة نسخة احتياطية', confirmLabel: 'استعادة الآن', danger: true }
  );
  if (!confirmed) return false;

  const safety = await dumpDatabase();
  const safetyName = backupName('carwash-before-restore');
  downloadText(JSON.stringify(safety, null, 2), safetyName, 'application/json;charset=utf-8');

  await replaceDatabase(payload);
  try {
    await logAudit('backup.restore', {
      source: file.name,
      exportedAt: payload.exportedAt || '',
      safetyBackup: safetyName,
      rows: countRows(data)
    }, user);
  } catch (e) { /* restored settings are already in place */ }

  return true;
}

function buildBanner() {
  const el = document.createElement('div');
  el.className = 'backup-reminder';
  el.innerHTML = `
    <div class="backup-reminder-icon">${icon('database', 22)}</div>
    <div class="backup-reminder-text">
      <strong>لم يتم أخذ نسخة احتياطية اليوم</strong>
      <span>البيانات محفوظة على هذا الجهاز فقط. احتفظ بنسخة خارجية من وقت لآخر.</span>
    </div>
    <div class="backup-reminder-actions">
      <button class="btn btn-sm btn-primary" type="button" data-backup-now>${icon('download', 15)} نسخ الآن</button>
      <button class="icon-btn sm" type="button" data-backup-later aria-label="تذكير لاحقًا">${icon('x', 15)}</button>
    </div>`;
  return el;
}

export async function maybeBackupReminder(user = null) {
  if (!user || user.role !== 'admin') return null;
  const settings = await getAllSettings();
  if (!settings.dailyBackupReminder) return null;
  if (sameLocalDay(settings.lastBackupAt)) return null;

  const snoozedAt = settings.lastBackupSnooze ? new Date(settings.lastBackupSnooze).getTime() : 0;
  if (snoozedAt && Date.now() - snoozedAt < SNOOZE_MS) return null;

  const banner = buildBanner();
  banner.querySelector('[data-backup-now]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await exportBackup(user);
      banner.remove();
    } catch (err) {
      toast(err.message || 'تعذر حفظ النسخة الاحتياطية.', 'error');
      btn.disabled = false;
    }
  });
  banner.querySelector('[data-backup-later]').addEventListener('click', async () => {
    try {
      await setSetting('lastBackupSnooze', new Date().toISOString(), { silent: true });
    } catch (e) { /* ignore */ }
    banner.remove();
  });
  return banner;
}
