import { esc, icon, onlyDigits, openModal, debounce } from './ui.js';
import { recentPlates, findPreviousInvoiceByPlate } from './db.js';

const LETTERS = ['أ', 'ب', 'ج', 'د', 'ر', 'س', 'ص', 'ط', 'ع', 'ق', 'ك', 'ل', 'م', 'ن', 'هـ', 'و', 'ى'];
const LETTER_SET = new Set(LETTERS);

function normalizeChar(ch) {
  if (ch === ' ' || ch === '\u0640') return '';
  if (ch === 'ه') return 'هـ';
  if (ch === 'ي') return 'ى';
  if (ch === 'ا' || ch === 'إ' || ch === 'آ' || ch === 'ٱ') return 'أ';
  if (ch === 'ک') return 'ك';
  return ch;
}

export function normalizePlateLetters(input) {
  const chars = Array.from(String(input || ''));
  const out = [];
  for (const raw of chars) {
    const ch = normalizeChar(raw);
    if (!ch) continue;
    if (!LETTER_SET.has(ch)) continue;
    out.push(ch);
    if (out.length >= 3) break;
  }
  return out.join(' ');
}

export function buildPlate(letters, numbers) {
  const l = normalizePlateLetters(letters);
  const n = onlyDigits(numbers).slice(0, 4);
  if (!l && !n) return null;
  return {
    letters: l,
    numbers: n,
    display: [l, n].filter(Boolean).join(' ')
  };
}

export function plateDisplay(plate) {
  if (!plate) return '';
  if (plate.display) return plate.display;
  return [plate.letters, plate.numbers].filter(Boolean).join(' ');
}

/* Creates a two-part Egyptian plate input with an Arabic on-screen letter picker. */
export function createPlateWidget(container, {
  onChange = null,
  onSelect = null,
  onExactMatch = null,
  compact = false
} = {}) {
  container.innerHTML = `
    <div class="plate-widget ${compact ? 'compact' : ''}">
      <div class="plate-box">
        <input class="plate-letters" type="text" inputmode="text" autocomplete="off"
          placeholder="حروف" aria-label="حروف اللوحة" maxlength="8">
        <span class="plate-sep" aria-hidden="true"></span>
        <input class="plate-numbers" type="text" inputmode="numeric" autocomplete="off"
          placeholder="1234" aria-label="أرقام اللوحة" maxlength="4">
        <button class="plate-key-btn" type="button" aria-label="اختيار الحروف">
          ${icon('key', 18)}<span>الحروف</span>
        </button>
      </div>
      <div class="plate-suggest" hidden></div>
    </div>`;

  const wrap = container.querySelector('.plate-widget');
  const lettersEl = container.querySelector('.plate-letters');
  const numbersEl = container.querySelector('.plate-numbers');
  const suggestEl = container.querySelector('.plate-suggest');

  let suggestions = [];
  let lastExact = '';

  const notify = () => {
    const value = buildPlate(lettersEl.value, numbersEl.value);
    if (onChange) onChange(value);
    return value;
  };

  const setLetters = (letters, { focus = false } = {}) => {
    lettersEl.value = normalizePlateLetters(letters);
    if (focus) lettersEl.focus();
    notify();
  };
  const setNumbers = (numbers) => {
    numbersEl.value = onlyDigits(numbers).slice(0, 4);
    notify();
  };

  const renderSuggestions = () => {
    if (!suggestions.length) {
      suggestEl.hidden = true;
      suggestEl.innerHTML = '';
      return;
    }
    suggestEl.innerHTML = suggestions.map((s, i) => `
      <button type="button" class="plate-suggestion" data-idx="${i}">
        <span class="plate-suggestion-main">${esc(plateDisplay(s.plate))}</span>
        <span class="plate-suggestion-sub">${esc(s.customerPhone || s.customerName || 'فاتورة سابقة')}</span>
      </button>`).join('');
    suggestEl.hidden = false;
    suggestEl.querySelectorAll('[data-idx]').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const choice = suggestions[Number(btn.dataset.idx)];
        if (!choice) return;
        setValue(choice.plate);
        hideSuggestions();
        if (onSelect) onSelect(choice);
      });
    });
  };

  const hideSuggestions = () => {
    suggestEl.hidden = true;
    suggestions = [];
  };

  const refreshSuggestions = debounce(async (checkedValue) => {
    const letters = normalizePlateLetters(lettersEl.value);
    const numbers = onlyDigits(numbersEl.value);
    const query = [letters, numbers].filter(Boolean).join(' ');
    if (!query) { hideSuggestions(); return; }

    const rows = await recentPlates(30);
    suggestions = rows.filter((row) => {
      const p = row.plate;
      if (!p) return false;
      if (letters && numbers) {
        return p.letters.includes(letters) && p.numbers.includes(numbers);
      }
      if (letters) return p.letters.includes(letters) || p.display.includes(letters);
      return p.numbers.includes(numbers);
    }).slice(0, 6);

    // hide the exact current plate from suggestions
    suggestions = suggestions.filter((s) =>
      !(s.plate.letters === letters && s.plate.numbers === numbers)
    );
    if (document.activeElement === lettersEl || document.activeElement === numbersEl) {
      renderSuggestions();
    }

    if (letters && numbers && onExactMatch) {
      const key = letters + '|' + numbers;
      if (key !== lastExact) {
        lastExact = key;
        const previous = await findPreviousInvoiceByPlate(letters, numbers);
        if (previous) {
          onExactMatch({
            plate: previous.plate,
            customerPhone: previous.customerPhone || '',
            customerName: previous.customerName || ''
          });
        }
      }
    }
  }, 280);

  const onInputLetters = () => {
    const normalized = normalizePlateLetters(lettersEl.value);
    if (lettersEl.value !== normalized) lettersEl.value = normalized;
    notify();
    refreshSuggestions();
  };
  const onInputNumbers = () => {
    const normalized = onlyDigits(numbersEl.value).slice(0, 4);
    if (numbersEl.value !== normalized) numbersEl.value = normalized;
    notify();
    refreshSuggestions();
  };

  lettersEl.addEventListener('input', onInputLetters);
  numbersEl.addEventListener('input', onInputNumbers);
  lettersEl.addEventListener('focus', () => { lastExact = ''; refreshSuggestions(); });
  numbersEl.addEventListener('focus', () => { lastExact = ''; refreshSuggestions(); });
  lettersEl.addEventListener('blur', () => setTimeout(hideSuggestions, 180));
  numbersEl.addEventListener('blur', () => setTimeout(hideSuggestions, 180));

  container.querySelector('.plate-key-btn').addEventListener('click', () => {
    openLetterPicker(lettersEl.value, (result) => {
      setLetters(result);
      numbersEl.focus();
    });
  });

  function setValue(plate, { silent = false } = {}) {
    if (!plate) {
      lettersEl.value = '';
      numbersEl.value = '';
    } else {
      lettersEl.value = normalizePlateLetters(plate.letters || '');
      numbersEl.value = onlyDigits(plate.numbers || '').slice(0, 4);
    }
    if (!silent) notify();
  }

  return {
    getValue: () => buildPlate(lettersEl.value, numbersEl.value),
    setValue,
    clear: () => setValue(null),
    focus: () => lettersEl.focus(),
    elements: { lettersEl, numbersEl, wrap },
    dispose: () => { hideSuggestions(); }
  };
}

function openLetterPicker(current, onDone) {
  let value = normalizePlateLetters(current);
  const grid = LETTERS.map((letter) =>
    `<button type="button" class="letter-btn" data-letter="${esc(letter)}">${esc(letter)}</button>`
  ).join('');

  const modal = openModal({
    title: 'اختيار حروف اللوحة',
    size: 'sm',
    iconName: 'car',
    body: `
      <p class="muted picker-help">اختار لحد 3 حروف. تقدر تكتب من الكيبورد كمان.</p>
      <div class="letters-display" data-display>${esc(value) || '<span class="muted">—</span>'}</div>
      <div class="letters-grid">${grid}</div>
      <div class="letters-actions">
        <button type="button" class="btn btn-ghost" data-action="backspace">${icon('x', 16)} امسح حرف</button>
        <button type="button" class="btn btn-ghost" data-action="clear">مسح الكل</button>
      </div>`,
    actions: [
      { label: 'تم', kind: 'btn-primary', onClick: (close) => { close(); onDone(value); } }
    ]
  });

  const display = modal.body.querySelector('[data-display]');
  const update = () => {
    display.innerHTML = value ? esc(value) : '<span class="muted">—</span>';
  };
  modal.body.querySelectorAll('[data-letter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tokens = value ? value.split(' ') : [];
      if (tokens.length >= 3) return;
      tokens.push(btn.dataset.letter);
      value = tokens.join(' ');
      update();
    });
  });
  modal.body.querySelector('[data-action="backspace"]').addEventListener('click', () => {
    const tokens = value ? value.split(' ') : [];
    tokens.pop();
    value = tokens.join(' ');
    update();
  });
  modal.body.querySelector('[data-action="clear"]').addEventListener('click', () => {
    value = '';
    update();
  });
  update();
}
