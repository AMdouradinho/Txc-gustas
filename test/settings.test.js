import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { DEFAULT_SETTINGS, getSettings, updateSettings, ValidationError } from '../src/settings.js';
import { loadConfig } from '../src/config.js';

const fresh = () => openDb(':memory:');

test('openDb cria as tabelas do spec', () => {
  const db = fresh();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const t of ['events', 'product_images', 'products', 'settings', 'tryons']) assert.ok(names.includes(t), t);
});

test('openDb é idempotente', () => {
  const db = fresh();
  assert.doesNotThrow(() => openDb.applySchema(db));
});

test('getSettings sem nada salvo devolve os padrões', () => {
  assert.deepEqual(getSettings(fresh()), DEFAULT_SETTINGS);
});

test('padrões do spec', () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(s.activeProvider, 'demo');
  assert.equal(s.providers.gemini.model, 'gemini-3.1-flash-image-preview');
  assert.equal(s.providers.gemini.imageSize, '1K');
  assert.deepEqual(s.providers.gemini.prices, { inputPerM: 0.5, outputImagePerM: 60, outputTextPerM: 3 });
  assert.equal(s.providers.openai.model, 'gpt-image-2');
  assert.equal(s.providers.openai.quality, 'medium');
  assert.deepEqual(s.providers.openai.prices, { textInputPerM: 5, imageInputPerM: 8, outputPerM: 30 });
  assert.equal(s.providers.fashn.model, 'tryon-v1.6');
  assert.equal(s.providers.fashn.mode, 'balanced');
  assert.deepEqual(s.providers.fashn.prices, { perCredit: 0.075, creditsPerRun: 1 });
  assert.deepEqual(s.limits, { perClientPerDay: 5, perIpPerDay: 15, dailyBudgetUsd: 5, retentionHours: 24 });
  assert.deepEqual(s.money, { usdToBrl: 5.2, fixedMonthlyBrl: 40 });
});

test('updateSettings persiste e mescla', () => {
  const db = fresh();
  updateSettings(db, { store: { name: 'Gustas' } });
  const s = getSettings(db);
  assert.equal(s.store.name, 'Gustas');
  assert.equal(s.limits.perClientPerDay, 5);
});

test('WhatsApp com máscara vira só dígitos com DDI 55', () => {
  const db = fresh();
  assert.equal(updateSettings(db, { store: { whatsapp: '(11) 99999-9999' } }).store.whatsapp, '5511999999999');
  assert.equal(updateSettings(db, { store: { whatsapp: '+55 11 99999-9999' } }).store.whatsapp, '5511999999999');
  assert.equal(updateSettings(db, { store: { whatsapp: '(11) 3333-4444' } }).store.whatsapp, '551133334444');
  assert.equal(updateSettings(db, { store: { whatsapp: '' } }).store.whatsapp, '');
});

test('WhatsApp inválido é rejeitado', () => {
  assert.throws(() => updateSettings(fresh(), { store: { whatsapp: '123' } }), ValidationError);
});

test('preço com vírgula decimal é aceito', () => {
  const s = updateSettings(fresh(), { providers: { fashn: { prices: { perCredit: '0,075' } } } });
  assert.equal(s.providers.fashn.prices.perCredit, 0.075);
});

test('preço negativo é rejeitado citando o campo', () => {
  assert.throws(
    () => updateSettings(fresh(), { providers: { fashn: { prices: { perCredit: -1 } } } }),
    (e) => e instanceof ValidationError && e.status === 400 && /perCredit/.test(e.message),
  );
});

test('cotação não numérica é rejeitada citando o campo', () => {
  assert.throws(
    () => updateSettings(fresh(), { money: { usdToBrl: 'abc' } }),
    (e) => e instanceof ValidationError && /usdToBrl/.test(e.message),
  );
});

test('provedor sem chave não pode ser ativado', () => {
  assert.throws(
    () => updateSettings(fresh(), { activeProvider: 'gemini' }, { keys: { gemini: '' } }),
    (e) => e instanceof ValidationError && e.message === 'Provedor gemini sem chave de API configurada',
  );
});

test('provedor com chave pode ser ativado; demo sempre', () => {
  assert.equal(updateSettings(fresh(), { activeProvider: 'gemini' }, { keys: { gemini: 'k' } }).activeProvider, 'gemini');
  assert.equal(updateSettings(fresh(), { activeProvider: 'demo' }, { keys: {} }).activeProvider, 'demo');
});

test('provedor desconhecido é rejeitado', () => {
  assert.throws(() => updateSettings(fresh(), { activeProvider: 'xyz' }, { keys: {} }), ValidationError);
});

test('limite por cliente precisa ser inteiro >= 1', () => {
  assert.throws(() => updateSettings(fresh(), { limits: { perClientPerDay: 0 } }), ValidationError);
  assert.throws(() => updateSettings(fresh(), { limits: { perClientPerDay: 2.5 } }), ValidationError);
  assert.equal(updateSettings(fresh(), { limits: { perClientPerDay: '7' } }).limits.perClientPerDay, 7);
});

test('qualidade OpenAI só aceita low/medium/high', () => {
  assert.throws(() => updateSettings(fresh(), { providers: { openai: { quality: 'ultra' } } }), ValidationError);
});

test('chaves desconhecidas são ignoradas', () => {
  const s = updateSettings(fresh(), { hacker: 1, store: { foo: 'x' } });
  assert.equal(s.hacker, undefined);
  assert.equal(s.store.foo, undefined);
});

test('loadConfig lê variáveis e aplica padrões', () => {
  const c = loadConfig({ PORT: '8080', ADMIN_PASSWORD: 'x', SESSION_SECRET: 's', GEMINI_API_KEY: 'g' });
  assert.equal(c.port, 8080);
  assert.equal(c.adminPassword, 'x');
  assert.equal(c.sessionSecret, 's');
  assert.deepEqual(c.keys, { gemini: 'g', openai: '', fashn: '' });
  assert.equal(c.timeZone, 'America/Sao_Paulo');
  const d = loadConfig({});
  assert.equal(d.port, 3000);
  assert.equal(d.adminPassword, 'admin');
  assert.ok(d.sessionSecret.length >= 32);
  assert.match(d.dataDir, /data$/);
});

test('loadConfig: trustProxy padrão 1 em produção, desligado em dev, configurável', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production', ADMIN_PASSWORD: 'x', SESSION_SECRET: 's' }).trustProxy, 1);
  assert.equal(loadConfig({}).trustProxy, false);
  assert.equal(loadConfig({ TRUST_PROXY: '2' }).trustProxy, 2);
  assert.equal(loadConfig({ NODE_ENV: 'production', TRUST_PROXY: 'false' }).trustProxy, false);
});

test('loadConfig avisa sobre senha/segredo ausentes', () => {
  assert.equal(loadConfig({}).warnings.length, 2);
  assert.equal(loadConfig({ ADMIN_PASSWORD: 'x', SESSION_SECRET: 's' }).warnings.length, 0);
});
