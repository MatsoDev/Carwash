import {
  getAllSettings, listCustomers, addCustomer, customerStatement, addPayment
} from './db.js';
import {
  esc, icon, toast, fmtMoney, fmtDateTime, onlyDigits,
  isValidEgyptPhone, toIntlPhone, openModal, debounce, emptyState
} from './ui.js';
import { getCurrentUser } from './auth.js';
import { notifyEvent } from './notifications.js';

function initial(name) {
  const s = String(name || '؟').trim();
  return s ? s[0] : '؟';
}

function balanceClass(balance) {
  const n = Number(balance) || 0;
  if (n > 0) return 'negative';
  if (n < 0) return '';
  return 'zero';
}

function balanceText(balance) {
  const n = Number(balance) || 0;
  if (n > 0) return `${fmtMoney(n)} عليه`;
  if (n < 0) return `${fmtMoney(Math.abs(n))} له`;
  return 'مسدد';
}

export async function renderCustomers(container) {
  const settings = await getAllSettings();
  const user = getCurrentUser();
  let customers = [];
  let query = '';

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>العملاء والآجل</h1>
        <p>أرصدة العملاء، الدفعات، وكشف حساب كامل لكل واحد.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-primary" type="button" id="add-customer">${icon('plus', 16)} عميل جديد</button>
        <button class="btn btn-sm btn-ghost" type="button" id="refresh-customers">${icon('refresh', 16)} تحديث</button>
      </div>
    </div>

    <div class="panel">
      <div class="filters">
        <label class="field search">
          <span>بحث</span>
          <div class="search-inline">
            ${icon('search', 17)}
            <input id="cust-search" type="search" placeholder="اسم العميل أو رقم التليفون…" autocomplete="off">
          </div>
        </label>
        <span class="result-count" id="cust-count"></span>
      </div>
      <div class="panel-body" id="customers-list"></div>
    </div>
  `;

  const el = (sel) => container.querySelector(sel);
  const listEl = el('#customers-list');
  const searchEl = el('#cust-search');
  const countEl = el('#cust-count');

  function renderList() {
    const totalDebt = customers.reduce((s, c) => s + Math.max(0, Number(c.balance) || 0), 0);
    const debtors = customers.filter((c) => Number(c.balance) > 0).length;
    countEl.textContent = `${customers.length} عميل — إجمالي الآجل ${fmtMoney(totalDebt)}`;
    if (!customers.length) {
      listEl.innerHTML = emptyState('users', query ? 'مفيش نتائج' : 'مفيش عملاء لسه',
        query ? 'جرّب كلمة بحث تانية.' : 'العميل بيتضاف تلقائيًا لما تسجل فاتورة آجل برقم تليفون، أو ضيفه من فوق.');
      return;
    }
    listEl.innerHTML = `
      <div class="about-list" style="margin-bottom:12px">
        <div><span>عملاء عليهم آجل</span><b>${debtors}</b></div>
        <div><span>إجمالي الآجل</span><b>${esc(fmtMoney(totalDebt))}</b></div>
      </div>
      ${customers.map((c) => `
        <div class="customer-card" data-customer="${c.id}">
          <span class="avatar">${esc(initial(c.name))}</span>
          <div class="customer-main">
            <div class="customer-name">${esc(c.name || 'عميل')}</div>
            <div class="customer-phone">${esc(c.phone || '—')}</div>
          </div>
          <div class="customer-balance ${balanceClass(c.balance)}">${esc(balanceText(c.balance))}</div>
          <div class="row" style="gap:4px">
            <button class="btn btn-sm btn-ghost" type="button" data-statement="${c.id}" title="كشف حساب">${icon('eye', 15)}</button>
            <button class="btn btn-sm btn-secondary" type="button" data-pay="${c.id}">${icon('coins', 15)} دفعة</button>
            <button class="btn btn-sm btn-ghost" type="button" data-wa="${c.id}" title="واتساب">${icon('whatsapp', 15)}</button>
          </div>
        </div>`).join('')}`;

    listEl.querySelectorAll('[data-statement]').forEach((btn) =>
      btn.addEventListener('click', () => openStatement(Number(btn.dataset.statement))));
    listEl.querySelectorAll('[data-pay]').forEach((btn) =>
      btn.addEventListener('click', () => openPayment(Number(btn.dataset.pay))));
    listEl.querySelectorAll('[data-wa]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const c = customers.find((x) => x.id === Number(btn.dataset.wa));
        if (c) sendWhatsApp(c);
      }));
    listEl.querySelectorAll('.customer-card').forEach((card) =>
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        openStatement(Number(card.dataset.customer));
      }));
  }

  async function load() {
    listEl.innerHTML = `<div class="empty"><span class="spinner"></span><span class="muted">بنجيب العملاء…</span></div>`;
    try {
      customers = await listCustomers(query);
      customers.sort((a, b) => {
        const diff = (Number(b.balance) || 0) - (Number(a.balance) || 0);
        if (diff !== 0) return diff;
        return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
      });
      renderList();
    } catch (e) {
      listEl.innerHTML = emptyState('info', 'مش قادر أحمل العملاء', e.message || '');
    }
  }

  function openAddCustomer() {
    const modal = openModal({
      title: 'عميل جديد',
      size: 'sm',
      iconName: 'users',
      body: `
        <label class="field"><span>اسم العميل <small class="muted">(اختياري)</small></span>
          <input id="nc-name" type="text" maxlength="60" placeholder="مثال: محمد أحمد" autofocus>
        </label>
        <label class="field" style="margin-top:10px"><span>رقم التليفون</span>
          <input id="nc-phone" type="tel" inputmode="numeric" maxlength="11" placeholder="01xxxxxxxxx">
          <small class="field-error" id="nc-error" hidden>رقم مصري: 010/011/012/015 + 8 أرقام</small>
        </label>`,
      actions: [
        { label: 'إلغاء', kind: 'btn-ghost', onClick: (close) => close() },
        {
          label: 'حفظ',
          kind: 'btn-primary',
          icon: 'save',
          busyText: 'بنحفظ…',
          onClick: async (close, handle) => {
            const phone = onlyDigits(handle.body.querySelector('#nc-phone').value);
            const name = handle.body.querySelector('#nc-name').value.trim();
            const error = handle.body.querySelector('#nc-error');
            if (!isValidEgyptPhone(phone)) {
              error.hidden = false;
              handle.body.querySelector('#nc-phone').focus();
              return;
            }
            try {
              await addCustomer({ name, phone });
              toast('العميل اتضاف', 'success');
              close();
              await load();
            } catch (e) {
              toast(e.message || 'مش قادر أضيف العميل', 'error');
            }
          }
        }
      ]
    });
    setTimeout(() => modal.body.querySelector('#nc-name')?.focus(), 80);
  }

  function statementModalBody(data, balance) {
    const rowsAsc = data.rows.map((row) => ({ ...row }));
    let running = 0;
    for (const row of rowsAsc) {
      if (row.kind === 'invoice') running += Number(row.amount) || 0;
      else running -= Number(row.amount) || 0;
      row.running = Math.round(running * 100) / 100;
    }
    const rowsDesc = rowsAsc.slice().reverse();
    return `
      <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-weight:900;font-size:1.1rem">${esc(data.customer.name || 'عميل')}</div>
          <div class="customer-phone numeric">${esc(data.customer.phone)}</div>
        </div>
        <div style="text-align:left">
          <div class="kpi-label">الرصيد الحالي</div>
          <div class="customer-balance ${balanceClass(balance)}" style="font-size:1.2rem">${esc(balanceText(balance))}</div>
        </div>
      </div>
      <div class="statement">
        ${rowsDesc.length ? rowsDesc.map((row) => `
          <div class="statement-row">
            <div class="stmt-main">
              <div>${row.kind === 'invoice'
                ? `فاتورة آجل #${esc(String(row.invoice.number).padStart(4, '0'))}`
                : `دفعة${row.payment?.note ? ` — ${esc(row.payment.note)}` : ''}`}</div>
              <div class="small muted">${esc(fmtDateTime(row.date))}</div>
            </div>
            <div class="stmt-amount ${row.kind === 'invoice' ? 'out' : 'in'}">
              ${row.kind === 'invoice' ? '+' : '−'} ${esc(fmtMoney(row.amount))}
              <div class="statement-balance">الرصيد: ${esc(fmtMoney(row.running))}</div>
            </div>
          </div>`).join('') : `<p class="muted small">مفيش حركات آجل أو دفعات لسه.</p>`}
      </div>`;
  }

  async function openStatement(customerId) {
    let data;
    try {
      data = await customerStatement(customerId);
    } catch (e) {
      toast(e.message || 'مش قادر أجيب كشف الحساب', 'error');
      return;
    }
    const customer = customers.find((c) => c.id === customerId) || data.customer;
    const modal = openModal({
      title: 'كشف حساب',
      size: 'lg',
      iconName: 'receipt',
      body: statementModalBody(data, customer.balance),
      actions: [
        { label: 'إغلاق', kind: 'btn-ghost', onClick: (close) => close() },
        { label: 'واتساب', kind: 'btn-secondary', icon: 'whatsapp', onClick: () => sendWhatsApp(customer) },
        {
          label: 'تسجيل دفعة', kind: 'btn-primary', icon: 'coins',
          onClick: () => { modal.close(); openPayment(customer.id); }
        }
      ]
    });
  }

  function openPayment(customerId) {
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    const suggested = Math.max(0, Number(customer.balance) || 0);
    const modal = openModal({
      title: `دفعة من ${customer.name || 'عميل'}`,
      size: 'sm',
      iconName: 'coins',
      body: `
        <div class="about-list" style="margin-bottom:12px">
          <div><span>الرصيد الحالي</span><b>${esc(balanceText(customer.balance))}</b></div>
        </div>
        <label class="field"><span>المبلغ المدفوع</span>
          <input id="pay-amount" type="number" inputmode="decimal" min="0.01" step="any"
            value="${suggested || ''}" placeholder="0" autofocus>
          <small class="field-error" id="pay-error" hidden>اكتب مبلغ أكبر من صفر</small>
        </label>
        <label class="field" style="margin-top:10px"><span>ملاحظة <small class="muted">(اختياري)</small></span>
          <input id="pay-note" type="text" maxlength="100" placeholder="مثال: دفعة نقدية">
        </label>`,
      actions: [
        { label: 'إلغاء', kind: 'btn-ghost', onClick: (close) => close() },
        {
          label: 'تسجيل الدفعة',
          kind: 'btn-primary',
          icon: 'check',
          busyText: 'بنسجل…',
          onClick: async (close, handle) => {
            const amount = Number(handle.body.querySelector('#pay-amount').value);
            const note = handle.body.querySelector('#pay-note').value.trim();
            const error = handle.body.querySelector('#pay-error');
            if (!amount || amount <= 0) {
              error.hidden = false;
              return;
            }
            try {
              const payment = await addPayment(customerId, amount, { user, note });
              notifyEvent('credit.payment', {
                customerName: payment.customer.name,
                phone: payment.customer.phone,
                amount,
                balance: payment.customer.balance
              });
              toast(`اتسجلت دفعة ${fmtMoney(amount)}`, 'success');
              close();
              await load();
              openStatement(customerId);
            } catch (e) {
              toast(e.message || 'مش قادر أسجل الدفعة', 'error');
            }
          }
        }
      ]
    });
    setTimeout(() => modal.body.querySelector('#pay-amount')?.select(), 100);
  }

  function sendWhatsApp(customer) {
    if (!customer.phone) { toast('مفيش رقم تليفون للعميل', 'error'); return; }
    const n = Number(customer.balance) || 0;
    const lines = [
      `*${settings.businessName || 'مغسلة سيارات'}*`,
      `أهلاً ${customer.name || 'عميل'}،`,
      '',
      n > 0 ? `عليك مبلغ *${fmtMoney(n)}* في حساب الآجل.` : n < 0 ? `عندك رصيد *${fmtMoney(Math.abs(n))}*.` : 'حسابك مسدد بالكامل.',
      '',
      'لو محتاج كشف حساب كامل، كلمنا.',
      settings.receiptFooter || ''
    ];
    const phone = onlyDigits(toIntlPhone(customer.phone));
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank', 'noopener');
  }

  searchEl.addEventListener('input', debounce(() => {
    query = searchEl.value.trim();
    load();
  }, 300));
  el('#add-customer').addEventListener('click', openAddCustomer);
  el('#refresh-customers').addEventListener('click', load);
  el('#add-customer').focus();

  await load();
}
