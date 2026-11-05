// Modo demonstração: não chama IA nem custa nada. Monta um SVG com a foto do cliente
// e uma miniatura da peça, para testar o fluxo inteiro sem chave.
import { toDataUrl } from './errors.js';

async function tryOn(input) {
  const w = input.aspect?.width > 0 ? Math.round(input.aspect.width) : 768;
  const h = input.aspect?.height > 0 ? Math.round(input.aspect.height) : 1024;
  const thumb = Math.round(Math.min(w, h) * 0.34);
  const pad = Math.round(Math.min(w, h) * 0.04);
  const font = Math.round(Math.min(w, h) * 0.07);
  const name = String(input.product?.name ?? '').replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <image href="${toDataUrl(input.person)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>
  <rect x="${w - thumb - pad * 1.5}" y="${h - thumb - pad * 1.5}" width="${thumb + pad}" height="${thumb + pad}" rx="${pad / 2}" fill="#fff" opacity="0.92"/>
  <image href="${toDataUrl(input.garment)}" x="${w - thumb - pad}" y="${h - thumb - pad}" width="${thumb}" height="${thumb}" preserveAspectRatio="xMidYMid slice"/>
  <rect x="${pad}" y="${pad}" width="${font * 3.6}" height="${font * 1.5}" rx="${font * 0.3}" fill="#b4532a"/>
  <text x="${pad + font * 1.8}" y="${pad + font * 1.08}" font-family="Arial, sans-serif" font-size="${font}" font-weight="700" fill="#fff" text-anchor="middle">DEMO</text>
  <text x="${pad}" y="${h - pad}" font-family="Arial, sans-serif" font-size="${Math.round(font * 0.45)}" fill="#fff" stroke="#000" stroke-width="0.6">${name}</text>
</svg>`;
  return { image: { buffer: Buffer.from(svg, 'utf8'), mime: 'image/svg+xml' }, usage: {}, model: 'demo' };
}

export default { id: 'demo', label: 'Demonstração (sem IA, grátis)', supports: ['top', 'bottom', 'full', 'headwear'], requiresKey: false, tryOn };
