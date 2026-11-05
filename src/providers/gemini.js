// Google Gemini (Nano Banana): edição de imagem via generateContent.
import { ProviderError, kindForStatus, send, readJson } from './errors.js';

const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'];

export function closestAspect(width, height) {
  if (!(width > 0 && height > 0)) return '3:4';
  const target = Math.log(width / height);
  let best = ASPECTS[0];
  let bestDiff = Infinity;
  for (const a of ASPECTS) {
    const [w, h] = a.split(':').map(Number);
    const diff = Math.abs(Math.log(w / h) - target);
    if (diff < bestDiff) {
      best = a;
      bestDiff = diff;
    }
  }
  return best;
}

const inline = ({ buffer, mime }) => ({ inline_data: { mime_type: mime, data: buffer.toString('base64') } });

async function tryOn(input, ctx) {
  const model = ctx.config.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: input.prompt }, inline(input.person), inline(input.garment)] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: closestAspect(input.aspect?.width, input.aspect?.height), imageSize: ctx.config.imageSize || '1K' },
    },
  };

  const res = await send(
    ctx,
    url,
    { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': ctx.apiKey }, body: JSON.stringify(body) },
    'Gemini',
  );
  const data = await readJson(res);

  if (!res.ok) {
    const msg = data?.error?.message ?? data?.raw ?? `HTTP ${res.status}`;
    let kind = kindForStatus(res.status);
    if (res.status === 400 && /api key/i.test(msg)) kind = 'auth';
    const hint = res.status === 404 ? ' (confira o ID do modelo nas Configurações)' : '';
    throw new ProviderError(kind, `Gemini ${res.status}: ${msg}${hint}`, data);
  }

  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!imagePart) {
    const reason =
      data.promptFeedback?.blockReason ||
      candidate?.finishReason ||
      parts
        .map((p) => p.text)
        .filter(Boolean)
        .join(' ')
        .slice(0, 300) ||
      'sem imagem na resposta';
    throw new ProviderError('refused', `Gemini não gerou imagem: ${reason}`, data, data.usageMetadata);
  }
  const d = imagePart.inlineData ?? imagePart.inline_data;
  return {
    image: { buffer: Buffer.from(d.data, 'base64'), mime: d.mimeType ?? d.mime_type ?? 'image/png' },
    usage: data.usageMetadata ?? {},
    model,
  };
}

export default { id: 'gemini', label: 'Google Gemini (Nano Banana)', supports: ['top', 'bottom', 'full', 'headwear'], requiresKey: true, tryOn };
