import { api, el, formatPrice, waLink, trackEvent, productUrl, CATEGORY_LABELS, setStoreName } from './api.js';
import { openTryon, remainingText } from './tryon.js';
import { pickGarmentImage } from './garment.js';

const $ = (id) => document.getElementById(id);
const state = { product: null, store: null, color: null, size: null, imageId: null };

function imagesForColor() {
  const { images } = state.product;
  if (!state.color) return images;
  const ofColor = images.filter((i) => i.color === state.color);
  const general = images.filter((i) => !i.color);
  return ofColor.length || general.length ? [...ofColor, ...general] : images;
}

function renderGallery() {
  const imgs = imagesForColor();
  if (!imgs.some((i) => i.id === state.imageId)) state.imageId = imgs[0]?.id ?? null;
  const main = imgs.find((i) => i.id === state.imageId);
  $('main-img').src = main?.url ?? '';
  $('main-img').alt = state.product.name;
  $('thumbs').replaceChildren(
    ...(imgs.length > 1
      ? imgs.map((i) =>
          el(
            'button',
            {
              class: 'thumb',
              type: 'button',
              'aria-label': 'Ver foto',
              'aria-current': String(i.id === state.imageId),
              onclick: () => {
                state.imageId = i.id;
                renderGallery();
              },
            },
            el('img', { src: i.url, alt: '' }),
          ),
        )
      : []),
  );
}

function chips(container, values, selected, onPick, cls) {
  container.replaceChildren(
    ...values.map((v) =>
      el('button', { class: `chip ${cls}`, type: 'button', 'aria-pressed': String(v === selected), text: v, onclick: () => onPick(v) }),
    ),
  );
}

function renderOptions() {
  const p = state.product;
  $('colors-option').hidden = !p.colors.length;
  $('color-label').textContent = state.color ?? '';
  chips($('colors'), p.colors, state.color, (c) => {
    state.color = c;
    renderOptions();
    renderGallery();
    renderTryButton();
  }, 'color-chip');
  $('sizes-option').hidden = !p.sizes.length;
  chips($('sizes'), p.sizes, state.size, (s) => {
    state.size = s;
    renderOptions();
  }, 'size-chip');
  renderContactLinks();
}

function renderContactLinks() {
  const { store, product } = state;
  const wa = $('p-whatsapp');
  if (store.whatsapp) {
    const parts = [`Olá! Quero saber mais sobre a ${product.name}`];
    if (state.color) parts.push(` na cor ${state.color}`);
    if (state.size) parts.push(`, tamanho ${state.size}`);
    wa.href = waLink(store.whatsapp, `${parts.join('')}. ${productUrl(product.slug)}`);
    wa.hidden = false;
    wa.onclick = () => trackEvent('whatsapp', product.id);
  }
  const buy = product.buyUrl || store.storeUrl;
  if (buy) {
    $('p-buy').href = buy;
    $('p-buy').hidden = false;
    $('p-buy').onclick = () => trackEvent('buy_link', product.id);
  }
}

// Botão só aparece se há IA para a peça e foto para a cor escolhida (mesma regra do servidor).
function renderTryButton() {
  const garment = state.product.canTryOn && state.store.tryonEnabled ? pickGarmentImage(state.product, state.color) : null;
  $('tryon-open').hidden = !garment;
  $('remaining-hint').textContent = garment
    ? remainingText(state.store.remaining, state.store.limitPerDay)
    : state.product.canTryOn
      ? 'Provador ainda indisponível para esta cor.'
      : 'Provador indisponível para esta peça no momento.';
}

function updateRemaining(n) {
  state.store.remaining = n;
  $('remaining-hint').textContent = remainingText(n, state.store.limitPerDay);
}

async function main() {
  const slug = new URLSearchParams(location.search).get('slug');
  try {
    if (!slug) throw new Error('Peça não encontrada');
    const [store, product] = await Promise.all([api('/api/store'), api(`/api/products/${encodeURIComponent(slug)}`)]);
    state.store = store;
    state.product = product;
    state.color = product.colors[0] ?? null;
    setStoreName(store.name);
    document.title = `${product.name} · ${store.name}`;

    $('p-category').textContent = CATEGORY_LABELS[product.category]?.replace(/s$/, '') ?? product.category;
    $('p-name').textContent = product.name;
    $('p-price').textContent = formatPrice(product.priceCents);
    $('p-desc').textContent = product.description;
    renderOptions();
    renderGallery();

    renderTryButton();
    $('tryon-open').addEventListener('click', () =>
      openTryon({
        product,
        store,
        color: state.color,
        size: state.size,
        image: pickGarmentImage(product, state.color),
        onRemaining: updateRemaining,
      }),
    );
    $('page-msg').hidden = true;
    $('product').hidden = false;
  } catch (err) {
    $('page-msg').textContent = err.message;
  }
}

main();
