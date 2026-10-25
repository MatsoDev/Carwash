/* Single source of truth at runtime: /version.json.
   The fallback below is only used when version.json cannot be fetched (e.g. opened via file://). */
const FALLBACK = {
  version: '1.0.1',
  date: '2026-10-25',
  notes: []
};

let cached = null;

export async function loadVersion(force = false) {
  if (cached && !force) return cached;
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json || !json.version) throw new Error('Bad version.json');
    cached = { ...FALLBACK, ...json };
  } catch (e) {
    cached = { ...FALLBACK };
  }
  return cached;
}

export function getCachedVersion() {
  return cached || FALLBACK;
}

export function versionSync() {
  return (cached || FALLBACK).version;
}

export function compareSemver(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export async function fetchText(url, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/* Parse Keep a Changelog style markdown into { version, date, lines } blocks. */
export function parseChangelog(markdown) {
  const blocks = [];
  let current = null;
  for (const rawLine of String(markdown || '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const m = line.match(/^##\s+\[([^\]]+)\]\s*(?:-\s*(\d{4}-\d{2}-\d{2}))?/);
    if (m) {
      current = { version: m[1], date: m[2] || '', lines: [] };
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    if (/^##\s+/.test(line)) { current = null; continue; }
    if (!line.trim()) { current.lines.push(''); continue; }
    current.lines.push(line);
  }
  for (const b of blocks) {
    while (b.lines.length && !b.lines[b.lines.length - 1].trim()) b.lines.pop();
    while (b.lines.length && !b.lines[0].trim()) b.lines.shift();
  }
  return blocks;
}

export function changesBetween(blocks, currentVersion, latestVersion) {
  return (blocks || []).filter((b) =>
    compareSemver(b.version, currentVersion) > 0 && compareSemver(b.version, latestVersion) <= 0
  );
}
