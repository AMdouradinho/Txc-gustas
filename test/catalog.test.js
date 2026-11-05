import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { ValidationError } from '../src/settings.js';
import { detectImageType, saveImage, readImage, removeFile, MAX_UPLOAD_BYTES } from '../src/images.js';
import {
  CATEGORIES,
  slugify,
  createProduct,
  updateProduct,
  deleteProduct,
  getProduct,
  getProductBySlug,
  listProducts,
  addImage,
  updateImage,
  deleteImage,
  pickGarmentImage,
} from '../src/catalog.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'));
const base = { name: 'Camiseta Águia Cowboy', category: 'camiseta', gender: 'masculino' };

test('MAX_UPLOAD_BYTES é 10 MB', () => assert.equal(MAX_UPLOAD_BYTES, 10 * 1024 * 1024));

test('detectImageType reconhece JPEG, PNG e WEBP pelos bytes', () => {
  assert.equal(detectImageType(JPEG), 'image/jpeg');
  assert.equal(detectImageType(PNG), 'image/png');
  assert.equal(detectImageType(WEBP), 'image/webp');
  assert.equal(detectImageType(Buffer.from('GIF89a......')), null);
  assert.equal(detectImageType(Buffer.from('hello world, isto é texto')), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});

test('saveImage grava com nome aleatório de 128 bits e readImage devolve', () => {
  const dir = tmp();
  const name = saveImage(dir, JPEG, 'image/jpeg');
  assert.match(name, /^[0-9a-f]{32}\.jpg$/);
  assert.match(saveImage(dir, PNG, 'image/png'), /^[0-9a-f]{32}\.png$/);
  assert.match(saveImage(dir, WEBP, 'image/webp'), /^[0-9a-f]{32}\.webp$/);
  const back = readImage(dir, name);
  assert.equal(back.mime, 'image/jpeg');
  assert.deepEqual(back.buffer, JPEG);
  removeFile(dir, name);
  assert.equal(fs.existsSync(path.join(dir, name)), false);
  assert.doesNotThrow(() => removeFile(dir, name));
});

test('readImage recusa nomes com caminho (path traversal)', () => {
  assert.throws(() => readImage(tmp(), '../etc/passwd'));
});

test('categorias mapeiam para o tipo de prova do spec', () => {
  for (const c of ['camiseta', 'polo', 'camisa', 'regata', 'moletom', 'jaqueta', 'baby look']) assert.equal(CATEGORIES[c], 'top', c);
  for (const c of ['calça', 'bermuda', 'short', 'saia']) assert.equal(CATEGORIES[c], 'bottom', c);
  for (const c of ['vestido', 'macacão']) assert.equal(CATEGORIES[c], 'full', c);
  for (const c of ['boné', 'chapéu']) assert.equal(CATEGORIES[c], 'headwear', c);
});

test('slugify remove acentos', () => assert.equal(slugify('Boné Jeans Águia TXC!'), 'bone-jeans-aguia-txc'));

test('createProduct gera slug e tipo de prova pela categoria', () => {
  const db = openDb(':memory:');
  const p = createProduct(db, base);
  assert.equal(p.slug, 'camiseta-aguia-cowboy');
  assert.equal(p.tryonType, 'top');
  assert.equal(p.gender, 'masculino');
  assert.deepEqual(p.images, []);
  assert.equal(p.active, true);
  assert.equal(p.priceCents, null);
  assert.equal(createProduct(db, base).slug, 'camiseta-aguia-cowboy-2');
});

test('tryonType explícito sobrescreve a categoria', () => {
  const p = createProduct(openDb(':memory:'), { ...base, tryonType: 'full' });
  assert.equal(p.tryonType, 'full');
});

test('createProduct normaliza listas e preço', () => {
  const p = createProduct(openDb(':memory:'), {
    ...base,
    sizes: ['P', ' M ', '', 'M'],
    colors: ['Verde Militar', 'Marrom'],
    priceCents: '15990',
    buyUrl: 'https://loja.com/p/1',
  });
  assert.deepEqual(p.sizes, ['P', 'M']);
  assert.deepEqual(p.colors, ['Verde Militar', 'Marrom']);
  assert.equal(p.priceCents, 15990);
  assert.equal(p.buyUrl, 'https://loja.com/p/1');
});

test('validações do produto', () => {
  const db = openDb(':memory:');
  assert.throws(() => createProduct(db, { ...base, name: '' }), ValidationError);
  assert.throws(() => createProduct(db, { ...base, category: 'meia' }), ValidationError);
  assert.throws(() => createProduct(db, { ...base, gender: 'x' }), ValidationError);
  assert.throws(() => createProduct(db, { ...base, tryonType: 'pé' }), ValidationError);
  assert.throws(() => createProduct(db, { ...base, buyUrl: 'javascript:alert(1)' }), ValidationError);
  assert.throws(() => createProduct(db, { ...base, priceCents: -5 }), ValidationError);
});

test('updateProduct altera campos e mantém slug', () => {
  const db = openDb(':memory:');
  const p = createProduct(db, base);
  const u = updateProduct(db, p.id, { ...base, name: 'Novo Nome', category: 'boné', active: false });
  assert.equal(u.name, 'Novo Nome');
  assert.equal(u.slug, p.slug);
  assert.equal(u.tryonType, 'headwear');
  assert.equal(u.active, false);
  assert.equal(updateProduct(db, 999, base), null);
});

test('list/get por slug respeitam activeOnly e categoria', () => {
  const db = openDb(':memory:');
  const a = createProduct(db, base);
  createProduct(db, { name: 'Boné', category: 'boné', gender: 'unissex', active: false });
  assert.equal(listProducts(db, { activeOnly: true }).length, 1);
  assert.equal(listProducts(db, {}).length, 2);
  assert.equal(listProducts(db, { category: 'boné' }).length, 1);
  assert.equal(getProductBySlug(db, 'bone', { activeOnly: true }), null);
  assert.equal(getProductBySlug(db, a.slug, { activeOnly: true }).id, a.id);
  assert.equal(getProduct(db, a.id).name, base.name);
});

test('addImage e updateImage: referência é exclusiva por cor', () => {
  const db = openDb(':memory:');
  const p = createProduct(db, { ...base, colors: ['Verde', 'Marrom'] });
  const v1 = addImage(db, p.id, 'a.jpg', { color: 'Verde' });
  const v2 = addImage(db, p.id, 'b.jpg', { color: 'Verde' });
  const m1 = addImage(db, p.id, 'c.jpg', { color: 'Marrom' });
  assert.equal(v1.url, '/media/products/a.jpg');
  updateImage(db, m1.id, { isTryonRef: true });
  updateImage(db, v1.id, { isTryonRef: true });
  updateImage(db, v2.id, { isTryonRef: true });
  const imgs = getProduct(db, p.id).images;
  const byName = Object.fromEntries(imgs.map((i) => [i.filename, i]));
  assert.equal(byName['a.jpg'].isTryonRef, false);
  assert.equal(byName['b.jpg'].isTryonRef, true);
  assert.equal(byName['c.jpg'].isTryonRef, true);
});

test('pickGarmentImage segue a ordem do spec §3.2', () => {
  const db = openDb(':memory:');
  const p = createProduct(db, { ...base, colors: ['Verde', 'Marrom', 'Azul'] });
  assert.equal(pickGarmentImage(getProduct(db, p.id), 'Verde'), null);
  const general = addImage(db, p.id, 'geral.jpg', { color: null });
  const v1 = addImage(db, p.id, 'v1.jpg', { color: 'Verde' });
  const v2 = addImage(db, p.id, 'v2.jpg', { color: 'Verde' });
  // sem referência na cor: primeira foto da cor
  assert.equal(pickGarmentImage(getProduct(db, p.id), 'Verde').id, v1.id);
  // referência da cor vence
  updateImage(db, v2.id, { isTryonRef: true });
  assert.equal(pickGarmentImage(getProduct(db, p.id), 'Verde').id, v2.id);
  // cor sem foto: primeira foto do produto (sem referência geral)
  assert.equal(pickGarmentImage(getProduct(db, p.id), 'Azul').id, general.id);
  // referência geral (sem cor) vence a primeira foto
  const g2 = addImage(db, p.id, 'g2.jpg', { color: null });
  updateImage(db, g2.id, { isTryonRef: true });
  assert.equal(pickGarmentImage(getProduct(db, p.id), 'Azul').id, g2.id);
  assert.equal(pickGarmentImage(getProduct(db, p.id), undefined).id, g2.id);
});

test('cor escolhida sem foto própria só usa foto sem cor; senão null', () => {
  const db = openDb(':memory:');
  const p = createProduct(db, { ...base, colors: ['Verde', 'Preto'] });
  addImage(db, p.id, 'v.jpg', { color: 'Verde' });
  assert.equal(pickGarmentImage(getProduct(db, p.id), 'Preto'), null);
  const general = addImage(db, p.id, 'g.jpg', { color: null });
  assert.equal(pickGarmentImage(getProduct(db, p.id), 'Preto').id, general.id);
});

test('pickGarmentImage é o mesmo módulo usado no navegador', async () => {
  const shared = await import('../public/js/garment.js');
  assert.equal(shared.pickGarmentImage, pickGarmentImage);
});

test('deleteImage e deleteProduct removem arquivos do disco', () => {
  const db = openDb(':memory:');
  const dir = tmp();
  const p = createProduct(db, base);
  const f1 = saveImage(dir, JPEG, 'image/jpeg');
  const f2 = saveImage(dir, JPEG, 'image/jpeg');
  const i1 = addImage(db, p.id, f1, {});
  addImage(db, p.id, f2, {});
  deleteImage(db, i1.id, dir);
  assert.equal(fs.existsSync(path.join(dir, f1)), false);
  deleteProduct(db, p.id, dir);
  assert.equal(fs.existsSync(path.join(dir, f2)), false);
  assert.equal(getProduct(db, p.id), null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM product_images').get().n, 0);
});
