// LGPD: apaga fotos de clientes e resultados depois do prazo de retenção.
// O registro da prova (custo, uso) continua, sem imagem.
import { removeFile } from './images.js';
import { getSettings } from './settings.js';

const HOUR_MS = 3600 * 1000;

export function cleanupExpired({ db, dirs, retentionHours, now = new Date() }) {
  const cutoff = new Date(now.getTime() - retentionHours * HOUR_MS).toISOString();
  const expired = db
    .prepare('SELECT id, person_file, result_file FROM tryons WHERE created_at < ? AND (person_file IS NOT NULL OR result_file IS NOT NULL)')
    .all(cutoff);
  const stillUsed = db.prepare('SELECT 1 FROM tryons WHERE result_file = ? AND created_at >= ? LIMIT 1');
  const clear = db.prepare('UPDATE tryons SET person_file = NULL, result_file = NULL WHERE id = ?');

  let deleted = 0;
  for (const row of expired) {
    if (row.person_file) {
      removeFile(dirs.people, row.person_file);
      deleted++;
    }
    // Um resultado reaproveitado (cache) por prova recente continua até ela expirar também.
    if (row.result_file && !stillUsed.get(row.result_file, cutoff)) {
      removeFile(dirs.results, row.result_file);
      deleted++;
    }
    clear.run(row.id);
  }
  return { deleted };
}

export function startCleanup({ db, dirs, intervalMs = HOUR_MS, log = console }) {
  const tick = () => {
    try {
      const { deleted } = cleanupExpired({ db, dirs, retentionHours: getSettings(db).limits.retentionHours });
      if (deleted) log.log?.(`Limpeza LGPD: ${deleted} arquivo(s) de foto apagado(s).`);
    } catch (err) {
      log.error?.('Falha na limpeza de fotos:', err);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
