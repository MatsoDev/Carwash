import {
  db, addExpense, listExpenses, logAudit
} from './db.js';
import {
  esc, icon, toast, fmtMoney, fmtDate, fmtNumber, todayISO,
  downloadCsv, confirmDialog, emptyState, badge
} from './ui.js';
import { getCurrentUser } from './auth.js';
import { notifyEvent } from './notifications.js';

const CATEGORIES = [
  'مستلزمات ومحاليل',
  'كهرباء ومياه',
  'صيانة وإصلاح',
  'إيجار',
  'رواتب',
  'مواصلات',
  'أخرى'
];

function firstOfMonth(dateStr) {
  return dateStr.slice(0, 8) + '01';
}

function sum(rows) {
  return Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
}

export async function renderExpenses(container) {
  const user = getCurrentUser();
  let fromDate = firstOfMonth(todayISO());
  let toDate = todayISO();
  let rows = [];

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1>المصاريف</h1>
        <p>سجّل كل جنيه خارج من المغسلة عشان الصافي يبان صح.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-sm btn-secondary" type="button" id="export-expenses">${icon('download', 16)} تصدير CSV</button>
        <button class="btn btn-sm btn-ghost" type="button" id="refresh-expenses">${icon('refresh', 16)} تحديث</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>${icon('plus', 18)} مصروف جديد</h2>
        <span class="spacer"></span>
        <span class="small muted">المصاريف بتتخصم من صافي الربح</span>
      </div>
      <div class="panel-body">
        <form id="expense-form" class="expense-form" autocomplete="off">
          <label class="field">
            <span>التاريخ</span>
            <input id="ex-date" type="date" required value="${todayISO()}">
          </label>
          <label class="field">
            <span>التصنيف</span>
            <select id="ex-category">
              ${CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>
          </label>
          <label class="field amount">
            <span>المبلغ</span>
            <input id="ex-amount" type="number" inputmode="decimal" min="0.01" step="any" placeholder="0" required>
          </label>
          <label class="field">
            <span>ملاحظة <small class="muted">(اختياري)</small></span>
            <input id="ex-note" type="text" maxlength="140" placeholder="مثال: صابون وشامبو">
          </label>
          <button class="btn btn-primary" type="submit" id="save-expense">${icon('save', 17)} سجّل المصروف</button>
        </form>
      </div>
    </div>

    <div id="expense-body"></div>
  `;

  const el = (sel) => container.querySelector(sel);
  const bodyEl = el('#expense-body');
  const formEl = el('#expense-form');
  const dateEl = el('#ex-date');
  const categoryEl = el('#ex-category');
  const amountEl = el('#ex-amount');
  const noteEl = el('#ex-note');
  const saveBtn = el('#save-expense');

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = Number(amountEl.value);
    if (!amount || amount <= 0) {
      toast('اكتب مبلغ أكبر من صفر', 'error');
      amountEl.focus();
      return;
    }
    saveBtn.disabled = true;
    const original = saveBtn.innerHTML;
    saveBtn.innerHTML = '<span class="spinner"></span><span>بنسجل…</span>';
    try {
      const expense = await addExpense({
        date: dateEl.value || todayISO(),
        category: categoryEl.value,
        amount,
        note: noteEl.value.trim(),
        user
      });
      await logAudit('expense.add', {
        expenseId: expense.id, amount: expense.amount, category: expense.category
      }, user);
      notifyEvent('expense.new', { expense });
      toast('المصروف اتسجل', 'success');
      amountEl.value = '';
      noteEl.value = '';
      await load();
      amountEl.focus();
    } catch (err) {
      toast(err.message || 'مش قادر أسجل المصروف', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = original;
    }
  });

  function renderBody() {
    const total = sum(rows);
    const today = todayISO();
    const todayTotal = sum(rows.filter((r) => r.date === today));
    const byCat = new Map();
    for (const row of rows) {
      const rec = byCat.get(row.category) || { label: row.category, count: 0, amount: 0 };
      rec.count += 1;
      rec.amount += Number(row.amount) || 0;
      byCat.set(row.category, rec);
    }
    const cats = [...byCat.values()].sort((a, b) => b.amount - a.amount);
    const max = Math.max(...cats.map((c) => c.amount), 1);

    bodyEl.innerHTML = `
      <div class="filters" style="border:1px solid var(--line);border-radius:14px;background:var(--surface);margin-bottom:14px">
        <label class="field">
          <span>من</span>
          <input id="ex-from" type="date" value="${fromDate}">
        </label>
        <label class="field">
          <span>إلى</span>
          <input id="ex-to" type="date" value="${toDate}">
        </label>
        <span class="result-count">${rows.length} مصروف</span>
      </div>

      <div class="kpi-grid">
        <div class="kpi">
          <span class="kpi-label">إجمالي الفترة</span>
          <span class="kpi-value">${esc(fmtMoney(total))}</span>
          <span class="kpi-sub">${fmtDate(fromDate)} — ${fmtDate(toDate)}</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">مصاريف النهارده</span>
          <span class="kpi-value">${esc(fmtMoney(todayTotal))}</span>
          <span class="kpi-sub">${rows.filter((r) => r.date === today).length} مصروف</span>
        </div>
        <div class="kpi">
          <span class="kpi-label">عدد المصاريف</span>
          <span class="kpi-value">${fmtNumber(rows.length)}</span>
          <span class="kpi-sub">في الفترة المختارة</span>
        </div>
      </div>

      <div class="report-grid">
        <section class="panel">
          <div class="panel-head"><h2>${icon('chart', 18)} حسب التصنيف</h2></div>
          <div class="panel-body">
            ${cats.length ? cats.map((c) => `
              <div class="bar-row">
                <span>${esc(c.label)}</span>
                <span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, Math.round((c.amount / max) * 100))}%"></span></span>
                <span class="bar-value">${esc(fmtMoney(c.amount))}</span>
              </div>`).join('') : '<p class="muted small">مفيش مصاريف في الفترة دي.</p>'}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>${icon('receipt', 18)} آخر المصاريف</h2>
            <span class="spacer"></span>
            ${badge(`${rows.length}`, 'primary')}
          </div>
          <div class="panel-body tight" style="padding:0">
            <div class="table-wrap" style="border:0;border-radius:0">
              <table class="data" style="min-width:520px">
                <thead><tr><th>التاريخ</th><th>التصنيف</th><th class="num">المبلغ</th><th>ملاحظة</th><th></th></tr></thead>
                <tbody>
                  ${rows.length ? rows.map((r) => `
                    <tr>
                      <td class="nowrap">${esc(fmtDate(r.date))}</td>
                      <td>${esc(r.category)}</td>
                      <td class="num"><b>${esc(fmtMoney(r.amount))}</b></td>
                      <td class="small muted">${esc(r.note || '—')}${r.createdBy ? `<br><span class="tiny">${esc(r.createdBy)}</span>` : ''}</td>
                      <td><button class="btn btn-sm btn-ghost" type="button" data-del="${r.id}" title="حذف">${icon('trash', 14)}</button></td>
                    </tr>`).join('') : `<tr><td colspan="5">${emptyState('wallet', 'مفيش مصاريف', 'سجّل أول مصروف من الفورم فوق.')}</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>`;

    bodyEl.querySelector('#ex-from')?.addEventListener('change', (e) => {
      fromDate = e.target.value || firstOfMonth(todayISO());
      load();
    });
    bodyEl.querySelector('#ex-to')?.addEventListener('change', (e) => {
      toDate = e.target.value || todayISO();
      load();
    });
    bodyEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteExpense(Number(btn.dataset.del)));
    });
  }

  async function deleteExpense(id) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const ok = await confirmDialog(
      `تحذف مصروف "${row.category}" بقيمة ${fmtMoney(row.amount)}؟`,
      { title: 'حذف مصروف', confirmLabel: 'احذف', danger: true }
    );
    if (!ok) return;
    try {
      await db.expenses.delete(id);
      await logAudit('expense.delete', {
        expenseId: id, amount: row.amount, category: row.category
      }, user);
      toast('المصروف اتحذف', 'success');
      await load();
    } catch (e) {
      toast(e.message || 'مش قادر أحذف المصروف', 'error');
    }
  }

  async function load() {
    bodyEl.innerHTML = `<div class="empty"><span class="spinner"></span><span class="muted">بنجيب المصاريف…</span></div>`;
    try {
      rows = await listExpenses(fromDate, toDate);
      renderBody();
    } catch (e) {
      bodyEl.innerHTML = emptyState('info', 'مش قادر أحمل المصاريف', e.message || '');
    }
  }

  function exportCsv() {
    if (!rows.length) { toast('مفيش مصاريف في الفترة دي', 'info'); return; }
    const csvRows = [['التاريخ', 'التصنيف', 'المبلغ', 'ملاحظة', 'بواسطة']];
    for (const r of rows) {
      csvRows.push([r.date, r.category, r.amount, r.note || '', r.createdBy || '']);
    }
    downloadCsv(csvRows, `carwash-expenses-${fromDate}-to-${toDate}.csv`);
    toast('المصاريف اتنزلت CSV', 'success');
  }

  el('#refresh-expenses').addEventListener('click', load);
  el('#export-expenses').addEventListener('click', exportCsv);

  await load();
  amountEl.focus();
}
