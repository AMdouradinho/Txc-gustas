// Cadastro de peças e das fotos de cada peça.
import { ValidationError, normalizeUrl } from './settings.js';
import { nowIso } from './time.js';
import { removeFile } from './images.js';

export const CATEGORIES = Object.freeze({
  camiseta: 'top',
  polo: 'top',
  camisa: 'top',
  regata: 'top',
  moletom: 'top',
  jaqueta: 'top',
  'baby look': 'top',
  'calça': 'bottom',
  bermuda: 'bottom',
  short: 'bottom',
  saia: 'bottom',
  vestido: 'full',
  'macacão': 'full',
  'boné': 'headwear',
  'chapéu': 'headwear',
});
export const GENDERS = ['masculino', 'feminino', 'unissex'];
export const TRYON_TYPES = ['top', 'bottom', 'full', 'headwear'];

export function slugify(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'peca';
}

function uniqueSlug(db, name) {
  const base = slugify(name);
  const exists = db.prepare('SELECT 1 FROM products WHERE slug = ?');
  let slug = base;
  for (let n = 2; exists.get(slug); n++) slug = `${base}-${n}`;
  return slug;
}

const str = (v, field, max, required = false) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (required && !s) throw new ValidationError(`Campo ${field}: não pode ficar vazio`);
  if (s.length > max) throw new ValidationError(`Campo ${field}: máximo de ${max} caracteres`);
  return s;
};

const list = (v, field) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ValidationError(`Campo ${field}: formato inválido`);
  const out = [];
  for (const item of v) {
    const s = str(item, field, 40);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
};

function validateProduct(input) {
  const name = str(input.name, 'nome', 120, true);
  const category = str(input.category, 'categoria', 40, true).toLowerCase();
  if (!(category in CATEGORIES)) throw new ValidationError(`Categoria inválida: ${category}`);
  const tryonType = input.tryonType ? String(input.tryonType) : CATEGORIES[category];
  if (!TRYON_TYPES.includes(tryonType)) throw new ValidationError(`Tipo de prova inválido: ${tryonType}`);
  const gender = input.gender ? String(input.gender) : 'unissex';
  if (!GENDERS.includes(gender)) throw new ValidationError(`Gênero inválido: ${gender}`);
  let priceCents = null;
  if (input.priceCents !== undefined && input.priceCents !== null && input.priceCents !== '') {
    priceCents = Number(input.priceCents);
    if (!Number.isInteger(priceCents) || priceCents < 0) throw new ValidationError('Campo preço: valor inválido');
  }
  return {
    name,
    category,
    tryonType,
    gender,
    priceCents,
    sizes: list(input.sizes, 'tamanhos'),
    colors: list(input.colors, 'cores'),
    description: str(input.description, 'descrição', 2000),
    aiNotes: str(input.aiNotes, 'detalhes para IA', 500),
    buyUrl: normalizeUrl(input.buyUrl ?? '', 'link de compra'),
    active: input.active === undefined ? true : Boolean(input.active),
    sort: Number.isInteger(Number(input.sort)) ? Number(input.sort) : 0,
  };
}

function toImage(row) {
  return {
    id: row.id,
    productId: row.product_id,
    filename: row.filename,
    url: `/media/products/${row.filename}`,
    color: row.color,
    isTryonRef: Boolean(row.is_tryon_ref),
    sort: row.sort,
  };
}

function toProduct(db, row) {
  if (!row) return null;
  const images = db
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort, id')
    .all(row.id)
    .map(toImage);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    tryonType: row.tryon_type,
    gender: row.gender,
    priceCents: row.price_cents,
    sizes: JSON.parse(row.sizes),
    colors: JSON.parse(row.colors),
    description: row.description,
    aiNotes: row.ai_notes,
    buyUrl: row.buy_url,
    active: Boolean(row.active),
    sort: row.sort,
    images,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProduct(db, id) {
  return toProduct(db, db.prepare('SELECT * FROM products WHERE id = ?').get(Number(id)));
}

export function getProductBySlug(db, slug, { activeOnly = false } = {}) {
  const row = db.prepare(`SELECT * FROM products WHERE slug = ?${activeOnly ? ' AND active = 1' : ''}`).get(String(slug));
  return toProduct(db, row);
}

export function listProducts(db, { activeOnly = false, category } = {}) {
  const where = [];
  const params = [];
  if (activeOnly) where.push('active = 1');
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  const sql = `SELECT * FROM products${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY sort, id`;
  return db.prepare(sql).all(...params).map((r) => toProduct(db, r));
}

export function createProduct(db, input) {
  const p = validateProduct(input);
  const now = nowIso();
  const res = db
    .prepare(
      `INSERT INTO products (slug, name, category, tryon_type, gender, price_cents, sizes, colors, description, ai_notes, buy_url, active, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uniqueSlug(db, p.name),
      p.name,
      p.category,
      p.tryonType,
      p.gender,
      p.priceCents,
      JSON.stringify(p.sizes),
      JSON.stringify(p.colors),
      p.description,
      p.aiNotes,
      p.buyUrl,
      p.active ? 1 : 0,
      p.sort,
      now,
      now,
    );
  return getProduct(db, res.lastInsertRowid);
}

export function updateProduct(db, id, input) {
  if (!getProduct(db, id)) return null;
  const p = validateProduct(input);
  db.prepare(
    `UPDATE products SET name=?, category=?, tryon_type=?, gender=?, price_cents=?, sizes=?, colors=?, description=?, ai_notes=?, buy_url=?, active=?, sort=?, updated_at=?
     WHERE id=?`,
  ).run(
    p.name,
    p.category,
    p.tryonType,
    p.gender,
    p.priceCents,
    JSON.stringify(p.sizes),
    JSON.stringify(p.colors),
    p.description,
    p.aiNotes,
    p.buyUrl,
    p.active ? 1 : 0,
    p.sort,
    nowIso(),
    Number(id),
  );
  return getProduct(db, id);
}

export function deleteProduct(db, id, productsDir) {
  const product = getProduct(db, id);
  if (!product) return false;
  for (const img of product.images) removeFile(productsDir, img.filename);
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(id));
  return true;
}

function getImage(db, imageId) {
  const row = db.prepare('SELECT * FROM product_images WHERE id = ?').get(Number(imageId));
  return row ? toImage(row) : null;
}

const normColor = (c) => (c === undefined || c === null || String(c).trim() === '' ? null : String(c).trim().slice(0, 40));

export function addImage(db, productId, filename, { color } = {}) {
  const next = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM product_images WHERE product_id = ?').get(Number(productId)).s;
  const res = db
    .prepare('INSERT INTO product_images (product_id, filename, color, is_tryon_ref, sort) VALUES (?, ?, ?, 0, ?)')
    .run(Number(productId), filename, normColor(color), next);
  return getImage(db, res.lastInsertRowid);
}

export function updateImage(db, imageId, changes = {}) {
  const img = getImage(db, imageId);
  if (!img) return null;
  const color = 'color' in changes ? normColor(changes.color) : img.color;
  const sort = 'sort' in changes && Number.isInteger(Number(changes.sort)) ? Number(changes.sort) : img.sort;
  let isRef = 'isTryonRef' in changes ? Boolean(changes.isTryonRef) : img.isTryonRef;
  if (isRef) {
    db.prepare('UPDATE product_images SET is_tryon_ref = 0 WHERE product_id = ? AND color IS ? AND id != ?').run(
      img.productId,
      color,
      img.id,
    );
  }
  db.prepare('UPDATE product_images SET color = ?, sort = ?, is_tryon_ref = ? WHERE id = ?').run(color, sort, isRef ? 1 : 0, img.id);
  db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(nowIso(), img.productId);
  return getImage(db, img.id);
}

export function deleteImage(db, imageId, productsDir) {
  const img = getImage(db, imageId);
  if (!img) return false;
  removeFile(productsDir, img.filename);
  db.prepare('DELETE FROM product_images WHERE id = ?').run(img.id);
  return true;
}

// Regra de escolha da foto da prova: compartilhada com o navegador.
export { pickGarmentImage } from '../public/js/garment.js';
