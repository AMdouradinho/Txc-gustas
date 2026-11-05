// Parte do smoke: fluxo do painel do dono.
export async function adminFlow({ browser, BASE, PHOTO, shot, errors }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(`[admin] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`[admin] console: ${m.text()}`));
  page.on('dialog', (d) => d.accept());

  await page.goto(`${BASE}/admin`);
  await page.fill('#login-password', 'errada');
  await page.click('#login-submit');
  await page.waitForSelector('#login-error:not(:empty)');
  await page.fill('#login-password', 'smoke123');
  await page.click('#login-submit');
  await page.waitForSelector('.product-row');
  if ((await page.locator('.product-row').count()) !== 5) throw new Error('painel: esperava 5 peças');
  await shot(page, 'admin-1-pecas');

  // nova peça com foto
  await page.click('#new-product');
  await page.fill('#f-name', 'Bermuda Sarja Teste');
  await page.selectOption('#f-category', 'bermuda');
  if ((await page.inputValue('#f-tryonType')) !== 'bottom') throw new Error('painel: categoria não ajustou o tipo de prova');
  await page.fill('#f-price', '129,90');
  await page.fill('#f-sizes-input', '38');
  await page.press('#f-sizes-input', 'Enter');
  await page.fill('#f-colors-input', 'Cáqui');
  await page.press('#f-colors-input', 'Enter');
  await page.fill('#f-aiNotes', 'Bermuda de sarja cáqui, cinco bolsos.');
  await page.click('#save-product');
  await page.waitForSelector('#photos-section:not([hidden])');
  await page.setInputFiles('#photo-upload', PHOTO);
  await page.waitForSelector('.photo-item');
  await shot(page, 'admin-2-editor');
  await page.click('#back-to-list');
  await page.waitForSelector('.product-row >> text=Bermuda Sarja Teste');
  const price = await page.textContent('.product-row:has-text("Bermuda Sarja Teste")');
  if (!price.includes('129,90')) throw new Error(`painel: preço não salvo (${price})`);

  // comparar IAs (modo demo)
  await page.click('[data-tab="compare"]');
  await page.setInputFiles('#compare-photo', PHOTO);
  await page.selectOption('#compare-product', { label: 'Camiseta Águia Cowboy' });
  await page.check('#compare-providers input[value="demo"]');
  await page.click('#compare-run');
  await page.waitForSelector('.compare-card img.result', { timeout: 20000 });
  await shot(page, 'admin-3-comparar');

  // custos
  await page.click('[data-tab="costs"]');
  await page.waitForSelector('#stats-cards .stat');
  await page.waitForSelector('#sim-table tbody tr');
  await page.waitForSelector('#recent-table tbody tr');
  await shot(page, 'admin-4-custos');

  // configurações
  await page.click('[data-tab="settings"]');
  await page.waitForSelector('#provider-cards .provider-card');
  await page.fill('#s-store-whatsapp', '(11) 99999-9999');
  await page.click('#save-settings');
  try {
    await page.waitForFunction(() => document.querySelector('#s-store-whatsapp').value === '5511999999999');
  } catch {
    throw new Error(`painel: configurações não salvaram: ${await page.textContent('#settings-error')}`);
  }
  await shot(page, 'admin-5-config');
  await ctx.close();
}
