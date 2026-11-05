// OpenAI GPT Image: edição com várias imagens de referência (/v1/images/edits).
import { ProviderError, kindForStatus, send, readJson } from './errors.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function openaiSize(width, height) {
  if (!(width > 0 && height > 0)) return '1024x1536';
  if (height > width * 1.1) return '1024x1536';
  if (width > height * 1.1) return '1536x1024';
  return '1024x1024';
}

async function tryOn(input, ctx) {
  const { model, quality } = ctx.config;
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', input.prompt);
  form.append('image[]', new Blob([input.person.buffer], { type: input.person.mime }), `person.${EXT[input.person.mime] ?? 'jpg'}`);
  form.append('image[]', new Blob([input.garment.buffer], { type: input.garment.mime }), `garment.${EXT[input.garment.mime] ?? 'jpg'}`);
  form.append('size', openaiSize(input.aspect?.width, input.aspect?.height));
  form.append('quality', quality || 'medium');
  form.append('n', '1');
  if (/^gpt-image-1/.test(model)) form.append('input_fidelity', 'high');

  const res = await send(
    ctx,
    'https://api.openai.com/v1/images/edits',
    { method: 'POST', headers: { Authorization: `Bearer ${ctx.apiKey}` }, body: form },
    'OpenAI',
  );
  const data = await readJson(res);

  if (!res.ok) {
    const err = data?.error ?? {};
    const msg = err.message ?? data?.raw ?? `HTTP ${res.status}`;
    let kind = kindForStatus(res.status);
    if (err.code === 'moderation_blocked' || /safety|moderation/i.test(err.code ?? '')) kind = 'refused';
    const hint = res.status === 404 ? ' (confira o ID do modelo nas Configurações)' : '';
    throw new ProviderError(kind, `OpenAI ${res.status}: ${msg}${hint}`, data);
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new ProviderError('refused', 'OpenAI não devolveu imagem', data);
  const buffer = Buffer.from(b64, 'base64');
  const mime = buffer[0] === 0xff ? 'image/jpeg' : buffer.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : 'image/png';
  return { image: { buffer, mime }, usage: data.usage ?? {}, model };
}

export default { id: 'openai', label: 'OpenAI GPT Image', supports: ['top', 'bottom', 'full', 'headwear'], requiresKey: true, tryOn };
