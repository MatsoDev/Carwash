import {
  getAllSettings, listCategories, listServices, listSizes, listWorkers, priceMatrix,
  createInvoice, findCustomerByPhone, phoneSuggestions, formatInvoiceNo
} from './db.js';
import { Cart } from './cart.js';
import { createPlateWidget } from './plate.js';
import {
  esc, icon, toast, fmtMoney, onlyDigits, isValidEgyptPhone, openModal,
  emptyState
} from './ui.js';
import { getCurrentUser } from './auth.js';
import { printReceipt } from './print.js';
import { notifyEvent } from './notifications.js';

let lastInvoiceSession = null;

const PAY_LABELS = { cash: 'كاش', visa: 'فيزا', credit: 'آجل' };

function paymentIcon(method) {
  return method === 'cash' ? 'wallet' : method === 'visa' ? 'tag' : 'clock';
}

export async function renderCashier(container) {
  const settings = await getAllSettings();
  const categories = await listCategories();
  const [sizes, workers, matrix] = await Promise.all([listSizes(), listWorkers(), priceMatrix()]);
  const servicesByCat = new Map();
  const allServices = await listServices();
  for (const svc of allServices) {
    if (!servicesByCat.has(svc.categoryId)) servicesByCat.set(svc.categoryId, []);
    servicesByCat.get(svc.categoryId).push(svc);
  }

  const state = {
    settings,
    categories,
    servicesByCat,
    sizes,
    workers,
    matrix,
    categoryId: categories[0]?.id ?? null,
    cart: new Cart(),
    paymentMethod: 'cash',
    discountType: 'amount',
    plate: null,
    saving: false
  };

  const hasAnyPrice = allServices.some((s) => s.price != null);
  const pricing = settings.pricingEnabled;
  const savedWorker = (() => {
    try { return sessionStorage.getItem('cw:worker') || ''; } catch (e) { return ''; }
  })();

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>الكاشير</h1>
        <p>دوس على الخدمة، ظبط بيانات الزبون، وخلّص الفاتورة.</p>
      </div>
      <div class="page-actions">
        ${pricing && !hasAnyPrice && getCurrentUser()?.role === 'admin'
          ? `<a class="btn btn-sm btn-secondary" href="#/settings/services">${icon('tag', 16)} اضبط الأسعار</a>` : ''}
        ${!pricing ? '<span class="badge warn">وضع بدون أسعار</span>' : ''}
      </div>
    </div>

    <div class="cashier-grid">
      <section class="panel services-panel">
        <div class="panel-head">
          <h2>${icon('car', 20)} الخدمات</h2>
          <span class="spacer"></span>
          <span class="small muted">دوسة واحدة تضيف للسلة</span>
        </div>
        <div class="cat-tabs" id="cat-tabs" role="tablist"></div>
        <div class="service-grid" id="service-grid"></div>
        <div class="shortcut-hint">
          <span><kbd>F2</kbd> خلّص واطبع</span>
          <span><kbd>F4</kbd> اطبع آخر فاتورة</span>
          <span><kbd>Esc</kbd> امسح السلة</span>
        </div>
      </section>

      <aside class="checkout" id="checkout">
        <div class="panel">
          <div class="panel-head">
            <h2>${icon('cart', 20)} السلة <span class="cart-count" id="cart-count">0</span></h2>
            <span class="spacer"></span>
            <button class="btn btn-sm btn-ghost" type="button" id="clear-cart">${icon('trash', 15)} امسح</button>
          </div>
          <div class="cart-list" id="cart-list"></div>
        </div>

        <div class="panel">
          <div class="checkout-section">
            <h3>${icon('car', 15)} بيانات الزبون</h3>
            <div class="field" style="margin-bottom:8px">
              <span>رقم اللوحة <small class="muted">(اختياري)</small></span>
              <div id="plate-host"></div>
            </div>
            <div class="field-row-2">
              <label class="field">
                <span>تليفون الزبون</span>
                <input id="phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="off"
                  placeholder="01xxxxxxxxx" list="phone-list">
                <small class="field-error" id="phone-error" hidden>رقم مصري: 010/011/012/015 + 8 أرقام</small>
              </label>
              <label class="field">
                <span>اسم الزبون <small class="muted">(اختياري)</small></span>
                <input id="customer-name" type="text" autocomplete="off" placeholder="اسم الزبون">
              </label>
            </div>
            <datalist id="phone-list"></datalist>
            <div class="field-row-2" style="margin-top:8px">
              <label class="field">
                <span>الموظف</span>
                <select id="worker">
                  <option value="">بدون تحديد</option>
                  ${workers.map((w) => `<option value="${w.id}" ${String(w.id) === savedWorker ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}
                </select>
              </label>
              <label class="field">
                <span>ملاحظات</span>
                <input id="notes" type="text" maxlength="120" placeholder="ملاحظة على الفاتورة">
              </label>
            </div>
          </div>
        </div>

        <div class="panel">
          ${pricing ? `
          <div class="checkout-section">
            <h3>${icon('coins', 15)} الدفع</h3>
            <div class="discount-grid">
              <div class="segmented" id="discount-type">
                <button type="button" data-type="amount" class="active">ج.م</button>
                <button type="button" data-type="percent">%</button>
              </div>
              <input class="input" id="discount-value" type="number" inputmode="decimal"
                min="0" step="any" placeholder="الخصم" aria-label="قيمة الخصم">
            </div>
            <div class="pay-methods" id="pay-methods" style="margin-top:8px">
              ${['cash', 'visa', 'credit'].map((m) => `
                <button type="button" class="pay-btn ${m === 'cash' ? 'active' : ''}" data-method="${m}">
                  ${icon(paymentIcon(m), 16)} ${PAY_LABELS[m]}
                </button>`).join('')}
            </div>
            <p class="unpriced-note" id="credit-hint" hidden>الآجل محتاج تليفون الزبون.</p>
            <div class="totals" id="totals"></div>
          </div>` : `
          <div class="checkout-section">
            <p class="muted small" style="margin:0">الأسعار متوقفة حاليًا — الفاتورة هتتسجل بالخدمات فقط. تقدر تفعّلها من الإعدادات.</p>
          </div>`}
          <div class="checkout-actions">
            <button class="btn btn-primary btn-lg btn-block" type="button" id="finish-print">
              ${icon('print', 20)} خلّص واطبع
            </button>
            <button class="btn btn-secondary btn-block" type="button" id="finish-only">
              خلّص بدون طباعة
            </button>
          </div>
        </div>
      </aside>
    </div>

    <div class="mobile-paybar" id="mobile-paybar">
      <div class="mp-total">
        <strong id="mp-total">—</strong>
        <small id="mp-count">0 خدمة</small>
      </div>
      <button class="btn btn-primary" type="button" id="mp-scroll">${icon('cart', 18)} الدفع</button>
    </div>
  `;

  const el = (sel) => container.querySelector(sel);
  const tabsEl = el('#cat-tabs');
  const gridEl = el('#service-grid');
  const cartListEl = el('#cart-list');
  const cartCountEl = el('#cart-count');
  const totalsEl = el('#totals');
  const phoneEl = el('#phone');
  const phoneErrorEl = el('#phone-error');
  const nameEl = el('#customer-name');
  const workerEl = el('#worker');
  const notesEl = el('#notes');
  const discountTypeEl = el('#discount-type');
  const discountValueEl = el('#discount-value');
  const creditHintEl = el('#credit-hint');
  const payMethodsEl = el('#pay-methods');
  const finishPrintBtn = el('#finish-print');
  const finishOnlyBtn = el('#finish-only');
  const mobileTotalEl = el('#mp-total');
  const mobileCountEl = el('#mp-count');

  /* ----- category + services ----- */
  function renderCategories() {
    tabsEl.innerHTML = categories.map((cat) => `
      <button type="button" role="tab" class="cat-tab ${cat.id === state.categoryId ? 'active' : ''}"
        data-cat="${cat.id}" aria-selected="${cat.id === state.categoryId}">
        <span class="cat-icon">${esc(cat.icon || '🚗')}</span>${esc(cat.name)}
      </button>`).join('');
    tabsEl.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.categoryId = Number(btn.dataset.cat);
        renderCategories();
        renderServices();
      });
    });
  }

  function serviceDisplayPrice(service) {
    if (!pricing) return null;
    if (settings.perSizePricing) return 'حسب الحجم';
    return service.price;
  }

  function renderServices() {
    const list = state.servicesByCat.get(state.categoryId) || [];
    const active = list.filter((s) => s.active);
    if (!active.length) {
      gridEl.innerHTML = emptyState('car', 'مفيش خدمات في القسم ده', 'تقدر تضيف خدمات من الإعدادات.');
      return;
    }
    gridEl.innerHTML = active.map((svc) => {
      const displayPrice = serviceDisplayPrice(svc);
      const priceHtml = !pricing ? '' : displayPrice === 'حسب الحجم'
        ? `<span class="service-price">حسب الحجم</span>`
        : svc.price == null
          ? `<span class="service-price unpriced">بدون سعر</span>`
          : `<span class="service-price">${esc(fmtMoney(svc.price))}</span>`;
      return `<button type="button" class="service-btn" data-service="${svc.id}">
        <span class="service-add">${icon('plus', 15)}</span>
        <span class="service-name">${esc(svc.name)}</span>
        ${priceHtml}
      </button>`;
    }).join('');
    gridEl.querySelectorAll('[data-service]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const svc = active.find((s) => String(s.id) === btn.dataset.service);
        if (svc) addService(svc);
      });
    });
  }

  function addItem(service, size = null) {
    let price = pricing ? service.price : null;
    if (pricing && size) {
      const matrixPrice = state.matrix.get(`${service.id}:${size.id}`);
      price = matrixPrice != null ? matrixPrice : service.price;
    }
    state.cart.add({ service, price, size });
    renderCart();
    renderTotals();
  }

  function addService(service) {
    if (settings.perSizePricing && state.sizes.length) {
      const choices = state.sizes.map((size) => {
        const matrixPrice = state.matrix.get(`${service.id}:${size.id}`);
        const price = matrixPrice != null ? matrixPrice : service.price;
        return `<button type="button" class="size-choice" data-size="${size.id}">
          <span>${esc(size.name)}</span>
          <small>${price == null ? 'بدون سعر' : esc(fmtMoney(price))}</small>
        </button>`;
      }).join('');
      openModal({
        title: service.name,
        size: 'sm',
        iconName: 'car',
        body: `<p class="muted small">اختار حجم العربية:</p><div class="size-choices">${choices}</div>`,
        actions: [{ label: 'إلغاء', kind: 'btn-ghost', onClick: (close) => close() }]
      }).body.querySelectorAll('[data-size]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const size = state.sizes.find((s) => String(s.id) === btn.dataset.size);
          btn.closest('.modal-overlay')?.querySelector('.modal-x')?.click();
          addItem(service, size || null);
        });
      });
      return;
    }
    addItem(service);
  }

  /* ----- cart ----- */
  function cartLine(item, index) {
    const showMoney = pricing;
    const lineTotal = item.priceSnapshot != null ? item.priceSnapshot * item.qty : null;
    const priceEditor = showMoney && settings.allowCashierPrice
      ? `<input class="price-edit" type="number" inputmode="decimal" min="0" step="any"
          data-price="${index}" value="${item.priceSnapshot ?? ''}" placeholder="سعر">` : '';
    return `<div class="cart-item">
      <div class="item-main">
        <div class="item-name">${esc(item.nameSnapshot)}</div>
        <div class="item-sub">${item.sizeName ? esc(item.sizeName) + ' • ' : ''}${showMoney ? (item.priceSnapshot != null ? esc(fmtMoney(item.priceSnapshot)) + ' للخدمة' : 'بدون سعر') : 'خدمة'}</div>
        ${priceEditor}
      </div>
      <div class="qty-control">
        <button type="button" class="qty-btn" data-dec="${index}" aria-label="تقليل">${icon('minus', 14)}</button>
        <span class="qty-val">${item.qty}</span>
        <button type="button" class="qty-btn" data-inc="${index}" aria-label="زيادة">${icon('plus', 14)}</button>
      </div>
      ${showMoney ? `<div class="item-price">${lineTotal == null ? '<span class="unpriced-text">—</span>' : esc(fmtMoney(lineTotal))}</div>` : ''}
      <div class="item-actions">
        <button type="button" class="remove-btn" data-remove="${index}" aria-label="مسح">
          ${icon('trash', 13)} مسح
        </button>
      </div>
    </div>`;
  }

  function renderCart() {
    const count = state.cart.count;
    cartCountEl.textContent = count;
    if (state.cart.isEmpty) {
      cartListEl.innerHTML = `<div class="cart-empty">
        <div class="empty-ico">${icon('cart', 24)}</div>
        السلة فاضية — دوس على خدمة.
      </div>`;
    } else {
      cartListEl.innerHTML = state.cart.items.map(cartLine).join('');
      cartListEl.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => {
        state.cart.inc(Number(b.dataset.inc)); renderCart(); renderTotals();
      }));
      cartListEl.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
        state.cart.dec(Number(b.dataset.dec)); renderCart(); renderTotals();
      }));
      cartListEl.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
        state.cart.remove(Number(b.dataset.remove)); renderCart(); renderTotals();
      }));
      cartListEl.querySelectorAll('[data-price]').forEach((input) => {
        input.addEventListener('change', () => {
          state.cart.setPrice(Number(input.dataset.price), input.value);
          renderCart(); renderTotals();
        });
      });
    }
    updateMobile();
    [finishPrintBtn, finishOnlyBtn].forEach((btn) => { btn.disabled = state.cart.isEmpty || state.saving; });
  }

  function totalsData() {
    return state.cart.totals(
      state.discountType,
      pricing ? (Number(discountValueEl?.value) || 0) : 0
    );
  }

  function renderTotals() {
    if (!pricing || !totalsEl) { updateMobile(); return; }
    const t = totalsData();
    const hasPriced = t.hasPricing;
    const itemsCount = state.cart.count;
    totalsEl.innerHTML = `
      ${hasPriced ? `<div class="total-row"><span>المجموع</span><span>${esc(fmtMoney(t.subtotal))}</span></div>` : ''}
      ${t.discount > 0 ? `<div class="total-row"><span>الخصم</span><span>− ${esc(fmtMoney(t.discount))}</span></div>` : ''}
      <div class="grand-total">
        <span>الإجمالي</span>
        <span class="amount">${hasPriced ? esc(fmtMoney(t.total)) : (itemsCount ? 'بدون سعر' : fmtMoney(0))}</span>
      </div>
      ${!hasPriced && itemsCount ? '<p class="unpriced-note">الخدمات دي لسه من غير سعر — الفاتورة هتتحفظ بدون مبلغ.</p>' : ''}
    `;
    if (discountValueEl) discountValueEl.disabled = t.subtotal <= 0;
    updateMobile();
  }

  function updateMobile() {
    if (!mobileTotalEl) return;
    const t = totalsData();
    if (!pricing) {
      mobileTotalEl.textContent = `${state.cart.count} خدمة`;
    } else {
      mobileTotalEl.textContent = t.hasPricing ? fmtMoney(t.total) : (state.cart.count ? 'بدون سعر' : '—');
    }
    mobileCountEl.textContent = `${state.cart.count} خدمة`;
  }

  /* ----- customer fields ----- */
  const plateWidget = createPlateWidget(el('#plate-host'), {
    onChange: (plate) => { state.plate = plate; },
    onSelect: (choice) => {
      state.plate = choice.plate;
      if (choice.customerPhone && !phoneEl.value) {
        phoneEl.value = choice.customerPhone;
        validatePhone(false);
      }
      if (choice.customerName && !nameEl.value) nameEl.value = choice.customerName;
    },
    onExactMatch: (match) => {
      if (match.customerPhone && !phoneEl.value) {
        phoneEl.value = match.customerPhone;
        validatePhone(false);
      }
      if (match.customerName && !nameEl.value) nameEl.value = match.customerName;
    }
  });

  function validatePhone(show = true) {
    const phone = onlyDigits(phoneEl.value);
    phoneEl.value = phone;
    const valid = !phone || isValidEgyptPhone(phone);
    phoneErrorEl.hidden = valid;
    phoneErrorEl.textContent = valid ? '' : 'رقم مصري: 010/011/012/015 + 8 أرقام';
    if (!valid && show) phoneEl.focus();
    return valid;
  }

  phoneEl.addEventListener('input', () => {
    phoneEl.value = onlyDigits(phoneEl.value).slice(0, 11);
    phoneErrorEl.hidden = true;
  });
  phoneEl.addEventListener('blur', async () => {
    if (!validatePhone(false)) return;
    const phone = phoneEl.value;
    if (!phone) return;
    const customer = await findCustomerByPhone(phone);
    if (customer && !nameEl.value) nameEl.value = customer.name === 'عميل' ? '' : customer.name;
  });

  async function loadCustomerSuggestions() {
    try {
      const rows = await phoneSuggestions(40);
      el('#phone-list').innerHTML = rows.map((r) =>
        `<option value="${esc(r.phone)}">${esc(r.name)}</option>`
      ).join('');
    } catch (e) { /* ignore */ }
  }
  loadCustomerSuggestions();

  /* ----- payment ----- */
  if (payMethodsEl) {
    payMethodsEl.querySelectorAll('[data-method]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.paymentMethod = btn.dataset.method;
        payMethodsEl.querySelectorAll('[data-method]').forEach((b) => b.classList.toggle('active', b === btn));
        creditHintEl.hidden = state.paymentMethod !== 'credit';
        if (state.paymentMethod === 'credit' && !phoneEl.value) phoneEl.focus();
      });
    });
  }
  discountTypeEl?.querySelectorAll('[data-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.discountType = btn.dataset.type;
      discountTypeEl.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b === btn));
      if (state.discountType === 'percent') {
        const v = Number(discountValueEl.value);
        if (v > 100) discountValueEl.value = 100;
      }
      renderTotals();
    });
  });
  discountValueEl?.addEventListener('input', () => {
    let v = Number(discountValueEl.value);
    if (state.discountType === 'percent' && v > 100) { v = 100; discountValueEl.value = 100; }
    if (v < 0) { discountValueEl.value = 0; }
    renderTotals();
  });

  el('#clear-cart').addEventListener('click', () => clearAll(true));
  el('#mp-scroll')?.addEventListener('click', () => {
    el('#checkout').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  workerEl.addEventListener('change', () => {
    try { sessionStorage.setItem('cw:worker', workerEl.value); } catch (e) { /* ignore */ }
  });

  function clearAll(notify = false) {
    state.cart.clear();
    plateWidget.clear();
    state.plate = null;
    phoneEl.value = '';
    nameEl.value = '';
    notesEl.value = '';
    phoneErrorEl.hidden = true;
    if (discountValueEl) discountValueEl.value = '';
    if (pricing) {
      state.paymentMethod = 'cash';
      payMethodsEl.querySelectorAll('[data-method]').forEach((b) =>
        b.classList.toggle('active', b.dataset.method === 'cash'));
      creditHintEl.hidden = true;
    }
    renderCart();
    renderTotals();
    if (notify) toast('اتمسحت السلة', 'info', 1600);
  }

  /* ----- finish sale ----- */
  async function finish({ print = false } = {}) {
    if (state.saving) return;
    if (state.cart.isEmpty) { toast('السلة فاضية — ضيف خدمة الأول', 'error'); return; }
    if (!validatePhone()) {
      toast('راجع رقم التليفون — لازم يكون رقم مصري صحيح', 'error');
      return;
    }
    const phone = onlyDigits(phoneEl.value);
    if (pricing && state.paymentMethod === 'credit' && !phone) {
      toast('البيع الآجل محتاج تليفون الزبون', 'error');
      phoneEl.focus();
      return;
    }
    if (phone && !isValidEgyptPhone(phone)) {
      toast('رقم التليفون مش صحيح', 'error');
      return;
    }
    const workerId = workerEl.value ? Number(workerEl.value) : null;
    const worker = state.workers.find((w) => w.id === workerId);
    const paymentMethod = pricing ? state.paymentMethod : 'cash';
    state.saving = true;
    finishPrintBtn.disabled = true;
    finishOnlyBtn.disabled = true;
    const originalPrint = finishPrintBtn.innerHTML;
    if (print) finishPrintBtn.innerHTML = '<span class="spinner"></span><span>بنحفظ…</span>';

    try {
      const invoice = await createInvoice({
        items: state.cart.cloneItems(),
        plate: state.plate,
        customerPhone: phone,
        customerName: nameEl.value.trim(),
        workerId,
        workerName: worker?.name || '',
        notes: notesEl.value.trim(),
        discountType: pricing ? state.discountType : 'amount',
        discountValue: pricing ? (Number(discountValueEl?.value) || 0) : 0,
        paymentMethod,
        cashier: getCurrentUser()
      });

      lastInvoiceSession = invoice;
      const percent = invoice.subtotal > 0 ? (invoice.discount / invoice.subtotal) * 100 : 0;

      notifyEvent('invoice.new', { invoice });
      if (invoice.discount > 0 && percent > 0) {
        notifyEvent('invoice.discount', { invoice, percent });
      }
      if (invoice.paymentMethod === 'credit') {
        const customer = phone ? await findCustomerByPhone(phone) : null;
        notifyEvent('credit.sale', { invoice, balance: customer?.balance ?? null });
      }

      clearAll(false);
      toast(`الفاتورة #${formatInvoiceNo(invoice.number)} اتحفظت`, 'success');
      nameEl.value = '';
      notesEl.value = '';
      if (print) {
        await printReceipt(invoice, { settings });
      }
    } catch (err) {
      console.error(err);
      toast(err.message || 'مش قادر أحفظ الفاتورة', 'error');
      notifyEvent('error', { message: err.message || String(err), context: 'cashier.finish' });
    } finally {
      state.saving = false;
      finishPrintBtn.innerHTML = originalPrint;
      renderCart();
    }
  }

  finishPrintBtn.addEventListener('click', () => finish({ print: true }));
  finishOnlyBtn.addEventListener('click', () => finish({ print: false }));

  /* ----- shortcuts ----- */
  const onKey = (e) => {
    if (document.querySelector('.modal-overlay')) return;
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    if (e.key === 'F2') {
      e.preventDefault();
      finish({ print: true });
    } else if (e.key === 'F4') {
      e.preventDefault();
      if (lastInvoiceSession) printReceipt(lastInvoiceSession, { preview: true });
      else toast('لسه مفيش فاتورة في الجلسة دي', 'info');
    } else if (e.key === 'Escape' && !['input', 'textarea', 'select'].includes(tag)) {
      if (!state.cart.isEmpty) clearAll(true);
    }
  };
  document.addEventListener('keydown', onKey);

  renderCategories();
  renderServices();
  renderCart();
  renderTotals();

  return () => {
    document.removeEventListener('keydown', onKey);
    plateWidget.dispose();
  };
}
