import gemini from './gemini.js';
import openai from './openai.js';
import fashn from './fashn.js';
import demo from './demo.js';
import { ProviderError } from './errors.js';

export const PROVIDERS = Object.freeze({ gemini, openai, fashn, demo });
const FALLBACK_ORDER = ['gemini', 'openai'];

export function providerStatus(keys = {}) {
  return Object.fromEntries(
    Object.values(PROVIDERS).map((p) => [p.id, { label: p.label, supports: p.supports, hasKey: !p.requiresKey || Boolean(keys[p.id]) }]),
  );
}

const usable = (p, keys) => p && (!p.requiresKey || Boolean(keys[p.id]));

// Decide qual provedor gera a prova. FASHN não faz boné: cai para Gemini, depois OpenAI.
export function resolveProvider(activeId, keys = {}, tryonType, providers = PROVIDERS) {
  const active = providers[activeId];
  if (!active) throw new ProviderError('config', `Provedor desconhecido: ${activeId}`);
  if (!usable(active, keys)) throw new ProviderError('config', `Provedor ${activeId} sem chave de API configurada`);
  if (active.supports.includes(tryonType)) return activeId;
  for (const id of FALLBACK_ORDER) {
    const p = providers[id];
    if (id !== activeId && usable(p, keys) && p.supports.includes(tryonType)) return id;
  }
  throw new ProviderError(
    'config',
    `${active.label ?? activeId} não faz provas do tipo "${tryonType}" e não há outro provedor com chave (Gemini ou OpenAI)`,
  );
}
