// FASHN: API especializada em provador virtual. Assíncrona: envia e consulta o status.
import { ProviderError, kindForStatus, send, readJson, toDataUrl, fromDataUrl } from './errors.js';

const BASE = 'https://api.fashn.ai/v1';
const CATEGORY = { top: 'tops', bottom: 'bottoms', full: 'one-pieces' };
// Erros de entrada (foto ruim) viram recusa para o cliente receber a dica de foto.
const INPUT_ERRORS = /Pose|ImageLoad|ContentModeration|InputValidation|Moderation/i;

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

async function call(ctx, url, init) {
  const res = await send(ctx, url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${ctx.apiKey}` } }, 'FASHN');
  const data = await readJson(res);
  if (!res.ok) {
    const msg = data?.message ?? data?.error?.message ?? (typeof data?.error === 'string' ? data.error : null) ?? `HTTP ${res.status}`;
    throw new ProviderError(kindForStatus(res.status), `FASHN ${res.status}: ${msg}`, data);
  }
  return data;
}

async function downloadOutput(ctx, out) {
  const fromData = fromDataUrl(out);
  if (fromData) return fromData;
  const res = await send(ctx, out, { method: 'GET' }, 'FASHN');
  if (!res.ok) throw new ProviderError('upstream', `FASHN: falha ao baixar o resultado (HTTP ${res.status})`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg' };
}

async function tryOn(input, ctx) {
  const { model, mode } = ctx.config;
  const category = CATEGORY[input.tryonType];
  if (!category) throw new ProviderError('config', `FASHN não suporta o tipo de peça "${input.tryonType}"`);

  const run = await call(ctx, `${BASE}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model_name: model,
      inputs: {
        model_image: toDataUrl(input.person),
        garment_image: toDataUrl(input.garment),
        category,
        garment_photo_type: 'auto',
        mode: mode || 'balanced',
        output_format: 'jpeg',
        return_base64: true,
      },
    }),
  });
  if (!run.id) throw new ProviderError('upstream', `FASHN não iniciou a prova: ${JSON.stringify(run.error ?? run).slice(0, 200)}`, run);

  const pollMs = ctx.pollMs ?? 1500;
  for (;;) {
    const st = await call(ctx, `${BASE}/status/${encodeURIComponent(run.id)}`, { method: 'GET', headers: {} });
    if (st.status === 'completed') {
      const out = st.output?.[0];
      if (!out) throw new ProviderError('refused', 'FASHN não devolveu imagem', st);
      const image = await downloadOutput(ctx, out);
      return { image, usage: { credits: ctx.config.prices?.creditsPerRun ?? 1 }, model };
    }
    if (st.status === 'failed' || st.status === 'canceled') {
      const name = st.error?.name ?? '';
      const kind = INPUT_ERRORS.test(name) ? 'refused' : 'upstream';
      throw new ProviderError(kind, `FASHN falhou: ${name} ${st.error?.message ?? ''}`.trim(), st);
    }
    try {
      await sleep(pollMs, ctx.signal);
    } catch {
      throw new ProviderError('timeout', 'FASHN: tempo esgotado');
    }
  }
}

export default { id: 'fashn', label: 'FASHN (especialista em provador)', supports: ['top', 'bottom', 'full'], requiresKey: true, tryOn };
