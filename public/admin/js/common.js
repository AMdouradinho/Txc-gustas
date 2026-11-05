export { api, el, formatPrice, CATEGORY_LABELS } from '/js/api.js';
export { resizeImage } from '/js/tryon.js';

export const $ = (id) => document.getElementById(id);

// Estado compartilhado entre as abas.
export const state = {
  catalog: null, // { categories, genders, tryonTypes }
  settings: null, // { settings, providerStatus, estimates }
  products: [],
};

export const PROVIDER_NAMES = { gemini: 'Gemini', openai: 'OpenAI', fashn: 'FASHN', demo: 'Demo' };
export const providerName = (id) => PROVIDER_NAMES[id] ?? id;

const nf = (min, max) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });

export function fmtUsd(n) {
  const v = Number(n) || 0;
  return `US$ ${(v !== 0 && Math.abs(v) < 1 ? nf(2, 4) : nf(2, 2)).format(v)}`;
}

export function fmtBrl(n) {
  const v = Number(n) || 0;
  return `R$ ${(v !== 0 && Math.abs(v) < 0.1 ? nf(2, 3) : nf(2, 2)).format(v)}`;
}

export const fmtSeconds = (ms) => (ms ? `${nf(1, 1).format(ms / 1000)} s` : '—');

export const usdToBrl = () => state.settings?.settings.money.usdToBrl ?? 5.2;

// "1.299,90" → 1299.9 ; "" → null ; inválido → NaN
export function parseDecimal(text) {
  const s = String(text ?? '').trim().replace(/\s|R\$|US\$/g, '');
  if (!s) return null;
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export const fmtDecimal = (n) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

let toastTimer;
export function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

export const categoryLabel = (c) => {
  const plural = { 'baby look': 'Baby look' }[c];
  return plural ?? c.charAt(0).toUpperCase() + c.slice(1);
};
