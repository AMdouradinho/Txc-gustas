// Utilidades HTTP compartilhadas pelas rotas.
import multer from 'multer';
import { MAX_UPLOAD_BYTES } from './images.js';
import { FRIENDLY_ERRORS } from './tryon-service.js';

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 12 } });

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Todos os erros saem como { error: "mensagem em português" }.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? FRIENDLY_ERRORS.badImage : 'Envio inválido';
    return res.status(400).json({ error: message });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Envio grande demais' });
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500 && !err?.status) {
    console.error(err);
    return res.status(500).json({ error: 'Erro interno. Tente de novo.' });
  }
  return res.status(status).json({ error: err.message });
}
