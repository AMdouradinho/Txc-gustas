import { api, $, state } from './common.js';
import { initProducts, showProducts } from './products.js';
import { initCompare, showCompare } from './compare.js';
import { initCosts, showCosts } from './costs.js';
import { initSettings, showSettings } from './settings.js';

const PANELS = { products: showProducts, compare: showCompare, costs: showCosts, settings: showSettings };

function selectTab(name) {
  if (!PANELS[name]) name = 'products';
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  PANELS[name]();
}

async function enterApp(me) {
  state.catalog = me.catalog;
  $('admin-store-name').textContent = me.storeName;
  state.settings = await api('/api/admin/settings');
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  initProducts();
  initCompare();
  initCosts();
  initSettings();
  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => selectTab(t.dataset.tab));
  selectTab(location.hash.slice(1));
}

function showLogin() {
  $('app-view').hidden = true;
  $('login-view').hidden = false;
  $('login-password').focus();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  $('login-submit').disabled = true;
  try {
    await api('/api/admin/login', { method: 'POST', json: { password: $('login-password').value } });
    await enterApp(await api('/api/admin/me'));
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    $('login-submit').disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

try {
  await enterApp(await api('/api/admin/me'));
} catch {
  showLogin();
}
