/* Optional Phase B: direct ESC/POS printing over Web Serial or Web Bluetooth.
   Arabic receipts are rendered to a 1-bit raster bitmap, so no code page is needed. */
import { fmtMoney, fmtDateTime } from './ui.js';
import { getCachedVersion } from './version.js';
import { formatInvoiceNo } from './db.js';

const PAY_LABELS = { cash: 'كاش', visa: 'فيزا', credit: 'آجل' };

let serialPort = null;
let btDevice = null;
let btCharacteristic = null;
let connected = false;
let transportType = '';

const BT_SERVICES = [
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455'
];

export function isSerialSupported() {
  return Boolean(navigator.serial);
}

export function isBluetoothSupported() {
  return Boolean(navigator.bluetooth);
}

export function isSupported() {
  return isSerialSupported() || isBluetoothSupported();
}

export function isConnected() {
  return connected;
}

export function connectionLabel() {
  if (!connected) return 'مش متوصلة';
  return transportType === 'serial' ? 'متوصلة USB / Serial' : 'متوصلة Bluetooth';
}

export async function connectSerial(baudRate = 9600) {
  if (!navigator.serial) throw new Error('Web Serial مش مدعوم في المتصفح ده. استخدم Chrome أو Edge.');
  if (connected) await disconnect();
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: Number(baudRate) || 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  serialPort = port;
  transportType = 'serial';
  connected = true;
  return true;
}

export async function connectBluetooth() {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth مش مدعوم. استخدم Chrome على أندرويد أو الكمبيوتر.');
  if (connected) await disconnect();
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BT_SERVICES
  });
  const server = await device.gatt.connect();
  let characteristic = null;
  for (const serviceId of BT_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceId);
      const chars = await service.getCharacteristics();
      characteristic = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse) || null;
      if (characteristic) break;
    } catch (e) { /* try next */ }
  }
  if (!characteristic) {
    try { server.disconnect(); } catch (e) { /* ignore */ }
    throw new Error('مش لاقي خاصية كتابة على الطابعة دي');
  }
  btDevice = device;
  btCharacteristic = characteristic;
  transportType = 'bluetooth';
  connected = true;
  return true;
}

export async function disconnect() {
  try {
    if (serialPort) await serialPort.close();
  } catch (e) { /* ignore */ }
  try {
    if (btDevice?.gatt?.connected) btDevice.gatt.disconnect();
  } catch (e) { /* ignore */ }
  serialPort = null;
  btDevice = null;
  btCharacteristic = null;
  connected = false;
  transportType = '';
}

async function writeSerial(bytes) {
  if (!serialPort) throw new Error('الطابعة مش متوصلة');
  const writer = serialPort.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

async function writeBluetooth(bytes) {
  if (!btCharacteristic) throw new Error('الطابعة مش متوصلة');
  const chunk = 100;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    if (btCharacteristic.properties.writeWithoutResponse) {
      await btCharacteristic.writeValueWithoutResponse(part);
    } else {
      await btCharacteristic.writeValue(part);
    }
  }
}

async function writeBytes(bytes) {
  if (transportType === 'serial') await writeSerial(bytes);
  else if (transportType === 'bluetooth') await writeBluetooth(bytes);
  else throw new Error('الطابعة مش متوصلة');
}

function dashes(ctx, width, margin, y, paper) {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(margin, y);
  ctx.lineTo(width - margin, y);
  ctx.stroke();
  ctx.restore();
  return y + (paper === 58 ? 10 : 12);
}

function wrapLines(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

async function drawLogo(ctx, settings, width, y) {
  if (!settings.logoDataUrl) return y;
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = settings.logoDataUrl;
    });
    const maxW = width * 0.4;
    const maxH = 90;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (width - w) / 2, y, w, h);
    return y + h + 8;
  } catch (e) {
    return y;
  }
}

function drawQr(ctx, payload, width, y) {
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    const count = qr.getModuleCount();
    const size = Math.min(130, width * 0.35);
    const cell = Math.max(2, Math.floor(size / count));
    const total = cell * count;
    const x0 = (width - total) / 2;
    ctx.fillStyle = '#000';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) ctx.fillRect(x0 + col * cell, y + row * cell, cell, cell);
      }
    }
    return y + total + 8;
  } catch (e) {
    return y;
  }
}

async function renderReceiptCanvas(invoice, settings) {
  await document.fonts.ready.catch(() => {});
  const paper = String(settings.paperWidth || '80');
  const width = paper === '58' ? 384 : 576;
  const margin = paper === '58' ? 10 : 14;
  const fs = paper === '58' ? { small: 16, base: 19, title: 25, total: 23 } : { small: 18, base: 22, title: 30, total: 27 };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 3000;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  let y = 8;
  y = await drawLogo(ctx, settings, width, y);

  const center = (text, font, gap = 4) => {
    ctx.font = font;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    const lines = wrapLines(ctx, text, width - margin * 2);
    for (const line of lines) {
      ctx.fillText(line, width / 2, y);
      y += parseInt(font.match(/(\d+)px/)?.[1] || '20', 10) + gap;
    }
  };
  const column = (label, value, { bold = false, size = 'base' } = {}) => {
    const px = fs[size];
    ctx.font = `${bold ? '700' : '400'} ${px}px Cairo, sans-serif`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillText(label, width - margin, y);
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillText(value, margin, y);
    y += px + 7;
  };

  center(settings.businessName || 'مغسلة سيارات', `900 ${fs.title}px Cairo, sans-serif`, 4);
  if (settings.businessAddress) center(settings.businessAddress, `400 ${fs.small}px Cairo, sans-serif`, 2);
  if (settings.businessPhone) center('ت: ' + settings.businessPhone, `400 ${fs.small}px Cairo, sans-serif`, 2);
  y = dashes(ctx, width, margin, y + 4, paper);

  if (invoice.status === 'cancelled') {
    center('فاتورة ملغية', `700 ${fs.base}px Cairo, sans-serif`, 4);
  }
  column('فاتورة رقم', '#' + formatInvoiceNo(invoice.number), { bold: true, size: 'base' });
  column('التاريخ', fmtDateTime(invoice.createdAt));
  if (invoice.cashierName) column('الكاشير', invoice.cashierName);
  if (invoice.workerName) column('الموظف', invoice.workerName);
  if (invoice.plate?.display) column('اللوحة', invoice.plate.display, { bold: true });
  if (!settings.hideCustomerPhone && invoice.customerPhone) column('التليفون', invoice.customerPhone);
  if (invoice.customerName) column('العميل', invoice.customerName);
  y = dashes(ctx, width, margin, y + 2, paper);

  const items = invoice.items || [];
  for (const item of items) {
    const price = settings.pricingEnabled && item.priceSnapshot != null
      ? fmtMoney(item.priceSnapshot * item.qty, false) : '';
    ctx.font = `700 ${fs.base}px Cairo, sans-serif`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    const name = item.nameSnapshot + (item.sizeName ? ` (${item.sizeName})` : '') + (item.qty > 1 ? ` ×${item.qty}` : '');
    const nameMax = width - margin * 2 - (price ? 90 : 0);
    const lines = wrapLines(ctx, name, nameMax);
    lines.forEach((line, idx) => {
      ctx.fillText(line, width - margin, y);
      if (idx === 0 && price) {
        ctx.font = `400 ${fs.base}px Cairo, sans-serif`;
        ctx.direction = 'ltr';
        ctx.textAlign = 'left';
        ctx.fillText(price, margin, y);
      }
      y += fs.base + 5;
    });
  }
  if (invoice.notes) {
    ctx.font = `400 ${fs.small}px Cairo, sans-serif`;
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    for (const line of wrapLines(ctx, 'ملاحظات: ' + invoice.notes, width - margin * 2)) {
      ctx.fillText(line, width - margin, y);
      y += fs.small + 4;
    }
  }

  const hasPriced = items.some((item) => item.priceSnapshot != null);
  const showTotals = settings.pricingEnabled && (hasPriced || !settings.hideUnpricedTotals);
  if (showTotals) {
    y = dashes(ctx, width, margin, y + 4, paper);
    column('المجموع', fmtMoney(invoice.subtotal || 0, true));
    if (invoice.discount > 0) column('الخصم', '− ' + fmtMoney(invoice.discount, true));
    column('الإجمالي', hasPriced ? fmtMoney(invoice.total || 0, true) : 'بدون سعر', { bold: true, size: 'total' });
  }
  if (settings.pricingEnabled) {
    column('طريقة الدفع', PAY_LABELS[invoice.paymentMethod] || invoice.paymentMethod || '—');
  }
  y = dashes(ctx, width, margin, y + 2, paper);

  if (settings.showQr) {
    const payload = `CARWASH|${formatInvoiceNo(invoice.number)}|${invoice.createdAt}|${invoice.total || 0}|v${getCachedVersion().version}`;
    y = drawQr(ctx, payload, width, y);
  }
  center(settings.receiptFooter || 'شكراً لزيارتكم', `700 ${fs.base}px Cairo, sans-serif`, 3);
  if (settings.showAppVersion) center('v' + getCachedVersion().version, `400 ${fs.small}px Cairo, sans-serif`, 2);
  y += 12;

  // trim trailing white rows
  const height = Math.min(canvas.height, Math.ceil(y));
  const img = ctx.getImageData(0, 0, width, height);
  const data = img.data;
  const bytesPerRow = Math.ceil(width / 8);
  const raster = new Uint8Array(bytesPerRow * height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 160) {
        raster[row * bytesPerRow + (col >> 3)] |= 0x80 >> (col & 7);
      }
    }
  }
  return { raster, bytesPerRow, height };
}

function escposCommands(raster, bytesPerRow, height) {
  const header = [];
  header.push(0x1b, 0x40); // init
  header.push(0x1b, 0x61, 0x00);
  header.push(0x1d, 0x76, 0x30, 0x00,
    bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff);
  const footer = [
    0x0a, 0x0a, 0x0a,
    0x1d, 0x56, 0x00, // cut
    0x1b, 0x70, 0x00, 0x19, 0xfa // cash drawer kick
  ];
  const out = new Uint8Array(header.length + raster.length + footer.length);
  out.set(header, 0);
  out.set(raster, header.length);
  out.set(footer, header.length + raster.length);
  return out;
}

export async function printInvoice(invoice, settings) {
  if (!connected) throw new Error('وصّل الطابعة الأول من الإعدادات');
  const { raster, bytesPerRow, height } = await renderReceiptCanvas(invoice, settings);
  const bytes = escposCommands(raster, bytesPerRow, height);
  await writeBytes(bytes);
  return true;
}

export async function printTest(settings) {
  const sample = {
    number: 9999,
    createdAt: new Date().toISOString(),
    cashierName: 'اختبار ESC/POS',
    workerName: '',
    plate: { letters: '', numbers: '', display: '' },
    customerPhone: '',
    customerName: '',
    items: [{ nameSnapshot: 'غسيل تجريبي', priceSnapshot: settings.pricingEnabled ? 50 : null, qty: 1 }],
    subtotal: settings.pricingEnabled ? 50 : 0,
    discount: 0,
    total: settings.pricingEnabled ? 50 : 0,
    paymentMethod: 'cash',
    status: 'active',
    notes: 'اختبار الطباعة العربية'
  };
  return printInvoice(sample, settings);
}
