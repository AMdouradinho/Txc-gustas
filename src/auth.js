// Login do painel: uma senha (ADMIN_PASSWORD) e um cookie assinado com HMAC.
import crypto from 'node:crypto';

export const SESSION_MS = 7 * 24 * 3600 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function createAuth({ password, secret, now = () => Date.now() }) {
  const failures = new Map(); // ip -> [timestamps]

  function recentFailures(ip) {
    const list = (failures.get(ip) ?? []).filter((t) => now() - t < WINDOW_MS);
    if (list.length) failures.set(ip, list);
    else failures.delete(ip);
    return list;
  }

  function login(given, ip) {
    if (recentFailures(ip).length >= MAX_FAILURES) throw new AuthError(429, 'Muitas tentativas. Aguarde 15 minutos.');
    if (!crypto.timingSafeEqual(sha(given ?? ''), sha(password))) {
      failures.set(ip, [...recentFailures(ip), now()]);
      throw new AuthError(401, 'Senha incorreta');
    }
    failures.delete(ip);
    const exp = String(now() + SESSION_MS);
    return `${exp}.${sign(secret, exp)}`;
  }

  function verify(token) {
    if (typeof token !== 'string') return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    if (Number(exp) <= now()) return false;
    return safeEqual(sig, sign(secret, exp));
  }

  return { login, verify };
}
