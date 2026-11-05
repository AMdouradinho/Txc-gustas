// Escolhe a foto da peça que vai para a IA (spec §3.2). Usado no servidor e no navegador.
// Com cor escolhida: referência da cor → 1ª foto da cor → referência sem cor → 1ª foto sem cor → nenhuma.
// Nunca usa a foto de outra cor: a IA receberia a cor errada.

const norm = (c) => (c === undefined || c === null || String(c).trim() === '' ? null : String(c).trim());

export function pickGarmentImage(product, color) {
  const images = product?.images ?? [];
  const colorless = images.filter((i) => !i.color);
  const c = norm(color);
  if (c) {
    const ofColor = images.filter((i) => i.color === c);
    return ofColor.find((i) => i.isTryonRef) ?? ofColor[0] ?? colorless.find((i) => i.isTryonRef) ?? colorless[0] ?? null;
  }
  return colorless.find((i) => i.isTryonRef) ?? images.find((i) => i.isTryonRef) ?? images[0] ?? null;
}
