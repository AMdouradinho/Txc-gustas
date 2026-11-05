# Provador Virtual TXC — Especificação

Data: 2026-11-05 · Status: aguardando revisão

## 1. Objetivo

O dono da loja cadastra peças de roupa num painel. O cliente abre o catálogo, escolhe uma
peça, envia uma foto sua e recebe uma imagem gerada por IA dele vestindo a peça. Depois
pode baixar a imagem, chamar a loja no WhatsApp ou abrir o link de compra. O sistema
registra o custo real de IA de cada prova e mostra totais, médias e uma projeção mensal.

**Sucesso significa:**
- O dono cadastra uma peça com fotos em menos de 2 minutos, sem ajuda técnica.
- O cliente vê o resultado em até ~30 s, no celular.
- Cada prova tem o custo registrado em US$ e R$, calculado com o uso devolvido pela API.
- O gasto nunca passa do teto diário configurado.

**Decisões do dono (05/11/2026):**
- Três provedores de IA (Gemini, OpenAI e FASHN), escolhidos no painel, mais um modo Demo.
- App próprio, hospedado de forma independente.
- Compra via WhatsApp + link.
- Limite de 5 provas por dia por cliente.

**Fora do escopo:** checkout/pagamento, contas de cliente, controle de estoque e vários
usuários no painel.

## 2. Arquitetura

- **Runtime:** Node.js ≥ 22.13, Express e `node:sqlite` (embutido, sem dependência nativa).
- **Upload:** `multer` (em memória, depois gravado em disco).
- **Front-end:** HTML, CSS e JS puros servidos como arquivos estáticos, sem etapa de build.
- **Persistência:** tudo fica em `DATA_DIR` (padrão `./data`).
  - `app.db`: banco SQLite.
  - `products/`: fotos das peças, permanentes.
  - `people/`: fotos de clientes, temporárias.
  - `results/`: imagens geradas, temporárias.
- **Deploy:** `Dockerfile` com volume em `/data`. Instruções no README para Railway,
  Render e VPS.

### 2.1 Estrutura de arquivos

```
server.js                 entrada: cria app, abre DB, semeia, sobe servidor e limpeza
src/config.js             variáveis de ambiente
src/db.js                 abertura do SQLite + schema
src/settings.js           configurações com valores padrão (tabela settings)
src/catalog.js            CRUD de peças e fotos
src/images.js             validação de imagem (magic bytes), gravação, nomes aleatórios
src/prompts.js            prompt por tipo de prova
src/pricing.js            fórmulas de custo por provedor
src/providers/index.js    registro, capacidade (tipos suportados) e fallback
src/providers/gemini.js
src/providers/openai.js
src/providers/fashn.js
src/providers/demo.js
src/tryon-service.js      limite, cache, teto, fila, execução e registro
src/stats.js              agregações do painel de custos
src/cleanup.js            retenção de fotos (LGPD)
src/auth.js               senha do painel, cookie assinado, limite de tentativas
src/routes/public.js
src/routes/admin.js
src/seed.js               semeia as 5 peças de exemplo se o banco estiver vazio
public/                   loja (index.html, peca.html, provador) + css/js
public/admin/             painel (index.html + js)
seed/images/              as 6 fotos enviadas pelo dono
test/                     node:test + supertest
```

## 3. Dados

```
products(id, slug UNIQUE, name, category, tryon_type, gender, price_cents NULL,
         sizes JSON, colors JSON, description, ai_notes, buy_url, active, sort,
         created_at, updated_at)

product_images(id, product_id → products ON DELETE CASCADE, filename,
               color NULL, is_tryon_ref, sort)

tryons(id TEXT uuid, kind 'customer'|'admin_test', product_id, image_id, color, size,
       provider, model, status 'pending'|'done'|'failed'|'blocked', error,
       client_id, ip_hash, cache_key, cache_hit, person_file, result_file,
       usage JSON, cost_usd REAL, latency_ms, created_at, finished_at)

events(id, type 'whatsapp'|'buy_link'|'download', product_id, tryon_id, created_at)

settings(key PRIMARY KEY, value JSON)
```

### 3.1 Categorias e tipos de prova

| Categoria | `tryon_type` |
|---|---|
| camiseta, polo, camisa, regata, moletom, jaqueta, baby look | `top` |
| calça, bermuda, short, saia | `bottom` |
| vestido, macacão | `full` |
| boné, chapéu | `headwear` |

O tipo vem da categoria, mas o dono pode trocar.

### 3.2 Fotos e cores

Cada foto da peça pode ter uma cor. Na prova, o sistema usa:
1. a foto da cor escolhida marcada como referência;
2. se não houver, a primeira foto daquela cor;
3. se não houver, a referência geral da peça.

Exemplo: a "Camiseta Águia Cowboy" tem as cores Verde Militar e Marrom, cada uma com a
sua foto.

## 4. Provedores de IA

Todos implementam a mesma interface:

```
tryOn({ person, garment, product, color, tryonType, aspect, settings })
  → { image: {buffer, mime}, usage, model }
```

O custo é calculado à parte por `pricing.cost(provider, usage, prices)`.

| Provedor | Chamada | Uso devolvido → custo |
|---|---|---|
| **Gemini** (padrão `gemini-3.1-flash-image-preview`, editável) | `POST generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`. Envia texto + 2 imagens inline; `responseModalities:["IMAGE"]`, `imageConfig:{aspectRatio, imageSize:"1K"}` | `usageMetadata`: entrada × US$ 0,50/M; tokens de imagem de saída × US$ 60/M; tokens de texto e raciocínio × US$ 3/M. Uma imagem 1K tem ~1.120 tokens, ≈ US$ 0,068 por prova |
| **OpenAI** (padrão `gpt-image-2`, qualidade `medium`) | `POST api.openai.com/v1/images/edits` (multipart, `image[]` = cliente + peça) | `usage`: texto de entrada × US$ 5/M; imagem de entrada × US$ 8/M; saída × US$ 30/M. Fica em ≈ US$ 0,05–0,25 conforme a qualidade |
| **FASHN** (padrão `tryon-v1.6`, modo `balanced`) | `POST api.fashn.ai/v1/run` com imagens base64 e `garment_photo_type:"auto"`; depois consulta `GET /v1/status/{id}` | 1 crédito × US$ 0,075 |
| **Demo** | Nenhuma chamada externa. Devolve um SVG com a foto do cliente e uma miniatura da peça, com a marca "DEMO" | US$ 0 |

- Todos os preços, modelos e a qualidade ficam editáveis no painel, porque os fornecedores
  mudam valores com frequência.
- Os valores padrão vêm de fontes públicas de out–nov/2026 e devem ser conferidos nas
  páginas oficiais.

**Capacidades e fallback:**
- FASHN não suporta `headwear`. Nesses casos o sistema usa o primeiro provedor com chave
  na ordem Gemini → OpenAI.
- Se nenhum servir, a prova falha com uma mensagem ao dono e ao cliente.

**Chaves:** ficam em variáveis de ambiente (`GEMINI_API_KEY`, `OPENAI_API_KEY`,
`FASHN_API_KEY`), nunca no banco. O painel mostra se cada chave existe e não deixa ativar
um provedor sem chave.

### 4.1 Prompt

O prompt é escrito em inglês, porque os modelos seguem instruções em inglês com mais
fidelidade.

- **Estrutura:** a IMAGEM 1 é o cliente; a IMAGEM 2 é a peça, possivelmente vestida por
  outro modelo, que deve ser ignorado.
- **Preservar:** rosto e identidade, cabelo, tom de pele, corpo, pose, fundo, luz,
  enquadramento e as demais roupas.
- **Reproduzir fielmente a peça:** cor, tecido, gola, botões, estampa ou bordado (posição,
  tamanho e cores).
- **Variações por tipo:**
  - `top`: troca só a parte de cima.
  - `bottom`: troca só a parte de baixo.
  - `full`: troca a roupa inteira.
  - `headwear`: coloca o boné/chapéu na cabeça.
- Inclui o nome da peça, a cor escolhida e os "detalhes para IA" cadastrados pelo dono.

## 5. Fluxo da prova

1. **No navegador:**
   - O cliente escolhe a cor e o tamanho e envia ou tira uma foto.
   - O navegador reduz a foto para no máximo 1280 px (JPEG 85%) e a guarda em
     `sessionStorage`, para reaproveitar em outras peças.
   - O envio exige aceite LGPD.
2. **Envio:** `POST /api/tryon` (multipart).
3. **Validação no servidor:**
   - O consentimento é obrigatório.
   - O tipo é JPEG, PNG ou WEBP, conferido pelos bytes do arquivo.
   - O arquivo tem no máximo 10 MB.
   - A peça está ativa.
4. **Cache:** a chave é `sha256(foto) + image_id + provedor + modelo`.
   - Se houver uma prova `done` com essa chave e o arquivo de resultado ainda existir, o
     sistema cria um registro com `cache_hit=1` e custo 0.
   - Esse registro não consome o limite do cliente.
5. **Limite do cliente:**
   - O cliente é identificado pelo cookie `pid` (uuid aleatório, 1 ano).
   - O limite é de 5 provas por dia por `pid` e 15 por dia por IP (hash), para evitar que
     alguém burle o limite apagando cookies.
   - Contam as provas `pending` ou `done` que não vieram do cache, no dia do fuso
     `America/Sao_Paulo`.
6. **Teto diário:** se o custo de hoje mais as provas pendentes (estimadas pelo preço de
   tabela) chegar ao teto (padrão US$ 5), o sistema responde 503 com a mensagem "Provador
   indisponível hoje".
   - As provas do dono (`admin_test`) não são bloqueadas pelo teto, mas entram na soma.
7. **Execução em segundo plano:**
   - O servidor cria a prova `pending` e responde com o `id` (202).
   - A fila roda dentro do próprio processo, com no máximo 3 provas simultâneas e tempo
     limite de 120 s.
8. **Acompanhamento:** o cliente consulta `GET /api/tryon/:id` a cada 2 s.
   - Se a prova terminar como `done`, recebe o `resultUrl`.
   - Se terminar como `failed`, recebe uma mensagem amigável. Uma prova que falha não conta
     no limite.
9. **Resultado:** a tela mostra o antes/depois com os botões Baixar, WhatsApp e Comprar.
   - Cada clique é registrado em `events`.
   - A mensagem do WhatsApp segue o modelo: "Olá! Experimentei a {peça} na cor {cor},
     tamanho {tam}, no provador virtual e quero comprar. {link da peça}".
10. **Reinício do servidor:** as provas `pending` órfãs viram `failed`.

## 6. Painel (`/admin`)

**Acesso:**
- A senha vem de `ADMIN_PASSWORD`.
- A sessão é um cookie `httpOnly` assinado com HMAC (`SESSION_SECRET`) e dura 7 dias.
- Há um limite de 5 tentativas de login a cada 15 min por IP.

**Abas:**
1. **Peças:** lista com miniatura, status e quantidade de provas.
   - O formulário tem nome, categoria (que define o tipo de prova, editável), gênero, preço
     opcional, tamanhos, cores, link de compra, descrição, detalhes para IA e ativo/inativo.
   - Fotos: envio múltiplo, cor por foto, marcação da referência, ordenação e exclusão.
2. **Comparar IAs:** o dono envia uma foto, escolhe a peça e a cor e marca os provedores.
   - O resultado mostra as imagens lado a lado, com custo e tempo de cada.
   - Essas provas ficam registradas como `admin_test`.
3. **Custos:**
   - Cartões: hoje e mês (US$ e R$), número de provas, custo médio por prova, economia do
     cache (provas reaproveitadas × custo médio) e taxa de falha.
   - Tabelas por provedor e por peça, com provas, custo e cliques WhatsApp/link.
   - Lista das últimas 50 provas.
   - **Simulador:** recebe clientes/dia, provas por cliente, taxa de cache e custos fixos
     mensais em R$ e mostra o custo mensal de cada provedor.
4. **Configurações:**
   - Loja: nome, WhatsApp (DDI+DDD+número) e link da loja.
   - IA: provedor ativo; para cada provedor, modelo, parâmetros e preços; status da chave.
   - Limites: cotação US$→R$ (padrão 5,20), provas por cliente/dia (5), teto diário em
     US$ (5,00), custos fixos mensais em R$ (40) e retenção de fotos em horas (24).

## 7. Rotas

**Públicas:**
- `GET /api/store`
- `GET /api/products`
- `GET /api/products/:slug`
- `POST /api/tryon`
- `GET /api/tryon/:id`
- `POST /api/events`
- Estáticos: `/media/products/*` e `/media/results/*`. Os nomes dos arquivos são aleatórios
  (128 bits).
- `/media/people` não é exposto.

**Painel** (exigem sessão):
- Sessão: `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`.
- Peças: `GET|POST /api/admin/products`, `GET|PUT|DELETE /api/admin/products/:id`.
- Fotos: `POST /api/admin/products/:id/images`, `PATCH|DELETE /api/admin/images/:id`.
- Configurações: `GET|PUT /api/admin/settings`.
- Comparar IAs: `POST /api/admin/compare`.
- Custos: `GET /api/admin/stats?period=today|7d|30d|month`.
- Histórico: `GET /api/admin/tryons`.

## 8. Erros

Todas as respostas de erro têm o formato `{error: "mensagem em português"}`. A tabela
mostra o que cada lado vê.

| Situação | Cliente vê | Dono vê |
|---|---|---|
| Foto inválida ou grande | "Envie uma foto JPG/PNG de até 10 MB" | — |
| Limite atingido (429) | "Você já usou as 5 provas de hoje. Volte amanhã!" | contagem no painel |
| Teto diário (503) | "Provador indisponível hoje" | alerta no painel |
| IA recusou ou não gerou imagem | "Não conseguimos gerar. Use uma foto de frente, com boa luz e só você." | erro bruto no histórico |
| Chave inválida, modelo inexistente ou timeout | "Provador com instabilidade, tente de novo" | erro bruto e sugestão (ex.: "confira o ID do modelo") |

## 9. Privacidade (LGPD)

- O consentimento é explícito e o texto explica o uso e o prazo de exclusão.
- A cada hora, o sistema apaga os arquivos de `people/` e `results/` mais antigos que a
  retenção configurada.
- O registro da prova (custo e uso) permanece, sem imagem.
- As fotos de clientes nunca aparecem em URL pública.

## 10. Dados iniciais

As 6 fotos do dono viram 5 peças, sem preço, que o dono preenche depois.

| Peça | Categoria | Gênero | Cor(es) |
|---|---|---|---|
| Camisa Polo Piquet Café | polo | masculino | Café |
| Camiseta Águia Off-Road | camiseta | masculino | Verde Militar |
| Camiseta Águia Cowboy | camiseta | masculino | Verde Militar, Marrom |
| Boné Jeans Águia TXC | boné | unissex | Jeans Claro |
| Baby Look Bordado Águia | baby look | feminino | Azul Marinho |

## 11. Testes

`node --test` com supertest e `fetch` simulado. Os casos cobertos:

- **Custo:** fórmulas de cada provedor a partir de respostas de exemplo das APIs.
- **Provedores:** corpo da requisição (modelo, imagens, parâmetros), leitura da imagem e do
  uso, tradução de erros e polling do FASHN.
- **Roteamento:** fallback de `headwear` no FASHN e bloqueio de provedor sem chave.
- **Serviço de prova:** cache, limite por `pid` e por IP, teto diário, falha que não conta
  no limite e recuperação de pendentes órfãs.
- **Rotas:** autenticação, CRUD de peças e fotos, validação de upload, eventos e estatísticas.
- **Limpeza:** apaga os arquivos expirados e mantém os registros.
- **Ponta a ponta:** fluxo completo no modo Demo e capturas de tela com Playwright
  (catálogo, peça, provador e painel) no celular e no desktop.

**Limitação conhecida:** neste ambiente não há chaves de API, e OpenAI e FASHN estão fora
da rede permitida. A integração real é validada pelo dono na primeira prova com chave. Para
isso, a aba "Comparar IAs" é o teste recomendado.
