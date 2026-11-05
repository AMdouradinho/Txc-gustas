import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { listProducts, pickGarmentImage } from '../src/catalog.js';
import { seedIfEmpty } from '../src/seed.js';

const seedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'images');

test('semeia as 5 peças do spec com fotos e cores', () => {
  const db = openDb(':memory:');
  const productsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
  assert.equal(seedIfEmpty(db, { seedDir, productsDir }), 5);
  const all = listProducts(db, {});
  assert.deepEqual(
    all.map((p) => p.name),
    ['Camisa Polo Piquet Café', 'Camiseta Águia Off-Road', 'Camiseta Águia Cowboy', 'Boné Jeans Águia TXC', 'Baby Look Bordado Águia'],
  );
  const cowboy = all.find((p) => p.name === 'Camiseta Águia Cowboy');
  assert.deepEqual(cowboy.colors, ['Verde Militar', 'Marrom']);
  assert.equal(cowboy.images.length, 2);
  assert.equal(pickGarmentImage(cowboy, 'Marrom').color, 'Marrom');
  const bone = all.find((p) => p.category === 'boné');
  assert.equal(bone.tryonType, 'headwear');
  assert.equal(all.find((p) => p.name.startsWith('Baby')).gender, 'feminino');
  for (const p of all) {
    assert.equal(p.priceCents, null, p.name);
    assert.ok(p.aiNotes.length > 20, p.name);
    for (const img of p.images) {
      assert.equal(img.isTryonRef, true);
      assert.ok(fs.existsSync(path.join(productsDir, img.filename)));
    }
  }
});

test('não semeia de novo se já houver peças', () => {
  const db = openDb(':memory:');
  const productsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
  seedIfEmpty(db, { seedDir, productsDir });
  assert.equal(seedIfEmpty(db, { seedDir, productsDir }), 0);
});
