// Custo de IA por prova, a partir do uso devolvido por cada API e da tabela de preços do painel.
// Preços são em US$ por 1 milhão de tokens (Gemini/OpenAI) ou por crédito (FASHN).

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const perM = (tokens, price) => ((Number(tokens) || 0) * (Number(price) || 0)) / 1e6;

function geminiCost(usage, prices) {
  const input = usage.promptTokenCount ?? 0;
  const details = usage.candidatesTokensDetails;
  let imageOut;
  let textOut;
  if (Array.isArray(details) && details.length) {
    imageOut = details.filter((d) => d.modality === 'IMAGE').reduce((s, d) => s + (d.tokenCount ?? 0), 0);
    textOut = details.filter((d) => d.modality !== 'IMAGE').reduce((s, d) => s + (d.tokenCount ?? 0), 0);
  } else {
    imageOut = usage.candidatesTokenCount ?? 0;
    textOut = 0;
  }
  textOut += usage.thoughtsTokenCount ?? 0;
  return perM(input, prices.inputPerM) + perM(imageOut, prices.outputImagePerM) + perM(textOut, prices.outputTextPerM);
}

function openaiCost(usage, prices) {
  const d = usage.input_tokens_details;
  const textIn = d ? d.text_tokens ?? 0 : 0;
  const imageIn = d ? d.image_tokens ?? 0 : usage.input_tokens ?? 0;
  return perM(textIn, prices.textInputPerM) + perM(imageIn, prices.imageInputPerM) + perM(usage.output_tokens, prices.outputPerM);
}

function fashnCost(usage, prices) {
  return (Number(usage.credits) || 0) * (Number(prices.perCredit) || 0);
}

export function computeCost(providerId, usage, prices = {}) {
  if (!usage || typeof usage !== 'object') return 0;
  switch (providerId) {
    case 'gemini':
      return round6(geminiCost(usage, prices));
    case 'openai':
      return round6(openaiCost(usage, prices));
    case 'fashn':
      return round6(fashnCost(usage, prices));
    default:
      return 0;
  }
}

// Tokens típicos de uma prova (2 imagens de entrada + texto), para estimar antes de gerar.
const GEMINI_INPUT_TOKENS = 2600;
const GEMINI_OUTPUT_TOKENS = { 512: 747, '1K': 1120, '2K': 1680, '4K': 2520 };
const OPENAI_TEXT_IN = 300;
const OPENAI_IMAGE_IN = 2000;
const OPENAI_OUTPUT_TOKENS = { low: 400, medium: 1584, high: 6240 };

export function estimateCost(providerId, providerSettings = {}) {
  const prices = providerSettings.prices ?? {};
  switch (providerId) {
    case 'gemini': {
      const out = GEMINI_OUTPUT_TOKENS[providerSettings.imageSize] ?? GEMINI_OUTPUT_TOKENS['1K'];
      return computeCost('gemini', { promptTokenCount: GEMINI_INPUT_TOKENS, candidatesTokenCount: out }, prices);
    }
    case 'openai': {
      const out = OPENAI_OUTPUT_TOKENS[providerSettings.quality] ?? OPENAI_OUTPUT_TOKENS.medium;
      return computeCost(
        'openai',
        { output_tokens: out, input_tokens_details: { text_tokens: OPENAI_TEXT_IN, image_tokens: OPENAI_IMAGE_IN } },
        prices,
      );
    }
    case 'fashn':
      return computeCost('fashn', { credits: prices.creditsPerRun ?? 1 }, prices);
    default:
      return 0;
  }
}
