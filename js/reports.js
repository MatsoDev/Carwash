import {
  getAllSettings, queryInvoices, expensesTotal, setSettings
} from './db.js';
import {
  esc, icon, toast, fmtMoney, fmtNumber, fmtDate, fmtDateTime,
  todayISO, localDateStartISO, localDateEndISO, downloadCsv,
  confirmDialog, emptyState, badge
} from './ui.js';
import { getCurrentUser } from './auth.js';
import { notifyEvent, telegramConfigured } from './notifications.js';

const PAY_LABELS = { cash: 'كاش', visa: 'فيزا', credit: 'آجل' };

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstOfMonth(dateStr) {
  return dateStr.slice(0, 8) + '01';
}

function periodLabel(from, to) {
  if (from === to) return fmtDate(from);
  return `${fmtDate(from)} — ${fmtDate(to)}`;
}

function itemNames(invoice) {
  return (invoice.items || []).map((item) => {
    const size = item.sizeName ? ` (${item.sizeName})` : '';
    return `${item.nameSnapshot}${size}${item.qty > 1 ? ` ×${item.qty}` : ''}`;
  }).join(' + ');
}

function bars(rows, valueFormatter, emptyText = 'مفيش بيانات في الفترة دي') {
  if (!rows.length) return `<p class="muted small" style="padding:8px 0">${esc(emptyText)}</p>`;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return rows.map((r) => `
    <div class="bar-row">
      <span>${esc(r.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, Math.round((r.count / max) * 100))}%"></span></span>
      <span class="bar-value">${valueFormatter(r)}</span>
    </div>`).join('');
}

export async function renderReports(container) {
  const settings = await getAllSettings();
  const user = getCurrentUser();
  const pricing = Boolean(settings.pricingEnabled);
  let fromDate = todayISO();
  let toDate = todayISO();
  let rows = [];
  let expenses = 0;
  let cancelled = 0;

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>التقارير</h1>
        <p>اعرف شغلك بيمشي إزاي: مبيعات، خدمات، موظفين، ومصاريف.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-secondary" type="button" id="export-report">${icon('download', 16)} تصدير CSV</button>
        <button class="btn btn-sm btn-ghost" type="button" id="refresh-report">${icon('refresh', 16)} تحديث</button>
      </div>
    </div>

    <div class="panel">
      <div class="filters">
        <label class="field">
          <span>من</span>
          <input id="r-from" type="date" value="${fromDate}">
        </label>
        <label class="field">
          <span>إلى</span>
          <input id="r-to" type="date" value="${toDate}">
        </label>
        <div class="row" style="align-self:center">
          <button class="btn btn-sm btn-ghost" type="button" data-range="today">اليوم</button>
          <button class="btn btn-sm btn-ghost" type="button" data-range="7">آخر 7 أيام</button>
          <button class="btn btn-sm btn-ghost" type="button" data-range="30">آخر 30 يوم</button>
          <button class="btn btn-sm btn-ghost" type="button" data-range="month">الشهر</button>
        </div>
        <span class="result-count" id="r-period"></span>
      </div>
    </div>

    <div class="day-close" id="shift-card"></div>
    <div id="report-body"></div>
  `;

  const el = (sel) => container.querySelector(sel);
  const fromEl = el('#r-from');
  const toEl = el('#r-to');
  const bodyEl = el('#report-body');
  const shiftEl = el('#shift-card');
  const periodEl = el('#r-period');

  function aggregates() {
    const active = rows.filter((inv) => inv.status !== 'cancelled');
    const byPayment = {};
    const byService = new Map();
    const byWorker = new Map();
    const byCashier = new Map();
    let revenue = 0;
    let pricedInvoices = 0;
    let servicesCount = 0;
    for (const inv of active) {
      const amount = Number(inv.total) || 0;
      const hasPrices = (inv.items || []).some((item) => item.priceSnapshot != null);
      if (hasPrices) {
        revenue += amount;
        pricedInvoices += 1;
      }
      const p = inv.paymentMethod || 'cash';
      if (!byPayment[p]) byPayment[p] = { count: 0, amount: 0 };
      byPayment[p].count += 1;
      byPayment[p].amount += amount;

      for (const item of inv.items || []) {
        const qty = Number(item.qty) || 0;
        servicesCount += qty;
        const key = item.nameSnapshot + (item.sizeName ? ` (${item.sizeName})` : '');
        const rec = byService.get(key) || { label: key, count: 0, amount: 0 };
        rec.count += qty;
        if (item.priceSnapshot != null) rec.amount += Number(item.priceSnapshot) * qty;
        byService.set(key, rec);
      }

      const worker = inv.workerName || 'بدون موظف';
      const w = byWorker.get(worker) || { label: worker, count: 0, amount: 0 };
      w.count += 1;
      w.amount += amount;
      byWorker.set(worker, w);

      const cashier = inv.cashierName || '—';
      const c = byCashier.get(cashier) || { label: cashier, count: 0, amount: 0 };
      c.count += 1;
      c.amount += amount;
      byCashier.set(cashier, c);
    }
    return {
      active,
      revenue,
      pricedInvoices,
      servicesCount,
      expenses,
      net: revenue - expenses,
      payment: Object.entries(byPayment).map(([key, v]) => ({
        key, label: PAY_LABELS[key] || key, count: v.count, amount: v.amount
      })).sort((a, b) => b.count - a.count),
      services: [...byService.values()].sort((a, b) => b.count - a.count).slice(0, 12),
      workers: [...byWorker.values()].sort((a, b) => b.count - a.count),
      cashiers: [...byCashier.values()].sort((a, b) => b.count - a.count)
    };
  }

  function renderBody() {
    const a = aggregates();
    const period = periodLabel(fromDate, toDate);
    periodEl.textContent = period;

    const invoiceKpi = `
      <div class="kpi">
        <span class="kpi-label">الفواتير</span>
        <span class="kpi-value">${fmtNumber(a.active.length)}</span>
        <span class="kpi-sub">${cancelled ? `${cancelled} ملغية مستبعدة` : 'كل الحسابات سليمة'}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">الخدمات</span>
        <span class="kpi-value">${fmtNumber(a.servicesCount)}</span>
        <span class="kpi-sub">خدمة اتعملت في الفترة</span>
      </div>`;

    const moneyKpis = pricing ? `
      <div class="kpi">
        <span class="kpi-label">المبيعات</span>
        <span class="kpi-value">${esc(fmtMoney(a.revenue))}</span>
        <span class="kpi-sub">${a.pricedInvoices} فاتورة بأسعار</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">المصاريف</span>
        <span class="kpi-value">${esc(fmtMoney(a.expenses))}</span>
        <span class="kpi-sub">مصاريف مسجلة في الفترة</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">الصافي</span>
        <span class="kpi-value" style="color:${a.net < 0 ? 'var(--danger)' : 'var(--success)'}">${esc(fmtMoney(a.net))}</span>
        <span class="kpi-sub">المبيعات − المصاريف</span>
      </div>` : `
      <div class="kpi">
        <span class="kpi-label">الأسعار</span>
        <span class="kpi-value plain" style="font-size:1.05rem">متوقفة</span>
        <span class="kpi-sub">التقارير شغالة بالعدد — فعّل الأسعار من الإعدادات</span>
      </div>`;

    bodyEl.innerHTML = `
      <div class="kpi-grid">${invoiceKpi}${moneyKpis}
        <div class="kpi">
          <span class="kpi-label">متوسط الفاتورة</span>
          <span class="kpi-value">${pricing && a.active.length ? esc(fmtMoney(a.revenue / a.active.length)) : '—'}</span>
          <span class="kpi-sub">${pricing ? 'للفواتير المسعّرة' : 'محتاج تفعيل الأسعار'}</span>
        </div>
      </div>

      <div class="report-grid">
        <section class="panel">
          <div class="panel-head"><h2>${icon('tag', 18)} أشهر الخدمات</h2></div>
          <div class="panel-body">
            ${bars(a.services, (r) => pricing && r.amount ? `${r.count} — ${fmtMoney(r.amount)}` : `${r.count}`, 'مفيش خدمات في الفترة دي')}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>${icon('wallet', 18)} طرق الدفع</h2></div>
          <div class="panel-body">
            ${bars(a.payment.map((p) => ({ ...p, label: p.label })), (r) => pricing ? `${r.count} — ${fmtMoney(r.amount)}` : `${r.count}`, 'مفيش مدفوعات')}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>${icon('users', 18)} الموظفين</h2></div>
          <div class="panel-body">
            ${bars(a.workers, (r) => pricing ? `${r.count} — ${fmtMoney(r.amount)}` : `${r.count}`, 'مفيش موظفين محددين')}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>${icon('receipt', 18)} الكاشير</h2></div>
          <div class="panel-body">
            ${bars(a.cashiers, (r) => pricing ? `${r.count} — ${fmtMoney(r.amount)}` : `${r.count}`, 'مفيش فواتير')}
          </div>
        </section>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>${icon('info', 18)} ملخص الفترة</h2>
          <span class="spacer"></span>
          ${pricing ? badge('بالأسعار', 'primary') : badge('بدون أسعار', 'warn')}
          <button class="btn btn-sm btn-secondary" type="button" id="send-summary">${icon('send', 15)} ابعت الملخص</button>
          <a class="btn btn-sm btn-ghost" href="#/expenses">${icon('wallet', 15)} المصاريف</a>
        </div>
        <div class="panel-body">
          <div class="about-list">
            <div><span>الفترة</span><b>${esc(period)}</b></div>
            <div><span>فواتير سارية</span><b>${a.active.length}</b></div>
            <div><span>فواتير ملغية</span><b>${cancelled}</b></div>
            <div><span>عدد الخدمات</span><b>${a.servicesCount}</b></div>
            ${pricing ? `<div><span>المبيعات</span><b>${esc(fmtMoney(a.revenue))}</b></div>
            <div><span>المصاريف</span><b>${esc(fmtMoney(a.expenses))}</b></div>
            <div><span>الصافي</span><b>${esc(fmtMoney(a.net))}</b></div>` : ''}
          </div>
          ${pricing && a.revenue === 0 ? '<p class="unpriced-note">مفيش مبالغ متسجلة — يمكن الخدمات متسعّرة أو لسه محتاجة تسعير.</p>' : ''}
        </div>
      </div>`;

    bodyEl.querySelector('#send-summary')?.addEventListener('click', () => sendSummary(a));
  }

  async function load() {
    if (!fromEl.value || !toEl.value) { toast('اختار تاريخ البداية والنهاية', 'error'); return; }
    if (fromEl.value > toEl.value) { toast('تاريخ البداية بعد النهاية', 'error'); return; }
    fromDate = fromEl.value;
    toDate = toEl.value;
    bodyEl.innerHTML = `<div class="empty"><span class="spinner"></span><span class="muted">بنجمع الأرقام…</span></div>`;
    try {
      const [invoices, exp] = await Promise.all([
        queryInvoices({
          from: localDateStartISO(fromDate),
          to: localDateEndISO(toDate),
          limit: 20000
        }),
        expensesTotal(fromDate, toDate)
      ]);
      rows = invoices;
      cancelled = invoices.filter((inv) => inv.status === 'cancelled').length;
      expenses = exp;
      renderBody();
      renderShift();
    } catch (e) {
      bodyEl.innerHTML = emptyState('info', 'مش قادر أحمل التقارير', e.message || '');
    }
  }

  function renderShift() {
    const openedAt = settings.shiftOpenedAt || '';
    if (!openedAt) {
      shiftEl.innerHTML = `
        <div>
          <span class="kpi-label">الوردية</span>
          <div class="shift-state">مفيش وردية مفتوحة</div>
          <div class="small muted">افتح وردية عشان تتابع شغل الفترة دي وتقفلها بتقرير.</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-primary" type="button" id="start-shift">${icon('clock', 15)} ابدأ وردية</button>`;
      shiftEl.querySelector('#start-shift')?.addEventListener('click', startShift);
    } else {
      shiftEl.innerHTML = `
        <div>
          <span class="kpi-label">الوردية مفتوحة</span>
          <div class="shift-state">${esc(fmtDateTime(openedAt))}</div>
          <div class="small muted">بواسطة ${esc(settings.shiftOpenedBy || '—')}</div>
        </div>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-secondary" type="button" id="close-shift">${icon('lock', 15)} إقفال الوردية</button>`;
      shiftEl.querySelector('#close-shift')?.addEventListener('click', closeShift);
    }
  }

  async function startShift() {
    const now = new Date().toISOString();
    await setSettings({ shiftOpenedAt: now, shiftOpenedBy: user?.name || '' });
    settings.shiftOpenedAt = now;
    settings.shiftOpenedBy = user?.name || '';
    notifyEvent('shift.open', { by: user?.name, at: now });
    toast('الوردية بدأت', 'success');
    renderShift();
  }

  async function closeShift() {
    const ok = await confirmDialog('تقفل الوردية الحالية؟ هيتسجل ملخص بالشغل اللي فيها.', {
      title: 'إقفال الوردية',
      confirmLabel: 'اقفل الوردية'
    });
    if (!ok) return;
    const openedAt = settings.shiftOpenedAt;
    try {
      const shiftInvoices = await queryInvoices({
        from: openedAt,
        to: new Date().toISOString(),
        status: 'active',
        limit: 20000
      });
      const revenue = shiftInvoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
      const services = shiftInvoices.reduce((sum, inv) =>
        sum + (inv.items || []).reduce((s, item) => s + (Number(item.qty) || 0), 0), 0);
      const hasPrices = shiftInvoices.some((inv) =>
        (inv.items || []).some((item) => item.priceSnapshot != null));
      notifyEvent('shift.close', {
        by: user?.name,
        invoices: shiftInvoices.length,
        services,
        revenue,
        hasPrices
      });
      await setSettings({ shiftOpenedAt: '', shiftOpenedBy: '' });
      settings.shiftOpenedAt = '';
      settings.shiftOpenedBy = '';
      toast('الوردية اتقفلت', 'success');
      renderShift();
    } catch (e) {
      toast(e.message || 'مش قادر أقفل الوردية', 'error');
    }
  }

  function sendSummary(a) {
    if (!telegramConfigured(settings)) {
      toast('ظبط إشعارات تليجرام الأول من الإعدادات', 'error', 4200);
      return;
    }
    if (!settings.notifyEndOfDay) {
      toast('إشعار "إقفال اليوم" متوقف — فعّله من إعدادات الإشعارات', 'error', 4200);
      return;
    }
    const breakdown = {};
    for (const p of a.payment) breakdown[p.label] = pricing ? p.amount : p.count;
    notifyEvent('day.close', {
      date: periodLabel(fromDate, toDate),
      invoices: a.active.length,
      services: a.servicesCount,
      pricing,
      hasPrices: a.pricedInvoices > 0,
      revenue: a.revenue,
      expenses: a.expenses,
      net: a.net,
      breakdown,
      cashier: user?.name || ''
    });
    toast('الملخص اتحفظ في قائمة الإرسال', 'success');
  }

  function exportCsv() {
    if (!rows.length) { toast('مفيش فواتير في الفترة دي', 'info'); return; }
    const header = [
      'رقم الفاتورة', 'التاريخ', 'اللوحة', 'التليفون', 'العميل',
      'الخدمات', 'عدد الخدمات', 'المجموع', 'الخصم', 'الإجمالي',
      'طريقة الدفع', 'الحالة', 'الكاشير', 'الموظف', 'ملاحظات'
    ];
    const csvRows = [header];
    for (const inv of rows) {
      csvRows.push([
        inv.number,
        fmtDateTime(inv.createdAt),
        inv.plate?.display || '',
        inv.customerPhone || '',
        inv.customerName || '',
        itemNames(inv),
        (inv.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0),
        pricing ? inv.subtotal : '',
        pricing ? inv.discount : '',
        pricing ? inv.total : '',
        PAY_LABELS[inv.paymentMethod] || inv.paymentMethod || '',
        inv.status === 'cancelled' ? 'ملغية' : 'سارية',
        inv.cashierName || '',
        inv.workerName || '',
        inv.notes || ''
      ]);
    }
    downloadCsv(csvRows, `carwash-report-${fromDate}-to-${toDate}.csv`);
    toast('التقرير اتنزل كـ CSV', 'success');
  }

  fromEl.addEventListener('change', load);
  toEl.addEventListener('change', load);
  el('#refresh-report').addEventListener('click', load);
  el('#export-report').addEventListener('click', exportCsv);
  container.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const range = btn.dataset.range;
      toDate = todayISO();
      if (range === 'today') fromDate = toDate;
      else if (range === '7') fromDate = addDays(toDate, -6);
      else if (range === '30') fromDate = addDays(toDate, -29);
      else if (range === 'month') fromDate = firstOfMonth(toDate);
      fromEl.value = fromDate;
      toEl.value = toDate;
      load();
    });
  });

  renderShift();
  await load();
}
