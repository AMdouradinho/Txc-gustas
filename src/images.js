import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

// Confere o tipo pelos primeiros bytes (não confia na extensão nem no Content-Type).
export function detectImageType(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function safeName(filename) {
  if (typeof filename !== 'string' || !/^[0-9a-zA-Z_.-]+$/.test(filename) || filename.includes('..')) {
    throw new Error(`Nome de arquivo inválido: ${filename}`);
  }
  return filename;
}

export function saveImage(dir, buf, mime) {
  const ext = EXT[mime];
  if (!ext) throw new Error(`Tipo de imagem não suportado: ${mime}`);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);
  return filename;
}

export function readImage(dir, filename) {
  const name = safeName(filename);
  const buffer = fs.readFileSync(path.join(dir, name));
  const mime = MIME[path.extname(name).slice(1)] || 'application/octet-stream';
  return { buffer, mime };
}

export function fileExists(dir, filename) {
  try {
    return fs.existsSync(path.join(dir, safeName(filename)));
  } catch {
    return false;
  }
}

export function removeFile(dir, filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(dir, safeName(filename)));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
