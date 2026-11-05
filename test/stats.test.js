import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { getSettings } from '../src/settings.js';
import { createProduct, deleteProduct } from '../src/catalog.js';
import { getStats, listTryons } from '../src/stats.js';

const NOW = new Date('2026-11-05T15:00:00Z');
const opts = { period: 'today', now: NOW, timeZone: 'America/Sao_Paulo' };

function insert(db, row) {
  const r = {
    id: `t${Math.random()}`,
    kind: 'customer',
    product_id: null,
    image_id: 1,
    provider: 'gemini',
    model: 'm',
    status: 'done',
    cache_hit: 0,
    cost_usd: 0,
    latency_ms: 1000,
    created_at: '2026-11-05T14:00:00.000Z',
    ...row,
  };
  db.prepare(
    `INSERT INTO tryons (id, kind, product_id, image_id, provider, model, status, cache_hit, cost_usd, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.id, r.kind, r.product_id, r.image_id, r.provider, r.model, r.status, r.cache_hit, r.cost_usd, r.latency_ms, r.created_at);
}

function fixture() {
  const db = openDb(':memory:');
  const p = createProduct(db, { name: 'Polo Café', category: 'polo' });
  for (let i = 0; i < 3; i++) insert(db, { product_id: p.id, cost_usd: 0.0685, latency_ms: 10000 });
  insert(db, { product_id: p.id, cache_hit: 1, cost_usd: 0, latency_ms: null });
  insert(db, { product_id: p.id, status: 'failed', cost_usd: 0 });
  db.prepare("INSERT INTO events (type, product_id, created_at) VALUES ('whatsapp', ?, '2026-11-05T14:30:00.000Z')").run(p.id);
  return { db, p };
}

test('totais do período', () => {
  const { db } = fixture();
  const s = getStats(db, getSettings(db), opts);
  assert.equal(s.totals.tryons, 5);
  assert.equal(s.totals.done, 4);
  assert.equal(s.totals.failed, 1);
  assert.equal(s.totals.cacheHits, 1);
  assert.equal(s.totals.costUsd, 0.2055);
  assert.equal(s.totals.avgCostUsd, 0.0685);
  assert.equal(s.totals.cacheSavingsUsd, 0.0685);
  assert.equal(s.totals.failureRate, 0.2);
  assert.equal(s.totals.costBrl, 1.07);
});

test('hoje, mês e teto', () => {
  const { db } = fixture();
  insert(db, { cost_usd: 1, created_at: '2026-11-01T12:00:00.000Z' }); // no mês, não hoje
  insert(db, { cost_usd: 5, created_at: '2026-10-31T12:00:00.000Z' }); // mês passado
  const s = getStats(db, getSettings(db), opts);
  assert.equal(s.today.tryons, 5);
  assert.equal(s.today.costUsd, 0.2055);
  assert.equal(s.month.tryons, 6);
  assert.equal(s.month.costUsd, 1.2055);
  assert.deepEqual(s.budget, { dailyBudgetUsd: 5, spentTodayUsd: 0.2055, blockedToday: 0 });
});

test('períodos 7d, 30d e mês', () => {
  const { db } = fixture();
  insert(db, { cost_usd: 1, created_at: '2026-10-20T12:00:00.000Z' });
  assert.equal(getStats(db, getSettings(db), { ...opts, period: '7d' }).totals.tryons, 5);
  assert.equal(getStats(db, getSettings(db), { ...opts, period: '30d' }).totals.tryons, 6);
  assert.equal(getStats(db, getSettings(db), { ...opts, period: 'month' }).totals.tryons, 5);
});

test('por provedor', () => {
  const { db } = fixture();
  insert(db, { provider: 'demo', cost_usd: 0 });
  const s = getStats(db, getSettings(db), opts);
  const g = s.byProvider.find((r) => r.provider === 'gemini');
  assert.equal(g.tryons, 5);
  assert.equal(g.costUsd, 0.2055);
  assert.equal(g.avgCostUsd, 0.0685);
  assert.equal(g.avgLatencyMs, 10000);
  assert.ok(s.byProvider.find((r) => r.provider === 'demo'));
});

test('por peça com cliques', () => {
  const { db, p } = fixture();
  const row = getStats(db, getSettings(db), opts).byProduct.find((r) => r.productId === p.id);
  assert.equal(row.name, 'Polo Café');
  assert.equal(row.tryons, 5);
  assert.equal(row.costUsd, 0.2055);
  assert.equal(row.whatsapp, 1);
  assert.equal(row.buyLink, 0);
  assert.equal(row.downloads, 0);
});

test('peça apagada mantém o histórico de custo', () => {
  const { db, p } = fixture();
  deleteProduct(db, p.id, fs.mkdtempSync(path.join(os.tmpdir(), 'st-')));
  const s = getStats(db, getSettings(db), opts);
  assert.equal(s.totals.costUsd, 0.2055);
  assert.equal(s.byProduct.find((r) => r.productId === p.id).name, 'Peça removida');
});

test('estimativas por provedor e período vazio', () => {
  const db = openDb(':memory:');
  const s = getStats(db, getSettings(db), opts);
  assert.deepEqual(s.estimates, { gemini: 0.0685, openai: 0.06502, fashn: 0.075 });
  assert.equal(s.totals.tryons, 0);
  assert.equal(s.totals.failureRate, 0);
  assert.equal(s.totals.avgCostUsd, 0);
});

test('período inválido é rejeitado', () => {
  const db = openDb(':memory:');
  assert.throws(() => getStats(db, getSettings(db), { ...opts, period: 'ano' }), /Período inválido/);
});

test('listTryons traz as últimas com nome da peça', () => {
  const { db } = fixture();
  insert(db, { created_at: '2026-11-05T14:59:00.000Z', cost_usd: 0.075, provider: 'fashn' });
  const list = listTryons(db, { limit: 3 });
  assert.equal(list.length, 3);
  assert.equal(list[0].provider, 'fashn');
  assert.equal(list[0].productName, 'Peça removida');
  assert.equal(list[1].productName, 'Polo Café');
});

test('clientes barrados no período e alerta de teto hoje', () => {
  const { db, p } = fixture();
  const ev = db.prepare('INSERT INTO events (type, product_id, created_at) VALUES (?, ?, ?)');
  ev.run('blocked_limit', p.id, '2026-11-05T14:10:00.000Z');
  ev.run('blocked_limit', p.id, '2026-11-05T14:11:00.000Z');
  ev.run('blocked_budget', p.id, '2026-11-05T14:12:00.000Z');
  ev.run('blocked_unavailable', p.id, '2026-11-04T10:00:00.000Z'); // ontem
  const s = getStats(db, getSettings(db), opts);
  assert.deepEqual(s.totals.blocked, { limit: 2, budget: 1, unavailable: 0, total: 3 });
  assert.equal(s.budget.blockedToday, 1);
  assert.equal(s.totals.tryons, 5);
});
