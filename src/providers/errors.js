// Erro padronizado dos provedores e helper de chamada HTTP.

export class ProviderError extends Error {
  // kind: 'refused' | 'auth' | 'config' | 'timeout' | 'upstream'
  constructor(kind, message, raw) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.raw = raw;
  }
}

export function kindForStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404 || status === 400 || status === 422) return 'config';
  return 'upstream'; // 408, 429, 5xx e o resto
}

// fetch com tradução de falhas de rede / abort para ProviderError.
export async function send(ctx, url, init, label) {
  try {
    return await ctx.fetch(url, { ...init, signal: ctx.signal });
  } catch (err) {
    if (ctx.signal?.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new ProviderError('timeout', `${label}: tempo esgotado`, String(err));
    }
    throw new ProviderError('upstream', `${label}: falha de rede (${err?.message ?? err})`, String(err));
  }
}

export async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

export const toDataUrl = ({ buffer, mime }) => `data:${mime};base64,${buffer.toString('base64')}`;

export function fromDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}
