import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/prompts.js';
import { ProviderError } from '../src/providers/errors.js';
import { PROVIDERS, providerStatus, resolveProvider } from '../src/providers/index.js';
import gemini from '../src/providers/gemini.js';
import openai from '../src/providers/openai.js';
import fashn from '../src/providers/fashn.js';
import demo from '../src/providers/demo.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

const PERSON = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GARMENT = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
const OUT_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);
const product = { name: 'Camiseta Águia Cowboy', aiNotes: 'estampa de águia cowboy no centro do peito' };

const input = (over = {}) => ({
  person: { buffer: PERSON, mime: 'image/jpeg' },
  garment: { buffer: GARMENT, mime: 'image/jpeg' },
  product,
  color: 'Verde Militar',
  tryonType: 'top',
  aspect: { width: 960, height: 1280 },
  prompt: 'PROMPT',
  ...over,
});

// fetch falso: cada chamada consome a próxima resposta da fila e fica registrada.
function stubFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error('stubFetch: nenhuma resposta restante');
    if (next instanceof Error) throw next;
    const { status = 200, json, body, headers = { 'content-type': 'application/json' } } = next;
    return new Response(json !== undefined ? JSON.stringify(json) : body, { status, headers });
  };
  fn.calls = calls;
  return fn;
}

const ctx = (id, fetch, over = {}) => ({ apiKey: 'KEY', config: DEFAULT_SETTINGS.providers[id], fetch, pollMs: 0, ...over });

// ---------- prompt ----------

test('prompt cita imagens, peça, cor, detalhes e manda ignorar o modelo da foto', () => {
  const p = buildPrompt({ product, color: 'Verde Militar', tryonType: 'top' });
  for (const s of ['IMAGE 1', 'IMAGE 2', 'Camiseta Águia Cowboy', 'Verde Militar', 'estampa de águia cowboy', 'ignore']) {
    assert.ok(p.includes(s), s);
  }
});

test('prompt varia por tipo de prova', () => {
  const by = (t) => buildPrompt({ product, color: '', tryonType: t });
  assert.match(by('top'), /upper-body/);
  assert.match(by('bottom'), /lower-body/);
  assert.match(by('full'), /entire outfit/);
  assert.match(by('headwear'), /on the customer's head/);
  for (const t of ['top', 'bottom', 'full', 'headwear']) assert.match(by(t), /ignore/i);
});

test('prompt sem cor e sem detalhes não deixa lacunas', () => {
  const p = buildPrompt({ product: { name: 'Boné' }, color: null, tryonType: 'headwear' });
  assert.doesNotMatch(p, /undefined|null/);
});

// ---------- Gemini ----------

const geminiOk = {
  json: {
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: OUT_PNG.toString('base64') } }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 2600, candidatesTokenCount: 1120, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] },
  },
};

test('Gemini monta a requisição do jeito da API', async () => {
  const f = stubFetch([geminiOk]);
  const r = await gemini.tryOn(input(), ctx('gemini', f));
  const call = f.calls[0];
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['x-goog-api-key'], 'KEY');
  const body = JSON.parse(call.init.body);
  const parts = body.contents[0].parts;
  assert.equal(parts[0].text, 'PROMPT');
  assert.deepEqual(parts[1].inline_data, { mime_type: 'image/jpeg', data: PERSON.toString('base64') });
  assert.deepEqual(parts[2].inline_data, { mime_type: 'image/jpeg', data: GARMENT.toString('base64') });
  assert.deepEqual(body.generationConfig.responseModalities, ['IMAGE']);
  assert.deepEqual(body.generationConfig.imageConfig, { aspectRatio: '3:4', imageSize: '1K' });
  assert.deepEqual(r.image, { buffer: OUT_PNG, mime: 'image/png' });
  assert.deepEqual(r.usage, geminiOk.json.usageMetadata);
  assert.equal(r.model, 'gemini-3.1-flash-image-preview');
});

test('Gemini escolhe a proporção mais próxima', async () => {
  for (const [w, h, expected] of [
    [1000, 1000, '1:1'],
    [720, 1280, '9:16'],
    [1280, 960, '4:3'],
    [800, 1000, '4:5'],
  ]) {
    const f = stubFetch([geminiOk]);
    await gemini.tryOn(input({ aspect: { width: w, height: h } }), ctx('gemini', f));
    assert.equal(JSON.parse(f.calls[0].init.body).generationConfig.imageConfig.aspectRatio, expected, `${w}x${h}`);
  }
});

test('Gemini: resposta só com texto = recusa', async () => {
  const f = stubFetch([{ json: { candidates: [{ content: { parts: [{ text: 'I cannot do that' }] }, finishReason: 'STOP' }] } }]);
  await assert.rejects(gemini.tryOn(input(), ctx('gemini', f)), (e) => e instanceof ProviderError && e.kind === 'refused');
});

test('Gemini: recusa carrega o uso cobrado', async () => {
  const usage = { promptTokenCount: 2600, candidatesTokenCount: 0 };
  const f = stubFetch([{ json: { candidates: [{ content: { parts: [{ text: 'no' }] } }], usageMetadata: usage } }]);
  await assert.rejects(gemini.tryOn(input(), ctx('gemini', f)), (e) => e.kind === 'refused' && e.usage?.promptTokenCount === 2600);
});

test('Gemini: bloqueio de segurança sem candidatos = recusa', async () => {
  const f = stubFetch([{ json: { promptFeedback: { blockReason: 'SAFETY' } } }]);
  await assert.rejects(gemini.tryOn(input(), ctx('gemini', f)), (e) => e.kind === 'refused');
});

test('Gemini: erros HTTP viram tipos de erro', async () => {
  const cases = [
    [401, 'auth'],
    [403, 'auth'],
    [404, 'config'],
    [429, 'upstream'],
    [500, 'upstream'],
    [503, 'upstream'],
  ];
  for (const [status, kind] of cases) {
    const f = stubFetch([{ status, json: { error: { message: 'boom' } } }]);
    await assert.rejects(gemini.tryOn(input(), ctx('gemini', f)), (e) => e.kind === kind, String(status));
  }
});

test('Gemini: 404 sugere conferir o ID do modelo', async () => {
  const f = stubFetch([{ status: 404, json: { error: { message: 'models/x is not found' } } }]);
  await assert.rejects(gemini.tryOn(input(), ctx('gemini', f)), (e) => /ID do modelo/.test(e.message));
});

test('Gemini: chave inválida (400 API_KEY_INVALID) = auth', async () => {
  const f = stubFetch([{ status: 400, json: { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } } }]);
  await assert.rejects(gemini.tryOn(input(), ctx('gemini', f)), (e) => e.kind === 'auth');
});

test('Gemini: abort vira timeout', async () => {
  const ac = new AbortController();
  ac.abort();
  const f = async () => {
    throw new DOMException('aborted', 'AbortError');
  };
  await assert.rejects(gemini.tryOn(input(), ctx('gemini', f, { signal: ac.signal })), (e) => e.kind === 'timeout');
});

test('Gemini: falha de rede = upstream', async () => {
  const f = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(gemini.tryOn(input(), ctx('gemini', f)), (e) => e.kind === 'upstream');
});

// ---------- OpenAI ----------

const openaiOk = {
  json: {
    data: [{ b64_json: OUT_PNG.toString('base64') }],
    usage: { input_tokens: 2300, output_tokens: 1584, input_tokens_details: { text_tokens: 300, image_tokens: 2000 } },
  },
};

test('OpenAI monta multipart com as duas imagens', async () => {
  const f = stubFetch([openaiOk]);
  const r = await openai.tryOn(input(), ctx('openai', f));
  const call = f.calls[0];
  assert.equal(call.url, 'https://api.openai.com/v1/images/edits');
  assert.equal(call.init.headers.Authorization, 'Bearer KEY');
  const form = call.init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.getAll('image[]').length, 2);
  assert.equal(form.get('model'), 'gpt-image-2');
  assert.equal(form.get('quality'), 'medium');
  assert.equal(form.get('size'), '1024x1536');
  assert.equal(form.get('prompt'), 'PROMPT');
  assert.equal(form.get('n'), '1');
  assert.equal(form.get('input_fidelity'), null);
  assert.equal(r.image.mime, 'image/png');
  assert.deepEqual(r.image.buffer, OUT_PNG);
  assert.deepEqual(r.usage, openaiOk.json.usage);
});

test('OpenAI: input_fidelity=high só em gpt-image-1*', async () => {
  const f = stubFetch([openaiOk]);
  await openai.tryOn(input(), ctx('openai', f, { config: { ...DEFAULT_SETTINGS.providers.openai, model: 'gpt-image-1.5' } }));
  assert.equal(f.calls[0].init.body.get('input_fidelity'), 'high');
});

test('OpenAI: tamanho segue a orientação da foto', async () => {
  for (const [w, h, size] of [
    [1280, 960, '1536x1024'],
    [1000, 1050, '1024x1024'],
  ]) {
    const f = stubFetch([openaiOk]);
    await openai.tryOn(input({ aspect: { width: w, height: h } }), ctx('openai', f));
    assert.equal(f.calls[0].init.body.get('size'), size);
  }
});

test('OpenAI: moderação = recusa; 401 = auth; 404 = config', async () => {
  let f = stubFetch([{ status: 400, json: { error: { code: 'moderation_blocked', message: 'blocked' } } }]);
  await assert.rejects(openai.tryOn(input(), ctx('openai', f)), (e) => e.kind === 'refused');
  f = stubFetch([{ status: 401, json: { error: { message: 'bad key' } } }]);
  await assert.rejects(openai.tryOn(input(), ctx('openai', f)), (e) => e.kind === 'auth');
  f = stubFetch([{ status: 404, json: { error: { message: 'model not found' } } }]);
  await assert.rejects(openai.tryOn(input(), ctx('openai', f)), (e) => e.kind === 'config');
});

// ---------- FASHN ----------

test('FASHN: envia, consulta até completar e decodifica base64', async () => {
  const f = stubFetch([
    { json: { id: 'abc', error: null } },
    { json: { id: 'abc', status: 'processing' } },
    { json: { id: 'abc', status: 'completed', output: [`data:image/jpeg;base64,${OUT_PNG.toString('base64')}`] } },
  ]);
  const r = await fashn.tryOn(input(), ctx('fashn', f));
  const run = f.calls[0];
  assert.equal(run.url, 'https://api.fashn.ai/v1/run');
  assert.equal(run.init.headers.Authorization, 'Bearer KEY');
  const body = JSON.parse(run.init.body);
  assert.deepEqual(body, {
    model_name: 'tryon-v1.6',
    inputs: {
      model_image: `data:image/jpeg;base64,${PERSON.toString('base64')}`,
      garment_image: `data:image/jpeg;base64,${GARMENT.toString('base64')}`,
      category: 'tops',
      garment_photo_type: 'auto',
      mode: 'balanced',
      output_format: 'jpeg',
      return_base64: true,
    },
  });
  assert.equal(f.calls[1].url, 'https://api.fashn.ai/v1/status/abc');
  assert.equal(f.calls.length, 3);
  assert.deepEqual(r.image, { buffer: OUT_PNG, mime: 'image/jpeg' });
  assert.deepEqual(r.usage, { credits: 1 });
});

test('FASHN: categorias bottom e full', async () => {
  for (const [t, cat] of [
    ['bottom', 'bottoms'],
    ['full', 'one-pieces'],
  ]) {
    const f = stubFetch([{ json: { id: 'x' } }, { json: { status: 'completed', output: [`data:image/jpeg;base64,AA==`] } }]);
    await fashn.tryOn(input({ tryonType: t }), ctx('fashn', f));
    assert.equal(JSON.parse(f.calls[0].init.body).inputs.category, cat);
  }
});

test('FASHN: saída em URL é baixada', async () => {
  const f = stubFetch([
    { json: { id: 'x' } },
    { json: { status: 'completed', output: ['https://cdn.fashn.ai/out.png'] } },
    { body: OUT_PNG, headers: { 'content-type': 'image/png' } },
  ]);
  const r = await fashn.tryOn(input(), ctx('fashn', f));
  assert.equal(f.calls[2].url, 'https://cdn.fashn.ai/out.png');
  assert.deepEqual(r.image, { buffer: OUT_PNG, mime: 'image/png' });
});

test('FASHN: status failed = upstream; erro de pose = recusa', async () => {
  let f = stubFetch([{ json: { id: 'x' } }, { json: { status: 'failed', error: { name: 'InternalError', message: 'x' } } }]);
  await assert.rejects(fashn.tryOn(input(), ctx('fashn', f)), (e) => e.kind === 'upstream');
  f = stubFetch([{ json: { id: 'x' } }, { json: { status: 'failed', error: { name: 'PoseError', message: 'no pose' } } }]);
  await assert.rejects(fashn.tryOn(input(), ctx('fashn', f)), (e) => e.kind === 'refused');
});

test('FASHN não aceita boné', () => {
  assert.equal(fashn.supports.includes('headwear'), false);
});

// ---------- Demo ----------

test('Demo devolve SVG com a marca DEMO e sem custo', async () => {
  const r = await demo.tryOn(input(), { fetch: () => assert.fail('demo não chama rede') });
  assert.equal(r.image.mime, 'image/svg+xml');
  const svg = r.image.buffer.toString('utf8');
  assert.match(svg, /DEMO/);
  assert.match(svg, /data:image\/jpeg;base64,/);
  assert.deepEqual(r.usage, {});
});

// ---------- roteamento ----------

test('providerStatus informa quem tem chave', () => {
  const s = providerStatus({ gemini: 'k', openai: '', fashn: '' });
  assert.equal(s.gemini.hasKey, true);
  assert.equal(s.openai.hasKey, false);
  assert.equal(s.demo.hasKey, true);
  assert.equal(typeof s.fashn.label, 'string');
  assert.deepEqual(Object.keys(PROVIDERS).sort(), ['demo', 'fashn', 'gemini', 'openai']);
});

test('resolveProvider: FASHN cai para Gemini/OpenAI em boné', () => {
  assert.equal(resolveProvider('fashn', { fashn: 'k', gemini: 'k' }, 'headwear'), 'gemini');
  assert.equal(resolveProvider('fashn', { fashn: 'k', openai: 'k' }, 'headwear'), 'openai');
  assert.equal(resolveProvider('fashn', { fashn: 'k' }, 'top'), 'fashn');
  assert.throws(() => resolveProvider('fashn', { fashn: 'k' }, 'headwear'), (e) => e.kind === 'config');
});

test('resolveProvider: provedor sem chave falha; demo sempre serve', () => {
  assert.throws(() => resolveProvider('gemini', {}, 'top'), (e) => e instanceof ProviderError && e.kind === 'config');
  assert.equal(resolveProvider('demo', {}, 'headwear'), 'demo');
  assert.throws(() => resolveProvider('nada', {}, 'top'), (e) => e.kind === 'config');
});

test('resolveProvider aceita mapa de provedores injetado', () => {
  const fake = { gemini: { id: 'gemini', supports: ['top'], requiresKey: false } };
  assert.equal(resolveProvider('gemini', {}, 'top', fake), 'gemini');
});
