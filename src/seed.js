// Peças de exemplo (fotos enviadas pelo dono). Só roda com o banco vazio.
import fs from 'node:fs';
import path from 'node:path';
import { createProduct, addImage, updateImage } from './catalog.js';
import { saveImage } from './images.js';

export const SEED_PRODUCTS = [
  {
    name: 'Camisa Polo Piquet Café',
    category: 'polo',
    gender: 'masculino',
    sizes: ['P', 'M', 'G', 'GG'],
    colors: ['Café'],
    description: 'Camisa polo em malha piquet na cor café, com o mascote águia bordado no peito.',
    aiNotes:
      'Polo de malha piquet marrom café bem escuro, gola e punhos canelados, carcela com dois botões claros, pequeno bordado de águia de jaqueta vermelha e calça azul no peito esquerdo.',
    images: [['polo-cafe.jpg', 'Café']],
  },
  {
    name: 'Camiseta Águia Off-Road',
    category: 'camiseta',
    gender: 'masculino',
    sizes: ['P', 'M', 'G', 'GG'],
    colors: ['Verde Militar'],
    description: 'Camiseta verde militar com estampa da águia off-road e o jipe TXC.',
    aiNotes:
      'Camiseta verde militar de gola careca. Estampa centralizada no peito em tons de amarelo-mostarda: águia de boné e óculos escuros, jaqueta e botas, em pé na frente de um jipe com a placa TXC.',
    images: [['camiseta-offroad-verde.jpg', 'Verde Militar']],
  },
  {
    name: 'Camiseta Águia Cowboy',
    category: 'camiseta',
    gender: 'masculino',
    sizes: ['P', 'M', 'G', 'GG'],
    colors: ['Verde Militar', 'Marrom'],
    description: 'Camiseta com estampa da águia cowboy. Disponível em verde militar e marrom.',
    aiNotes:
      'Camiseta de gola careca. Estampa centralizada no peito: águia com chapéu de cowboy, jaqueta caramelo, calça bege e botas, em pé sobre uma pequena faixa com assinatura.',
    images: [
      ['camiseta-cowboy-verde.jpg', 'Verde Militar'],
      ['camiseta-cowboy-marrom.jpg', 'Marrom'],
    ],
  },
  {
    name: 'Boné Jeans Águia TXC',
    category: 'boné',
    gender: 'unissex',
    sizes: ['Único'],
    colors: ['Jeans Claro'],
    description: 'Boné de jeans claro lavado com a águia TXC bordada.',
    aiNotes:
      'Boné estilo dad hat de jeans azul claro lavado, aba curva, fecho traseiro, bordado azul-marinho no painel frontal: águia de casaco longo com "TXC" no peito.',
    images: [['bone-jeans.jpg', 'Jeans Claro']],
  },
  {
    name: 'Baby Look Bordado Águia',
    category: 'baby look',
    gender: 'feminino',
    sizes: ['P', 'M', 'G'],
    colors: ['Azul Marinho'],
    description: 'Baby look azul-marinho com o mascote águia bordado no peito.',
    aiNotes: 'Camiseta baby look azul-marinho, gola careca, modelagem ajustada, pequeno bordado dourado de águia no peito esquerdo.',
    images: [['babylook-marinho.jpg', 'Azul Marinho']],
  },
];

export function seedIfEmpty(db, { seedDir, productsDir }) {
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0) return 0;
  let count = 0;
  SEED_PRODUCTS.forEach(({ images, ...data }, i) => {
    const product = createProduct(db, { ...data, sort: i });
    for (const [file, color] of images) {
      const filename = saveImage(productsDir, fs.readFileSync(path.join(seedDir, file)), 'image/jpeg');
      const img = addImage(db, product.id, filename, { color });
      updateImage(db, img.id, { isTryonRef: true });
    }
    count++;
  });
  return count;
}
