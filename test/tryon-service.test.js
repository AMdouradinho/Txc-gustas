import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { updateSettings } from '../src/settings.js';
import { createProduct, addImage } from '../src/catalog.js';
import { saveImage } from '../src/images.js';
import { createTryonService, TryonError, FRIENDLY_ERRORS } from '../src/tryon-service.js';
import { ProviderError } from '../src/providers/errors.js';
import demo from '../src/providers/demo.js';

const jpeg = (n = 0) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n & 255, (n >> 8) & 255, 7, 7]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const GEMINI_USAGE = { promptTokenCount: 2600, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] };

function setup({ providers, keys = {}, settings, withImage = true, ...opts } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'));
  const dirs = { products: path.join(root, 'products'), people: path.join(root, 'people'), results: path.join(root, 'results') };
  const db = openDb(':memory:');
  if (settings) updateSettings(db, settings, { keys });
  const product = createProduct(db, { name: 'Camiseta Teste', category: 'camiseta', colors: ['Verde'] });
  if (withImage) addImage(db, product.id, saveImage(dirs.products, jpeg(999), 'image/jpeg'), { color: 'Verde' });
  const config = { keys, sessionSecret: 'segredo', timeZone: 'America/Sao_Paulo' };
  const service = createTryonService({ db, config, dirs, providers, pollMs: 0, ...opts });
  return { db, dirs, service, product };
}

const fakeGemini = (impl) => ({ id: 'gemini', label: 'Fake', supports: ['top', 'bottom', 'full', 'headwear'], requiresKey: true, tryOn: impl });
const okGemini = fakeGemini(async () => ({ image: { buffer: PNG, mime: 'image/png' }, usage: GEMINI_USAGE, model: 'm' }));
const base = (product, over = {}) => ({
  kind: 'customer',
  productId: product.id,
  color: 'Verde',
  size: 'M',
  personBuffer: jpeg(1),
  aspect: { width: 960, height: 1280 },
  clientId: 'c1',
  ip: '1.1.1.1',
  ...over,
});

test('fluxo feliz no modo demo', async () => {
  const { service, product, dirs } = setup();
  const r = service.submit(base(product));
  assert.equal(r.status, 'pending');
  assert.equal(r.cacheHit, false);
  await service.idle();
  const v = service.get(r.id);
  assert.equal(v.status, 'done');
  assert.match(v.resultUrl, /^\/media\/results\/[0-9a-f]{32}\.svg$/);
  assert.equal(v.costUsd, 0);
  assert.equal(v.provider, 'demo');
  assert.ok(fs.existsSync(path.join(dirs.results, path.basename(v.resultUrl))));
  assert.equal(service.get('nao-existe'), null);
});

test('mesma foto + mesma peça reaproveita o resultado sem custo e sem gastar limite', async () => {
  const { service, product } = setup();
  const first = service.submit(base(product));
  await service.idle();
  assert.equal(service.remaining('c1', '1.1.1.1'), 4);
  const again = service.submit(base(product));
  assert.equal(again.cacheHit, true);
  assert.equal(again.status, 'done');
  const v = service.get(again.id);
  assert.equal(v.resultUrl, service.get(first.id).resultUrl);
  assert.equal(v.costUsd, 0);
  assert.equal(service.remaining('c1', '1.1.1.1'), 4);
});

test('limite de 5 por cliente por dia', async () => {
  const { service, product } = setup();
  for (let i = 0; i < 5; i++) service.submit(base(product, { personBuffer: jpeg(10 + i) }));
  assert.throws(
    () => service.submit(base(product, { personBuffer: jpeg(99) })),
    (e) => e instanceof TryonError && e.status === 429 && e.message === 'Você já usou as 5 provas de hoje. Volte amanhã!',
  );
  assert.equal(service.remaining('c1', '1.1.1.1'), 0);
  await service.idle();
});

test('limite de 15 por IP mesmo trocando de cliente', async () => {
  const { service, product } = setup();
  for (let i = 0; i < 15; i++) service.submit(base(product, { clientId: `c${i}`, personBuffer: jpeg(100 + i) }));
  assert.throws(() => service.submit(base(product, { clientId: 'novo', personBuffer: jpeg(500) })), (e) => e.status === 429);
  await service.idle();
});

test('toque duplo com 1 prova restante: um passa, outro 429', async () => {
  const { service, product } = setup({ settings: { limits: { perClientPerDay: 1 } } });
  const results = [];
  for (const n of [1, 2]) {
    try {
      results.push(service.submit(base(product, { personBuffer: jpeg(n) })).status);
    } catch (e) {
      results.push(e.status);
    }
  }
  assert.deepEqual(results, ['pending', 429]);
  await service.idle();
});

test('prova que falha não conta no limite e mostra mensagem amigável', async () => {
  const failing = fakeGemini(async () => {
    throw new ProviderError('refused', 'Gemini não gerou imagem: IMAGE_SAFETY');
  });
  const { service, product } = setup({ providers: { gemini: failing, demo }, keys: { gemini: 'k' }, settings: { activeProvider: 'gemini' } });
  const r = service.submit(base(product));
  await service.idle();
  const v = service.get(r.id);
  assert.equal(v.status, 'failed');
  assert.equal(v.error, FRIENDLY_ERRORS.refused);
  assert.equal(v.error, 'Não conseguimos gerar. Use uma foto de frente, com boa luz e só você.');
  assert.match(v.errorDetail, /IMAGE_SAFETY/);
  assert.equal(service.remaining('c1', '1.1.1.1'), 5);
});

test('erro técnico mostra "instabilidade" ao cliente', async () => {
  const failing = fakeGemini(async () => {
    throw new ProviderError('auth', 'Gemini 401: bad key');
  });
  const { service, product } = setup({ providers: { gemini: failing, demo }, keys: { gemini: 'k' }, settings: { activeProvider: 'gemini' } });
  const r = service.submit(base(product));
  await service.idle();
  assert.equal(service.get(r.id).error, 'Provador com instabilidade, tente de novo');
});

test('provedor que não responde estoura o tempo', async () => {
  const hanging = fakeGemini(() => new Promise(() => {}));
  const { service, product } = setup({ providers: { gemini: hanging, demo }, keys: { gemini: 'k' }, settings: { activeProvider: 'gemini' }, timeoutMs: 50 });
  const r = service.submit(base(product));
  await service.idle();
  const v = service.get(r.id);
  assert.equal(v.status, 'failed');
  assert.match(v.errorDetail, /^timeout/);
});

test('custo real gravado a partir do uso devolvido', async () => {
  const { service, product } = setup({ providers: { gemini: okGemini, demo }, keys: { gemini: 'k' }, settings: { activeProvider: 'gemini' } });
  const r = service.submit(base(product));
  await service.idle();
  const v = service.get(r.id);
  assert.equal(v.status, 'done');
  assert.equal(v.costUsd, 0.0685);
  assert.equal(v.model, 'm');
  assert.ok(v.latencyMs >= 0);
});

test('falha com uso cobrado (recusa do Gemini) registra o custo', async () => {
  const refusing = fakeGemini(async () => {
    throw new ProviderError('refused', 'sem imagem', {}, { promptTokenCount: 2600, candidatesTokenCount: 0 });
  });
  const { service, product } = setup({ providers: { gemini: refusing, demo }, keys: { gemini: 'k' }, settings: { activeProvider: 'gemini' } });
  const r = service.submit(base(product));
  await service.idle();
  assert.equal(service.get(r.id).costUsd, 0.0013);
});

test('teto diário conta as pendentes pela estimativa', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const slow = fakeGemini(async () => {
    await gate;
    return { image: { buffer: PNG, mime: 'image/png' }, usage: GEMINI_USAGE, model: 'm' };
  });
  const { service, product } = setup({
    providers: { gemini: slow, demo },
    keys: { gemini: 'k' },
    settings: { activeProvider: 'gemini', limits: { dailyBudgetUsd: 0.1 } },
  });
  service.submit(base(product, { personBuffer: jpeg(1) }));
  assert.throws(
    () => service.submit(base(product, { clientId: 'c2', personBuffer: jpeg(2) })),
    (e) => e.status === 503 && e.message === 'Provador indisponível hoje',
  );
  // prova do dono não é bloqueada pelo teto
  const admin = service.submit(base(product, { kind: 'admin_test', clientId: null, personBuffer: jpeg(3) }));
  assert.equal(admin.status, 'pending');
  release();
  await service.idle();
});

test('peça sem foto: 400', () => {
  const { service, product } = setup({ withImage: false });
  assert.throws(() => service.submit(base(product)), (e) => e.status === 400 && e.message === 'Esta peça ainda não tem foto para prova');
});

test('peça inexistente ou inativa: 404', () => {
  const { service, product, db } = setup();
  assert.throws(() => service.submit(base(product, { productId: 999 })), (e) => e.status === 404);
  db.prepare('UPDATE products SET active = 0').run();
  assert.throws(() => service.submit(base(product)), (e) => e.status === 404);
});

test('arquivo que não é imagem: 400', () => {
  const { service, product } = setup();
  assert.throws(
    () => service.submit(base(product, { personBuffer: Buffer.from('não sou imagem nenhuma') })),
    (e) => e.status === 400 && e.message === 'Envie uma foto JPG/PNG de até 10 MB',
  );
});

test('provedor sem chave: 503 para cliente', () => {
  const { service, product, db } = setup();
  // grava direto no banco (o painel não deixaria ativar sem chave; simula a chave removida depois)
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify({ activeProvider: 'gemini' }));
  assert.throws(() => service.submit(base(product)), (e) => e.status === 503);
});

test('fila respeita no máximo 3 provas simultâneas', async () => {
  let running = 0;
  let peak = 0;
  const slow = fakeGemini(async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 20));
    running--;
    return { image: { buffer: PNG, mime: 'image/png' }, usage: {}, model: 'm' };
  });
  const { service, product } = setup({ providers: { gemini: slow, demo }, keys: { gemini: 'k' }, settings: { activeProvider: 'gemini' } });
  for (let i = 0; i < 5; i++) service.submit(base(product, { clientId: `c${i}`, personBuffer: jpeg(i + 1) }));
  await service.idle();
  assert.equal(peak, 3);
});

test('recoverOrphans marca pendentes como falhas', () => {
  const { service, product, db } = setup();
  service.submit(base(product));
  // simula reinício: outro serviço sobre o mesmo banco, antes da fila rodar
  db.prepare("UPDATE tryons SET status = 'pending'").run();
  const fresh = createTryonService({ db, config: { keys: {}, sessionSecret: 's', timeZone: 'UTC' }, dirs: { products: '/x', people: '/x', results: '/x' } });
  assert.equal(fresh.recoverOrphans(), 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tryons WHERE status = 'failed'").get().n, 1);
});

test('comparação do dono pode escolher o provedor', async () => {
  const { service, product } = setup({ providers: { gemini: okGemini, demo }, keys: { gemini: 'k' } });
  const r = service.submit(base(product, { kind: 'admin_test', providerId: 'gemini' }));
  await service.idle();
  assert.equal(service.get(r.id).provider, 'gemini');
});

test('IP é guardado como hash, nunca em claro', () => {
  const { service, product, db } = setup();
  service.submit(base(product));
  const row = db.prepare('SELECT ip_hash FROM tryons').get();
  assert.notEqual(row.ip_hash, '1.1.1.1');
  assert.match(row.ip_hash, /^[0-9a-f]{32}$/);
});
