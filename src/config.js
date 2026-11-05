import path from 'node:path';
import crypto from 'node:crypto';

// Quantos proxies à frente do app (Railway/Render/Nginx) para ler o IP real do cliente.
// Sem proxy confiável, um cliente poderia falsificar o IP no cabeçalho e furar o limite.
function parseTrustProxy(value, isProduction) {
  if (value === undefined || value === '') return isProduction ? 1 : false;
  if (value === 'false' || value === '0') return false;
  if (value === 'true') return true;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : false;
}

// Lê as variáveis de ambiente. Não imprime nada: avisos voltam em `warnings`
// para o server.js mostrar no console.
export function loadConfig(env = process.env) {
  const warnings = [];
  const isProduction = env.NODE_ENV === 'production';
  // Em produção não há senha padrão: sem isso, qualquer um entraria no painel com "admin".
  if (isProduction && !env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD é obrigatória em produção (senha do painel).');
  if (isProduction && !env.SESSION_SECRET) throw new Error('SESSION_SECRET é obrigatória em produção (texto aleatório longo).');

  let adminPassword = env.ADMIN_PASSWORD || '';
  if (!adminPassword) {
    adminPassword = 'admin';
    warnings.push('ADMIN_PASSWORD não definida: usando a senha "admin". Defina uma senha forte antes de publicar.');
  }

  let sessionSecret = env.SESSION_SECRET || '';
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    warnings.push('SESSION_SECRET não definida: gerando uma aleatória (o login do painel cai a cada reinício).');
  }

  return {
    port: Number(env.PORT) || 3000,
    dataDir: path.resolve(env.DATA_DIR || './data'),
    adminPassword,
    sessionSecret,
    keys: {
      gemini: env.GEMINI_API_KEY || '',
      openai: env.OPENAI_API_KEY || '',
      fashn: env.FASHN_API_KEY || '',
    },
    timeZone: 'America/Sao_Paulo',
    isProduction,
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction),
    warnings,
  };
}
