// Teste de fumaça no navegador (manual): sobe o servidor em modo demo num diretório temporário,
// percorre loja → peça → provador → resultado e o painel, e salva capturas de tela.
// Uso: npm run smoke   (capturas em $SMOKE_OUT ou numa pasta temporária)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.env.SMOKE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
const PHOTO = path.join(ROOT, 'test', 'fixtures', 'cliente.jpg');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-data-'));
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_PASSWORD: 'smoke123', SESSION_SECRET: 'smoke' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/store`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`servidor não subiu:\n${serverLog}`);
}

const errors = [];
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

async function storeFlow(browser, label, viewport, expectedRemaining) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`[${label}] console: ${m.text()}`));

  page.setDefaultTimeout(8000);
  await page.goto(BASE);
  await page.waitForSelector('.product-card');
  // PNG transparente não pode virar fundo preto ao reduzir a foto
  const corner = await page.evaluate(async () => {
    const { resizeImage } = await import('/js/tryon.js');
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const out = await resizeImage(blob);
    const img = new Image();
    img.src = out.dataUrl;
    await img.decode();
    const k = document.createElement('canvas');
    k.width = k.height = 40;
    const ctx = k.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(1, 1, 1, 1).data.slice(0, 3));
  });
  if (corner.some((v) => v < 240)) throw new Error(`PNG transparente ficou escuro: rgb(${corner})`);
  const cards = await page.locator('.product-card').count();
  if (cards !== 5) throw new Error(`esperava 5 peças, vi ${cards}`);
  await shot(page, `${label}-1-catalogo`);

  await page.locator('.product-card', { hasText: 'Camiseta Águia Cowboy' }).click();
  await page.waitForSelector('#tryon-open');
  await page.locator('.color-chip', { hasText: 'Marrom' }).click();
  await page.locator('.size-chip', { hasText: 'M' }).first().click();
  await shot(page, `${label}-2-peca`);

  await page.click('#tryon-open');
  await page.setInputFiles('#photo-gallery', PHOTO);
  await page.waitForSelector('#photo-preview img');
  await page.check('#consent');
  await shot(page, `${label}-3-provador`);
  await page.click('#generate');
  await page.waitForSelector('#result-after', { timeout: 20000 });
  await page.waitForTimeout(300);
  await shot(page, `${label}-4-resultado`);

  const wa = await page.getAttribute('#btn-whatsapp', 'href');
  if (wa && !wa.includes('Camiseta%20%C3%81guia%20Cowboy')) throw new Error(`link do WhatsApp sem a peça: ${wa}`);
  const remaining = await page.textContent('#remaining');
  if (!remaining.includes(String(expectedRemaining))) throw new Error(`provas restantes inesperadas: ${remaining}`);
  await ctx.close();
}

let browser;
async function closeMidGeneration(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => errors.push(`[fechar] ${e.message}`));
  page.on('dialog', (d) => d.accept()); // cliente confirma o fechamento
  await page.goto(`${BASE}/peca?slug=camisa-polo-piquet-cafe`);
  await page.click('#tryon-open');
  await page.setInputFiles('#photo-gallery', path.join(ROOT, 'seed', 'images', 'babylook-marinho.jpg'));
  await page.waitForSelector('#photo-preview img');
  await page.check('#consent');
  await page.click('#generate');
  await page.waitForSelector('[data-step="loading"]:not([hidden])');
  await page.click('#tryon-close');
  await page.click('#tryon-open');
  if (await page.isDisabled('#generate')) throw new Error('fechar no meio da geração deixou "Gerar" travado');
  await page.waitForTimeout(3000);
  if (!(await page.isHidden('[data-step="result"]'))) throw new Error('resultado antigo apareceu depois de reabrir o provador');
  await ctx.close();
}

try {
  await waitServer();
  browser = await chromium.launch();
  await storeFlow(browser, 'celular', { width: 390, height: 844 }, 4);
  // mesma foto + mesma peça: resultado reaproveitado (cache), não gasta prova
  await storeFlow(browser, 'desktop', { width: 1280, height: 800 }, 5);
  await closeMidGeneration(browser);
  if (process.env.SMOKE_ADMIN !== '0' && fs.existsSync(path.join(ROOT, 'test', 'e2e', 'admin-flow.mjs'))) {
    const { adminFlow } = await import('./admin-flow.mjs');
    await adminFlow({ browser, BASE, PHOTO, shot, errors });
  }
  if (errors.length) throw new Error(`erros no navegador:\n${errors.join('\n')}`);
  console.log(`SMOKE OK — capturas em ${OUT}`);
} catch (err) {
  console.error('SMOKE FALHOU:', err.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
