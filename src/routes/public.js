// Rotas da loja (clientes).
import express from 'express';
import { getSettings } from '../settings.js';
import { listProducts, getProductBySlug } from '../catalog.js';
import { PROVIDERS } from '../providers/index.js';
import { nowIso } from '../time.js';
import { asyncHandler, upload, HttpError } from '../http.js';
import { FRIENDLY_ERRORS } from '../tryon-service.js';

export const EVENT_TYPES = ['whatsapp', 'buy_link', 'download'];

export function publicProduct(p) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    tryonType: p.tryonType,
    gender: p.gender,
    priceCents: p.priceCents,
    sizes: p.sizes,
    colors: p.colors,
    description: p.description,
    buyUrl: p.buyUrl,
    images: p.images.map(({ id, url, color, isTryonRef }) => ({ id, url, color, isTryonRef })),
  };
}

export function publicTryon(v, remaining) {
  return {
    id: v.id,
    status: v.status,
    resultUrl: v.resultUrl,
    error: v.error,
    productId: v.productId,
    color: v.color,
    size: v.size,
    cacheHit: v.cacheHit,
    remaining,
  };
}

const intOrNull = (v) => (v === undefined || v === null || v === '' || !Number.isInteger(Number(v)) ? null : Number(v));

export function publicRouter({ db, config, service }) {
  const r = express.Router();

  r.get('/store', (req, res) => {
    const s = getSettings(db);
    const active = PROVIDERS[s.activeProvider];
    res.json({
      name: s.store.name,
      whatsapp: s.store.whatsapp,
      storeUrl: s.store.storeUrl,
      limitPerDay: s.limits.perClientPerDay,
      remaining: service.remaining(req.clientId, req.ip),
      tryonEnabled: Boolean(active && (!active.requiresKey || config.keys?.[active.id])),
    });
  });

  r.get('/products', (req, res) => {
    const category = typeof req.query.category === 'string' && req.query.category ? req.query.category : undefined;
    res.json(listProducts(db, { activeOnly: true, category }).map(publicProduct));
  });

  r.get('/products/:slug', (req, res) => {
    const p = getProductBySlug(db, req.params.slug, { activeOnly: true });
    if (!p) throw new HttpError(404, FRIENDLY_ERRORS.notFound);
    res.json(publicProduct(p));
  });

  r.post(
    '/tryon',
    upload.single('photo'),
    asyncHandler(async (req, res) => {
      if (req.body?.consent !== 'true') throw new HttpError(400, 'É preciso aceitar o termo de uso da foto');
      if (!req.file) throw new HttpError(400, FRIENDLY_ERRORS.badImage);
      const out = service.submit({
        kind: 'customer',
        productId: intOrNull(req.body.productId),
        color: req.body.color || null,
        size: req.body.size || null,
        personBuffer: req.file.buffer,
        aspect: { width: Number(req.body.width) || 0, height: Number(req.body.height) || 0 },
        clientId: req.clientId,
        ip: req.ip,
      });
      const view = service.get(out.id);
      res.status(202).json(publicTryon(view, service.remaining(req.clientId, req.ip)));
    }),
  );

  r.get('/tryon/:id', (req, res) => {
    const v = service.get(req.params.id);
    if (!v || v.kind !== 'customer' || v.clientId !== req.clientId) throw new HttpError(404, 'Prova não encontrada');
    res.json(publicTryon(v, service.remaining(req.clientId, req.ip)));
  });

  r.post('/events', (req, res) => {
    const { type, productId, tryonId } = req.body ?? {};
    if (!EVENT_TYPES.includes(type)) throw new HttpError(400, 'Evento inválido');
    db.prepare('INSERT INTO events (type, product_id, tryon_id, created_at) VALUES (?, ?, ?, ?)').run(
      type,
      intOrNull(productId),
      typeof tryonId === 'string' ? tryonId.slice(0, 64) : null,
      nowIso(),
    );
    res.status(204).end();
  });

  return r;
}
