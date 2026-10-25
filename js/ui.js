/* Shared UI helpers: escaping, formatting, modals, toasts, CSV, icons. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeDigits(value) {
  return String(value == null ? '' : value)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function onlyDigits(value) {
  return normalizeDigits(value).replace(/\D+/g, '');
}

export function isValidEgyptPhone(value) {
  return /^01[0125]\d{8}$/.test(onlyDigits(value));
}

export function toIntlPhone(value) {
  const digits = onlyDigits(value);
  if (!digits) return '';
  if (digits.startsWith('20')) return '+' + digits;
  if (digits.startsWith('0')) return '+20' + digits.slice(1);
  return '+20' + digits;
}

export function fmtMoney(value, withCurrency = true) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const text = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
  return withCurrency ? `${text} ج.م` : text;
}

export function fmtNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

const dateFmt = new Intl.DateTimeFormat('ar-EG', {
  numberingSystem: 'latn', day: '2-digit', month: 'short', year: 'numeric'
});
const timeFmt = new Intl.DateTimeFormat('ar-EG', {
  numberingSystem: 'latn', hour: '2-digit', minute: '2-digit', hour12: true
});

export function fmtDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return dateFmt.format(d);
}

export function fmtTime(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return timeFmt.format(d);
}

export function fmtDateTime(value) {
  if (!value) return '—';
  return `${fmtDate(value)} — ${fmtTime(value)}`;
}

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function localDateStartISO(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toISOString();
}

export function localDateEndISO(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export function debounce(fn, wait = 250) {
  let t = 0;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

let toastRoot = null;
export function toast(message, kind = 'info', ms = 3200) {
  if (!toastRoot) toastRoot = document.getElementById('toast-root');
  if (!toastRoot) return;
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  const iconName = kind === 'success' ? 'check' : kind === 'error' ? 'x' : 'info';
  node.innerHTML = `${icon(iconName)}<span>${esc(message)}</span>`;
  toastRoot.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 260);
  }, ms);
}

const ICONS = {
  cart: '<path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M16 12h4"/><path d="M3 9h16"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 5.5a3 3 0 0 1 0 5.8M18 14a6 6 0 0 1 4 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8z"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 17h12v4H6z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  whatsapp: '<path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.5-4A8 8 0 1 1 20 11.5z"/><path d="M8.8 8.4c.3-.5 1.2-.5 1.4 0l.6 1.2c.1.3 0 .6-.2.8l-.5.5c.5 1 1.3 1.8 2.3 2.3l.5-.5c.2-.2.5-.3.8-.2l1.2.6c.5.2.5 1.1 0 1.4-1.6 1-4.9-1.1-6.1-4-.2-.7-.1-1.5 0-2.1z"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A10.8 10.8 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.4 3.9M6.5 6.6A17.5 17.5 0 0 0 2 12s3.5 6 10 6a10.9 10.9 0 0 0 4.1-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l3 3"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  cloud: '<path d="M18 18H7a4 4 0 0 1-.6-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 18 18z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  external: '<path d="M14 3h7v7M10 14L21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  car: '<path d="M5 17h14l1-5-2-5H6L4 12l1 5z"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M5 12h14"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/>',
  wifiOff: '<path d="M2 2l20 20"/><path d="M8.5 8.5A13 13 0 0 1 22 9M2 9a15 15 0 0 1 4.2-2.8M5 13a10 10 0 0 1 4-2M8.5 16.5a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"/>',
  tag: '<path d="M20.6 13.4L12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  coins: '<circle cx="9" cy="9" r="6"/><path d="M14.5 5.3a6 6 0 1 1-8.8 8.2"/><path d="M15 15h6M18 12v6"/>'
};

export function icon(name, size = 20) {
  const path = ICONS[name] || ICONS.info;
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/* ---------------- Modals ---------------- */
const modalStack = [];

export function openModal({
  title = '',
  body = '',
  actions = [],
  size = '',
  dismissible = true,
  onClose = null,
  iconName = '',
  className = ''
} = {}) {
  const root = document.getElementById('modal-root') || document.body;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${size} ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h3>${iconName ? icon(iconName, 22) : ''}<span>${esc(title)}</span></h3>
        ${dismissible ? `<button class="icon-btn modal-x" type="button" aria-label="إغلاق">${icon('x')}</button>` : ''}
      </div>
      <div class="modal-body"></div>
      <div class="modal-actions"></div>
    </div>`;
  const modal = overlay.querySelector('.modal');
  const bodyEl = overlay.querySelector('.modal-body');
  const actionsEl = overlay.querySelector('.modal-actions');
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body || '';

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    overlay.classList.remove('show');
    document.removeEventListener('keydown', onKey, true);
    const idx = modalStack.indexOf(handle);
    if (idx >= 0) modalStack.splice(idx, 1);
    setTimeout(() => overlay.remove(), 180);
    if (onClose) onClose(result);
  };
  const handle = { close, root: overlay, modal, body: bodyEl };

  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${action.kind || 'btn-ghost'} ${action.block ? 'btn-block' : ''}`;
    btn.innerHTML = `${action.icon ? icon(action.icon, 18) : ''}<span>${esc(action.label)}</span>`;
    btn.addEventListener('click', async () => {
      if (action.busyText) {
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner"></span><span>${esc(action.busyText)}</span>`;
        try {
          await action.onClick(close, handle);
        } finally {
          if (!closed) { btn.disabled = false; btn.innerHTML = original; }
        }
      } else {
        await action.onClick(close, handle);
      }
    });
    actionsEl.appendChild(btn);
  });
  if (!actions.length) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.innerHTML = '<span>تمام</span>';
    btn.addEventListener('click', () => close());
    actionsEl.appendChild(btn);
  }

  const onKey = (e) => {
    if (modalStack[modalStack.length - 1] !== handle) return;
    if (e.key === 'Escape' && dismissible) {
      e.preventDefault();
      close();
    }
    if (e.key === 'Tab') {
      const focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modal)
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  overlay.querySelector('.modal-x')?.addEventListener('click', () => close());
  if (dismissible) {
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) close();
    });
  }
  document.addEventListener('keydown', onKey, true);
  modalStack.push(handle);
  root.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('show');
    const focusTarget = modal.querySelector('[autofocus]') || modal.querySelector('input:not([type=hidden]), select, textarea') || modal.querySelector('.btn-primary');
    setTimeout(() => focusTarget?.focus(), 60);
  });
  return handle;
}

export function confirmDialog(message, {
  title = 'تأكيد',
  confirmLabel = 'تمام',
  cancelLabel = 'إلغاء',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title,
      size: 'sm',
      body: `<p class="dialog-text">${esc(message)}</p>`,
      actions: [
        { label: cancelLabel, kind: 'btn-ghost', onClick: (close) => { answered = true; close(); resolve(false); } },
        { label: confirmLabel, kind: danger ? 'btn-danger' : 'btn-primary', onClick: (close) => { answered = true; close(); resolve(true); } }
      ],
      onClose: () => { if (!answered) resolve(false); }
    });
    return modal;
  });
}

export function promptDialog(message, {
  title = 'إدخال',
  value = '',
  placeholder = '',
  confirmLabel = 'حفظ',
  inputType = 'text',
  required = true
} = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title,
      size: 'sm',
      body: `<label class="field"><span>${esc(message)}</span>
        <input id="prompt-value" type="${esc(inputType)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus>
        <small class="field-error" id="prompt-error" hidden>مطلوب</small></label>`,
      actions: [
        { label: 'إلغاء', kind: 'btn-ghost', onClick: (close) => { answered = true; close(); resolve(null); } },
        {
          label: confirmLabel, kind: 'btn-primary', onClick: (close, handle) => {
            const input = handle.body.querySelector('#prompt-value');
            const err = handle.body.querySelector('#prompt-error');
            const v = input.value.trim();
            if (required && !v) { err.hidden = false; input.focus(); return; }
            answered = true;
            close();
            resolve(v);
          }
        }
      ],
      onClose: () => { if (!answered) resolve(null); }
    });
    setTimeout(() => modal.body.querySelector('input')?.focus(), 80);
  });
}

/* ---------------- Files ---------------- */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function downloadCsv(rows, filename) {
  const csv = '\uFEFF' + rows.map((row) =>
    row.map((cell) => {
      const s = String(cell == null ? '' : cell);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')
  ).join('\r\n');
  downloadText(csv, filename, 'text/csv;charset=utf-8');
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'utf-8');
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* Downscale an uploaded logo to keep IndexedDB light. */
export async function resizeImageFile(file, maxSize = 420) {
  const dataUrl = await readFileAsDataURL(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL('image/png')); } catch (e) { resolve(dataUrl); }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* ---------------- Theme ---------------- */
export function applyTheme(theme) {
  const t = theme || 'auto';
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePref = t;
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

export function emptyState(iconName, title, text = '') {
  return `<div class="empty">
    <div class="empty-ico">${icon(iconName, 40)}</div>
    <strong>${esc(title)}</strong>
    ${text ? `<p>${esc(text)}</p>` : ''}
  </div>`;
}

export function badge(text, kind = '') {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

export function setBusy(button, busy, label = 'لحظة…') {
  if (!button) return;
  if (busy) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span><span>${esc(label)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.original) button.innerHTML = button.dataset.original;
  }
}
