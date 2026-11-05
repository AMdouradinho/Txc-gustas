// Aba "Comparar IAs": mesma foto e peça em várias IAs, lado a lado.
import { api, el, $, state, fmtUsd, fmtBrl, fmtSeconds, usdToBrl, providerName, resizeImage } from './common.js';

let photo = null;
let products = [];

function fillProducts() {
  const keep = $('compare-product').value;
  products = state.products.filter((p) => p.images.length);
  $('compare-product').replaceChildren(...products.map((p) => el('option', { value: p.id, text: p.name, selected: String(p.id) === keep })));
  fillColors();
}

function fillColors() {
  const p = products.find((x) => String(x.id) === $('compare-product').value);
  const colors = p?.colors ?? [];
  $('compare-color').replaceChildren(...(colors.length ? colors.map((c) => el('option', { value: c, text: c })) : [el('option', { value: '', text: '—' })]));
}

function fillProviders() {
  const { providerStatus, estimates } = state.settings;
  const active = state.settings.settings.activeProvider;
  $('compare-providers').replaceChildren(
    ...['gemini', 'openai', 'fashn', 'demo'].map((id) => {
      const st = providerStatus[id];
      const cost = id === 'demo' ? 'grátis' : `≈ ${fmtUsd(estimates[id])}`;
      return el(
        'label',
        { class: `provider-check${st.hasKey ? '' : ' disabled'}`, title: st.hasKey ? st.label : 'Sem chave de API configurada' },
        el('input', { type: 'checkbox', value: id, disabled: !st.hasKey, checked: st.hasKey && (id === active || (active === 'demo' && id !== 'demo')) }),
        `${providerName(id)} `,
        el('small', { text: st.hasKey ? cost : 'sem chave' }),
      );
    }),
  );
}

async function onPhoto(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  $('compare-error').textContent = '';
  try {
    photo = await resizeImage(file);
    $('compare-preview').replaceChildren(el('img', { src: photo.dataUrl, alt: 'Foto de teste' }));
  } catch (err) {
    $('compare-error').textContent = err.message;
  }
}

function card(provider) {
  const media = el('div', { class: 'media', text: 'Gerando…' });
  const info = el('div', { class: 'info' }, el('b', { text: providerName(provider) }));
  return { node: el('div', { class: 'compare-card' }, media, info), media, info };
}

async function follow(job, c) {
  if (job.error) {
    c.media.textContent = 'Não gerou';
    c.info.append(el('span', { class: 'err', text: job.error }));
    return;
  }
  let v;
  for (let i = 0; i < 90; i++) {
    v = await api(`/api/admin/tryon/${job.id}`);
    if (v.status !== 'pending') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (v.status === 'done') {
    c.media.replaceChildren(el('img', { class: 'result', src: v.resultUrl, alt: `Resultado ${providerName(job.provider)}` }));
    c.info.append(
      el('span', { text: `${fmtUsd(v.costUsd)} · ${fmtBrl(v.costUsd * usdToBrl())}${v.cacheHit ? ' (reaproveitada)' : ''}` }),
      el('span', { class: 'muted', text: `${fmtSeconds(v.latencyMs)} · ${v.model ?? ''}` }),
    );
  } else {
    c.media.textContent = 'Falhou';
    c.info.append(el('span', { class: 'err', text: v.errorDetail || v.error || 'Ainda gerando — confira em Custos.' }));
  }
}

async function run() {
  $('compare-error').textContent = '';
  const providers = [...$('compare-providers').querySelectorAll('input:checked')].map((i) => i.value);
  if (!photo) return ($('compare-error').textContent = 'Escolha uma foto de teste.');
  if (!$('compare-product').value) return ($('compare-error').textContent = 'Cadastre uma peça com foto primeiro.');
  if (!providers.length) return ($('compare-error').textContent = 'Marque ao menos uma IA.');
  const form = new FormData();
  form.append('photo', await (await fetch(photo.dataUrl)).blob(), 'teste.jpg');
  form.append('productId', $('compare-product').value);
  if ($('compare-color').value) form.append('color', $('compare-color').value);
  form.append('providers', providers.join(','));
  form.append('width', photo.width);
  form.append('height', photo.height);
  $('compare-run').disabled = true;
  try {
    const { jobs } = await api('/api/admin/compare', { method: 'POST', form });
    const cards = jobs.map((j) => [j, card(j.provider)]);
    $('compare-results').replaceChildren(...cards.map(([, c]) => c.node));
    await Promise.all(cards.map(([j, c]) => follow(j, c).catch((err) => c.info.append(el('span', { class: 'err', text: err.message })))));
  } catch (err) {
    $('compare-error').textContent = err.message;
  } finally {
    $('compare-run').disabled = false;
  }
}

let ready = false;
export function initCompare() {
  if (ready) return;
  ready = true;
  $('compare-photo').addEventListener('change', onPhoto);
  $('compare-product').addEventListener('change', fillColors);
  $('compare-run').addEventListener('click', run);
}

export async function showCompare() {
  if (!state.products.length) state.products = await api('/api/admin/products');
  fillProducts();
  fillProviders();
}
