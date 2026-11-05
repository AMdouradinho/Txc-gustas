// Ponto de entrada: lê a configuração, abre o banco e sobe o servidor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './src/config.js';
import { openDb } from './src/db.js';
import { createTryonService } from './src/tryon-service.js';
import { createApp } from './src/app.js';
import { seedIfEmpty } from './src/seed.js';
import { startCleanup } from './src/cleanup.js';

const config = loadConfig();
for (const w of config.warnings) console.warn(`⚠️  ${w}`);

const dirs = {
  products: path.join(config.dataDir, 'products'),
  people: path.join(config.dataDir, 'people'),
  results: path.join(config.dataDir, 'results'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

const db = openDb(path.join(config.dataDir, 'app.db'));
const seeded = seedIfEmpty(db, { seedDir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed', 'images'), productsDir: dirs.products });
if (seeded) console.log(`Banco novo: ${seeded} peças de exemplo cadastradas.`);
const service = createTryonService({ db, config, dirs });
const orphans = service.recoverOrphans();
if (orphans) console.warn(`${orphans} prova(s) interrompida(s) pelo reinício foram marcadas como falha.`);

startCleanup({ db, dirs });

const app = createApp({ db, config, service, dirs });
app.listen(config.port, () => {
  console.log(`Provador virtual rodando em http://localhost:${config.port}  (painel: /admin)`);
});
