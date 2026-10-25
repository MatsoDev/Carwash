export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || '*').trim();
    const allowOrigin = allowed === '*' ? '*' : (origin === allowed ? origin : '');
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === 'GET') {
      return json({ ok: true, service: 'carwash-telegram-proxy' }, 200, cors);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405, cors);
    }

    if (allowed !== '*' && allowOrigin === '') {
      return json({ ok: false, error: 'Origin not allowed' }, 403, cors);
    }

    const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
    const secret = String(env.PROXY_SECRET || '').trim();
    if (!token || !secret) {
      return json({ ok: false, error: 'Worker is not configured' }, 500, cors);
    }

    const supplied = String(request.headers.get('X-Proxy-Secret') || '').trim();
    if (!(await safeEqual(supplied, secret))) {
      return json({ ok: false, error: 'Unauthorized' }, 401, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: 'Invalid JSON' }, 400, cors);
    }

    const chatId = String(body?.chatId || '').trim();
    const text = String(body?.text || '');
    if (!chatId || !text.trim()) {
      return json({ ok: false, error: 'chatId and text are required' }, 400, cors);
    }
    if (text.length > 4096) {
      return json({ ok: false, error: 'Message is too long' }, 400, cors);
    }

    const parseMode = body?.parse_mode === 'HTML' || body?.parse_mode === 'MarkdownV2'
      ? body.parse_mode
      : undefined;

    const payload = {
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    };
    if (parseMode) payload.parse_mode = parseMode;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({ ok: false, error: `Telegram HTTP ${res.status}` }));
      return json(data, res.status, cors);
    } catch (e) {
      return json({ ok: false, error: 'Telegram request failed' }, 502, cors);
    }
  }
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
