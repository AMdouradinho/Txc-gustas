// Aba "Custos": números reais, simulador e últimas provas.
import { api, el, $, fmtUsd, fmtBrl, fmtSeconds, providerName } from './common.js';
import { simulateMonthly } from '/js/simulate.js';

let period = 'today';
let stats = null;

const stat = (label, value, sub, extra) =>
  el('div', { class: 'stat' }, el('span', { class: 'label', text: label }), el('span', { class: 'value', text: value }), sub ? el('span', { class: 'sub', text: sub }) : null, extra ?? null);

function renderCards() {
  const { totals, today, month, budget, money } = stats;
  const rate = money.usdToBrl;
  const used = budget.dailyBudgetUsd > 0 ? Math.min(1, budget.spentTodayUsd / budget.dailyBudgetUsd) : 0;
  $('stats-cards').replaceChildren(
    stat('Provas', String(totals.tryons), `${totals.done} prontas · ${totals.cacheHits} reaproveitadas · ${totals.adminTests} testes`),
    stat('Gasto no período', fmtBrl(totals.costBrl), fmtUsd(totals.costUsd)),
    stat('Custo médio por prova', fmtBrl(totals.avgCostUsd * rate), fmtUsd(totals.avgCostUsd)),
    stat('Economia (reaproveitadas)', fmtBrl(totals.cacheSavingsUsd * rate), fmtUsd(totals.cacheSavingsUsd)),
    stat('Falhas', `${Math.round(totals.failureRate * 100)}%`, `${totals.failed} de ${totals.tryons}`),
    stat(
      'Hoje × teto diário',
      fmtUsd(today.costUsd),
      `teto ${fmtUsd(budget.dailyBudgetUsd)} · ${today.tryons} provas`,
      el('div', { class: 'bar' }, el('span', { class: used >= 0.8 ? 'hot' : '', style: `width:${Math.round(used * 100)}%` })),
    ),
    stat('Este mês', fmtBrl(month.costBrl), `${month.tryons} provas · ${fmtUsd(month.costUsd)}`),
  );
}

const emptyRow = (cols, text) => el('tr', { class: 'empty-row' }, el('td', { colspan: cols, text }));

function renderTables() {
  const rate = stats.money.usdToBrl;
  $('provider-table').tBodies[0].replaceChildren(
    ...(stats.byProvider.length
      ? stats.byProvider.map((r) =>
          el(
            'tr',
            {},
            el('td', { text: providerName(r.provider) }),
            el('td', { class: 'num', text: r.tryons }),
            el('td', { class: 'num', text: fmtBrl(r.costUsd * rate) }),
            el('td', { class: 'num', text: fmtUsd(r.avgCostUsd) }),
            el('td', { class: 'num', text: fmtSeconds(r.avgLatencyMs) }),
          ),
        )
      : [emptyRow(5, 'Nenhuma prova no período.')]),
  );
  $('product-table').tBodies[0].replaceChildren(
    ...(stats.byProduct.length
      ? stats.byProduct.map((r) =>
          el(
            'tr',
            {},
            el('td', { text: r.name }),
            el('td', { class: 'num', text: r.tryons }),
            el('td', { class: 'num', text: fmtBrl(r.costUsd * rate) }),
            el('td', { class: 'num', text: r.whatsapp }),
            el('td', { class: 'num', text: r.buyLink }),
            el('td', { class: 'num', text: r.downloads }),
          ),
        )
      : [emptyRow(6, 'Nenhuma prova no período.')]),
  );
}

function renderSimulator() {
  if (!stats) return;
  const rate = stats.money.usdToBrl;
  const input = {
    clientsPerDay: Number($('sim-clients').value) || 0,
    triesPerClient: Number($('sim-tries').value) || 0,
    cacheRate: (Number($('sim-cache').value) || 0) / 100,
    usdToBrl: rate,
    fixedMonthlyBrl: $('sim-fixed').value === '' ? stats.money.fixedMonthlyBrl : Number($('sim-fixed').value) || 0,
  };
  $('sim-table').tBodies[0].replaceChildren(
    ...['gemini', 'openai', 'fashn'].map((id) => {
      const real = stats.byProvider.find((r) => r.provider === id && r.avgCostUsd > 0);
      const cost = real ? real.avgCostUsd : stats.estimates[id];
      const sim = simulateMonthly({ ...input, costPerTryUsd: cost });
      return el(
        'tr',
        {},
        el('td', {}, providerName(id), id === stats.activeProvider ? el('span', { class: 'pill on', text: 'ativa' }) : null),
        el('td', { class: 'num' }, `${fmtUsd(cost)} (${fmtBrl(cost * rate)})`, el('br'), el('small', { text: real ? 'média real' : 'estimativa' })),
        el('td', { class: 'num', text: sim.paidTryons.toLocaleString('pt-BR') }),
        el('td', { class: 'num', text: fmtBrl(sim.aiBrl) }),
        el('td', { class: 'num' }, el('b', { text: fmtBrl(sim.totalBrl) })),
      );
    }),
  );
}

const STATUS = { done: 'Pronta', failed: 'Falhou', pending: 'Gerando' };

async function renderRecent() {
  const rows = await api('/api/admin/tryons?limit=50');
  $('recent-table').tBodies[0].replaceChildren(
    ...(rows.length
      ? rows.map((r) =>
          el(
            'tr',
            {},
            el('td', { text: new Date(r.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) }),
            el('td', { text: [r.productName, r.color].filter(Boolean).join(' · ') }),
            el('td', {}, providerName(r.provider), r.kind === 'admin_test' ? el('span', { class: 'pill off', text: 'teste' }) : null),
            el(
              'td',
              { title: r.error ?? '' },
              el('span', { class: `status ${r.status}`, text: r.cacheHit ? 'Reaproveitada' : STATUS[r.status] ?? r.status }),
              r.status === 'failed' && r.error ? el('div', { class: 'muted', text: r.error.slice(0, 120) }) : null,
            ),
            el('td', { class: 'num', text: fmtUsd(r.costUsd) }),
            el('td', { class: 'num', text: fmtSeconds(r.latencyMs) }),
            el('td', {}, r.resultUrl ? el('a', { class: 'link', href: r.resultUrl, target: '_blank', rel: 'noopener', text: 'ver' }) : null),
          ),
        )
      : [emptyRow(7, 'Nenhuma prova ainda.')]),
  );
}

async function load() {
  stats = await api(`/api/admin/stats?period=${period}`);
  if ($('sim-fixed').value === '') $('sim-fixed').placeholder = String(stats.money.fixedMonthlyBrl);
  renderCards();
  renderTables();
  renderSimulator();
  await renderRecent();
}

let ready = false;
export function initCosts() {
  if (ready) return;
  ready = true;
  for (const b of $('period').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      period = b.dataset.period;
      for (const x of $('period').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      load();
    });
  }
  for (const id of ['sim-clients', 'sim-tries', 'sim-cache', 'sim-fixed']) $(id).addEventListener('input', renderSimulator);
}

export function showCosts() {
  load().catch((err) => $('stats-cards').replaceChildren(el('p', { class: 'form-error', text: err.message })));
}
