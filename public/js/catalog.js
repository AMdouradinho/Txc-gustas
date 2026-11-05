import { api, el, formatPrice, CATEGORY_LABELS, setStoreName } from './api.js';

const grid = document.getElementById('grid');
const filters = document.getElementById('filters');
let products = [];
let current = '';

function card(p) {
  const img = p.images[0];
  const colors = p.colors.length > 1 ? `${p.colors.length} cores` : p.colors[0] || '';
  return el(
    'a',
    { class: 'product-card', href: `/peca?slug=${encodeURIComponent(p.slug)}` },
    el(
      'div',
      { class: 'card-media' },
      img ? el('img', { src: img.url, alt: p.name, loading: 'lazy' }) : null,
      p.canTryOn ? el('span', { class: 'card-badge', text: 'Experimente em você' }) : null,
    ),
    el(
      'div',
      { class: 'card-body' },
      el('span', { class: 'card-name', text: p.name }),
      el('span', { class: 'card-price', text: formatPrice(p.priceCents) }),
      colors ? el('span', { class: 'card-meta', text: colors }) : null,
    ),
  );
}

function render() {
  const list = current ? products.filter((p) => p.category === current) : products;
  grid.replaceChildren(...(list.length ? list.map(card) : [el('p', { class: 'empty', text: 'Nenhuma peça por aqui ainda.' })]));
  for (const b of filters.querySelectorAll('.filter')) b.setAttribute('aria-pressed', String(b.dataset.cat === current));
}

function renderFilters() {
  const cats = [...new Set(products.map((p) => p.category))];
  if (cats.length < 2) return filters.replaceChildren();
  const button = (cat, label) =>
    el('button', {
      class: 'filter',
      type: 'button',
      'data-cat': cat,
      'aria-pressed': 'false',
      text: label,
      onclick: () => {
        current = cat;
        render();
      },
    });
  filters.replaceChildren(button('', 'Todas'), ...cats.map((c) => button(c, CATEGORY_LABELS[c] ?? c)));
}

async function main() {
  try {
    const [store, list] = await Promise.all([api('/api/store'), api('/api/products')]);
    setStoreName(store.name);
    products = list;
    renderFilters();
    render();
  } catch (err) {
    grid.replaceChildren(el('p', { class: 'empty', text: err.message }));
  }
}

main();
