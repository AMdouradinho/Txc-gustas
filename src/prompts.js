// Instruções para a IA, em inglês (os modelos seguem melhor).

const TASK = {
  top: (g) =>
    `Edit IMAGE 1 so the customer is wearing ${g} as their upper-body garment, replacing only the shirt/top they currently wear. ` +
    'Keep their pants, skirt, shoes and accessories exactly as they are.',
  bottom: (g) =>
    `Edit IMAGE 1 so the customer is wearing ${g} as their lower-body garment, replacing only the pants/shorts/skirt they currently wear. ` +
    'Keep their top, shoes and accessories exactly as they are.',
  full: (g) =>
    `Edit IMAGE 1 so the customer is wearing ${g}, replacing their entire outfit (top and bottom) with this one-piece garment. ` +
    'Keep their shoes and accessories when they remain visible.',
  headwear: (g) =>
    `Edit IMAGE 1 to place ${g} on the customer's head, worn naturally and facing the same way as in the product photo, ` +
    'with hair adjusted realistically around it. Keep all of their clothes exactly as they are.',
};

export function buildPrompt({ product, color, tryonType }) {
  const name = String(product?.name ?? 'the product').trim();
  const colorText = color ? ` in the color "${String(color).trim()}"` : '';
  const garment = `the product "${name}"${colorText} shown in IMAGE 2`;
  const notes = product?.aiNotes ? `\nProduct details from the store (Portuguese): ${String(product.aiNotes).trim()}` : '';
  const task = (TASK[tryonType] ?? TASK.top)(garment);

  return [
    'You are a virtual fitting room for a clothing store.',
    'IMAGE 1 is a photo of the customer. IMAGE 2 is the product photo.',
    'IMAGE 2 may show the product worn by a different model: ignore that model completely (face, body, pose, hair and any other clothes) and use only the product itself.',
    '',
    task,
    '',
    'Preserve from IMAGE 1, unchanged: the face and identity, facial expression, hair, skin tone, body shape and proportions, pose, hands, background, lighting and camera framing.',
    'Reproduce the product faithfully: exact color, fabric texture, collar/neckline, sleeves, buttons and seams, and every print, logo or embroidery with its exact design, position, size and colors. Do not invent or remove details.',
    'Make it fit the customer naturally, with realistic folds, shadows and lighting that match IMAGE 1.' + notes,
    '',
    'Output a single photorealistic photo with the same framing and aspect ratio as IMAGE 1. No text, no watermark, no collage, no side-by-side.',
  ].join('\n');
}
