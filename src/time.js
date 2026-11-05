// Datas: tudo é gravado em UTC (ISO). "Hoje" e "mês" são calculados no fuso da loja.

export function nowIso(date = new Date()) {
  return date.toISOString();
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

// Diferença (ms) entre o relógio local e o UTC naquele instante.
function offsetMs(date, timeZone) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Converte "meia-noite local de Y-M-D" para o instante UTC correspondente.
function localMidnightUtc(year, month, day, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const first = new Date(guess.getTime() - offsetMs(guess, timeZone));
  // Segunda passada corrige caso o offset mude entre o palpite e o resultado (horário de verão).
  return new Date(guess.getTime() - offsetMs(first, timeZone));
}

export function startOfDayUtc(date, timeZone) {
  const p = localParts(date, timeZone);
  return localMidnightUtc(p.year, p.month, p.day, timeZone).toISOString();
}

export function startOfMonthUtc(date, timeZone) {
  const p = localParts(date, timeZone);
  return localMidnightUtc(p.year, p.month, 1, timeZone).toISOString();
}
