import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.js';
import { parseCookies, errorHandler } from './http.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const YEAR_MS = 365 * 24 * 3600 * 1000;

export function createApp({ db, config, service, dirs, extendAdmin }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy !== undefined && config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Imagens: peças (permanentes) e resultados (temporários). Fotos de clientes nunca são servidas.
  const imageHeaders = (cacheControl) => (res) => {
    res.set('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    res.set('Cache-Control', cacheControl);
  };
  app.use('/media/products', express.static(dirs.products, { index: false, setHeaders: imageHeaders('public, max-age=86400') }));
  // Resultados mostram o cliente: nada de cache compartilhado (CDN/proxy) além do prazo de exclusão.
  app.use('/media/results', express.static(dirs.results, { index: false, setHeaders: imageHeaders('private, max-age=3600') }));

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  app.use('/api', express.json({ limit: '200kb' }));

  // Cookie anônimo do aparelho, para o limite de provas por cliente.
  app.use('/api', (req, res, next) => {
    let pid = parseCookies(req.headers.cookie).pid;
    if (!pid || !UUID.test(pid)) {
      pid = crypto.randomUUID();
      res.cookie('pid', pid, { httpOnly: true, sameSite: 'lax', secure: Boolean(config.isProduction), maxAge: YEAR_MS, path: '/' });
    }
    req.clientId = pid;
    next();
  });

  const auth = createAuth({ password: config.adminPassword, secret: config.sessionSecret });
  app.use('/api/admin', adminRouter({ db, config, service, dirs, auth, extend: extendAdmin }));
  app.use('/api', publicRouter({ db, config, service }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada' }));

  app.use(errorHandler);
  return app;
}
