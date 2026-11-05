// Simulador de custo mensal. Usado pelo painel (navegador) e pelos testes (Node).
const round2 = (n) => Math.round(n * 100) / 100;

export function simulateMonthly({ clientsPerDay, triesPerClient, cacheRate, costPerTryUsd, usdToBrl, fixedMonthlyBrl }) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const tryonsPerMonth = Math.round(num(clientsPerDay) * num(triesPerClient) * 30);
  const rate = Math.min(Math.max(num(cacheRate), 0), 1);
  const paidTryons = Math.round(tryonsPerMonth * (1 - rate));
  const aiUsdRaw = paidTryons * num(costPerTryUsd);
  const aiBrlRaw = aiUsdRaw * num(usdToBrl);
  return {
    tryonsPerMonth,
    paidTryons,
    aiUsd: round2(aiUsdRaw),
    aiBrl: round2(aiBrlRaw),
    totalBrl: round2(aiBrlRaw + num(fixedMonthlyBrl)),
  };
}
