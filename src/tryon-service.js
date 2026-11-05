// Serviço de prova: valida, aplica cache, limite por cliente/IP e teto diário,
// grava o pedido e roda a geração numa fila dentro do processo.
import crypto from 'node:crypto';
import { getSettings } from './settings.js';
import { getProduct, pickGarmentImage } from './catalog.js';
import { MAX_UPLOAD_BYTES, detectImageType, saveImage, readImage, fileExists } from './images.js';
import { buildPrompt } from './prompts.js';
import { computeCost, estimateCost } from './pricing.js';
import { PROVIDERS, resolveProvider } from './providers/index.js';
import { ProviderError } from './providers/errors.js';
import { nowIso, startOfDayUtc } from './time.js';

export class TryonError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TryonError';
    this.status = status;
  }
}

export const FRIENDLY_ERRORS = Object.freeze({
  badImage: 'Envie uma foto JPG/PNG de até 10 MB',
  noGarmentPhoto: 'Esta peça ainda não tem foto para prova',
  notFound: 'Peça não encontrada',
  budget: 'Provador indisponível hoje',
  unavailable: 'Provador indisponível no momento',
  refused: 'Não conseguimos gerar. Use uma foto de frente, com boa luz e só você.',
  ipLimit: 'Muitas provas feitas nesta rede hoje. Tente amanhã ou use outra conexão.',
  technical: 'Provador com instabilidade, tente de novo',
});

export const limitMessage = (n) => `Você já usou as ${n} provas de hoje. Volte amanhã!`;

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

export function createTryonService({
  db,
  config,
  dirs,
  fetch = globalThis.fetch,
  providers = PROVIDERS,
  now = () => new Date(),
  concurrency = 3,
  timeoutMs = 120000,
  pollMs,
}) {
  const keys = config.keys ?? {};
  const timeZone = config.timeZone ?? 'America/Sao_Paulo';
  const hashIp = (ip) => (ip ? sha(`${ip}|${config.sessionSecret ?? ''}`).slice(0, 32) : null);

  const queue = [];
  let running = 0;
  let idleWaiters = [];

  const stmt = {
    get: db.prepare('SELECT * FROM tryons WHERE id = ?'),
    cache: db.prepare(
      "SELECT * FROM tryons WHERE cache_key = ? AND status = 'done' AND result_file IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    ),
    countClient: db.prepare(
      "SELECT COUNT(*) AS n FROM tryons WHERE kind = 'customer' AND client_id = ? AND created_at >= ? AND cache_hit = 0 AND status IN ('pending','done')",
    ),
    countIp: db.prepare(
      "SELECT COUNT(*) AS n FROM tryons WHERE kind = 'customer' AND ip_hash = ? AND created_at >= ? AND cache_hit = 0 AND status IN ('pending','done')",
    ),
    spent: db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM tryons WHERE created_at >= ?'),
    pendingByProvider: db.prepare("SELECT provider, COUNT(*) AS n FROM tryons WHERE status = 'pending' AND created_at >= ? GROUP BY provider"),
    insert: db.prepare(
      `INSERT INTO tryons (id, kind, product_id, image_id, color, size, provider, model, status, client_id, ip_hash, cache_key, cache_hit, person_file, result_file, usage, cost_usd, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    done: db.prepare(
      "UPDATE tryons SET status = 'done', model = ?, result_file = ?, usage = ?, cost_usd = ?, latency_ms = ?, finished_at = ? WHERE id = ?",
    ),
    failed: db.prepare("UPDATE tryons SET status = 'failed', error = ?, usage = ?, cost_usd = ?, latency_ms = ?, finished_at = ? WHERE id = ?"),
    orphans: db.prepare("UPDATE tryons SET status = 'failed', error = ?, finished_at = ? WHERE status = 'pending'"),
    event: db.prepare('INSERT INTO events (type, product_id, created_at) VALUES (?, ?, ?)'),
  };

  // Guardamos a proporção da foto em memória até o worker rodar (não precisa ir para o banco).
  const aspects = new Map();

  function usedToday(clientId, ipHash) {
    const since = startOfDayUtc(now(), timeZone);
    return {
      client: clientId ? stmt.countClient.get(clientId, since).n : 0,
      ip: ipHash ? stmt.countIp.get(ipHash, since).n : 0,
    };
  }

  function remaining(clientId, ip) {
    const { limits } = getSettings(db);
    const used = usedToday(clientId, hashIp(ip));
    return Math.max(0, Math.min(limits.perClientPerDay - used.client, limits.perIpPerDay - used.ip));
  }

  function overBudget(settings, providerId) {
    const since = startOfDayUtc(now(), timeZone);
    const spent = stmt.spent.get(since).s;
    const pending = stmt.pendingByProvider
      .all(since)
      .reduce((sum, r) => sum + r.n * estimateCost(r.provider, settings.providers[r.provider] ?? {}), 0);
    const next = estimateCost(providerId, settings.providers[providerId] ?? {});
    return spent + pending + next > settings.limits.dailyBudgetUsd + 1e-9;
  }

  // Síncrono do começo ao INSERT: duas chamadas seguidas nunca furam o limite.
  function submit(params) {
    const { kind = 'customer', productId, color = null, size = null, personBuffer, aspect, clientId = null, ip = null } = params;
    const isCustomer = kind === 'customer';
    const settings = getSettings(db);

    const product = getProduct(db, productId);
    if (!product || (isCustomer && !product.active)) throw new TryonError(404, FRIENDLY_ERRORS.notFound);

    const mime = Buffer.isBuffer(personBuffer) ? detectImageType(personBuffer) : null;
    if (!mime || personBuffer.length > MAX_UPLOAD_BYTES) throw new TryonError(400, FRIENDLY_ERRORS.badImage);

    const garment = pickGarmentImage(product, color);
    if (!garment) throw new TryonError(400, FRIENDLY_ERRORS.noGarmentPhoto);

    // Cliente barrado (limite, teto, IA indisponível) fica registrado para o dono ver no painel.
    const block = (type, status, message) => {
      if (isCustomer) stmt.event.run(type, product.id, nowIso(now()));
      return new TryonError(status, message);
    };

    let providerId;
    try {
      providerId = resolveProvider(params.providerId ?? settings.activeProvider, keys, product.tryonType, providers);
    } catch (err) {
      if (err instanceof ProviderError) throw block('blocked_unavailable', 503, isCustomer ? FRIENDLY_ERRORS.unavailable : err.message);
      throw err;
    }
    const { prices: _prices, ...providerParams } = settings.providers[providerId] ?? {};
    const model = providerParams.model ?? providerId;
    const ipHash = hashIp(ip);
    // Tudo o que muda a imagem gerada entra na chave: foto, foto da peça, prompt (peça, cor, detalhes) e parâmetros da IA.
    const prompt = buildPrompt({ product, color, tryonType: product.tryonType });
    const cacheKey = sha(
      [sha(personBuffer), garment.id, garment.filename, providerId, JSON.stringify(providerParams), sha(prompt)].join('|'),
    );
    const id = crypto.randomUUID();
    const createdAt = nowIso(now());

    const cached = stmt.cache.get(cacheKey);
    if (cached && fileExists(dirs.results, cached.result_file)) {
      stmt.insert.run(id, kind, product.id, garment.id, color, size, providerId, cached.model, 'done', clientId, ipHash, cacheKey, 1, null, cached.result_file, null, 0, createdAt, createdAt);
      return { id, status: 'done', cacheHit: true };
    }

    if (isCustomer) {
      const used = usedToday(clientId, ipHash);
      if (used.client >= settings.limits.perClientPerDay) throw block('blocked_limit', 429, limitMessage(settings.limits.perClientPerDay));
      if (used.ip >= settings.limits.perIpPerDay) throw block('blocked_limit', 429, FRIENDLY_ERRORS.ipLimit);
      if (overBudget(settings, providerId)) throw block('blocked_budget', 503, FRIENDLY_ERRORS.budget);
    }

    const personFile = saveImage(dirs.people, personBuffer, mime);
    stmt.insert.run(id, kind, product.id, garment.id, color, size, providerId, model, 'pending', clientId, ipHash, cacheKey, 0, personFile, null, null, 0, createdAt, null);
    aspects.set(id, aspect && aspect.width > 0 && aspect.height > 0 ? { width: Number(aspect.width), height: Number(aspect.height) } : null);
    queue.push(id);
    pump();
    return { id, status: 'pending', cacheHit: false };
  }

  function pump() {
    while (running < concurrency && queue.length) {
      const id = queue.shift();
      running++;
      run(id)
        .catch(() => {})
        .finally(() => {
          running--;
          pump();
          if (running === 0 && queue.length === 0) {
            const waiters = idleWaiters;
            idleWaiters = [];
            waiters.forEach((w) => w());
          }
        });
    }
  }

  function withTimeout(promise, ms, controller) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ProviderError('timeout', `Tempo esgotado (${Math.round(ms / 1000)} s)`));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function run(id) {
    const started = Date.now();
    const row = stmt.get.get(id);
    const aspect = aspects.get(id);
    aspects.delete(id);
    const settings = getSettings(db);
    const providerSettings = settings.providers[row.provider] ?? {};
    try {
      const product = getProduct(db, row.product_id);
      const garmentImg = product?.images.find((i) => i.id === row.image_id);
      if (!product || !garmentImg) throw new ProviderError('config', 'A peça ou a foto da peça foi removida antes da geração');
      const provider = providers[row.provider];
      const controller = new AbortController();
      const result = await withTimeout(
        provider.tryOn(
          {
            person: readImage(dirs.people, row.person_file),
            garment: readImage(dirs.products, garmentImg.filename),
            product,
            color: row.color,
            tryonType: product.tryonType,
            aspect: aspect ?? { width: 0, height: 0 },
            prompt: buildPrompt({ product, color: row.color, tryonType: product.tryonType }),
          },
          { apiKey: keys[row.provider], config: providerSettings, fetch, signal: controller.signal, pollMs },
        ),
        timeoutMs,
        controller,
      );
      // Só o modo demo devolve SVG (montado por nós). Das IAs, aceitamos apenas bitmap conferido pelos bytes.
      const resultMime = row.provider === 'demo' ? result.image.mime : detectImageType(result.image.buffer);
      if (!resultMime) throw new ProviderError('upstream', 'A IA devolveu um arquivo que não é imagem JPG/PNG/WEBP');
      const resultFile = saveImage(dirs.results, result.image.buffer, resultMime);
      const cost = computeCost(row.provider, result.usage, providerSettings.prices);
      stmt.done.run(result.model ?? row.model, resultFile, JSON.stringify(result.usage ?? {}), cost, Date.now() - started, nowIso(now()), id);
    } catch (err) {
      const kind = err instanceof ProviderError ? err.kind : 'upstream';
      const usage = err instanceof ProviderError && err.usage ? err.usage : null;
      const cost = usage ? computeCost(row.provider, usage, providerSettings.prices) : 0;
      stmt.failed.run(`${kind}: ${err?.message ?? err}`, usage ? JSON.stringify(usage) : null, cost, Date.now() - started, nowIso(now()), id);
    }
  }

  function get(id) {
    const row = stmt.get.get(String(id));
    if (!row) return null;
    let error = null;
    if (row.status === 'failed') error = row.error?.startsWith('refused:') ? FRIENDLY_ERRORS.refused : FRIENDLY_ERRORS.technical;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      resultUrl: row.status === 'done' && row.result_file ? `/media/results/${row.result_file}` : null,
      error,
      errorDetail: row.error,
      productId: row.product_id,
      color: row.color,
      size: row.size,
      provider: row.provider,
      model: row.model,
      costUsd: row.cost_usd,
      cacheHit: Boolean(row.cache_hit),
      latencyMs: row.latency_ms,
      clientId: row.client_id,
      createdAt: row.created_at,
    };
  }

  function recoverOrphans() {
    return Number(stmt.orphans.run('upstream: servidor reiniciado durante a geração', nowIso(now())).changes);
  }

  function idle() {
    if (running === 0 && queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  return { submit, get, remaining, recoverOrphans, idle };
}
