#!/usr/bin/env node
/* Zero-dependency local static server for Carwash POS.
   Keeps a stable origin (http://localhost:8080) so IndexedDB data is never lost. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const PORT = 8080;
const HOST = '127.0.0.1';
const URL = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.zip': 'application/zip'
};

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, URL).pathname);
    let filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }
    if (urlPath === '/' || urlPath === '') filePath = path.join(ROOT, 'index.html');
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('ملف غير موجود: ' + urlPath);
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Service-Worker-Allowed': '/'
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    sendJson(res, 500, { error: String(e) });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\n⚠️  البورت 8080 مشغول بالفعل.');
    console.error('    يمكن يكون التطبيق شغال في نافذة تانية. جرّب تفتح:');
    console.error(`    ${URL}\n`);
    console.error('    لو مش شغال، اقفل النافذة القديمة (أو البرنامج اللي بيستخدم 8080) وجرّب تاني.');
  } else if (err.code === 'EACCES') {
    console.error('\n⚠️  مفيش صلاحية لفتح البورت 8080. جرّب تشغّل start.bat كمسؤول.\n');
  } else {
    console.error('\n⚠️  حصل خطأ في تشغيل السيرفر:', err.message, '\n');
  }
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100);
});

server.listen(PORT, HOST, () => {
  console.log('\n✅ مغسلة سيارات — الكاشير شغال محليًا');
  console.log(`   العنوان: ${URL}`);
  console.log('   سيب النافذة دي مفتوحة أثناء استخدام التطبيق.');
  console.log('   للإغلاق: اضغط Ctrl + C أو اقفل النافذة.\n');
  openBrowser(URL + '/index.html');
});

process.on('SIGINT', () => { server.close(); process.exit(0); });
