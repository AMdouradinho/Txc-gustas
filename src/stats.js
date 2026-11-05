// Números do painel de custos.
import { estimateCost } from './pricing.js';
import { startOfDayUtc, startOfMonthUtc } from './time.js';
import { ValidationError } from './settings.js';

const round2 = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const DAY_MS = 24 * 3600 * 1000;
const REMOVED = 'Peça removida';

export function periodStart(period, now, timeZone) {
  switch (period) {
    case 'today':
      return startOfDayUtc(now, timeZone);
    case '7d':
      return new Date(now.getTime() - 7 * DAY_MS).toISOString();
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS).toISOString();
    case 'month':
      return startOfMonthUtc(now, timeZone);
    default:
      throw new ValidationError(`Período inválido: ${period}`);
  }
}

function summary(db, since, usdToBrl) {
  const r = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost FROM tryons WHERE created_at >= ?').get(since);
  const costUsd = round6(r.cost);
  return { tryons: r.n, costUsd, costBrl: round2(costUsd * usdToBrl) };
}

export function getStats(db, settings, { period = 'today', now = new Date(), timeZone = 'America/Sao_Paulo' } = {}) {
  const since = periodStart(period, now, timeZone);
  const { usdToBrl, fixedMonthlyBrl } = settings.money;

  const t = db
    .prepare(
      `SELECT COUNT(*) AS tryons,
              SUM(status = 'done') AS done,
              SUM(status = 'failed') AS failed,
              SUM(cache_hit = 1) AS cacheHits,
              COALESCE(SUM(cost_usd), 0) AS cost,
              SUM(status = 'done' AND cache_hit = 0) AS paidDone,
              COALESCE(SUM(CASE WHEN status = 'done' AND cache_hit = 0 THEN cost_usd END), 0) AS paidCost,
              SUM(kind = 'admin_test') AS adminTests
       FROM tryons WHERE created_at >= ?`,
    )
    .get(since);
  const costUsd = round6(t.cost);
  const avgCostUsd = t.paidDone ? round6(t.paidCost / t.paidDone) : 0;
  const totals = {
    tryons: t.tryons,
    done: t.done ?? 0,
    failed: t.failed ?? 0,
    cacheHits: t.cacheHits ?? 0,
    adminTests: t.adminTests ?? 0,
    costUsd,
    costBrl: round2(costUsd * usdToBrl),
    avgCostUsd,
    cacheSavingsUsd: round6((t.cacheHits ?? 0) * avgCostUsd),
    failureRate: t.tryons ? Math.round(((t.failed ?? 0) / t.tryons) * 10000) / 10000 : 0,
  };

  const byProvider = db
    .prepare(
      `SELECT provider, COUNT(*) AS tryons, COALESCE(SUM(cost_usd), 0) AS cost,
              SUM(status = 'done' AND cache_hit = 0) AS paidDone,
              COALESCE(SUM(CASE WHEN status = 'done' AND cache_hit = 0 THEN cost_usd END), 0) AS paidCost,
              AVG(CASE WHEN status = 'done' AND cache_hit = 0 THEN latency_ms END) AS latency
       FROM tryons WHERE created_at >= ? GROUP BY provider ORDER BY cost DESC`,
    )
    .all(since)
    .map((r) => ({
      provider: r.provider,
      tryons: r.tryons,
      costUsd: round6(r.cost),
      avgCostUsd: r.paidDone ? round6(r.paidCost / r.paidDone) : 0,
      avgLatencyMs: r.latency ? Math.round(r.latency) : null,
    }));

  const rows = new Map();
  const row = (productId, name) => {
    if (!rows.has(productId)) rows.set(productId, { productId, name: name ?? REMOVED, tryons: 0, costUsd: 0, whatsapp: 0, buyLink: 0, downloads: 0 });
    return rows.get(productId);
  };
  for (const r of db
    .prepare(
      `SELECT t.product_id AS productId, p.name AS name, COUNT(*) AS n, COALESCE(SUM(t.cost_usd), 0) AS cost
       FROM tryons t LEFT JOIN products p ON p.id = t.product_id
       WHERE t.created_at >= ? AND t.product_id IS NOT NULL GROUP BY t.product_id`,
    )
    .all(since)) {
    Object.assign(row(r.productId, r.name), { tryons: r.n, costUsd: round6(r.cost) });
  }
  const field = { whatsapp: 'whatsapp', buy_link: 'buyLink', download: 'downloads' };
  for (const e of db
    .prepare(
      `SELECT e.product_id AS productId, p.name AS name, e.type AS type, COUNT(*) AS n
       FROM events e LEFT JOIN products p ON p.id = e.product_id
       WHERE e.created_at >= ? AND e.product_id IS NOT NULL GROUP BY e.product_id, e.type`,
    )
    .all(since)) {
    if (field[e.type]) row(e.productId, e.name)[field[e.type]] = e.n;
  }
  const byProduct = [...rows.values()].sort((a, b) => b.tryons - a.tryons || b.costUsd - a.costUsd);

  const today = summary(db, startOfDayUtc(now, timeZone), usdToBrl);
  return {
    period,
    since,
    totals,
    today,
    month: summary(db, startOfMonthUtc(now, timeZone), usdToBrl),
    byProvider,
    byProduct,
    estimates: Object.fromEntries(['gemini', 'openai', 'fashn'].map((id) => [id, estimateCost(id, settings.providers[id])])),
    budget: { dailyBudgetUsd: settings.limits.dailyBudgetUsd, spentTodayUsd: today.costUsd },
    money: { usdToBrl, fixedMonthlyBrl },
    activeProvider: settings.activeProvider,
  };
}

export function listTryons(db, { limit = 50 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return db
    .prepare(
      `SELECT t.*, p.name AS product_name FROM tryons t LEFT JOIN products p ON p.id = t.product_id
       ORDER BY t.created_at DESC LIMIT ?`,
    )
    .all(n)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      provider: r.provider,
      model: r.model,
      productId: r.product_id,
      productName: r.product_name ?? REMOVED,
      color: r.color,
      size: r.size,
      costUsd: r.cost_usd,
      cacheHit: Boolean(r.cache_hit),
      latencyMs: r.latency_ms,
      error: r.error,
      resultUrl: r.result_file ? `/media/results/${r.result_file}` : null,
      createdAt: r.created_at,
    }));
}
