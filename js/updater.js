import {
  getCachedVersion, compareSemver, fetchText, parseChangelog, changesBetween
} from './version.js';
import {
  getAllSettings, getSetting, setSetting
} from './db.js';
import { openModal, toast, esc, icon, fmtDate } from './ui.js';
import { notifyEvent } from './notifications.js';

const VERSION_URL = 'https://raw.githubusercontent.com/MatsoDev/Carwash/main/version.json';
const CHANGELOG_URL = 'https://raw.githubusercontent.com/MatsoDev/Carwash/main/CHANGELOG.md';
const RELEASES_URL = 'https://github.com/MatsoDev/Carwash/releases/latest';
const REPO_URL = 'https://github.com/MatsoDev/Carwash';

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function linesHtml(lines) {
  let html = '';
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  for (const raw of lines || []) {
    const line = String(raw || '').trim();
    if (!line) {
      closeList();
      continue;
    }
    if (/^###\s+/.test(line)) {
      closeList();
      html += `<h4>${inline(line.replace(/^###\s+/, ''))}</h4>`;
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`;
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function blocksHtml(blocks) {
  if (!blocks?.length) return '';
  return blocks.map((block) => `
    <section class="changelog-block">
      <div class="changelog-head">
        <strong>v${esc(block.version)}</strong>
        ${block.date ? `<span>${esc(fmtDate(block.date))}</span>` : ''}
      </div>
      <div class="changelog-lines">${linesHtml(block.lines)}</div>
    </section>`).join('');
}

function notesHtml(notes) {
  if (!notes?.length) return '';
  return `<section class="changelog-block">
    <div class="changelog-lines"><ul>${notes.map((n) => `<li>${inline(n)}</li>`).join('')}</ul></div>
  </section>`;
}

async function fetchJson(url) {
  const text = await fetchText(url, 9000);
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('ملف الإصدار على GitHub غير صالح.');
  }
  if (!data || !data.version) throw new Error('ملف الإصدار على GitHub لا يحتوي على رقم إصدار.');
  return data;
}

async function loadChangelog() {
  const urls = [CHANGELOG_URL, './CHANGELOG.md'];
  for (const url of urls) {
    try {
      const text = await fetchText(url, 9000);
      const blocks = parseChangelog(text);
      if (blocks.length) return blocks;
    } catch (e) { /* try the next source */ }
  }
  return [];
}

function changelogFor(blocks, version) {
  return (blocks || []).filter((b) => compareSemver(b.version, version) === 0);
}

export async function checkForUpdates({ manual = false } = {}) {
  const current = getCachedVersion().version;
  let remote;
  try {
    remote = await fetchJson(VERSION_URL);
  } catch (e) {
    if (manual) {
      throw new Error('تعذر الاتصال بـ GitHub. تحقق من الإنترنت ثم حاول مرة أخرى.');
    }
    return {
      update: false,
      remote: null,
      current,
      changes: [],
      releaseUrl: RELEASES_URL,
      error: e.message || String(e)
    };
  }

  const update = compareSemver(remote.version, current) > 0;
  let changes = [];
  if (update) {
    try {
      changes = changesBetween(await loadChangelog(), current, remote.version);
    } catch (e) { /* changelog is optional */ }
  }

  if (update) {
    const notified = await getSetting('notifiedUpdateVersion', '');
    if (notified !== remote.version) {
      await setSetting('notifiedUpdateVersion', remote.version, { silent: true });
      await notifyEvent('update.available', { version: remote.version, current });
    }
  }

  return {
    update,
    remote,
    current,
    changes,
    releaseUrl: remote.releaseUrl || RELEASES_URL
  };
}

export async function autoCheckForUpdates() {
  const settings = await getAllSettings();
  if (!settings.autoUpdateCheck) return null;
  if (!navigator.onLine) return null;
  const notifiedBefore = await getSetting('notifiedUpdateVersion', '');
  const info = await checkForUpdates({ manual: false });
  if (info.update && notifiedBefore !== info.remote.version) {
    toast(`يتوفر إصدار جديد v${info.remote.version}. افتح الإعدادات ← التحديثات.`, 'info', 6500);
  }
  return info;
}

export function showUpdateModal(info) {
  if (!info?.remote?.version) return;
  const remote = info.remote;
  const releaseUrl = info.releaseUrl || RELEASES_URL;
  const changes = info.changes?.length ? blocksHtml(info.changes) : notesHtml(remote.notes);
  const modal = openModal({
    title: 'تحديث متاح',
    size: 'md',
    iconName: 'cloud',
    body: `
      <div class="update-hero">
        <div class="update-icon">${icon('cloud', 32)}</div>
        <div>
          <h3 class="update-version">v${esc(remote.version)}</h3>
          <p class="muted small">النسخة الحالية: v${esc(info.current || getCachedVersion().version)}</p>
        </div>
      </div>
      ${changes ? `<div class="changelog">${changes}</div>` : '<p class="muted">لا توجد ملاحظات إصدار منشورة لهذا التحديث.</p>'}
      <div class="help-card" style="margin-top:14px">
        <h4>طريقة التحديث</h4>
        <ol>
          <li>اضغط "فتح صفحة التحميل" وحمّل ملف ZIP الخاص بالإصدار.</li>
          <li>فك الضغط فوق مجلد البرنامج مع الاحتفاظ بمجلد <code>data</code>.</li>
          <li>شغّل <code>start.bat</code> ثم حدّث الصفحة.</li>
        </ol>
      </div>
      <p class="small muted">لن تُحذف بيانات IndexedDB عند تحديث الملفات. خذ نسخة احتياطية قبل أي تحديث كبير.</p>`,
    actions: [
      { label: 'لاحقًا', kind: 'btn-ghost', onClick: (close) => close() },
      {
        label: 'فتح صفحة التحميل',
        kind: 'btn-primary',
        icon: 'external',
        onClick: (close) => {
          window.open(releaseUrl, '_blank', 'noopener');
          close();
        }
      }
    ]
  });
  return modal;
}

export async function showChangelog() {
  const current = getCachedVersion();
  let blocks = [];
  try {
    blocks = await loadChangelog();
  } catch (e) { /* handled below */ }
  if (!blocks.length) {
    const notes = current.notes || [];
    if (!notes.length) {
      toast('تعذر تحميل سجل التغييرات. تحقق من الإنترنت.', 'error');
      return;
    }
    blocks = [{ version: current.version, date: current.date, lines: notes.map((n) => `- ${n}`) }];
  }
  openModal({
    title: 'سجل التغييرات',
    size: 'md',
    iconName: 'info',
    body: `
      <div class="changelog">${blocksHtml(blocks.slice(0, 12))}</div>
      <p class="small muted" style="margin-top:12px">
        أحدث إصدارات المشروع على <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>.
      </p>`,
    actions: [
      {
        label: 'فتح GitHub',
        kind: 'btn-secondary',
        icon: 'external',
        onClick: (close) => {
          window.open(REPO_URL, '_blank', 'noopener');
          close();
        }
      },
      { label: 'إغلاق', kind: 'btn-primary', onClick: (close) => close() }
    ]
  });
}

export async function maybeShowWhatsNew() {
  const current = getCachedVersion();
  if (!current?.version) return false;
  const settings = await getAllSettings();
  if (settings.lastSeenVersion === current.version) return false;

  const blocks = await loadChangelog();
  const block = changelogFor(blocks, current.version);
  const notes = current.notes || [];
  const content = block.length ? blocksHtml(block) : notesHtml(notes);

  if (!content) {
    await setSetting('lastSeenVersion', current.version, { silent: true });
    return false;
  }

  await setSetting('lastSeenVersion', current.version, { silent: true });
  openModal({
    title: `ما الجديد في v${current.version}`,
    size: 'md',
    iconName: 'info',
    body: `
      <div class="changelog">${content}</div>
      <p class="small muted" style="margin-top:12px">
        يمكنك مراجعة كل الإصدارات من صفحة <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>.
      </p>`,
    actions: [
      {
        label: 'عرض كل التغييرات',
        kind: 'btn-secondary',
        icon: 'clock',
        onClick: (close) => {
          close();
          showChangelog();
        }
      },
      { label: 'تم', kind: 'btn-primary', onClick: (close) => close() }
    ]
  });
  return true;
}
