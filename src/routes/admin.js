// Rotas do painel do dono (/api/admin).
import express from 'express';
import { getSettings, updateSettings } from '../settings.js';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  addImage,
  updateImage,
  deleteImage,
} from '../catalog.js';
import { detectImageType, saveImage, removeFile } from '../images.js';
import { providerStatus, PROVIDERS } from '../providers/index.js';
import { estimateCost } from '../pricing.js';
import { parseCookies, upload, asyncHandler, HttpError } from '../http.js';
import { FRIENDLY_ERRORS, TryonError } from '../tryon-service.js';
import { SESSION_MS } from '../auth.js';

export function adminRouter({ db, config, service, dirs, auth, extend }) {
  const r = express.Router();
  const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: Boolean(config.isProduction), path: '/' };

  r.post('/login', (req, res) => {
    const token = auth.login(req.body?.password, req.ip);
    res.cookie('adm', token, { ...cookieOpts, maxAge: SESSION_MS });
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    res.clearCookie('adm', cookieOpts);
    res.status(204).end();
  });

  r.use((req, res, next) => {
    if (!auth.verify(parseCookies(req.headers.cookie).adm)) throw new HttpError(401, 'Faça login no painel');
    next();
  });

  r.get('/me', (req, res) => res.json({ ok: true, storeName: getSettings(db).store.name }));

  // ---- peças ----
  const mustProduct = (id) => {
    const p = getProduct(db, id);
    if (!p) throw new HttpError(404, FRIENDLY_ERRORS.notFound);
    return p;
  };

  r.get('/products', (req, res) => res.json(listProducts(db, {})));
  r.get('/products/:id', (req, res) => res.json(mustProduct(req.params.id)));
  r.post('/products', (req, res) => res.status(201).json(createProduct(db, req.body ?? {})));
  r.put('/products/:id', (req, res) => {
    const p = updateProduct(db, req.params.id, req.body ?? {});
    if (!p) throw new HttpError(404, FRIENDLY_ERRORS.notFound);
    res.json(p);
  });
  r.delete('/products/:id', (req, res) => {
    mustProduct(req.params.id);
    deleteProduct(db, req.params.id, dirs.products);
    res.status(204).end();
  });

  r.post('/products/:id/images', upload.array('photos', 12), (req, res) => {
    const product = mustProduct(req.params.id);
    const files = req.files ?? [];
    if (!files.length) throw new HttpError(400, FRIENDLY_ERRORS.badImage);
    const mimes = files.map((f) => detectImageType(f.buffer));
    if (mimes.some((m) => !m)) throw new HttpError(400, FRIENDLY_ERRORS.badImage);
    const color = req.body?.color || null;
    const hadRef = product.images.some((i) => i.isTryonRef && i.color === (color ?? null));
    const saved = [];
    try {
      files.forEach((f, i) => saved.push(saveImage(dirs.products, f.buffer, mimes[i])));
    } catch (err) {
      saved.forEach((name) => removeFile(dirs.products, name));
      throw err;
    }
    saved.forEach((name, i) => {
      const img = addImage(db, product.id, name, { color });
      if (i === 0 && !hadRef) updateImage(db, img.id, { isTryonRef: true });
    });
    res.json(getProduct(db, product.id));
  });

  r.patch('/images/:id', (req, res) => {
    const img = updateImage(db, req.params.id, req.body ?? {});
    if (!img) throw new HttpError(404, 'Foto não encontrada');
    res.json(img);
  });
  r.delete('/images/:id', (req, res) => {
    if (!deleteImage(db, req.params.id, dirs.products)) throw new HttpError(404, 'Foto não encontrada');
    res.status(204).end();
  });

  // ---- configurações ----
  const settingsPayload = (settings) => ({
    settings,
    providerStatus: providerStatus(config.keys),
    estimates: Object.fromEntries(['gemini', 'openai', 'fashn'].map((id) => [id, estimateCost(id, settings.providers[id])])),
  });
  r.get('/settings', (req, res) => res.json(settingsPayload(getSettings(db))));
  r.put('/settings', (req, res) => res.json(settingsPayload(updateSettings(db, req.body ?? {}, { keys: config.keys }))));

  // ---- comparar IAs ----
  r.post(
    '/compare',
    upload.single('photo'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw new HttpError(400, FRIENDLY_ERRORS.badImage);
      const raw = [].concat(req.body?.providers ?? []).join(',');
      const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter((s) => s in PROVIDERS))];
      if (!ids.length) throw new HttpError(400, 'Escolha ao menos um provedor');
      const jobs = ids.map((providerId) => {
        try {
          const out = service.submit({
            kind: 'admin_test',
            providerId,
            productId: Number(req.body.productId),
            color: req.body.color || null,
            personBuffer: req.file.buffer,
            aspect: { width: Number(req.body.width) || 0, height: Number(req.body.height) || 0 },
          });
          return { provider: providerId, id: out.id, cacheHit: out.cacheHit };
        } catch (err) {
          if (err instanceof TryonError) return { provider: providerId, error: err.message };
          throw err;
        }
      });
      res.json({ jobs });
    }),
  );

  r.get('/tryon/:id', (req, res) => {
    const v = service.get(req.params.id);
    if (!v) throw new HttpError(404, 'Prova não encontrada');
    res.json(v);
  });

  if (extend) extend(r);
  return r;
}
