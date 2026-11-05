import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCost, estimateCost } from '../src/pricing.js';
import { simulateMonthly } from '../public/js/simulate.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

const P = DEFAULT_SETTINGS.providers;

test('Gemini: entrada + tokens de imagem de saída', () => {
  const usage = { promptTokenCount: 2600, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] };
  assert.equal(computeCost('gemini', usage, P.gemini.prices), 0.0685);
});

test('Gemini: tokens de raciocínio cobram como texto de saída', () => {
  const usage = {
    promptTokenCount: 2600,
    candidatesTokenCount: 1120,
    thoughtsTokenCount: 200,
    candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }],
  };
  assert.equal(computeCost('gemini', usage, P.gemini.prices), 0.0691);
});

test('Gemini: texto junto com a imagem cobra como texto', () => {
  const usage = {
    promptTokenCount: 2600,
    candidatesTokenCount: 1220,
    candidatesTokensDetails: [
      { modality: 'IMAGE', tokenCount: 1120 },
      { modality: 'TEXT', tokenCount: 100 },
    ],
  };
  assert.equal(computeCost('gemini', usage, P.gemini.prices), 0.0688);
});

test('Gemini: sem detalhes, toda a saída conta como imagem', () => {
  assert.equal(computeCost('gemini', { promptTokenCount: 2600, candidatesTokenCount: 1120 }, P.gemini.prices), 0.0685);
});

test('OpenAI: texto, imagem de entrada e saída', () => {
  const usage = { input_tokens: 2300, output_tokens: 1584, input_tokens_details: { text_tokens: 300, image_tokens: 2000 } };
  assert.equal(computeCost('openai', usage, P.openai.prices), 0.06502);
});

test('OpenAI: sem detalhes, entrada conta como imagem', () => {
  assert.equal(computeCost('openai', { input_tokens: 2000, output_tokens: 1584 }, P.openai.prices), 0.06352);
});

test('FASHN: créditos × preço do crédito', () => {
  assert.equal(computeCost('fashn', { credits: 1 }, P.fashn.prices), 0.075);
  assert.equal(computeCost('fashn', { credits: 2 }, P.fashn.prices), 0.15);
});

test('Demo é grátis', () => {
  assert.equal(computeCost('demo', { anything: 1 }, {}), 0);
});

test('uso vazio não quebra', () => {
  assert.equal(computeCost('gemini', undefined, P.gemini.prices), 0);
  assert.equal(computeCost('openai', null, P.openai.prices), 0);
});

test('estimativas por prova', () => {
  assert.equal(estimateCost('gemini', P.gemini), 0.0685);
  assert.equal(estimateCost('openai', P.openai), 0.06502);
  assert.equal(estimateCost('openai', { ...P.openai, quality: 'low' }), 0.0295);
  assert.equal(estimateCost('openai', { ...P.openai, quality: 'high' }), 0.2047);
  assert.equal(estimateCost('fashn', P.fashn), 0.075);
  assert.equal(estimateCost('demo', P.demo), 0);
});

test('estimativa Gemini acompanha o tamanho da imagem', () => {
  assert.equal(estimateCost('gemini', { ...P.gemini, imageSize: '2K' }), 0.1021);
});

test('simulador mensal', () => {
  assert.deepEqual(
    simulateMonthly({ clientsPerDay: 20, triesPerClient: 3, cacheRate: 0.1, costPerTryUsd: 0.0685, usdToBrl: 5.2, fixedMonthlyBrl: 40 }),
    { tryonsPerMonth: 1800, paidTryons: 1620, aiUsd: 110.97, aiBrl: 577.04, totalBrl: 617.04 },
  );
});

test('simulador com zero clientes devolve só o fixo', () => {
  const r = simulateMonthly({ clientsPerDay: 0, triesPerClient: 3, cacheRate: 0, costPerTryUsd: 0.07, usdToBrl: 5.2, fixedMonthlyBrl: 40 });
  assert.equal(r.totalBrl, 40);
  assert.equal(r.aiUsd, 0);
});
