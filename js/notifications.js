import { db, getAllSettings, getSetting, formatInvoiceNo } from './db.js';
import { getCachedVersion } from './version.js';
import { fmtMoney, fmtDateTime } from './ui.js';

export const NOTIFY_EVENTS = [
  { key: 'notifyNewInvoice', label: 'فاتورة جديدة', type: 'invoice.new', hint: 'ملخص كل بيعة' },
  { key: 'notifyCancel', label: 'إلغاء فاتورة', type: 'invoice.cancel', hint: 'مهم جدًا — يفضل يسيبها شغالة' },
  { key: 'notifyLargeDiscount', label: 'خصم كبير', type: 'invoice.discount', hint: 'لما الخصم يعدي النسبة اللي تحت' },
  { key: 'notifyEndOfDay', label: 'إقفال اليوم', type: 'day.close', hint: 'تقرير آخر اليوم' },
  { key: 'notifyExpense', label: 'مصروف جديد', type: 'expense.new', hint: 'أي مصروف يتسجل' },
  { key: 'notifyShift', label: 'بدء / إقفال وردية', type: 'shift', hint: 'فتح وقفل الوردية' },
  { key: 'notifyCredit', label: 'بيع آجل / دفعة', type: 'credit', hint: 'حركة حساب العميل' },
  { key: 'notifyFailedPin', label: 'محاولات PIN فاشلة', type: 'security.failedPin', hint: 'أمان — يفضل شغالة' },
  { key: 'notifyPriceChange', label: 'تغيير سعر', type: 'price.change', hint: 'مين غيّر أنهي سعر' },
  { key: 'notifyUpdate', label: 'تحديث متاح / تم', type: 'update', hint: 'إشعار بإصدار جديد' },
  { key: 'notifyErrors', label: 'أخطاء النظام', type: 'error', hint: 'طباعة، اتصال، أخطاء غير متوقعة' }
];

const TYPES = {
  'invoice.new': 'notifyNewInvoice',
  'invoice.cancel': 'notifyCancel',
  'invoice.discount': 'notifyLargeDiscount',
  'day.close': 'notifyEndOfDay',
  'expense.new': 'notifyExpense',
  'shift.open': 'notifyShift',
  'shift.close': 'notifyShift',
  'credit.sale': 'notifyCredit',
  'credit.payment': 'notifyCredit',
  'security.failedPin': 'notifyFailedPin',
  'price.change': 'notifyPriceChange',
  'update.available': 'notifyUpdate',
  'update.installed': 'notifyUpdate',
  'error': 'notifyErrors'
};

let processing = false;
let processTimer = 0;
let initialized = false;

export function splitChatIds(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function telegramConfigured(settings) {
  const ids = splitChatIds(settings.telegramChatIds);
  const hasTransport = Boolean(String(settings.telegramProxyUrl || '').trim() || String(settings.telegramToken || '').trim());
  return ids.length > 0 && hasTransport;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pricesOn(settings) {
  return Boolean(settings.pricingEnabled);
}

function hasAnyPrice(invoice) {
  return Array.isArray(invoice?.items) && invoice.items.some((i) => i.priceSnapshot != null);
}

function money(value) {
  return fmtMoney(value, true);
}

function plateLine(invoice) {
  const p = invoice?.plate;
  return p && (p.letters || p.numbers) ? `🚗 <b>${escapeHtml(p.display || [p.letters, p.numbers].filter(Boolean).join(' '))}</b>` : '';
}

function phoneLine(invoice, settings) {
  if (settings.privacyLevel !== 'detailed') return '';
  if (!invoice?.customerPhone) return '';
  return `📱 ${escapeHtml(invoice.customerPhone)}`;
}

function versionFooter() {
  const v = getCachedVersion().version;
  return `\n\n<i>v${escapeHtml(v)}</i>`;
}

function itemsText(invoice, settings) {
  if (!invoice?.items?.length) return '';
  const lines = invoice.items.map((item) => {
    const qty = item.qty > 1 ? ` ×${item.qty}` : '';
    const price = settings.pricingEnabled && item.priceSnapshot != null
      ? ` — ${money(item.priceSnapshot * item.qty)}` : '';
    return `• ${escapeHtml(item.nameSnapshot)}${item.sizeName ? ` (${escapeHtml(item.sizeName)})` : ''}${qty}${price}`;
  });
  return lines.join('\n');
}

function buildMessage(type, payload, settings) {
  const detailed = settings.privacyLevel === 'detailed';
  switch (type) {
    case 'invoice.new': {
      const inv = payload.invoice || payload;
      const priced = pricesOn(settings) && hasAnyPrice(inv);
      const method = { cash: 'كاش', visa: 'فيزا', credit: 'آجل' }[inv.paymentMethod] || inv.paymentMethod;
      const head = `🧾 <b>فاتورة جديدة #${formatInvoiceNo(inv.number)}</b>`;
      const serviceCount = (inv.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
      const lines = [head, plateLine(inv), phoneLine(inv, settings)];
      if (priced) lines.push(`💰 الإجمالي: <b>${money(inv.total)}</b> (${escapeHtml(method)})`);
      else lines.push(`💳 الدفع: ${escapeHtml(method)} — بدون أسعار`);
      lines.push(`🧼 الخدمات: <b>${serviceCount}</b>`);
      if (detailed) {
        const items = itemsText(inv, settings);
        if (items) lines.push('', items);
      }
      if (inv.workerName) lines.push(`🧑‍🔧 الموظف: ${escapeHtml(inv.workerName)}`);
      if (inv.cashierName) lines.push(`🧑‍💼 الكاشير: ${escapeHtml(inv.cashierName)}`);
      return lines.filter(Boolean).join('\n') + versionFooter();
    }
    case 'invoice.cancel': {
      const inv = payload.invoice || payload;
      const lines = [
        `❌ <b>إلغاء فاتورة #${formatInvoiceNo(inv.number)}</b>`,
        plateLine(inv),
        `السبب: <b>${escapeHtml(payload.reason || inv.cancelReason || '—')}</b>`,
        `بواسطة: ${escapeHtml(payload.by || inv.cancelledByName || '—')}`
      ];
      if (pricesOn(settings) && hasAnyPrice(inv)) lines.push(`المبلغ: ${money(inv.total)}`);
      return lines.filter(Boolean).join('\n') + versionFooter();
    }
    case 'invoice.discount': {
      const inv = payload.invoice || payload;
      return [
        `⚠️ <b>خصم كبير #${formatInvoiceNo(inv.number)}</b>`,
        plateLine(inv),
        `الخصم: <b>${money(inv.discount)}</b> (${payload.percent != null ? Math.round(payload.percent) + '%' : '—'})`,
        `الإجمالي: ${money(inv.total)}`,
        `الكاشير: ${escapeHtml(inv.cashierName || '—')}`
      ].filter(Boolean).join('\n') + versionFooter();
    }
    case 'day.close': {
      const p = payload;
      const lines = [`📅 <b>إقفال يوم ${escapeHtml(p.date || '')}</b>`, ''];
      lines.push(`🧾 عدد الفواتير: <b>${p.invoices || 0}</b>`);
      lines.push(`🧼 عدد الخدمات: <b>${p.services || 0}</b>`);
      if (p.pricing && p.hasPrices !== false) {
        lines.push(`💰 المبيعات: <b>${money(p.revenue)}</b>`);
        if (p.breakdown) {
          const parts = Object.entries(p.breakdown).filter(([, v]) => v)
            .map(([k, v]) => `${escapeHtml(k)}: ${money(v)}`);
          if (parts.length) lines.push(parts.join(' — '));
        }
        if (p.expenses != null) lines.push(`💸 المصروفات: ${money(p.expenses)}`);
        if (p.net != null) lines.push(`📈 الصافي: <b>${money(p.net)}</b>`);
      } else {
        lines.push('ℹ️ الأسعار غير مفعّلة أو الخدمات بدون أسعار — الأرقام بالعدد فقط.');
      }
      if (p.cashier) lines.push(`🧑‍💼 بواسطة: ${escapeHtml(p.cashier)}`);
      return lines.filter(Boolean).join('\n') + versionFooter();
    }
    case 'expense.new': {
      const e = payload.expense || payload;
      return [
        `💸 <b>مصروف جديد</b>`,
        `التصنيف: ${escapeHtml(e.category || '—')}`,
        `المبلغ: <b>${money(e.amount)}</b>`,
        e.note ? `ملاحظة: ${escapeHtml(e.note)}` : '',
        `التاريخ: ${escapeHtml(e.date || '')}`,
        e.createdBy ? `بواسطة: ${escapeHtml(e.createdBy)}` : ''
      ].filter(Boolean).join('\n') + versionFooter();
    }
    case 'shift.open':
      return `🟢 <b>بدء وردية</b>\n${escapeHtml(payload.by || '')}\n${escapeHtml(fmtDateTime(payload.at || new Date().toISOString()))}` + versionFooter();
    case 'shift.close': {
      const lines = [`🔴 <b>إقفال وردية</b>`, `بواسطة: ${escapeHtml(payload.by || '')}`];
      if (payload.invoices != null) lines.push(`عدد الفواتير: ${payload.invoices}`);
      if (payload.services != null) lines.push(`عدد الخدمات: ${payload.services}`);
      if (pricesOn(settings) && payload.hasPrices && payload.revenue != null) {
        lines.push(`المبيعات: ${money(payload.revenue)}`);
      } else {
        lines.push('الأسعار: بدون أسعار');
      }
      return lines.join('\n') + versionFooter();
    }
    case 'credit.sale': {
      const inv = payload.invoice || payload;
      const lines = [
        `📝 <b>بيع آجل #${formatInvoiceNo(inv.number)}</b>`,
        plateLine(inv),
        detailed && inv.customerName ? `👤 ${escapeHtml(inv.customerName)}` : '',
        phoneLine(inv, settings),
        `المبلغ: <b>${money(inv.total)}</b>`,
        payload.balance != null ? `الرصيد بعد العملية: ${money(payload.balance)}` : ''
      ];
      return lines.filter(Boolean).join('\n') + versionFooter();
    }
    case 'credit.payment': {
      const lines = [
        `💰 <b>دفعة آجل</b>`,
        payload.customerName ? `👤 ${escapeHtml(payload.customerName)}` : '',
        detailed && payload.phone ? `📱 ${escapeHtml(payload.phone)}` : '',
        `المبلغ: <b>${money(payload.amount)}</b>`,
        payload.balance != null ? `الرصيد بعد الدفع: ${money(payload.balance)}` : ''
      ];
      return lines.filter(Boolean).join('\n') + versionFooter();
    }
    case 'security.failedPin':
      return [
        `🔐 <b>محاولات PIN فاشلة</b>`,
        `المستخدم: ${escapeHtml(payload.userName || '—')}`,
        `عدد المحاولات: ${payload.attempts || 0}`,
        `الوقت: ${escapeHtml(fmtDateTime(new Date().toISOString()))}`
      ].join('\n') + versionFooter();
    case 'price.change': {
      if (payload.count > 1) {
        return [
          `💰 <b>تعديل أسعار جماعي</b>`,
          `القسم: ${escapeHtml(payload.categoryName || '—')}`,
          `عدد الخدمات: ${payload.count}`,
          `السعر الجديد: ${escapeHtml(payload.newPriceText || (payload.newPrice == null ? 'بدون سعر' : money(payload.newPrice)))}`,
          `بواسطة: ${escapeHtml(payload.by || '—')}`
        ].join('\n') + versionFooter();
      }
      const oldText = payload.oldPriceText || (payload.oldPrice == null ? 'بدون سعر' : money(payload.oldPrice));
      const newText = payload.newPriceText || (payload.newPrice == null ? 'بدون سعر' : money(payload.newPrice));
      const lines = [
        `💰 <b>تعديل سعر</b>`,
        `الخدمة: ${escapeHtml(payload.serviceName || '—')}`,
        `من: ${escapeHtml(oldText)}`,
        `إلى: ${escapeHtml(newText)}`,
        `بواسطة: ${escapeHtml(payload.by || '—')}`
      ];
      return lines.join('\n') + versionFooter();
    }
    case 'update.available':
      return `⬆️ <b>فيه تحديث جديد: v${escapeHtml(payload.version || '')}</b>\nالنسخة الحالية: v${escapeHtml(payload.current || '')}\nافتح الإعدادات ← التحديثات.` + versionFooter();
    case 'update.installed':
      return `✅ <b>تم تحديث التطبيق إلى v${escapeHtml(payload.version || '')}</b>${payload.previous ? `\nمن v${escapeHtml(payload.previous)}` : ''}` + versionFooter();
    case 'error':
      return `⚠️ <b>خطأ في النظام</b>\n${escapeHtml(String(payload.message || '').slice(0, 800))}\n${payload.context ? escapeHtml(payload.context) : ''}`.trim() + versionFooter();
    default:
      return null;
  }
}

function eventEnabled(type, settings, payload) {
  if (type === 'invoice.discount') {
    if (!settings.notifyLargeDiscount) return false;
    const threshold = Number(settings.discountThreshold) || 0;
    return Number(payload.percent || 0) >= threshold;
  }
  if (type === 'shift.open' || type === 'shift.close') return Boolean(settings.notifyShift);
  const key = TYPES[type];
  if (!key) return false;
  return Boolean(settings[key]);
}

export async function notifyEvent(type, payload = {}) {
  try {
    const settings = await getAllSettings();
    if (!eventEnabled(type, settings, payload)) return null;
    if (!telegramConfigured(settings)) return null;
    const text = buildMessage(type, payload, settings);
    if (!text) return null;
    const row = {
      type,
      payload: { ...payload, sentTo: [] },
      text,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      sentAt: null,
      error: '',
      nextAttemptAt: Date.now()
    };
    const id = await db.notifications.add(row);
    window.dispatchEvent(new CustomEvent('cw:notify', { detail: { id } }));
    processSoon();
    return id;
  } catch (e) {
    console.warn('notifyEvent failed', e);
    return null;
  }
}

export async function notifyError(message, context = '') {
  return notifyEvent('error', { message, context });
}

class TelegramError extends Error {
  constructor(message, { retryAfter = 0, status = 0 } = {}) {
    super(message);
    this.name = 'TelegramError';
    this.retryAfter = Number(retryAfter) || 0;
    this.status = Number(status) || 0;
  }
}

export function splitMessage(text, limit = 4000) {
  const value = String(text == null ? '' : text);
  if (!value) return [];
  if (value.length <= limit) return [value];
  const chunks = [];
  let rest = value;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < Math.floor(limit * 0.5)) cut = rest.lastIndexOf(' ', limit);
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function retryAfterFrom(res, data) {
  const seconds = Number(data?.parameters?.retry_after ?? data?.retry_after ?? res.headers?.get?.('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

async function sendChunk(settings, chatId, text) {
  const proxyUrl = String(settings.telegramProxyUrl || '').trim();
  let res;
  let data;
  if (proxyUrl) {
    const headers = { 'Content-Type': 'application/json' };
    const secret = String(settings.telegramProxySecret || '').trim();
    if (secret) headers['X-Proxy-Secret'] = secret;
    res = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chatId, text, parse_mode: 'HTML' })
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new TelegramError(data.description || data.error || `Proxy HTTP ${res.status}`, {
        retryAfter: retryAfterFrom(res, data),
        status: res.status
      });
    }
    return;
  }
  const token = String(settings.telegramToken || '').trim();
  if (!token) throw new TelegramError('Bot Token مش متظبط');
  res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new TelegramError(data.description || `Telegram HTTP ${res.status}`, {
      retryAfter: retryAfterFrom(res, data),
      status: res.status
    });
  }
}

async function sendToChat(settings, chatId, text) {
  for (const chunk of splitMessage(text)) await sendChunk(settings, chatId, chunk);
}

function sentToOf(row) {
  const list = row?.payload?.sentTo;
  return Array.isArray(list) ? [...new Set(list.map(String).filter(Boolean))] : [];
}

async function persistChatProgress(row, sentTo, sentErrors) {
  const payload = {
    ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
    sentTo,
    sentErrors
  };
  const error = Object.entries(sentErrors)
    .map(([chatId, message]) => `${chatId}: ${message}`)
    .join(' | ')
    .slice(0, 500);
  await db.notifications.update(row.id, { payload, error });
}

async function sendNotification(row, settings) {
  const ids = splitChatIds(settings.telegramChatIds);
  if (!ids.length) throw new TelegramError('مفيش Chat ID');
  const sentTo = sentToOf(row);
  const sentErrors = { ...(row?.payload?.sentErrors || {}) };
  let retryAfter = 0;
  for (const chatId of ids) {
    if (sentTo.includes(chatId)) continue;
    try {
      await sendToChat(settings, chatId, row.text);
      sentTo.push(chatId);
      delete sentErrors[chatId];
    } catch (e) {
      sentErrors[chatId] = String(e.message || e).slice(0, 300);
      retryAfter = Math.max(retryAfter, Number(e.retryAfter) || 0);
    }
    await persistChatProgress(row, sentTo, sentErrors);
  }
  return {
    allDone: ids.every((chatId) => sentTo.includes(chatId)),
    sentTo,
    sentErrors,
    retryAfter
  };
}

function retryDelay(attempts) {
  if (attempts <= 1) return 30 * 1000;
  if (attempts === 2) return 2 * 60 * 1000;
  return 10 * 60 * 1000;
}

export async function processOutbox({ manual = false, id = null } = {}) {
  if (processing) return;
  processing = true;
  try {
    const settings = await getAllSettings();
    if (!telegramConfigured(settings)) return;
    if (!navigator.onLine) return;

    let rows;
    if (id != null) {
      const row = await db.notifications.get(id);
      rows = row ? [row] : [];
    } else {
      rows = await db.notifications.where('status').anyOf('pending', 'failed').toArray();
      rows = rows.filter((row) => row.attempts < 3 && (!row.nextAttemptAt || row.nextAttemptAt <= Date.now()));
      rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }

    for (const row of rows) {
      let result;
      try {
        result = await sendNotification(row, settings);
      } catch (e) {
        result = {
          allDone: false,
          sentTo: sentToOf(row),
          sentErrors: { all: String(e.message || e).slice(0, 300) },
          retryAfter: Number(e.retryAfter) || 0
        };
        await persistChatProgress(row, result.sentTo, result.sentErrors);
      }
      if (result.allDone) {
        await db.notifications.update(row.id, {
          status: 'sent',
          sentAt: new Date().toISOString(),
          error: '',
          attempts: Number(row.attempts || 0) + 1
        });
        continue;
      }
      const attempts = result.retryAfter ? Number(row.attempts || 0) : Number(row.attempts || 0) + 1;
      const exhausted = !result.retryAfter && attempts >= 3;
      const delay = result.retryAfter ? result.retryAfter * 1000 : retryDelay(attempts);
      await db.notifications.update(row.id, {
        status: exhausted ? 'failed' : 'pending',
        attempts,
        error: Object.entries(result.sentErrors)
          .map(([chatId, message]) => `${chatId}: ${message}`)
          .join(' | ')
          .slice(0, 500),
        nextAttemptAt: Date.now() + delay
      });
    }
    window.dispatchEvent(new CustomEvent('cw:notify'));
  } catch (e) {
    console.warn('outbox', e);
  } finally {
    processing = false;
  }
}

export function processSoon() {
  clearTimeout(processTimer);
  processTimer = setTimeout(() => processOutbox(), 1200);
}

export async function pendingNotifications(limit = 100) {
  const rows = await db.notifications.orderBy('createdAt').reverse().limit(limit).toArray();
  return rows;
}

export async function pendingCount() {
  const rows = await db.notifications.where('status').anyOf('pending', 'failed').toArray();
  return rows.filter((r) => r.attempts < 3).length;
}

export async function retryNotification(id) {
  await db.notifications.update(id, {
    status: 'pending',
    attempts: 0,
    error: '',
    nextAttemptAt: Date.now()
  });
  window.dispatchEvent(new CustomEvent('cw:notify'));
  await processOutbox({ manual: true });
}

export async function deleteNotification(id) {
  await db.notifications.delete(id);
  window.dispatchEvent(new CustomEvent('cw:notify'));
}

export async function clearSentNotifications() {
  const rows = await db.notifications.where('status').equals('sent').toArray();
  await db.notifications.bulkDelete(rows.map((r) => r.id));
  window.dispatchEvent(new CustomEvent('cw:notify'));
}

export async function sendTestMessage() {
  const settings = await getAllSettings();
  if (!telegramConfigured(settings)) {
    throw new Error('ظبط Bot Token وChat ID الأول');
  }
  const text = `✅ <b>اختبار إشعارات مغسلة السيارات</b>\nكل حاجة شغالة تمام.\n\n<i>v${escapeHtml(getCachedVersion().version)}</i>`;
  const ids = splitChatIds(settings.telegramChatIds);
  for (const chatId of ids) await sendToChat(settings, chatId, text);
  return ids.length;
}

export async function detectChatIds() {
  const token = String(await getSetting('telegramToken') || '').trim();
  if (!token) throw new Error('اكتب Bot Token الأول');
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.description || 'مش قادر أجيب المحادثات');
  const ids = new Set();
  for (const update of data.result || []) {
    const chat = update.message?.chat || update.channel_post?.chat || update.my_chat_member?.chat;
    if (chat?.id) ids.add(String(chat.id));
  }
  return [...ids];
}

export function initNotifications() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('online', () => processSoon());
  window.addEventListener('cw:notify', () => { /* UI components can listen */ });
  setInterval(() => processOutbox(), 60000);
  setTimeout(() => processOutbox(), 2500);
}
