// Configurações da loja (uma linha JSON na tabela settings), com validação campo a campo.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

export const PROVIDER_IDS = ['gemini', 'openai', 'fashn', 'demo'];

export const DEFAULT_SETTINGS = Object.freeze({
  store: { name: 'TXC', whatsapp: '', storeUrl: '' },
  activeProvider: 'demo',
  providers: {
    gemini: {
      model: 'gemini-3.1-flash-image-preview',
      imageSize: '1K',
      prices: { inputPerM: 0.5, outputImagePerM: 60, outputTextPerM: 3 },
    },
    openai: {
      model: 'gpt-image-2',
      quality: 'medium',
      prices: { textInputPerM: 5, imageInputPerM: 8, outputPerM: 30 },
    },
    fashn: {
      model: 'tryon-v1.6',
      mode: 'balanced',
      prices: { perCredit: 0.075, creditsPerRun: 1 },
    },
    demo: { model: 'demo', prices: {} },
  },
  limits: { perClientPerDay: 5, perIpPerDay: 15, dailyBudgetUsd: 5, retentionHours: 24 },
  money: { usdToBrl: 5.2, fixedMonthlyBrl: 40 },
});

// ---- validadores de folha: recebem (valor, caminho) e devolvem o valor normalizado ----

const fail = (field, why) => {
  throw new ValidationError(`Campo ${field}: ${why}`);
};

function toNumber(value, field) {
  const n = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || (typeof value === 'string' && value.trim() === '')) {
    fail(field, 'informe um número');
  }
  return n;
}

const number = ({ min = 0, exclusiveMin = false } = {}) => (value, field) => {
  const n = toNumber(value, field);
  if (exclusiveMin ? n <= min : n < min) fail(field, `precisa ser ${exclusiveMin ? 'maior que' : 'no mínimo'} ${min}`);
  return n;
};

const integer = ({ min = 1 } = {}) => (value, field) => {
  const n = toNumber(value, field);
  if (!Number.isInteger(n) || n < min) fail(field, `precisa ser um número inteiro a partir de ${min}`);
  return n;
};

const text = ({ max = 200, required = false } = {}) => (value, field) => {
  if (typeof value !== 'string') fail(field, 'informe um texto');
  const v = value.trim();
  if (required && !v) fail(field, 'não pode ficar vazio');
  if (v.length > max) fail(field, `máximo de ${max} caracteres`);
  return v;
};

const oneOf = (options) => (value, field) => {
  if (!options.includes(value)) fail(field, `use um destes valores: ${options.join(', ')}`);
  return value;
};

export function normalizeWhatsapp(value, field = 'store.whatsapp') {
  if (typeof value !== 'string' && typeof value !== 'number') fail(field, 'informe o número');
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`; // DDD + número, sem DDI
  if (digits.length >= 12 && digits.length <= 15) return digits; // já tem DDI
  return fail(field, 'use DDD + número, ex.: (11) 99999-9999');
}

export function normalizeUrl(value, field) {
  const v = text({ max: 500 })(value, field);
  if (!v) return '';
  let url;
  try {
    url = new URL(v);
  } catch {
    fail(field, 'endereço inválido (comece com https://)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail(field, 'endereço precisa começar com http:// ou https://');
  return url.toString();
}

const prices = (keys) => Object.fromEntries(keys.map((k) => [k, number()]));

const SCHEMA = {
  store: { name: text({ max: 80, required: true }), whatsapp: normalizeWhatsapp, storeUrl: normalizeUrl },
  activeProvider: oneOf(PROVIDER_IDS),
  providers: {
    gemini: {
      model: text({ max: 100, required: true }),
      imageSize: oneOf(['512', '1K', '2K', '4K']),
      prices: prices(['inputPerM', 'outputImagePerM', 'outputTextPerM']),
    },
    openai: {
      model: text({ max: 100, required: true }),
      quality: oneOf(['low', 'medium', 'high']),
      prices: prices(['textInputPerM', 'imageInputPerM', 'outputPerM']),
    },
    fashn: {
      model: text({ max: 100, required: true }),
      mode: oneOf(['performance', 'balanced', 'quality']),
      prices: prices(['perCredit', 'creditsPerRun']),
    },
  },
  limits: {
    perClientPerDay: integer({ min: 1 }),
    perIpPerDay: integer({ min: 1 }),
    dailyBudgetUsd: number(),
    retentionHours: integer({ min: 1 }),
  },
  money: { usdToBrl: number({ min: 0, exclusiveMin: true }), fixedMonthlyBrl: number() },
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Aplica `patch` sobre `base` seguindo o SCHEMA; chaves fora do schema são ignoradas.
function applyPatch(base, patch, schema, prefix) {
  const out = { ...base };
  for (const [key, rule] of Object.entries(schema)) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const field = prefix ? `${prefix}.${key}` : key;
    if (typeof rule === 'function') {
      out[key] = rule(patch[key], field);
    } else {
      if (!isPlainObject(patch[key])) fail(field, 'formato inválido');
      out[key] = applyPatch(base[key] ?? {}, patch[key], rule, field);
    }
  }
  return out;
}

function deepMerge(base, extra) {
  if (!isPlainObject(extra)) return structuredClone(base);
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = isPlainObject(v) ? deepMerge(v, extra[k]) : k in extra ? extra[k] : v;
  }
  return out;
}

export function getSettings(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app'").get();
  const stored = row ? JSON.parse(row.value) : {};
  return deepMerge(DEFAULT_SETTINGS, stored);
}

export function updateSettings(db, patch, { keys = {} } = {}) {
  if (!isPlainObject(patch)) throw new ValidationError('Configurações em formato inválido');
  const next = applyPatch(getSettings(db), patch, SCHEMA, '');
  if (patch.activeProvider !== undefined && next.activeProvider !== 'demo' && !keys[next.activeProvider]) {
    throw new ValidationError(`Provedor ${next.activeProvider} sem chave de API configurada`);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(next),
  );
  return next;
}
