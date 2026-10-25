import { getAllSettings, listServices, formatInvoiceNo } from './db.js';
import {
  esc, fmtMoney, fmtDateTime, openModal, icon, toast
} from './ui.js';
import { getCachedVersion } from './version.js';
import * as escpos from './escpos.js';
import { notifyError } from './notifications.js';

const PAY_LABELS = { cash: 'كاش', visa: 'فيزا', credit: 'آجل' };

let qrCounter = 0;

function qrSvg(text) {
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) {
    return '';
  }
}

function receiptTotals(invoice, settings) {
  const priced = (invoice.items || []).some((item) => item.priceSnapshot != null);
  if (!settings.pricingEnabled) return { show: false, priced: false };
  if (!priced && settings.hideUnpricedTotals) return { show: false, priced: false };
  return { show: true, priced };
}

export function renderReceiptHTML(invoice, settings, qrText = '') {
  const width = String(settings.paperWidth || '80');
  const totals = receiptTotals(invoice, settings);
  const showPhone = !settings.hideCustomerPhone && invoice.customerPhone;
  const items = invoice.items || [];
  const itemsHtml = items.map((item) => {
    const price = settings.pricingEnabled && item.priceSnapshot != null
      ? fmtMoney(item.priceSnapshot * item.qty, false) : '';
    const qty = item.qty > 1 ? `<span class="r-qty">×${item.qty}</span>` : '';
    const size = item.sizeName ? `<span class="r-size">${esc(item.sizeName)}</span>` : '';
    return `<div class="r-item">
      <div class="r-item-name">${esc(item.nameSnapshot)}${size} ${qty}</div>
      ${price ? `<div class="r-item-price">${esc(price)}</div>` : ''}
    </div>`;
  }).join('');

  const qr = settings.showQr && qrText ? `<div class="r-qr">${qrSvg(qrText)}</div>` : '';
  const version = getCachedVersion().version;
  const logo = settings.logoDataUrl ? `<div class="r-logo"><img src="${settings.logoDataUrl}" alt=""></div>` : '';

  const totalBlock = totals.show ? `
    <div class="r-dash"></div>
    <div class="r-row"><span>المجموع</span><span>${esc(fmtMoney(invoice.subtotal || 0, true))}</span></div>
    ${invoice.discount > 0 ? `<div class="r-row"><span>الخصم</span><span>− ${esc(fmtMoney(invoice.discount, true))}</span></div>` : ''}
    <div class="r-row r-total"><span>الإجمالي</span><span>${totals.priced ? esc(fmtMoney(invoice.total || 0, true)) : 'بدون سعر'}</span></div>` : '';

  const payment = settings.pricingEnabled
    ? `<div class="r-row"><span>طريقة الدفع</span><span>${esc(PAY_LABELS[invoice.paymentMethod] || invoice.paymentMethod || '—')}</span></div>`
    : '';

  return `
  <div class="receipt paper-${esc(width)}" data-receipt>
    <div class="r-inner">
      ${logo}
      <div class="r-business">${esc(settings.businessName || 'مغسلة سيارات')}</div>
      ${settings.businessAddress ? `<div class="r-muted">${esc(settings.businessAddress)}</div>` : ''}
      ${settings.businessPhone ? `<div class="r-muted">ت: ${esc(settings.businessPhone)}</div>` : ''}
      <div class="r-dash"></div>
      ${invoice.status === 'cancelled' ? '<div class="r-cancelled">فاتورة ملغية</div>' : ''}
      <div class="r-row"><span>فاتورة رقم</span><b>#${esc(formatInvoiceNo(invoice.number))}</b></div>
      <div class="r-row"><span>التاريخ</span><span>${esc(fmtDateTime(invoice.createdAt))}</span></div>
      ${invoice.cashierName ? `<div class="r-row"><span>الكاشير</span><span>${esc(invoice.cashierName)}</span></div>` : ''}
      ${invoice.workerName ? `<div class="r-row"><span>الموظف</span><span>${esc(invoice.workerName)}</span></div>` : ''}
      ${invoice.plate?.display ? `<div class="r-row"><span>اللوحة</span><b>${esc(invoice.plate.display)}</b></div>` : ''}
      ${showPhone ? `<div class="r-row"><span>التليفون</span><span>${esc(invoice.customerPhone)}</span></div>` : ''}
      ${invoice.customerName ? `<div class="r-row"><span>العميل</span><span>${esc(invoice.customerName)}</span></div>` : ''}
      <div class="r-dash"></div>
      <div class="r-items">${itemsHtml || '<div class="r-muted">مفيش خدمات</div>'}</div>
      ${invoice.notes ? `<div class="r-notes">${esc(invoice.notes)}</div>` : ''}
      ${totalBlock}
      ${payment}
      <div class="r-dash"></div>
      ${qr}
      <div class="r-thanks">${esc(settings.receiptFooter || 'شكراً لزيارتكم')}</div>
      ${settings.showAppVersion ? `<div class="r-version">v${esc(version)}</div>` : ''}
    </div>
  </div>`;
}

function qrPayload(invoice) {
  const v = getCachedVersion().version;
  return `CARWASH|${formatInvoiceNo(invoice.number)}|${invoice.createdAt}|${invoice.total || 0}|v${v}`;
}

function setPageSize(width) {
  let style = document.getElementById('page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'page-style';
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${width}mm auto; margin: 0; }`;
}

async function prepareReceipt(invoice, settings) {
  setPageSize(String(settings.paperWidth || '80'));
  const host = document.getElementById('receipt');
  if (!host) return;
  host.className = `receipt paper-${settings.paperWidth || '80'}`;
  host.innerHTML = renderReceiptHTML(invoice, settings, qrPayload(invoice));
  try { await document.fonts.ready; } catch (e) { /* ignore */ }
}

async function browserPrint() {
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    window.print();
  } catch (e) {
    toast('الطابعة مش متاحة. جرّب تطبع من المتصفح أو راجع إعدادات الطباعة.', 'error');
    notifyError('فشل فتح نافذة الطباعة: ' + (e.message || e), 'print');
  }
}

async function dispatchPrint(invoice, settings) {
  if (settings.receiptMode === 'escpos' && escpos.isConnected()) {
    try {
      await escpos.printInvoice(invoice, settings);
      toast('الفاتورة اتبعتت للطابعة', 'success');
      return;
    } catch (e) {
      toast('طابعة ESC/POS مش شغالة — هنطبع من المتصفح', 'error');
      notifyError('ESC/POS: ' + (e.message || e), 'print');
    }
  }
  await browserPrint();
}

export async function printReceipt(invoice, options = {}) {
  const settings = options.settings || await getAllSettings();
  await prepareReceipt(invoice, settings);
  const shouldPreview = options.preview ?? (settings.printPreview || settings.autoPrint === false);

  if (shouldPreview) {
    const modal = openModal({
      title: 'معاينة الفاتورة',
      size: 'receipt-modal',
      iconName: 'receipt',
      body: `<div class="receipt-preview">${renderReceiptHTML(invoice, settings, qrPayload(invoice))}</div>`,
      actions: [
        { label: 'إغلاق', kind: 'btn-ghost', onClick: (close) => close() },
        {
          label: 'اطبع',
          kind: 'btn-primary',
          icon: 'print',
          onClick: async () => {
            if (settings.receiptMode === 'escpos' && escpos.isConnected()) {
              try {
                await escpos.printInvoice(invoice, settings);
                toast('الفاتورة اتبعتت للطابعة', 'success');
              } catch (e) {
                toast('فشل ESC/POS — هنطبع من المتصفح', 'error');
                await browserPrint();
              }
            } else {
              await browserPrint();
            }
          }
        }
      ]
    });
    return modal;
  }
  await dispatchPrint(invoice, settings);
  return null;
}

export async function testPrint() {
  const settings = await getAllSettings();
  const services = (await listServices()).filter((s) => s.active).slice(0, 3);
  const items = services.length ? services.map((s, i) => ({
    serviceId: s.id,
    nameSnapshot: s.name,
    priceSnapshot: s.price != null ? s.price : (settings.pricingEnabled ? 50 + i * 10 : null),
    qty: 1,
    sizeName: settings.perSizePricing ? 'ملاكي' : ''
  })) : [{
    serviceId: 0,
    nameSnapshot: 'غسيل تجريبي',
    priceSnapshot: settings.pricingEnabled ? 50 : null,
    qty: 1
  }];
  const subtotal = items.reduce((sum, x) => sum + (x.priceSnapshot || 0) * x.qty, 0);
  const sample = {
    number: 9999,
    createdAt: new Date().toISOString(),
    cashierName: 'طباعة تجريبية',
    workerName: '—',
    plate: { letters: 'س ص ع', numbers: '1234', display: 'س ص ع 1234' },
    customerPhone: '01000000000',
    customerName: 'عميل تجريبي',
    items,
    subtotal,
    discount: 0,
    total: subtotal,
    paymentMethod: 'cash',
    status: 'active',
    notes: ''
  };
  await printReceipt(sample, { settings, preview: true });
  return sample;
}

export async function printPreviewOnly(invoice) {
  const settings = await getAllSettings();
  return printReceipt(invoice, { settings, preview: true });
}
