// Aba "Configurações".
import { api, el, $, state, toast, fmtUsd, fmtBrl, providerName, fmtDecimal } from './common.js';

const PROVIDER_FIELDS = {
  gemini: ['model', 'imageSize'],
  openai: ['model', 'quality'],
  fashn: ['model', 'mode'],
};
const PRICE_FIELDS = {
  gemini: ['inputPerM', 'outputImagePerM', 'outputTextPerM'],
  openai: ['textInputPerM', 'imageInputPerM', 'outputPerM'],
  fashn: ['perCredit', 'creditsPerRun'],
};
const SECTIONS = {
  store: ['name', 'whatsapp', 'storeUrl'],
  limits: ['perClientPerDay', 'perIpPerDay', 'dailyBudgetUsd', 'retentionHours'],
  money: ['usdToBrl', 'fixedMonthlyBrl'],
};
const DESCRIPTIONS = {
  gemini: 'Bom com foto de modelo vestindo a peça. Barato.',
  openai: 'Boa qualidade; custo varia com a qualidade escolhida.',
  fashn: 'Especialista em provador. Não faz boné (usa Gemini/OpenAI nesses casos).',
  demo: 'Não usa IA: monta uma imagem de teste. Grátis.',
};

function renderProviderCards() {
  const { settings, providerStatus, estimates } = state.settings;
  const rate = settings.money.usdToBrl;
  $('provider-cards').replaceChildren(
    ...['gemini', 'openai', 'fashn', 'demo'].map((id) => {
      const st = providerStatus[id];
      const cost = id === 'demo' ? 'Grátis' : `≈ ${fmtUsd(estimates[id])} por prova (${fmtBrl(estimates[id] * rate)})`;
      return el(
        'label',
        { class: `provider-card${st.hasKey ? '' : ' disabled'}` },
        el(
          'span',
          { class: 'top' },
          el('input', { type: 'radio', name: 'activeProvider', value: id, disabled: !st.hasKey, checked: settings.activeProvider === id }),
          providerName(id),
        ),
        el('span', { class: 'sub', text: st.hasKey ? (id === 'demo' ? '' : '✓ chave configurada') : '✗ sem chave de API' }),
        el('span', { class: 'sub', text: cost }),
        el('span', { class: 'sub', text: DESCRIPTIONS[id] }),
      );
    }),
  );
}

function fill() {
  const s = state.settings.settings;
  for (const [section, keys] of Object.entries(SECTIONS)) {
    for (const k of keys) {
      const v = s[section][k];
      $(`s-${section}-${k}`).value = typeof v === 'number' && !Number.isInteger(v) ? fmtDecimal(v) : v ?? '';
    }
  }
  for (const [p, keys] of Object.entries(PROVIDER_FIELDS)) for (const k of keys) $(`s-${p}-${k}`).value = s.providers[p][k];
  for (const [p, keys] of Object.entries(PRICE_FIELDS)) for (const k of keys) $(`s-${p}-${k}`).value = fmtDecimal(s.providers[p].prices[k]);
  renderProviderCards();
}

function readForm() {
  const patch = {};
  for (const [section, keys] of Object.entries(SECTIONS)) {
    patch[section] = Object.fromEntries(keys.map((k) => [k, $(`s-${section}-${k}`).value]));
  }
  patch.providers = {};
  for (const p of Object.keys(PROVIDER_FIELDS)) {
    patch.providers[p] = Object.fromEntries(PROVIDER_FIELDS[p].map((k) => [k, $(`s-${p}-${k}`).value]));
    patch.providers[p].prices = Object.fromEntries(PRICE_FIELDS[p].map((k) => [k, $(`s-${p}-${k}`).value]));
  }
  const active = $('provider-cards').querySelector('input:checked');
  if (active) patch.activeProvider = active.value;
  return patch;
}

async function save(e) {
  e.preventDefault();
  $('settings-error').textContent = '';
  $('save-settings').disabled = true;
  try {
    state.settings = await api('/api/admin/settings', { method: 'PUT', json: readForm() });
    $('admin-store-name').textContent = state.settings.settings.store.name;
    fill();
    toast('Configurações salvas');
  } catch (err) {
    $('settings-error').textContent = err.message;
  } finally {
    $('save-settings').disabled = false;
  }
}

let ready = false;
export function initSettings() {
  if (ready) return;
  ready = true;
  $('settings-form').addEventListener('submit', save);
}

export async function showSettings() {
  state.settings = await api('/api/admin/settings');
  fill();
}
