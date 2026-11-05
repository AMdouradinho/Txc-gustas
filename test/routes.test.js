import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createTryonService } from '../src/tryon-service.js';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';

const JPEG = (n = 1) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, 2, 3, 4, 5, 6, 7, 8]);

function setup(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
  const dirs = { products: path.join(root, 'products'), people: path.join(root, 'people'), results: path.join(root, 'results') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const db = openDb(':memory:');
  const config = { keys: {}, sessionSecret: 'segredo-de-teste', adminPassword: 'senha123', timeZone: 'America/Sao_Paulo', isProduction: false, ...over };
  const service = createTryonService({ db, config, dirs });
  const app = createApp({ db, config, service, dirs });
  return { app, db, dirs, service };
}

async function adminAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ password: 'senha123' }).expect(200);
  return agent;
}

async function productWithPhoto(agent, over = {}) {
  const p = (await agent.post('/api/admin/products').send({ name: 'Camiseta Águia', category: 'camiseta', colors: ['Verde'], ...over }).expect(201)).body;
  const withImg = (await agent.post(`/api/admin/products/${p.id}/images`).field('color', 'Verde').attach('photos', JPEG(9), 'peca.jpg').expect(200)).body;
  return withImg;
}

// ---------- auth ----------

test('painel sem login: 401', async () => {
  const { app } = setup();
  const r = await request(app).get('/api/admin/products').expect(401);
  assert.ok(r.body.error);
});

test('login certo libera o painel; logout derruba', async () => {
  const { app } = setup();
  const agent = await adminAgent(app);
  const me = (await agent.get('/api/admin/me').expect(200)).body;
  assert.equal(me.catalog.categories['boné'], 'headwear');
  assert.deepEqual(me.catalog.genders, ['masculino', 'feminino', 'unissex']);
  assert.deepEqual(me.catalog.tryonTypes, ['top', 'bottom', 'full', 'headwear']);
  await agent.post('/api/admin/logout').expect(204);
  await agent.get('/api/admin/me').expect(401);
});

test('6 senhas erradas seguidas: a 6ª é 429', async () => {
  const { app } = setup();
  for (let i = 0; i < 5; i++) {
    const r = await request(app).post('/api/admin/login').send({ password: 'errada' });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'Senha incorreta');
  }
  const r = await request(app).post('/api/admin/login').send({ password: 'senha123' });
  assert.equal(r.status, 429);
});

test('cookie do painel é httpOnly e assinado', async () => {
  const { app } = setup();
  const r = await request(app).post('/api/admin/login').send({ password: 'senha123' }).expect(200);
  const cookie = r.headers['set-cookie'].find((c) => c.startsWith('adm='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  const forged = request(app).get('/api/admin/me').set('Cookie', 'adm=99999999999999.assinaturafalsa');
  await forged.expect(401);
});

test('createAuth: token expira em 7 dias', () => {
  let t = 1_000_000;
  const auth = createAuth({ password: 'x', secret: 's', now: () => t });
  const token = auth.login('x', 'ip');
  assert.equal(auth.verify(token), true);
  t += 7 * 24 * 3600 * 1000 + 1;
  assert.equal(auth.verify(token), false);
});

// ---------- peças ----------

test('CRUD de peças pelo painel', async () => {
  const { app } = setup();
  const agent = await adminAgent(app);
  const created = (await agent.post('/api/admin/products').send({ name: 'Polo Café', category: 'polo', priceCents: 15990 }).expect(201)).body;
  assert.equal(created.slug, 'polo-cafe');
  const updated = (await agent.put(`/api/admin/products/${created.id}`).send({ ...created, name: 'Polo Café Piquet' }).expect(200)).body;
  assert.equal(updated.name, 'Polo Café Piquet');
  assert.equal((await agent.get('/api/admin/products').expect(200)).body.length, 1);
  await agent.delete(`/api/admin/products/${created.id}`).expect(204);
  await agent.get(`/api/admin/products/${created.id}`).expect(404);
});

test('validação de peça devolve 400 com mensagem', async () => {
  const { app } = setup();
  const agent = await adminAgent(app);
  const r = await agent.post('/api/admin/products').send({ name: '', category: 'camiseta' }).expect(400);
  assert.match(r.body.error, /nome/);
});

test('upload de foto: primeira da cor vira referência; texto renomeado é rejeitado', async () => {
  const { app } = setup();
  const agent = await adminAgent(app);
  const p = await productWithPhoto(agent);
  assert.equal(p.images.length, 1);
  assert.equal(p.images[0].isTryonRef, true);
  assert.equal(p.images[0].color, 'Verde');
  await agent.get(p.images[0].url).expect(200);
  const bad = await agent.post(`/api/admin/products/${p.id}/images`).attach('photos', Buffer.from('não sou foto'), 'falsa.jpg').expect(400);
  assert.equal(bad.body.error, 'Envie uma foto JPG/PNG de até 10 MB');
});

test('editar e apagar foto', async () => {
  const { app } = setup();
  const agent = await adminAgent(app);
  const p = await productWithPhoto(agent);
  const img = (await agent.patch(`/api/admin/images/${p.images[0].id}`).send({ color: 'Marrom' }).expect(200)).body;
  assert.equal(img.color, 'Marrom');
  await agent.delete(`/api/admin/images/${img.id}`).expect(204);
  assert.equal((await agent.get(`/api/admin/products/${p.id}`).expect(200)).body.images.length, 0);
});

test('catálogo público esconde peças inativas e detalhes internos', async () => {
  const { app } = setup();
  const agent = await adminAgent(app);
  await productWithPhoto(agent, { aiNotes: 'segredo da IA' });
  await agent.post('/api/admin/products').send({ name: 'Oculta', category: 'polo', active: false }).expect(201);
  const list = (await request(app).get('/api/products').expect(200)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].aiNotes, undefined);
  await request(app).get('/api/products/oculta').expect(404);
  const one = (await request(app).get(`/api/products/${list[0].slug}`).expect(200)).body;
  assert.equal(one.name, 'Camiseta Águia');
});

// ---------- configurações ----------

test('configurações: lê status das chaves e recusa provedor sem chave', async () => {
  const { app } = setup();
  const agent = await adminAgent(app);
  const s = (await agent.get('/api/admin/settings').expect(200)).body;
  assert.equal(s.settings.activeProvider, 'demo');
  assert.equal(s.providerStatus.gemini.hasKey, false);
  assert.equal(s.providerStatus.demo.hasKey, true);
  assert.equal(s.estimates.gemini, 0.0685);
  const r = await agent.put('/api/admin/settings').send({ activeProvider: 'openai' }).expect(400);
  assert.equal(r.body.error, 'Provedor openai sem chave de API configurada');
  const ok = (await agent.put('/api/admin/settings').send({ store: { whatsapp: '(11) 99999-9999' } }).expect(200)).body;
  assert.equal(ok.settings.store.whatsapp, '5511999999999');
});

// ---------- prova ----------

test('loja informa nome, limite e provas restantes; cria cookie pid', async () => {
  const { app } = setup();
  const r = await request(app).get('/api/store').expect(200);
  assert.equal(r.body.limitPerDay, 5);
  assert.equal(r.body.remaining, 5);
  assert.equal(r.body.tryonEnabled, true);
  assert.equal(r.body.retentionHours, 24);
  const pid = r.headers['set-cookie'].find((c) => c.startsWith('pid='));
  assert.match(pid, /HttpOnly/i);
});

test('prova sem aceite do termo: 400', async () => {
  const { app } = setup();
  const agent = await adminAgent(app);
  const p = await productWithPhoto(agent);
  const r = await request(app).post('/api/tryon').field('productId', p.id).field('color', 'Verde').attach('photo', JPEG(1), 'eu.jpg').expect(400);
  assert.equal(r.body.error, 'É preciso aceitar o termo de uso da foto');
});

test('prova completa no modo demo, e outro cliente não vê o resultado', async () => {
  const { app, service } = setup();
  const admin = await adminAgent(app);
  const p = await productWithPhoto(admin);
  const client = request.agent(app);
  const r = await client
    .post('/api/tryon')
    .field('productId', p.id)
    .field('color', 'Verde')
    .field('size', 'M')
    .field('width', '960')
    .field('height', '1280')
    .field('consent', 'true')
    .attach('photo', JPEG(1), 'eu.jpg')
    .expect(202);
  assert.ok(r.body.id);
  assert.equal(r.body.remaining, 4);
  await service.idle();
  const v = (await client.get(`/api/tryon/${r.body.id}`).expect(200)).body;
  assert.equal(v.status, 'done');
  assert.equal(v.errorDetail, undefined);
  assert.equal(v.clientId, undefined);
  const img = await client.get(v.resultUrl).expect(200);
  assert.match(img.headers['content-type'], /svg/);
  assert.match(img.headers['content-security-policy'], /default-src 'none'/);
  await request(app).get(`/api/tryon/${r.body.id}`).expect(404);
});

test('prova: arquivo grande demais vira 400 amigável', async () => {
  const { app } = setup();
  const agent = await adminAgent(app);
  const p = await productWithPhoto(agent);
  const big = Buffer.concat([JPEG(1), Buffer.alloc(10 * 1024 * 1024 + 1)]);
  const r = await request(app).post('/api/tryon').field('productId', p.id).field('consent', 'true').attach('photo', big, 'grande.jpg');
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Envie uma foto JPG/PNG de até 10 MB');
});

test('fotos de clientes não são servidas', async () => {
  const { app, dirs } = setup();
  fs.writeFileSync(path.join(dirs.people, 'abc.jpg'), JPEG(1));
  const r = await request(app).get('/media/people/abc.jpg');
  assert.notEqual(r.status, 200);
});

test('comparar IAs pelo painel', async () => {
  const { app, service } = setup();
  const agent = await adminAgent(app);
  const p = await productWithPhoto(agent);
  const r = (await agent.post('/api/admin/compare').field('productId', p.id).field('color', 'Verde').field('providers', 'demo,gemini').attach('photo', JPEG(3), 'eu.jpg').expect(200)).body;
  assert.equal(r.jobs.length, 2);
  const demoJob = r.jobs.find((j) => j.provider === 'demo');
  const geminiJob = r.jobs.find((j) => j.provider === 'gemini');
  assert.ok(demoJob.id);
  assert.match(geminiJob.error, /sem chave/);
  await service.idle();
  const v = (await agent.get(`/api/admin/tryon/${demoJob.id}`).expect(200)).body;
  assert.equal(v.status, 'done');
  assert.equal(v.kind, 'admin_test');
});

// ---------- eventos ----------

test('eventos de clique', async () => {
  const { app, db } = setup();
  await request(app).post('/api/events').send({ type: 'whatsapp', productId: 1 }).expect(204);
  await request(app).post('/api/events').send({ type: 'hack', productId: 1 }).expect(400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n, 1);
});

test('painel: estatísticas e últimas provas', async () => {
  const { app, service } = setup();
  const agent = await adminAgent(app);
  const p = await productWithPhoto(agent);
  await request(app).post('/api/tryon').field('productId', p.id).field('color', 'Verde').field('consent', 'true').attach('photo', JPEG(4), 'eu.jpg').expect(202);
  await service.idle();
  const s = (await agent.get('/api/admin/stats?period=today').expect(200)).body;
  assert.equal(s.totals.tryons, 1);
  assert.equal(s.money.usdToBrl, 5.2);
  await agent.get('/api/admin/stats?period=ano').expect(400);
  const list = (await agent.get('/api/admin/tryons').expect(200)).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].productName, 'Camiseta Águia');
});
