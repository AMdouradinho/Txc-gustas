# Custos do Provador Virtual

Valores de **novembro de 2026**, com o dólar a **R$ 5,20** (padrão do painel, que você pode mudar).
Os números saem das mesmas fórmulas do sistema (`src/pricing.js` e `public/js/simulate.js`).

> **Importante:** os preços das IAs mudam com frequência e vieram de páginas públicas (veja as fontes
> no fim). Confira na página oficial de cada fornecedor e, se mudar, atualize em
> **Painel → Configurações → Modelos e preços**. O sistema passa a usar o novo valor na hora.

## 1. Quanto custa cada prova

O sistema registra o **custo real de cada prova**, calculado com o uso que a própria IA informa
(tokens ou créditos). A tabela abaixo mostra o custo típico de uma prova (1 foto do cliente + 1 foto da
peça → 1 imagem gerada):

| IA (configuração) | Como cobra | US$ por prova | R$ por prova |
|---|---|---:|---:|
| **Gemini** `gemini-3.1-flash-image-preview`, 1K (padrão) | ~2.600 tokens de entrada × US$ 0,50/M + 1.120 tokens de imagem × US$ 60/M | **0,0685** | **0,36** |
| Gemini, 2K | 1.680 tokens de imagem | 0,1021 | 0,53 |
| **OpenAI** `gpt-image-2`, qualidade baixa | entrada (texto US$ 5/M, imagem US$ 8/M) + saída US$ 30/M | 0,0295 | 0,15 |
| OpenAI, qualidade média (padrão) | idem | **0,0650** | **0,34** |
| OpenAI, qualidade alta | idem | 0,2047 | 1,06 |
| **FASHN** `tryon-v1.6` | 1 crédito × US$ 0,075 | **0,0750** | **0,39** |
| Demo | não usa IA | 0 | 0 |

**Regras que reduzem o custo:**
- **Reaproveitamento.** A mesma foto com a mesma peça reaproveita o resultado e custa R$ 0.
- **Recusas.** Quando a IA recusa a foto, ela pode cobrar só a leitura. No Gemini isso dá cerca de
  US$ 0,0013 (menos de 1 centavo), e o sistema registra esse valor.
- **Limite por cliente.** São no máximo 5 provas por dia (configurável). No Gemini, cada cliente custa
  no máximo **R$ 1,78 por dia**.
- **Teto diário.** O padrão é US$ 5 por dia, o que limita o gasto com IA a **R$ 26 por dia (R$ 780 por
  mês)**, mesmo num pico de acessos. Quando o teto é atingido, o provador pausa até o dia seguinte.

## 2. Quanto custa por mês

Cenários sem reaproveitamento (o pior caso), com **R$ 40 por mês de custos fixos** (hospedagem +
domínio, ver item 3). Uma "prova" é uma imagem gerada:

| Provas por dia | Provas por mês | Gemini (IA + fixo) | OpenAI média (IA + fixo) | FASHN (IA + fixo) |
|---:|---:|---:|---:|---:|
| 10 | 300 | R$ 106,86 + 40 = **R$ 146,86** | R$ 101,43 + 40 = **R$ 141,43** | R$ 117,00 + 40 = **R$ 157,00** |
| 50 | 1.500 | R$ 534,30 + 40 = **R$ 574,30** | R$ 507,16 + 40 = **R$ 547,16** | R$ 585,00 + 40 = **R$ 625,00** |
| 200 | 6.000 | R$ 2.137,20 + 40 = **R$ 2.177,20** | R$ 2.028,62 + 40 = **R$ 2.068,62** | R$ 2.340,00 + 40 = **R$ 2.380,00** |

- **Volume alto e o teto diário.** Com o teto padrão de US$ 5 por dia, cabem cerca de **73 provas Gemini
  por dia**. Para 200 provas por dia, aumente o teto para uns **US$ 15** em Configurações.
- **Simulador.** O painel tem um simulador (aba **Custos**) com os seus números reais. Depois das
  primeiras provas, ele usa o custo médio real da sua loja no lugar da estimativa.

**Como ler isso no negócio:** com o Gemini, cada prova sai por ~R$ 0,36. Se 1 em cada 30 provas virar
uma venda de R$ 150, o custo de IA por venda é ~R$ 10,70, ou cerca de 7% do ticket. A aba **Custos**
mostra, por peça, quantas provas viraram clique no WhatsApp ou no link de compra.

## 3. Outros custos ("e etc.")

| Item | Valor aproximado | Observação |
|---|---|---|
| Hospedagem Railway (Hobby) | US$ 5/mês (~R$ 26) | Inclui US$ 5 de uso; volume cobrado à parte, centavos para este app |
| Hospedagem Render (Starter + disco 1 GB) | ~US$ 7,25/mês (~R$ 38) | |
| VPS no Brasil (1 GB RAM) | R$ 30–60/mês | Exige configurar HTTPS (ex.: Caddy) |
| Domínio `.com.br` | ~R$ 40/ano (~R$ 3,50/mês) | Opcional; dá para usar o endereço gratuito do Railway/Render |
| Armazenamento das fotos | desprezível | Fotos de clientes são apagadas em 24 h; as fotos das peças ocupam poucos MB |
| Chaves de API | sem mensalidade | Pague só o que usar (recarregue créditos ou cadastre cartão no fornecedor) |

O padrão de **R$ 40 por mês** de custo fixo no painel cobre hospedagem e domínio. Ajuste em
Configurações.

## 4. Qual IA escolher

1. **Comece pelo Gemini.** É o padrão recomendado: barato, entende bem fotos de modelo vestindo a peça
   (como as suas) e faz boné.
2. **Compare com as suas fotos.** Use **Painel → Comparar IAs** com 2 ou 3 fotos reais de clientes ou
   da equipe. Isso custa centavos.
3. **FASHN** costuma ser o mais fiel em camisetas e polos, mas não faz boné; nesses casos o sistema usa
   o Gemini automaticamente. Também é mais um fornecedor para gerenciar.
4. **OpenAI** na qualidade média tem custo parecido com o Gemini; a alta é 3× mais cara.

## Fontes dos preços (consultadas em out–nov/2026)

- Gemini (Nano Banana 2):
  - [Google Cloud: Gemini 3.1 Flash Image](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-image) (tokens por imagem)
  - [benchlm.ai](https://benchlm.ai/media-pricing/nano-banana)
  - [aifreeapi.com](https://www.aifreeapi.com/en/posts/nano-banana-2-pricing)
- OpenAI GPT Image 2:
  - [wavespeed.ai](https://wavespeed.ai/blog/posts/gpt-image-2-pricing-2026/)
  - [OpenRouter](https://openrouter.ai/openai/gpt-image-2)
  - [costgoat.com](https://costgoat.com/pricing/openai-images)
- FASHN:
  - [fashn.ai/products/api](https://fashn.ai/products/api)
  - [docs.fashn.ai](https://docs.fashn.ai/api-reference/tryon-v1-6)
- Dólar:
  - [Focus/BC via Canal Rural](https://www.canalrural.com.br/economia/focus-mantem-dolar-de-2026-em-r-520-e-ajusta-2027-para-r-528/) (expectativa de R$ 5,20 para o fim de 2026)
- Hospedagem:
  - [Railway: planos](https://docs.railway.com/pricing/plans)
  - [comparativo Railway × Render 2026](https://sota.io/blog/railway-vs-render-vs-fly-pricing-2026)
