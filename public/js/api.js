// Utilidades compartilhadas da loja e do painel.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', json, form } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (form) {
    init.body = form;
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('Sem conexão. Confira sua internet e tente de novo.', 0);
  }
  if (res.status === 204) return null;
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* resposta sem JSON */
  }
  if (!res.ok) throw new ApiError(body?.error || 'Algo deu errado. Tente de novo.', res.status);
  return body;
}

export function formatPrice(cents) {
  if (cents === null || cents === undefined) return 'Consulte';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

export const waLink = (number, text) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

export function trackEvent(type, productId, tryonId) {
  try {
    fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, productId, tryonId }),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  } catch {
    /* métrica nunca quebra a tela */
  }
}

export const CATEGORY_LABELS = {
  camiseta: 'Camisetas',
  polo: 'Polos',
  camisa: 'Camisas',
  regata: 'Regatas',
  moletom: 'Moletons',
  jaqueta: 'Jaquetas',
  'baby look': 'Baby looks',
  'calça': 'Calças',
  bermuda: 'Bermudas',
  short: 'Shorts',
  saia: 'Saias',
  vestido: 'Vestidos',
  'macacão': 'Macacões',
  'boné': 'Bonés',
  'chapéu': 'Chapéus',
};

export const productUrl = (slug) => `${location.origin}/peca?slug=${encodeURIComponent(slug)}`;

export function setStoreName(name) {
  for (const n of document.querySelectorAll('[data-store-name]')) n.textContent = name;
  if (name) document.title = document.title.replace(/^[^·|—]+/, `${name} `);
}
