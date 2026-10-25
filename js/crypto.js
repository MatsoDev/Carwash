/* PIN hashing with Web Crypto: PBKDF2-HMAC-SHA256 + random salt. */

export const PIN_ITERATIONS = 150000;

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function randomSalt() {
  if (!globalThis.crypto || !crypto.getRandomValues) {
    throw new Error('Web Crypto غير متاح. شغّل التطبيق من start.bat على localhost.');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashPin(pin, saltHex, iterations = PIN_ITERATIONS) {
  if (!globalThis.crypto || !crypto.subtle) {
    throw new Error('Web Crypto غير متاح. شغّل التطبيق من start.bat على localhost.');
  }
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex),
      iterations: iterations || PIN_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return bytesToHex(bits);
}

export async function verifyPin(pin, user) {
  if (!user || !user.pinHash || !user.salt) return false;
  const candidate = await hashPin(pin, user.salt, user.iterations || PIN_ITERATIONS);
  const a = candidate;
  const b = user.pinHash;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
