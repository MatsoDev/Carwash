import {
  getAllSettings, queryInvoices, cancelInvoice, formatInvoiceNo
} from './db.js';
import {
  esc, icon, toast, fmtMoney, fmtDateTime, fmtDate, fmtTime,
  localDateStartISO, localDateEndISO, todayISO, debounce, openModal,
  emptyState, badge, onlyDigits, toIntlPhone
} from './ui.js';
import { getCurrentUser } from './auth.js';
import { printReceipt } from './print.js';
import { notifyEvent } from './notifications.js';

const PAY_LABELS = { cash: 'كاش', visa: 'فيزا', credit: 'آجل' };

function itemCount(invoice) {
  return (invoice.items || []).reduce((sum, item) => sum + (item.qty || 0), 0);
}

function hasPrice(invoice) {
  return (invoice.items || []).some((item) => item.priceSnapshot != null);
}

function totalText(invoice, settings) {
  if (!settings.pricingEnabled) return '—';
  if (!hasPrice(invoice)) return 'بدون سعر';
  return fmtMoney(invoice.total);
}

export async function renderInvoices(container) {
  const settings = await getAllSettings();
  const user = getCurrentUser();
  const isAdmin = user?.role === 'admin';

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>الفواتير</h1>
        <p>دور برقم الفاتورة أو اللوحة أو التليفون، واطبع أي فاتورة تاني.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-ghost" type="button" id="refresh-invoices">${icon('refresh', 16)} تحديث</button>
      </div>
    </div>

    <div class="panel">
      <div class="filters">
        <label class="field search">
          <span>بحث</span>
          <div class="search-inline">
            ${icon('search', 17)}
            <input id="inv-search" type="search" placeholder="رقم الفاتورة، لوحة، تليفون، اسم…" autocomplete="off">
          </div>
        </label>
        <label class="field">
          <span>من</span>
          <input id="inv-from" type="date" value="${todayISO()}">
        </label>
        <label class="field">
          <span>إلى</span>
          <input id="inv-to" type="date" value="${todayISO()}">
        </label>
        <label class="field" style="max-width:150px">
          <span>الحالة</span>
          <select id="inv-status">
            <option value="">الكل</option>
            <option value="active">سارية</option>
            <option value="cancelled">ملغية</option>
          </select>
        </label>
        <button class="btn btn-sm btn-ghost" type="button" id="all-dates">كل الفواتير</button>
        <span class="result-count" id="inv-count"></span>
      </div>
      <div id="invoice-results"></div>
    </div>
  `;

  const el = (sel) => container.querySelector(sel);
  const searchEl = el('#inv-search');
  const fromEl = el('#inv-from');
  const toEl = el('#inv-to');
  const statusEl = el('#inv-status');
  const resultsEl = el('#invoice-results');
  const countEl = el('#inv-count');

  let rows = [];

  async function load() {
    const fromVal = fromEl.value;
    const toVal = toEl.value;
    let from = null;
    let to = null;
    if (fromVal && toVal) {
      if (fromVal > toVal) {
        toast('تاريخ البداية بعد النهاية', 'error');
        return;
      }
      from = localDateStartISO(fromVal);
      to = localDateEndISO(toVal);
    } else if (fromVal) {
      from = localDateStartISO(fromVal);
    } else if (toVal) {
      to = localDateEndISO(toVal);
    }
    resultsEl.innerHTML = `<div class="empty"><span class="spinner"></span><span class="muted">بندور…</span></div>`;
    try {
      rows = await queryInvoices({
        from,
        to,
        search: searchEl.value.trim(),
        status: statusEl.value || null,
        limit: 1500
      });
      renderRows();
    } catch (e) {
      resultsEl.innerHTML = emptyState('receipt', 'حصل خطأ في تحميل الفواتير', e.message || '');
    }
  }

  function renderRows() {
    countEl.textContent = `${rows.length} فاتورة`;
    if (!rows.length) {
      resultsEl.innerHTML = emptyState('receipt', 'مفيش فواتير', 'جرّب تغيّر التاريخ أو كلمة البحث.');
      return;
    }
    resultsEl.innerHTML = `<div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>رقم</th>
            <th>التاريخ</th>
            <th>اللوحة</th>
            <th>التليفون</th>
            <th>الخدمات</th>
            ${settings.pricingEnabled ? '<th class="num">الإجمالي</th>' : ''}
            <th>الدفع</th>
            <th>الحالة</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((inv) => `
            <tr class="${inv.status === 'cancelled' ? 'cancelled' : ''}" data-invoice="${inv.id}">
              <td><b>#${esc(formatInvoiceNo(inv.number))}</b></td>
              <td class="nowrap"><span class="small">${esc(fmtDate(inv.createdAt))}</span><br><span class="tiny muted">${esc(fmtTime(inv.createdAt))}</span></td>
              <td>${inv.plate?.display ? `<b>${esc(inv.plate.display)}</b>` : '<span class="muted">—</span>'}</td>
              <td class="numeric">${inv.customerPhone ? esc(inv.customerPhone) : '<span class="muted">—</span>'}</td>
              <td>${itemCount(inv)} <span class="muted tiny">خدمة</span></td>
              ${settings.pricingEnabled ? `<td class="num"><b>${esc(totalText(inv, settings))}</b></td>` : ''}
              <td><span class="badge ${inv.paymentMethod === 'credit' ? 'warn' : ''}">${esc(PAY_LABELS[inv.paymentMethod] || inv.paymentMethod)}</span></td>
              <td>${inv.status === 'cancelled' ? badge('ملغية', 'danger') : badge('سارية', 'success')}</td>
              <td>
                <div class="row-actions">
                  <button class="btn btn-sm btn-secondary" type="button" data-view="${inv.id}" title="تفاصيل">${icon('eye', 15)}</button>
                  <button class="btn btn-sm btn-ghost" type="button" data-print="${inv.id}" title="طباعة">${icon('print', 15)}</button>
                  <button class="btn btn-sm btn-ghost" type="button" data-wa="${inv.id}" title="واتساب">${icon('whatsapp', 15)}</button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

    resultsEl.querySelectorAll('[data-view]').forEach((btn) =>
      btn.addEventListener('click', () => openInvoice(Number(btn.dataset.view))));
    resultsEl.querySelectorAll('[data-print]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const inv = rows.find((r) => String(r.id) === btn.dataset.print);
        if (inv) printReceipt(inv, { settings, preview: true });
      }));
    resultsEl.querySelectorAll('[data-wa]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const inv = rows.find((r) => String(r.id) === btn.dataset.wa);
        if (inv) sendWhatsApp(inv);
      }));
  }

  function invoiceBody(inv) {
    const canCancel = isAdmin && inv.status !== 'cancelled';
    return `
      <div class="invoice-meta">
        <div><span>رقم الفاتورة</span><b>#${esc(formatInvoiceNo(inv.number))}</b></div>
        <div><span>التاريخ</span><b>${esc(fmtDateTime(inv.createdAt))}</b></div>
        <div><span>الكاشير</span><b>${esc(inv.cashierName || '—')}</b></div>
        <div><span>الموظف</span><b>${esc(inv.workerName || '—')}</b></div>
        <div><span>اللوحة</span><b>${esc(inv.plate?.display || '—')}</b></div>
        <div><span>التليفون</span><b class="numeric">${esc(inv.customerPhone || '—')}</b></div>
        <div><span>العميل</span><b>${esc(inv.customerName || '—')}</b></div>
        <div><span>الدفع</span><b>${esc(PAY_LABELS[inv.paymentMethod] || inv.paymentMethod)}</b></div>
        ${inv.notes ? `<div style="grid-column:1/-1"><span>ملاحظات</span><b>${esc(inv.notes)}</b></div>` : ''}
        ${inv.status === 'cancelled' ? `<div style="grid-column:1/-1"><span>سبب الإلغاء</span><b class="muted">${esc(inv.cancelReason || '—')} — ${esc(inv.cancelledByName || '')}</b></div>` : ''}
      </div>
      <div class="invoice-items">
        ${(inv.items || []).map((item) => `
          <div class="invoice-line">
            <span class="il-name">${esc(item.nameSnapshot)}${item.sizeName ? ` <span class="muted tiny">(${esc(item.sizeName)})</span>` : ''}</span>
            <span class="il-qty">×${item.qty}</span>
            <span class="il-price">${settings.pricingEnabled ? (item.priceSnapshot != null ? esc(fmtMoney(item.priceSnapshot * item.qty)) : '—') : ''}</span>
          </div>`).join('')}
      </div>
      ${settings.pricingEnabled && hasPrice(inv) ? `
        <div class="total-row"><span>المجموع</span><span>${esc(fmtMoney(inv.subtotal))}</span></div>
        ${inv.discount > 0 ? `<div class="total-row"><span>الخصم</span><span>− ${esc(fmtMoney(inv.discount))}</span></div>` : ''}
        <div class="grand-total"><span>الإجمالي</span><span class="amount">${esc(fmtMoney(inv.total))}</span></div>
      ` : settings.pricingEnabled ? '<p class="muted small">الخدمات دي مسجلة بدون أسعار.</p>' : ''}
      ${canCancel ? `<hr class="hr"><div class="danger-zone">
        <h3>إلغاء الفاتورة</h3>
        <p class="small muted">الإلغاء مش هيحذف الفاتورة — هتفضل في السجل وبتتستبعد من التقارير.</p>
        <button class="btn btn-sm btn-danger" type="button" id="cancel-invoice">${icon('trash', 15)} إلغاء الفاتورة</button>
      </div>` : ''}
    `;
  }

  function openInvoice(id) {
    const inv = rows.find((r) => r.id === id);
    if (!inv) return;
    const modal = openModal({
      title: `فاتورة #${formatInvoiceNo(inv.number)}`,
      size: 'lg',
      iconName: 'receipt',
      body: invoiceBody(inv),
      actions: [
        { label: 'إغلاق', kind: 'btn-ghost', onClick: (close) => close() },
        { label: 'واتساب', kind: 'btn-secondary', icon: 'whatsapp', onClick: () => sendWhatsApp(inv) },
        { label: 'طباعة', kind: 'btn-primary', icon: 'print', onClick: () => printReceipt(inv, { settings, preview: true }) }
      ]
    });
    modal.body.querySelector('#cancel-invoice')?.addEventListener('click', () => {
      modal.close();
      openCancel(inv);
    });
  }

  function openCancel(inv) {
    const modal = openModal({
      title: `إلغاء الفاتورة #${formatInvoiceNo(inv.number)}`,
      size: 'sm',
      iconName: 'trash',
      body: `<label class="field"><span>سبب الإلغاء (مطلوب)</span>
        <textarea id="cancel-reason" rows="3" placeholder="مثال: العميل استنى / خطأ في الخدمة"></textarea>
        <small class="field-error" id="cancel-error" hidden>اكتب السبب</small>
      </label>
      <p class="help-card">الإلغاء هيسجل باسمك ووقت الإلغاء، ومش هيتحسب في التقارير.</p>`,
      actions: [
        { label: 'رجوع', kind: 'btn-ghost', onClick: (close) => close() },
        {
          label: 'تأكيد الإلغاء',
          kind: 'btn-danger',
          icon: 'trash',
          busyText: 'بنلغي…',
          onClick: async (close, handle) => {
            const reason = handle.body.querySelector('#cancel-reason').value.trim();
            const error = handle.body.querySelector('#cancel-error');
            if (!reason) { error.hidden = false; handle.body.querySelector('#cancel-reason').focus(); return; }
            try {
              await cancelInvoice(inv.id, { reason, user });
              notifyEvent('invoice.cancel', { invoice: { ...inv, status: 'cancelled', cancelReason: reason }, reason, by: user?.name });
              toast('الفاتورة اتلغت', 'success');
              close();
              await load();
            } catch (e) {
              toast(e.message || 'مش قادر ألغي الفاتورة', 'error');
            }
          }
        }
      ]
    });
    setTimeout(() => modal.body.querySelector('#cancel-reason')?.focus(), 80);
  }

  function sendWhatsApp(inv) {
    const phone = settings.ownerPhone;
    const target = phone ? onlyDigits(toIntlPhone(phone)) : '';
    if (!target) {
      toast('حدد رقم واتساب صاحب المغسلة من الإعدادات الأول', 'error', 4200);
      return;
    }
    const lines = [
      `*${settings.businessName || 'مغسلة سيارات'}*`,
      `فاتورة #${formatInvoiceNo(inv.number)}`,
      `${fmtDateTime(inv.createdAt)}`,
      inv.plate?.display ? `اللوحة: ${inv.plate.display}` : '',
      '',
      ...(inv.items || []).map((item) => {
        const price = settings.pricingEnabled && item.priceSnapshot != null
          ? ` — ${fmtMoney(item.priceSnapshot * item.qty)}` : '';
        return `• ${item.nameSnapshot}${item.qty > 1 ? ` ×${item.qty}` : ''}${price}`;
      }),
      ''
    ];
    if (settings.pricingEnabled && hasPrice(inv)) {
      lines.push(`الإجمالي: ${fmtMoney(inv.total)}`);
      lines.push(`الدفع: ${PAY_LABELS[inv.paymentMethod] || inv.paymentMethod}`);
    }
    lines.push('', settings.receiptFooter || 'شكراً لزيارتكم');
    const text = encodeURIComponent(lines.filter((l) => l != null).join('\n'));
    const url = `https://wa.me/${target}?text=${text}`;
    window.open(url, '_blank', 'noopener');
  }

  const reload = debounce(load, 320);
  searchEl.addEventListener('input', reload);
  fromEl.addEventListener('change', load);
  toEl.addEventListener('change', load);
  statusEl.addEventListener('change', load);
  el('#all-dates').addEventListener('click', () => {
    fromEl.value = '';
    toEl.value = '';
    load();
  });
  el('#refresh-invoices').addEventListener('click', load);

  await load();

  return () => { /* no global listeners */ };
}
