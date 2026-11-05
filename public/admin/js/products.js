// Aba "Peças": lista, formulário e fotos.
import { api, el, $, state, formatPrice, toast, parseDecimal, fmtDecimal, categoryLabel, resizeImage } from './common.js';

let current = null; // peça em edição (null = nova)
let sizes;
let colors;

// Campo de etiquetas: Enter ou vírgula adiciona; × remove.
function tagInput(container, input) {
  let values = [];
  const render = () => {
    for (const t of container.querySelectorAll('.tag')) t.remove();
    values.forEach((v, i) =>
      container.insertBefore(
        el('span', { class: 'tag' }, v, el('button', { type: 'button', 'aria-label': `Remover ${v}`, text: '×', onclick: () => remove(i) })),
        input,
      ),
    );
  };
  const add = (raw) => {
    for (const part of String(raw).split(',')) {
      const v = part.trim();
      if (v && !values.includes(v)) values.push(v);
    }
    input.value = '';
    render();
  };
  const remove = (i) => {
    values.splice(i, 1);
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(input.value);
    } else if (e.key === 'Backspace' && !input.value && values.length) {
      remove(values.length - 1);
    }
  });
  input.addEventListener('blur', () => input.value.trim() && add(input.value));
  container.addEventListener('click', (e) => e.target === container && input.focus());
  return {
    get: () => (input.value.trim() ? (add(input.value), values) : values).slice(),
    set: (list) => {
      values = [...(list ?? [])];
      render();
    },
  };
}

function productRow(p) {
  const thumb = p.images[0];
  const variants = [p.colors.join(', '), p.sizes.join(' ')].filter(Boolean).join(' · ');
  return el(
    'div',
    { class: 'product-row' },
    thumb ? el('img', { src: thumb.url, alt: '' }) : el('div', { class: 'noimg' }),
    el(
      'div',
      {},
      el(
        'b',
        {},
        p.name,
        el('span', { class: `pill ${p.active ? 'on' : 'off'}`, text: p.active ? 'No catálogo' : 'Oculta' }),
        p.images.length ? null : el('span', { class: 'pill warn', text: 'Sem foto' }),
      ),
      el('div', { class: 'meta', text: `${categoryLabel(p.category)} · ${formatPrice(p.priceCents)} · ${p.images.length} foto(s)` }),
      variants ? el('div', { class: 'meta', text: variants }) : null,
    ),
    el('button', { class: 'btn btn-ghost', type: 'button', text: 'Editar', onclick: () => openEditor(p) }),
  );
}

async function loadList() {
  state.products = await api('/api/admin/products');
  const list = $('product-list');
  list.replaceChildren(
    ...(state.products.length
      ? state.products.map(productRow)
      : [el('p', { class: 'muted', text: 'Nenhuma peça ainda. Clique em "Nova peça".' })]),
  );
}

function showList() {
  current = null;
  $('product-editor').hidden = true;
  $('products-list-view').hidden = false;
  loadList();
}

function fillForm(p) {
  $('f-name').value = p?.name ?? '';
  const cat = p?.category ?? 'camiseta';
  $('f-category').value = cat;
  $('f-tryonType').value = p?.tryonType ?? state.catalog.categories[cat];
  $('f-gender').value = p?.gender ?? 'unissex';
  $('f-price').value = p?.priceCents === null || p?.priceCents === undefined ? '' : fmtDecimal((p.priceCents / 100).toFixed(2));
  sizes.set(p?.sizes);
  colors.set(p?.colors);
  $('f-buyUrl').value = p?.buyUrl ?? '';
  $('f-description').value = p?.description ?? '';
  $('f-aiNotes').value = p?.aiNotes ?? '';
  $('f-active').checked = p ? p.active : true;
  $('product-error').textContent = '';
}

function openEditor(p) {
  current = p ?? null;
  fillForm(current);
  $('editor-title').textContent = current ? current.name : 'Nova peça';
  $('delete-product').hidden = !current;
  $('photos-section').hidden = !current;
  if (current) renderPhotos();
  $('products-list-view').hidden = true;
  $('product-editor').hidden = false;
  window.scrollTo(0, 0);
  $('f-name').focus();
}

function readForm() {
  const price = parseDecimal($('f-price').value);
  if (Number.isNaN(price) || (price !== null && price < 0)) throw new Error('Preço inválido. Use o formato 159,90');
  return {
    name: $('f-name').value,
    category: $('f-category').value,
    tryonType: $('f-tryonType').value,
    gender: $('f-gender').value,
    priceCents: price === null ? null : Math.round(price * 100),
    sizes: sizes.get(),
    colors: colors.get(),
    buyUrl: $('f-buyUrl').value,
    description: $('f-description').value,
    aiNotes: $('f-aiNotes').value,
    active: $('f-active').checked,
    sort: current?.sort ?? state.products.length,
  };
}

async function saveProduct(e) {
  e.preventDefault();
  $('product-error').textContent = '';
  $('save-product').disabled = true;
  try {
    const body = readForm();
    const saved = current
      ? await api(`/api/admin/products/${current.id}`, { method: 'PUT', json: body })
      : await api('/api/admin/products', { method: 'POST', json: body });
    const isNew = !current;
    current = saved;
    $('editor-title').textContent = saved.name;
    $('delete-product').hidden = false;
    $('photos-section').hidden = false;
    renderPhotos();
    toast(isNew ? 'Peça criada. Agora envie as fotos.' : 'Peça salva');
  } catch (err) {
    $('product-error').textContent = err.message;
  } finally {
    $('save-product').disabled = false;
  }
}

function colorOptions(selected, emptyLabel) {
  return [
    el('option', { value: '', text: emptyLabel, selected: !selected }),
    ...current.colors.map((c) => el('option', { value: c, text: c, selected: c === selected })),
  ];
}

async function refreshCurrent() {
  current = await api(`/api/admin/products/${current.id}`);
  renderPhotos();
}

async function patchImage(id, body) {
  try {
    await api(`/api/admin/images/${id}`, { method: 'PATCH', json: body });
  } catch (err) {
    $('photo-error').textContent = err.message;
  }
}

function renderPhotos() {
  const keep = $('upload-color').value;
  $('upload-color').replaceChildren(...colorOptions(keep, 'Sem cor (vale para todas)'));
  const imgs = current.images;
  $('photo-grid').replaceChildren(
    ...(imgs.length
      ? imgs.map((img, i) =>
          el(
            'div',
            { class: `photo-item${img.isTryonRef ? ' ref' : ''}` },
            el('img', { src: img.url, alt: '' }),
            el(
              'div',
              { class: 'photo-tools' },
              el(
                'select',
                {
                  'aria-label': 'Cor desta foto',
                  onchange: async (e) => {
                    await patchImage(img.id, { color: e.target.value || null });
                    refreshCurrent();
                  },
                },
                ...colorOptions(img.color, 'Sem cor'),
              ),
              el(
                'div',
                { class: 'tool-row' },
                el('button', {
                  type: 'button',
                  title: 'Usar esta foto na prova',
                  'aria-pressed': String(img.isTryonRef),
                  text: '★',
                  onclick: async () => {
                    await patchImage(img.id, { isTryonRef: !img.isTryonRef });
                    refreshCurrent();
                  },
                }),
                el('button', {
                  type: 'button',
                  title: 'Mover para a esquerda',
                  text: '←',
                  disabled: i === 0,
                  onclick: () => swap(i, i - 1),
                }),
                el('button', {
                  type: 'button',
                  title: 'Mover para a direita',
                  text: '→',
                  disabled: i === imgs.length - 1,
                  onclick: () => swap(i, i + 1),
                }),
                el('button', {
                  type: 'button',
                  title: 'Excluir foto',
                  text: '🗑',
                  onclick: async () => {
                    if (!confirm('Excluir esta foto?')) return;
                    await api(`/api/admin/images/${img.id}`, { method: 'DELETE' }).catch((err) => ($('photo-error').textContent = err.message));
                    refreshCurrent();
                  },
                }),
              ),
            ),
          ),
        )
      : [el('p', { class: 'muted', text: 'Nenhuma foto ainda. Sem foto, a peça não pode ser provada.' })]),
  );
}

async function swap(a, b) {
  const imgs = current.images;
  await patchImage(imgs[a].id, { sort: b });
  await patchImage(imgs[b].id, { sort: a });
  // normaliza a ordem das demais
  await Promise.all(imgs.map((img, i) => (i !== a && i !== b && img.sort !== i ? patchImage(img.id, { sort: i }) : null)));
  refreshCurrent();
}

async function uploadPhotos(e) {
  const files = [...(e.target.files ?? [])];
  e.target.value = '';
  if (!files.length || !current) return;
  $('photo-error').textContent = '';
  const form = new FormData();
  try {
    for (const f of files) {
      const { blob } = await resizeImage(f, 1600, 0.88);
      form.append('photos', blob, 'foto.jpg');
    }
  } catch (err) {
    $('photo-error').textContent = err.message;
    return;
  }
  if ($('upload-color').value) form.append('color', $('upload-color').value);
  try {
    current = await api(`/api/admin/products/${current.id}/images`, { method: 'POST', form });
    renderPhotos();
    toast(`${files.length} foto(s) enviada(s)`);
  } catch (err) {
    $('photo-error').textContent = err.message;
  }
}

async function deleteCurrent() {
  if (!current || !confirm(`Excluir "${current.name}" e todas as fotos? O histórico de custo é mantido.`)) return;
  await api(`/api/admin/products/${current.id}`, { method: 'DELETE' });
  toast('Peça excluída');
  showList();
}

let ready = false;
export function initProducts() {
  if (ready) return;
  ready = true;
  sizes = tagInput($('f-sizes'), $('f-sizes-input'));
  colors = tagInput($('f-colors'), $('f-colors-input'));
  $('f-category').replaceChildren(
    ...Object.keys(state.catalog.categories).map((c) => el('option', { value: c, text: categoryLabel(c) })),
  );
  $('f-category').addEventListener('change', (e) => ($('f-tryonType').value = state.catalog.categories[e.target.value]));
  $('product-form').addEventListener('submit', saveProduct);
  $('new-product').addEventListener('click', () => openEditor(null));
  $('back-to-list').addEventListener('click', showList);
  $('delete-product').addEventListener('click', deleteCurrent);
  $('photo-upload').addEventListener('change', uploadPhotos);
}

export function showProducts() {
  if ($('product-editor').hidden) loadList();
}
