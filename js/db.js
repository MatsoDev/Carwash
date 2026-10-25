import Dexie from '../lib/dexie.mjs';
import { randomSalt, hashPin, PIN_ITERATIONS } from './crypto.js';
import { versionSync } from './version.js';

const DB_NAME = 'carwash_pos_v1';

export const db = new Dexie(DB_NAME);

/* Schema v1. Any future schema change MUST be a new db.version(n).stores(...)
   with an upgrade() migration so existing branches never lose data. */
db.version(1).stores({
  categories: '++id, order, name',
  services: '++id, categoryId, order, active',
  sizes: '++id, name',
  servicePrices: '[serviceId+sizeId], serviceId, sizeId',
  invoices: '++id, number, createdAt, cashierId, workerId, status, customerPhone, customerId, paymentMethod',
  customers: '++id, &phone, name',
  payments: '++id, customerId, date',
  expenses: '++id, date, category',
  workers: '++id, name',
  users: '++id, name, role',
  notifications: '++id, status, createdAt, type',
  settings: '&key',
  audit: '++id, createdAt, type, userId'
});

export const DEFAULT_SETTINGS = {
  businessName: 'مغسلة سيارات',
  businessAddress: '',
  businessPhone: '',
  ownerPhone: '',
  logoDataUrl: '',
  receiptFooter: 'شكراً لزيارتكم — نورتونا',
  theme: 'auto',
  pricingEnabled: true,
  allowCashierPrice: false,
  perSizePricing: false,
  hideCustomerPhone: false,
  hideUnpricedTotals: true,
  showQr: true,
  showAppVersion: true,
  paperWidth: '80',
  autoPrint: true,
  printPreview: false,
  receiptMode: 'browser',
  escposBaud: 9600,
  autoUpdateCheck: true,
  lastRunVersion: '',
  lastSeenVersion: '',
  lastUpdatePrompt: '',
  notifiedUpdateVersion: '',
  invoiceCounter: 1,
  shiftOpenedAt: '',
  shiftOpenedBy: '',
  telegramToken: '',
  telegramChatIds: '',
  telegramProxyUrl: '',
  telegramProxySecret: '',
  privacyLevel: 'summary',
  notifyNewInvoice: false,
  notifyCancel: true,
  notifyLargeDiscount: true,
  discountThreshold: 20,
  notifyEndOfDay: true,
  notifyExpense: false,
  notifyShift: false,
  notifyCredit: true,
  notifyFailedPin: true,
  notifyPriceChange: true,
  notifyErrors: true,
  notifyUpdate: true,
  dailyBackupReminder: true,
  lastBackupAt: '',
  lastBackupSnooze: ''
};

export function formatInvoiceNo(number) {
  const n = Number(number) || 0;
  return String(n).padStart(4, '0');
}

let initPromise = null;
let settingsCache = null;

export function initDB() {
  if (!initPromise) {
    initPromise = (async () => {
      await db.open();
      await seedIfNeeded();
      await ensureDefaultSettings();
      await loadSettingsCache(true);
      return db;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function loadSeedJson() {
  try {
    const mod = await import('../data/seed.json', { with: { type: 'json' } });
    if (mod && mod.default) return mod.default;
  } catch (e) { /* fall through to fetch (older browsers) */ }
  const res = await fetch(new URL('../data/seed.json', import.meta.url), { cache: 'no-store' });
  if (!res.ok) throw new Error('seed.json not found');
  return res.json();
}

async function seedIfNeeded() {
  const seeded = await db.settings.get('_seeded');
  const categoryCount = await db.categories.count();
  if (seeded && categoryCount > 0) return;

  const seed = await loadSeedJson();
  const needDefaultUsers = (await db.users.count()) === 0;
  const defaultUsers = [];
  if (needDefaultUsers) {
    const defaults = [
      { name: 'المدير', role: 'admin', pin: '1234' },
      { name: 'الكاشير', role: 'cashier', pin: '1111' }
    ];
    for (const u of defaults) {
      const salt = randomSalt();
      const pinHash = await hashPin(u.pin, salt);
      defaultUsers.push({
        name: u.name,
        role: u.role,
        salt,
        pinHash,
        iterations: PIN_ITERATIONS,
        createdAt: new Date().toISOString()
      });
    }
  }

  await db.transaction('rw', db.categories, db.services, db.sizes, db.workers, db.users, db.settings, async () => {
    if ((await db.categories.count()) === 0) {
      const catIds = {};
      for (const cat of seed.categories || []) {
        const id = await db.categories.add({ name: cat.name, icon: cat.icon || '🚗', order: cat.order || 0 });
        catIds[cat.ref] = id;
      }
      for (const svc of seed.services || []) {
        const catId = catIds[svc.categoryRef];
        if (!catId) continue;
        await db.services.add({
          categoryId: catId,
          name: svc.name,
          price: null,
          active: true,
          order: svc.order || 0
        });
      }
      for (const size of seed.sizes || []) {
        await db.sizes.add({ name: size.name });
      }
      for (const worker of seed.workers || []) {
        await db.workers.add({ name: worker.name });
      }
    }

    if (needDefaultUsers) {
      for (const user of defaultUsers) await db.users.add(user);
    }

    if (!seeded) await db.settings.put({ key: '_seeded', value: new Date().toISOString() });
  });
}

async function ensureDefaultSettings() {
  await db.transaction('rw', db.settings, async () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      const existing = await db.settings.get(key);
      if (!existing) await db.settings.put({ key, value });
    }
  });
}

async function loadSettingsCache(force = false) {
  if (settingsCache && !force) return settingsCache;
  const rows = await db.settings.toArray();
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  settingsCache = map;
  return settingsCache;
}

export async function getAllSettings(force = false) {
  const map = await loadSettingsCache(force);
  return { ...DEFAULT_SETTINGS, ...map };
}

export async function getSetting(key, fallback) {
  const all = await loadSettingsCache();
  if (key in all) return all[key];
  if (key in DEFAULT_SETTINGS) return DEFAULT_SETTINGS[key];
  return fallback;
}

export async function setSetting(key, value, { silent = false } = {}) {
  await db.settings.put({ key, value });
  const map = await loadSettingsCache();
  map[key] = value;
  if (!silent && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cw:settings', { detail: { key, value } }));
  }
  return value;
}

export async function setSettings(entries) {
  await db.transaction('rw', db.settings, async () => {
    for (const [key, value] of Object.entries(entries)) {
      await db.settings.put({ key, value });
    }
  });
  await loadSettingsCache(true);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cw:settings'));
}

/* ---------------- Catalog ---------------- */
export async function listCategories() {
  return db.categories.orderBy('order').toArray();
}

export async function listServices(categoryId = null) {
  if (categoryId != null) {
    return db.services.where('categoryId').equals(categoryId).sortBy('order');
  }
  return db.services.orderBy('order').toArray();
}

export async function listSizes() {
  return db.sizes.orderBy('id').toArray();
}

export async function listWorkers() {
  return db.workers.orderBy('name').toArray();
}

export async function listUsers() {
  return db.users.orderBy('name').toArray();
}

export async function getUser(id) {
  return db.users.get(id);
}

export async function priceMatrix() {
  const rows = await db.servicePrices.toArray();
  const map = new Map();
  for (const row of rows) map.set(`${row.serviceId}:${row.sizeId}`, row.price);
  return map;
}

export async function setServicePrice(serviceId, sizeId, price) {
  if (sizeId == null) {
    await db.services.update(serviceId, { price });
    return;
  }
  const existing = await db.servicePrices.get([serviceId, sizeId]);
  if (price == null) {
    if (existing) await db.servicePrices.delete([serviceId, sizeId]);
  } else if (existing) {
    await db.servicePrices.update([serviceId, sizeId], { price });
  } else {
    await db.servicePrices.put({ serviceId, sizeId, price });
  }
}

/* ---------------- Customers ---------------- */
export async function findCustomerByPhone(phone) {
  if (!phone) return null;
  return (await db.customers.where('phone').equals(phone).first()) || null;
}

export async function addCustomer({ name, phone }) {
  if (!phone) throw new Error('رقم التليفون مطلوب');
  const exists = await findCustomerByPhone(phone);
  if (exists) throw new Error('الرقم ده موجود بالفعل');
  const id = await db.customers.add({
    name: name || 'عميل',
    phone,
    balance: 0,
    createdAt: new Date().toISOString()
  });
  return db.customers.get(id);
}

async function upsertCustomerTX({ name, phone, creditAmount = 0 }) {
  if (!phone) return null;
  let customer = await db.customers.where('phone').equals(phone).first();
  if (!customer) {
    const id = await db.customers.add({
      name: name || 'عميل',
      phone,
      balance: 0,
      createdAt: new Date().toISOString()
    });
    customer = await db.customers.get(id);
  } else if (name && (!customer.name || customer.name === 'عميل')) {
    await db.customers.update(customer.id, { name });
    customer.name = name;
  }
  if (creditAmount) {
    const balance = Math.round((Number(customer.balance || 0) + Number(creditAmount)) * 100) / 100;
    await db.customers.update(customer.id, { balance });
    customer.balance = balance;
  }
  return customer;
}

/* ---------------- Invoices ---------------- */
export function computeTotals(items, discountType = 'amount', discountValue = 0) {
  const subtotal = Math.round(items.reduce((sum, item) => {
    const price = item.priceSnapshot;
    if (price == null || price === '' || Number.isNaN(Number(price))) return sum;
    return sum + Number(price) * Number(item.qty || 0);
  }, 0) * 100) / 100;

  let discount = 0;
  const dv = Number(discountValue) || 0;
  if (subtotal > 0 && dv > 0) {
    discount = discountType === 'percent'
      ? subtotal * Math.min(100, Math.max(0, dv)) / 100
      : Math.min(subtotal, dv);
  }
  discount = Math.round(discount * 100) / 100;
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const pricedCount = items.filter((i) => i.priceSnapshot != null && !Number.isNaN(Number(i.priceSnapshot))).length;
  const unpricedCount = items.length - pricedCount;
  return { subtotal, discount, total, pricedCount, unpricedCount, hasPricing: pricedCount > 0 };
}

export async function createInvoice({
  items,
  plate = null,
  customerPhone = '',
  customerName = '',
  workerId = null,
  workerName = '',
  notes = '',
  discountType = 'amount',
  discountValue = 0,
  paymentMethod = 'cash',
  cashier = null
}) {
  if (!items || !items.length) throw new Error('السلة فاضية');
  const cleanItems = items.map((item) => ({
    serviceId: item.serviceId,
    nameSnapshot: item.nameSnapshot,
    priceSnapshot: item.priceSnapshot == null || item.priceSnapshot === ''
      ? null : Number(item.priceSnapshot),
    qty: Math.max(1, Number(item.qty) || 1),
    sizeId: item.sizeId ?? null,
    sizeName: item.sizeName || ''
  }));
  const totals = computeTotals(cleanItems, discountType, discountValue);
  const createdAt = new Date().toISOString();

  return db.transaction('rw', db.invoices, db.customers, db.settings, async () => {
    const counterRec = await db.settings.get('invoiceCounter');
    const number = Number(counterRec ? counterRec.value : 1) || 1;

    let customer = null;
    const shouldCreateCustomer = customerPhone && /^01[0125]\d{8}$/.test(customerPhone);
    if (shouldCreateCustomer) {
      customer = await upsertCustomerTX({
        name: customerName,
        phone: customerPhone,
        creditAmount: paymentMethod === 'credit' && totals.total > 0 ? totals.total : 0
      });
    }

    const invoice = {
      number,
      createdAt,
      cashierId: cashier?.id ?? null,
      cashierName: cashier?.name || '',
      workerId: workerId ?? null,
      workerName: workerName || '',
      plate: plate && (plate.letters || plate.numbers)
        ? { letters: plate.letters || '', numbers: plate.numbers || '', display: plate.display || '' }
        : null,
      customerPhone: customerPhone || '',
      customerName: customerName || (customer?.name || ''),
      customerId: customer?.id ?? null,
      items: cleanItems,
      subtotal: totals.subtotal,
      discount: totals.discount,
      discountType,
      discountValue: Number(discountValue) || 0,
      total: totals.total,
      paymentMethod,
      notes: notes || '',
      status: 'active',
      cancelReason: ''
    };
    const id = await db.invoices.add(invoice);
    await db.settings.put({ key: 'invoiceCounter', value: number + 1 });
    settingsCache = null;
    return { ...invoice, id, hasPricing: totals.hasPricing, unpricedCount: totals.unpricedCount };
  });
}

export async function getInvoice(id) {
  return db.invoices.get(id);
}

export async function getInvoiceByNumber(number) {
  return (await db.invoices.where('number').equals(Number(number)).first()) || null;
}

export async function cancelInvoice(id, { reason, user }) {
  const invoice = await db.invoices.get(id);
  if (!invoice) throw new Error('الفاتورة مش موجودة');
  if (invoice.status === 'cancelled') throw new Error('الفاتورة ملغية بالفعل');
  if (!reason || !reason.trim()) throw new Error('سبب الإلغاء مطلوب');

  return db.transaction('rw', db.invoices, db.customers, db.audit, async () => {
    const cancelledAt = new Date().toISOString();
    await db.invoices.update(id, {
      status: 'cancelled',
      cancelReason: reason.trim(),
      cancelledAt,
      cancelledBy: user?.id ?? null,
      cancelledByName: user?.name || ''
    });
    if (invoice.paymentMethod === 'credit' && invoice.customerId && invoice.total > 0) {
      const customer = await db.customers.get(invoice.customerId);
      if (customer) {
        const balance = Math.round((Number(customer.balance || 0) - Number(invoice.total)) * 100) / 100;
        await db.customers.update(customer.id, { balance });
      }
    }
    await db.audit.add({
      type: 'invoice.cancel',
      details: { invoiceId: id, number: invoice.number, reason: reason.trim(), total: invoice.total },
      userId: user?.id ?? null,
      userName: user?.name || '',
      createdAt: cancelledAt
    });
    return { ...invoice, status: 'cancelled', cancelReason: reason.trim(), cancelledAt };
  });
}

/* Query invoices. Date args are ISO strings. Cancelled are included unless status given. */
export async function queryInvoices({
  from = null,
  to = null,
  search = '',
  status = null,
  limit = 1000
} = {}) {
  let rows;
  if (from && to) {
    rows = await db.invoices.where('createdAt').between(from, to, true, false).reverse().toArray();
  } else if (from) {
    rows = await db.invoices.where('createdAt').aboveOrEqual(from).reverse().toArray();
  } else if (to) {
    rows = await db.invoices.where('createdAt').below(to).reverse().toArray();
  } else {
    rows = await db.invoices.orderBy('createdAt').reverse().limit(limit).toArray();
  }
  if (status) rows = rows.filter((inv) => inv.status === status);
  const q = String(search || '').trim().toLowerCase();
  if (q) {
    const qDigits = q.replace(/\D+/g, '');
    rows = rows.filter((inv) => {
      const plate = inv.plate || {};
      const numberText = String(inv.number).padStart(4, '0');
      const haystack = [
        inv.number, numberText, plate.letters, plate.numbers, plate.display,
        inv.customerPhone, inv.customerName, inv.workerName, inv.cashierName
      ].filter(Boolean).join(' ').toLowerCase();
      if (haystack.includes(q)) return true;
      if (qDigits && [plate.numbers, inv.customerPhone].filter(Boolean).join(' ').includes(qDigits)) return true;
      return false;
    });
  }
  return rows.slice(0, limit);
}

export async function recentInvoices(limit = 200) {
  return db.invoices.orderBy('createdAt').reverse().limit(limit).toArray();
}

export async function recentPlates(limit = 500) {
  const rows = await db.invoices.orderBy('createdAt').reverse().limit(limit).toArray();
  const seen = new Set();
  const plates = [];
  for (const inv of rows) {
    const p = inv.plate;
    if (!p || (!p.letters && !p.numbers)) continue;
    const key = `${p.letters}|${p.numbers}`;
    if (seen.has(key)) continue;
    seen.add(key);
    plates.push({
      plate: p,
      customerPhone: inv.customerPhone || '',
      customerName: inv.customerName || '',
      createdAt: inv.createdAt
    });
    if (plates.length >= 24) break;
  }
  return plates;
}

export async function findPreviousInvoiceByPlate(letters, numbers) {
  if (!letters && !numbers) return null;
  const rows = await db.invoices.orderBy('createdAt').reverse().limit(800).toArray();
  return rows.find((inv) => {
    const p = inv.plate;
    if (!p) return false;
    if (letters && p.letters !== letters) return false;
    if (numbers && p.numbers !== numbers) return false;
    return true;
  }) || null;
}

export async function latestInvoiceWithPlate(letters, numbers) {
  return findPreviousInvoiceByPlate(letters, numbers);
}

export async function phoneSuggestions(limit = 20) {
  const customers = await db.customers.orderBy('id').reverse().limit(limit).toArray();
  return customers.map((c) => ({ phone: c.phone, name: c.name }));
}

/* ---------------- Payments & expenses ---------------- */
export async function addPayment(customerId, amount, { user = null, note = '' } = {}) {
  const value = Number(amount);
  if (!value || value <= 0) throw new Error('المبلغ لازم يكون أكبر من صفر');
  return db.transaction('rw', db.customers, db.payments, db.audit, async () => {
    const customer = await db.customers.get(customerId);
    if (!customer) throw new Error('العميل مش موجود');
    const balance = Math.round((Number(customer.balance || 0) - value) * 100) / 100;
    await db.customers.update(customerId, { balance });
    const payment = {
      customerId,
      amount: value,
      date: new Date().toISOString(),
      note: note || '',
      createdBy: user?.name || ''
    };
    const id = await db.payments.add(payment);
    await db.audit.add({
      type: 'credit.payment',
      details: { customerId, amount: value, balance },
      userId: user?.id ?? null,
      userName: user?.name || '',
      createdAt: payment.date
    });
    return { ...payment, id, customer: { ...customer, balance } };
  });
}

export async function customerStatement(customerId) {
  const customer = await db.customers.get(customerId);
  if (!customer) throw new Error('العميل مش موجود');
  const invoices = (await db.invoices.where('customerId').equals(customerId).toArray())
    .filter((inv) => inv.status !== 'cancelled' && inv.paymentMethod === 'credit')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const payments = (await db.payments.where('customerId').equals(customerId).toArray())
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const rows = [
    ...invoices.map((inv) => ({ kind: 'invoice', date: inv.createdAt, amount: inv.total, invoice: inv })),
    ...payments.map((p) => ({ kind: 'payment', date: p.date, amount: p.amount, payment: p }))
  ].sort((a, b) => new Date(a.date) - new Date(b.date));
  return { customer, rows };
}

export async function listCustomers(search = '') {
  const rows = await db.customers.orderBy('name').toArray();
  const q = String(search || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((c) =>
    String(c.name || '').toLowerCase().includes(q) || String(c.phone || '').includes(q)
  );
}

export async function invoicesByCustomer(customerId) {
  return db.invoices.where('customerId').equals(customerId).reverse().toArray();
}

export async function addExpense({ date, category, amount, note = '', user = null }) {
  const value = Number(amount);
  if (!value || value <= 0) throw new Error('المبلغ لازم يكون أكبر من صفر');
  const id = await db.expenses.add({
    date: date || new Date().toISOString().slice(0, 10),
    category: category || 'أخرى',
    amount: value,
    note: note || '',
    createdAt: new Date().toISOString(),
    createdBy: user?.name || ''
  });
  return db.expenses.get(id);
}

export async function listExpenses(fromDate = null, toDate = null) {
  let rows = await db.expenses.orderBy('date').reverse().toArray();
  if (fromDate) rows = rows.filter((r) => r.date >= fromDate);
  if (toDate) rows = rows.filter((r) => r.date <= toDate);
  return rows;
}

export async function expensesTotal(fromDate, toDate) {
  const rows = await listExpenses(fromDate, toDate);
  return Math.round(rows.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100;
}

/* ---------------- Audit ---------------- */
export async function logAudit(type, details = {}, user = null) {
  return db.audit.add({
    type,
    details,
    userId: user?.id ?? null,
    userName: user?.name || '',
    createdAt: new Date().toISOString()
  });
}

/* ---------------- Backup ---------------- */
export const BACKUP_TABLES = [
  'categories', 'services', 'sizes', 'servicePrices', 'invoices', 'customers',
  'payments', 'expenses', 'workers', 'users', 'notifications', 'settings', 'audit'
];

export async function dumpDatabase() {
  const data = {};
  for (const table of BACKUP_TABLES) {
    data[table] = await db.table(table).toArray();
  }
  return {
    app: 'carwash-pos',
    appVersion: versionSync(),
    schema: 1,
    exportedAt: new Date().toISOString(),
    data
  };
}

export async function replaceDatabase(payload) {
  if (!payload || payload.app !== 'carwash-pos' || !payload.data) {
    throw new Error('ملف النسخة الاحتياطية مش تابع للتطبيق');
  }
  const incoming = payload.data;
  await db.transaction('rw', BACKUP_TABLES.map((name) => db.table(name)), async () => {
    for (const table of BACKUP_TABLES) {
      await db.table(table).clear();
      const rows = Array.isArray(incoming[table]) ? incoming[table] : [];
      if (rows.length) await db.table(table).bulkPut(rows);
    }
  });
  settingsCache = null;
  initPromise = null;
}

export async function resetInvoiceCounter(value = 1) {
  const n = Math.max(1, Number(value) || 1);
  await setSetting('invoiceCounter', n);
  return n;
}
