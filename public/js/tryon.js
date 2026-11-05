// Provador: escolher foto → enviar → acompanhar → mostrar antes/depois.
import { api, waLink, trackEvent, productUrl } from './api.js';

const $ = (id) => document.getElementById(id);
const PHOTO_KEY = 'txc-provador-foto';
const POLL_MS = 2000;
const MAX_WAIT_MS = 150000;
const LOADING_TITLES = ['Analisando sua foto…', 'Vestindo a peça em você…', 'Ajustando caimento e cores…', 'Quase pronto…'];

export function remainingText(n, limit) {
  if (n <= 0) return 'Você já usou todas as provas de hoje. Volte amanhã!';
  return n === 1 ? 'Você tem 1 prova restante hoje.' : `Você tem ${n} de ${limit} provas hoje.`;
}

// Reduz a foto no próprio aparelho antes de enviar (menos dados, IA mais rápida e barata).
export async function resizeImage(file, maxSide = 1280, quality = 0.85) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Não conseguimos ler esta foto. Envie uma foto JPG ou PNG.'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = source.width || source.naturalWidth;
  const h0 = source.height || source.naturalHeight;
  if (!w0 || !h0) throw new Error('Não conseguimos ler esta foto. Envie uma foto JPG ou PNG.');
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const width = Math.round(w0 * scale);
  const height = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // JPEG não tem transparência: fundo branco em vez de preto
  g.fillRect(0, 0, width, height);
  g.drawImage(source, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const blob = await (await fetch(dataUrl)).blob();
  return { blob, width, height, dataUrl };
}

function loadSavedPhoto() {
  try {
    const raw = sessionStorage.getItem(PHOTO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePhoto(photo) {
  try {
    sessionStorage.setItem(PHOTO_KEY, JSON.stringify({ dataUrl: photo.dataUrl, width: photo.width, height: photo.height }));
  } catch {
    /* sem espaço ou modo privado: segue sem guardar */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ctx = null; // { product, store, color, size, image, onRemaining }
let photo = null; // { dataUrl, width, height }
let busy = false;
let lastFocus = null;
let wired = false;

function step(name) {
  for (const s of document.querySelectorAll('#tryon [data-step]')) s.hidden = s.dataset.step !== name;
}

function setRemaining(n) {
  $('remaining').textContent = remainingText(n, ctx.store.limitPerDay);
  ctx.onRemaining?.(n);
}

function showPhoto() {
  const box = $('photo-preview');
  if (photo) {
    box.classList.add('has-photo');
    const img = new Image();
    img.src = photo.dataUrl;
    img.alt = 'Sua foto';
    box.replaceChildren(img);
  }
  updateGenerate();
}

function updateGenerate() {
  $('generate').disabled = busy || !photo || !$('consent').checked || ctx.store.remaining <= 0;
}

async function onFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  $('photo-error').textContent = '';
  try {
    photo = await resizeImage(file);
    savePhoto(photo);
    showPhoto();
  } catch (err) {
    $('photo-error').textContent = err.message || 'Não conseguimos ler esta foto. Envie uma foto JPG ou PNG.';
  }
}

function whatsappText() {
  const { product, color, size } = ctx;
  let t = `Olá! Experimentei a ${product.name}`;
  if (color) t += ` na cor ${color}`;
  if (size) t += `, tamanho ${size}`;
  return `${t}, no provador virtual e quero comprar. ${productUrl(product.slug)}`;
}

function showResult(view) {
  $('result-before').src = photo.dataUrl;
  $('result-after').src = view.resultUrl;
  $('compare').style.aspectRatio = `${photo.width} / ${photo.height}`;
  $('compare').style.setProperty('--ar', String(photo.width / photo.height));
  $('compare').style.setProperty('--pos', '20%');
  $('compare-range').value = 20;

  const { product, store } = ctx;
  const ext = view.resultUrl.split('.').pop();
  const dl = $('btn-download');
  dl.href = view.resultUrl;
  dl.download = `prova-${product.slug}.${ext}`;
  dl.onclick = () => trackEvent('download', product.id, view.id);

  const wa = $('btn-whatsapp');
  wa.hidden = !store.whatsapp;
  if (store.whatsapp) {
    wa.href = waLink(store.whatsapp, whatsappText());
    wa.onclick = () => trackEvent('whatsapp', product.id, view.id);
  }
  const buyUrl = product.buyUrl || store.storeUrl;
  $('btn-buy').hidden = !buyUrl;
  if (buyUrl) {
    $('btn-buy').href = buyUrl;
    $('btn-buy').onclick = () => trackEvent('buy_link', product.id, view.id);
  }
  step('result');
}

function showError(message) {
  $('error-message').textContent = message;
  step('error');
}

// Cada geração tem um número; fechar o provador invalida a que estiver em andamento,
// para ela não travar o botão nem mostrar o resultado antigo depois de reabrir.
let generation = 0;

async function generate() {
  if (busy || !photo) return;
  const mine = ++generation;
  const stale = () => mine !== generation;
  busy = true;
  updateGenerate();
  $('photo-error').textContent = '';
  const form = new FormData();
  form.append('photo', await (await fetch(photo.dataUrl)).blob(), 'foto.jpg');
  form.append('productId', ctx.product.id);
  if (ctx.color) form.append('color', ctx.color);
  if (ctx.size) form.append('size', ctx.size);
  form.append('width', photo.width);
  form.append('height', photo.height);
  form.append('consent', 'true');

  let view;
  try {
    view = await api('/api/tryon', { method: 'POST', form });
  } catch (err) {
    if (stale()) return;
    busy = false;
    $('photo-error').textContent = err.message;
    updateGenerate();
    return;
  }
  if (stale()) return;
  setRemaining(view.remaining);

  $('loading-img').src = photo.dataUrl;
  step('loading');
  const started = Date.now();
  let tick = 0;
  try {
    while (view.status === 'pending') {
      $('loading-title').textContent = LOADING_TITLES[Math.min(Math.floor(tick / 2), LOADING_TITLES.length - 1)];
      $('progress-bar').style.width = `${Math.min(92, ((Date.now() - started) / 25000) * 100)}%`;
      if (Date.now() - started > MAX_WAIT_MS) throw new Error('Demorou mais que o normal. Tente de novo em instantes.');
      await sleep(POLL_MS);
      if (stale()) return;
      tick++;
      view = await api(`/api/tryon/${view.id}`);
      if (stale()) return;
    }
    $('progress-bar').style.width = '100%';
    setRemaining(view.remaining);
    if (view.status === 'done') showResult(view);
    else showError(view.error || 'Não conseguimos gerar agora. Tente de novo.');
  } catch (err) {
    if (!stale()) showError(err.message);
  } finally {
    if (!stale()) {
      busy = false;
      updateGenerate();
    }
  }
}

function close() {
  if (busy && !confirm('A prova ainda está sendo gerada. Fechar mesmo assim?')) return;
  generation++; // abandona a geração em andamento (a prova continua no servidor e aparece no histórico)
  busy = false;
  $('tryon').hidden = true;
  document.body.classList.remove('no-scroll');
  lastFocus?.focus?.();
}

function wire() {
  if (wired) return;
  wired = true;
  $('photo-camera').addEventListener('change', onFile);
  $('photo-gallery').addEventListener('change', onFile);
  $('consent').addEventListener('change', updateGenerate);
  $('generate').addEventListener('click', generate);
  $('tryon-close').addEventListener('click', close);
  $('tryon').addEventListener('click', (e) => e.target === $('tryon') && close());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('tryon').hidden && close());
  $('compare-range').addEventListener('input', (e) => $('compare').style.setProperty('--pos', `${e.target.value}%`));
  $('btn-other-photo').addEventListener('click', () => {
    $('consent').checked = false;
    step('photo');
    updateGenerate();
  });
  $('btn-retry').addEventListener('click', () => {
    step('photo');
    updateGenerate();
  });
}

export function openTryon(options) {
  ctx = options;
  wire();
  lastFocus = document.activeElement;
  photo = photo ?? loadSavedPhoto();
  const variant = [ctx.color, ctx.size && `Tam. ${ctx.size}`].filter(Boolean).join(' · ');
  $('sheet-thumb').src = ctx.image?.url ?? '';
  $('sheet-name').textContent = ctx.product.name;
  $('sheet-variant').textContent = variant;
  const hours = ctx.store.retentionHours ?? 24;
  $('consent-text').textContent = `Autorizo o uso desta foto apenas para gerar a minha prova virtual. A foto e o resultado são apagados automaticamente em ${hours} horas.`;
  $('photo-error').textContent = ctx.store.remaining <= 0 ? remainingText(0) : '';
  showPhoto();
  setRemaining(ctx.store.remaining);
  step('photo');
  $('tryon').hidden = false;
  document.body.classList.add('no-scroll');
  $('tryon-close').focus();
}
