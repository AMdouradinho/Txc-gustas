import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { cleanupExpired } from '../src/cleanup.js';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-'));
  const dirs = { people: path.join(root, 'people'), results: path.join(root, 'results') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d);
  const db = openDb(':memory:');
  const add = (id, createdAt, person, result, cacheHit = 0) => {
    if (person) fs.writeFileSync(path.join(dirs.people, person), 'x');
    if (result && !fs.existsSync(path.join(dirs.results, result))) fs.writeFileSync(path.join(dirs.results, result), 'x');
    db.prepare(
      "INSERT INTO tryons (id, kind, provider, status, person_file, result_file, cache_hit, cost_usd, created_at) VALUES (?, 'customer', 'gemini', 'done', ?, ?, ?, 0.07, ?)",
    ).run(id, person, result, cacheHit, createdAt);
  };
  return { db, dirs, add };
}

const NOW = new Date('2026-11-05T12:00:00Z');

test('apaga fotos com mais de 24 h e mantém o registro', () => {
  const { db, dirs, add } = setup();
  add('velha', '2026-11-04T11:00:00.000Z', 'p1.jpg', 'r1.png');
  add('nova', '2026-11-05T11:00:00.000Z', 'p2.jpg', 'r2.png');
  const out = cleanupExpired({ db, dirs, retentionHours: 24, now: NOW });
  assert.equal(out.deleted, 2);
  assert.equal(fs.existsSync(path.join(dirs.people, 'p1.jpg')), false);
  assert.equal(fs.existsSync(path.join(dirs.results, 'r1.png')), false);
  assert.equal(fs.existsSync(path.join(dirs.people, 'p2.jpg')), true);
  assert.equal(fs.existsSync(path.join(dirs.results, 'r2.png')), true);
  const old = db.prepare("SELECT * FROM tryons WHERE id = 'velha'").get();
  assert.equal(old.person_file, null);
  assert.equal(old.result_file, null);
  assert.equal(old.cost_usd, 0.07);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tryons').get().n, 2);
});

test('resultado reaproveitado por prova recente não é apagado', () => {
  const { db, dirs, add } = setup();
  add('original', '2026-11-04T11:00:00.000Z', 'p1.jpg', 'shared.png');
  add('cache', '2026-11-05T11:00:00.000Z', null, 'shared.png', 1);
  cleanupExpired({ db, dirs, retentionHours: 24, now: NOW });
  assert.equal(fs.existsSync(path.join(dirs.results, 'shared.png')), true);
  assert.equal(fs.existsSync(path.join(dirs.people, 'p1.jpg')), false);
});

test('rodar de novo não quebra', () => {
  const { db, dirs, add } = setup();
  add('velha', '2026-11-04T11:00:00.000Z', 'p1.jpg', 'r1.png');
  cleanupExpired({ db, dirs, retentionHours: 24, now: NOW });
  assert.deepEqual(cleanupExpired({ db, dirs, retentionHours: 24, now: NOW }), { deleted: 0 });
});
