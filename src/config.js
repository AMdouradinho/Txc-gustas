import path from 'node:path';
import crypto from 'node:crypto';

// Lê as variáveis de ambiente. Não imprime nada: avisos voltam em `warnings`
// para o server.js mostrar no console.
export function loadConfig(env = process.env) {
  const warnings = [];

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
    isProduction: env.NODE_ENV === 'production',
    warnings,
  };
}
