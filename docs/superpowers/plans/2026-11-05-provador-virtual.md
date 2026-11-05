# Provador Virtual TXC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web app where the store owner registers garments and customers upload a photo to see themselves wearing a garment through AI (Gemini, OpenAI or FASHN). Every try-on records its real AI cost.

**Architecture:** Express server on Node 22 with built-in `node:sqlite`. Product photos and temporary customer images live under `DATA_DIR`. Providers sit behind one `tryOn()` interface. An in-process job queue runs try-ons and the browser polls for status. The store and the admin panel are plain HTML/CSS/ES-module JS, with no build step.

**Tech Stack:** Node ≥ 22.13 (ESM, `node:sqlite`, `node:test`), express@5, multer@2, supertest (dev). Playwright (pre-installed) for a manual smoke script.

**Spec:** `docs/superpowers/specs/2026-11-05-provador-virtual-design.md`

## Global Constraints

- `"type": "module"`, `"engines": {"node": ">=22.13"}`; runtime deps: `express`, `multer` only.
- Start script: `node --disable-warning=ExperimentalWarning server.js`; test script: `node --disable-warning=ExperimentalWarning --test test/`.
- User-facing text is pt-BR. AI prompts are English.
- JSON errors are always `{ "error": "<mensagem pt-BR>" }`.
- Timezone for "today"/"month": `America/Sao_Paulo`.
- API keys only from env: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `FASHN_API_KEY`. Other env vars: `PORT` (3000), `DATA_DIR` (`./data`), `ADMIN_PASSWORD` (required; dev default `admin` with a console warning), `SESSION_SECRET` (random per boot if absent, with a warning).
- Stored filenames: 32 random hex chars (128 bits) + extension.
- Defaults (verbatim from spec):
  - gemini: model `gemini-3.1-flash-image-preview`, `imageSize` `1K`, prices input 0.50 / image out 60 / text out 3 (US$ per 1M tokens).
  - openai: model `gpt-image-2`, quality `medium`, prices text in 5 / image in 8 / out 30 (US$ per 1M tokens).
  - fashn: model `tryon-v1.6`, mode `balanced`, US$ 0.075 per credit, 1 credit per run.
  - limits: 5 per client/day, 15 per IP/day, daily budget US$ 5, retention 24 h.
  - money: US$→R$ 5.20, fixed monthly R$ 40.
  - queue: concurrency 3, timeout 120 s.
  - upload max 10 MB; client resize max 1280 px, JPEG 0.85.

## Review Focus

1. **Double-tap "Gerar" with one try-on left.** Two simultaneous submits must yield one 202 and one 429. Check and insert run synchronously with no `await` between them. Test in Task 5.
2. **Product or color without any photo.** Submit returns 400 "Esta peça ainda não tem foto para prova", and the product page hides the button. Tests in Tasks 2 and 5.
3. **Owner deletes a product that has try-on history.** Cost totals stay intact and stats show "Peça removida". `tryons.product_id` has no FK. Test in Task 7.
4. **WhatsApp typed as `(11) 99999-9999`.** Normalize to digits and prepend `55` when there are 10–11 digits. Test in Task 1.
5. **Owner types `0,075` or `-1` in a price field.** Comma decimals are accepted; negatives and non-numbers give 400 with the field name. Test in Task 1.

---

### Task 1: Project scaffold, config, database, settings

**Files:**
- Create: `package.json`, `.gitignore` (`node_modules/`, `data/`, `.env`), `.env.example`, `src/config.js`, `src/db.js`, `src/settings.js`, `src/time.js`
- Test: `test/settings.test.js`, `test/time.test.js`

**Interfaces:**
- Produces:
  - `loadConfig(env = process.env) → { port, dataDir, adminPassword, sessionSecret, keys: {gemini, openai, fashn}, timeZone: 'America/Sao_Paulo' }`
  - `openDb(file: string | ':memory:') → DatabaseSync`, with WAL, `foreign_keys=ON` and the spec §3 schema applied idempotently. JSON columns are TEXT.
  - `nowIso(date = new Date()) → string`
  - `startOfDayUtc(date: Date, timeZone) → string`
  - `startOfMonthUtc(date: Date, timeZone) → string`
  - `DEFAULT_SETTINGS`, with shape `{ store:{name:'TXC', whatsapp:'', storeUrl:''}, activeProvider:'demo', providers:{gemini:{model,imageSize,prices:{inputPerM,outputImagePerM,outputTextPerM}}, openai:{model,quality,prices:{textInputPerM,imageInputPerM,outputPerM}}, fashn:{model,mode,prices:{perCredit,creditsPerRun}}, demo:{model:'demo',prices:{}}}, limits:{perClientPerDay,perIpPerDay,dailyBudgetUsd,retentionHours}, money:{usdToBrl,fixedMonthlyBrl} }`
  - `getSettings(db) → settings`: defaults deep-merged with stored values.
  - `updateSettings(db, patch, {keys}) → settings`: validates, persists and throws `ValidationError`.
  - `class ValidationError extends Error { status = 400 }`, exported from `src/settings.js` and reused by later tasks.

- [ ] **Step 1: Write failing tests.**
  - `startOfDayUtc(new Date('2026-11-05T02:00:00Z'), 'America/Sao_Paulo') === '2026-11-04T03:00:00.000Z'`
  - `startOfMonthUtc(new Date('2026-11-05T12:00:00Z'), 'America/Sao_Paulo') === '2026-11-01T03:00:00.000Z'`
  - `getSettings(openDb(':memory:'))` deep-equals `DEFAULT_SETTINGS`.
  - `updateSettings(db, {store:{whatsapp:'(11) 99999-9999'}}).store.whatsapp === '5511999999999'`; `'+55 11 99999-9999'` also gives `'5511999999999'`.
  - `updateSettings(db, {providers:{fashn:{prices:{perCredit:'0,075'}}}})` stores `0.075`.
  - `perCredit: -1` and `usdToBrl: 'abc'` throw `ValidationError` whose message names the field.
  - `activeProvider:'gemini'` with `{keys:{gemini:''}}` throws `'Provedor gemini sem chave de API configurada'`; `activeProvider:'demo'` is always allowed.
  - `limits.perClientPerDay` must be an integer ≥ 1.
- [ ] **Step 2:** Run `npm test` and expect FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - Install the deps.
  - `startOfDayUtc` uses `Intl.DateTimeFormat(...).formatToParts` to get local Y-M-D and offset. Handle zones without DST generically by computing the offset at that instant.
  - Settings are stored as a single row: `key='app'`, `value=JSON`.
- [ ] **Step 4:** Run `npm test` and expect PASS.
- [ ] **Step 5:** Commit `feat: scaffold, banco e configurações`.

### Task 2: Image storage and catalog

**Files:**
- Create: `src/images.js`, `src/catalog.js`
- Test: `test/catalog.test.js`

**Interfaces:**
- Consumes: `openDb`, `ValidationError`, `nowIso`.
- Produces (`src/images.js`):
  - `MAX_UPLOAD_BYTES = 10*1024*1024`
  - `detectImageType(buf) → 'image/jpeg'|'image/png'|'image/webp'|null`, by magic bytes.
  - `saveImage(dir, buf, mime) → filename`
  - `readImage(dir, filename) → {buffer, mime}`
  - `removeFile(dir, filename)`: ignores ENOENT.
- Produces (`src/catalog.js`):
  - `CATEGORIES`: category → tryonType, exactly per spec §3.1.
  - `GENDERS = ['masculino','feminino','unissex']`
  - `TRYON_TYPES = ['top','bottom','full','headwear']`
  - `slugify(name) → string`, unique-ified with `-2`, `-3` and so on.
  - `createProduct(db, input) → Product`
  - `updateProduct(db, id, input) → Product`
  - `deleteProduct(db, id, productsDir)`
  - `getProduct(db, id) → Product|null`
  - `getProductBySlug(db, slug, {activeOnly}) → Product|null`
  - `listProducts(db, {activeOnly, category}) → Product[]`, ordered by `sort, id`.
  - `addImage(db, productId, filename, {color}) → Image`
  - `updateImage(db, imageId, {color, isTryonRef, sort}) → Image`
  - `deleteImage(db, imageId, productsDir)`
  - `pickGarmentImage(product, color) → Image|null`
  - `Product = {id, slug, name, category, tryonType, gender, priceCents, sizes[], colors[], description, aiNotes, buyUrl, active, sort, images: Image[], createdAt, updatedAt}`
  - `Image = {id, productId, filename, url:'/media/products/<filename>', color, isTryonRef, sort}`

- [ ] **Step 1: Write failing tests.**
  - `detectImageType` recognizes JPEG `FF D8 FF`, PNG `89 50 4E 47`, and WEBP `RIFF....WEBP`; it returns null for `GIF89a` and for text.
  - `saveImage` returns a name matching `/^[0-9a-f]{32}\.(jpg|png|webp)$/`.
  - `createProduct({name:'Camiseta Águia Cowboy', category:'camiseta', gender:'masculino'})` gives `slug==='camiseta-aguia-cowboy'` and `tryonType==='top'`. An explicit `tryonType` overrides it.
  - A missing name, an unknown category, and `buyUrl:'javascript:x'` each throw `ValidationError`.
  - `updateImage(..., {isTryonRef:true})` clears `isTryonRef` on the other images of the same product and color.
  - `pickGarmentImage` follows spec §3.2 in order: ref of that color → first of that color → product ref → first image. A product with no images returns `null`.
  - `deleteProduct` removes the image files from disk.
- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement. `slugify` strips accents via `normalize('NFD')`.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit `feat: catálogo de peças e fotos`.

### Task 3: Cost formulas

**Files:**
- Create: `src/pricing.js`, `public/js/simulate.js` (pure ES module shared with the browser)
- Test: `test/pricing.test.js`

**Interfaces:**
- Produces:
  - `computeCost(providerId, usage, prices) → number`: US$, rounded to 6 decimals.
  - `estimateCost(providerId, providerSettings) → number`
  - `simulateMonthly({clientsPerDay, triesPerClient, cacheRate, costPerTryUsd, usdToBrl, fixedMonthlyBrl}) → {tryonsPerMonth, paidTryons, aiUsd, aiBrl, totalBrl}`: 30 days per month, `paidTryons = round(tryonsPerMonth*(1-cacheRate))`.

- [ ] **Step 1: Write failing tests (default prices).**
  - **gemini:** `{promptTokenCount:2600, candidatesTokenCount:1120, candidatesTokensDetails:[{modality:'IMAGE',tokenCount:1120}]}` gives `0.0685`. Adding `thoughtsTokenCount:200` gives `0.0691`. Without `candidatesTokensDetails`, all candidates count as image.
  - **openai:** `{input_tokens:2300, output_tokens:1584, input_tokens_details:{text_tokens:300, image_tokens:2000}}` gives `0.06502`.
  - **fashn:** `{credits:1}` gives `0.075`.
  - **demo:** anything gives `0`.
  - **Estimates:**
    - `estimateCost('gemini', defaults)` is `0.0685`, assuming 2600 in and 1120 image out.
    - `estimateCost('openai', {quality:'medium', …})` is `0.06502`, from an output-token table `{low:400, medium:1584, high:6240}` plus 300 text and 2000 image input tokens.
    - `estimateCost('fashn', …)` is `0.075`.
  - **Simulator:** `simulateMonthly({clientsPerDay:20, triesPerClient:3, cacheRate:0.1, costPerTryUsd:0.0685, usdToBrl:5.2, fixedMonthlyBrl:40})` gives `tryonsPerMonth 1800`, `paidTryons 1620`, `aiUsd 110.97`, `aiBrl 577.04` and `totalBrl 617.04` (money rounded to 2 decimals).
- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit `feat: cálculo de custo e simulador`.

### Task 4: Prompts and AI providers

**Files:**
- Create: `src/prompts.js`, `src/providers/errors.js`, `src/providers/demo.js`, `src/providers/gemini.js`, `src/providers/openai.js`, `src/providers/fashn.js`, `src/providers/index.js`
- Test: `test/providers.test.js`, using a stub `fetch(url, init)` that records calls and returns canned `Response` objects.

**Interfaces:**
- Consumes: `pickGarmentImage`, settings shape.
- Produces:
  - `buildPrompt({product, color, tryonType}) → string`
  - `class ProviderError extends Error { kind: 'refused'|'auth'|'config'|'timeout'|'upstream'; raw }`
  - Each provider module default-exports `{ id, label, supports: string[], tryOn(input, ctx) }`.
    - `input = { person:{buffer,mime}, garment:{buffer,mime}, product, color, tryonType, aspect:{width,height}, prompt }`
    - `ctx = { apiKey, config, fetch, signal, pollMs }`
    - It returns `{ image:{buffer,mime}, usage, model }`.
  - `PROVIDERS` (id → module)
  - `providerStatus(keys) → {gemini:{label,hasKey}, openai:…, fashn:…, demo:{hasKey:true}}`
  - `resolveProvider(activeId, keys, tryonType) → id`

- [ ] **Step 1: Write failing tests.**
  - **Prompt:**
    - The text contains `IMAGE 1`, `IMAGE 2`, the product name, the color and `aiNotes`.
    - `top` mentions `upper-body`, `bottom` mentions `lower-body`, `full` mentions `entire outfit`, and `headwear` mentions `on the customer's head`.
    - All variants contain `ignore` (the model in the product photo).
  - **gemini:**
    - POSTs to `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent` with header `x-goog-api-key`.
    - The body has `contents[0].parts` = `[text, inline_data person, inline_data garment]`, `generationConfig.responseModalities` = `['IMAGE']`, and `imageConfig` = `{aspectRatio:'3:4', imageSize:'1K'}` for a 960×1280 aspect.
    - It returns the decoded `inlineData` image and `usage` = `usageMetadata`.
    - A response with only text throws `kind 'refused'`. HTTP 401/403 → `'auth'`; 404 → `'config'`, with the message mentioning "ID do modelo"; 429/5xx → `'upstream'`.
  - **openai:**
    - POSTs a multipart body to `https://api.openai.com/v1/images/edits` with two `image[]` parts, `model gpt-image-2`, `quality medium` and `size 1024x1536` for a portrait aspect.
    - `input_fidelity` is absent for `gpt-image-2` and is `high` for `gpt-image-1.5`.
    - It decodes `data[0].b64_json` and returns `usage`.
  - **fashn:**
    - POSTs to `https://api.fashn.ai/v1/run` with `{model_name:'tryon-v1.6', inputs:{model_image:'data:image/jpeg;base64,…', garment_image:…, category:'tops', garment_photo_type:'auto', mode:'balanced', output_format:'jpeg', return_base64:true}}`.
    - It polls `GET /v1/status/{id}` (with `pollMs:0` in tests) until `completed`, then decodes `output[0]` whether it is a data URL or an http URL (the URL is fetched).
    - `status:'failed'` throws `'upstream'`. Usage is `{credits:1}`.
  - **demo:** returns `image/svg+xml` containing `DEMO`, with `usage {}`.
  - **resolveProvider:**
    - `('fashn', {fashn:'k', gemini:'k'}, 'headwear') === 'gemini'`
    - `('fashn', {fashn:'k', openai:'k'}, 'headwear') === 'openai'`
    - `('fashn', {fashn:'k'}, 'headwear')` throws `'config'`.
    - `('gemini', {}, 'top')` throws `'config'`.
    - `('demo', {}, 'headwear') === 'demo'`
- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement.
  - Gemini aspect = the closest of `1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9`.
  - OpenAI size: portrait if h > 1.1w, landscape if w > 1.1h, else square.
  - FASHN category map: top → `tops`, bottom → `bottoms`, full → `one-pieces`.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit `feat: provedores de IA (Gemini, OpenAI, FASHN, Demo)`.

### Task 5: Try-on service (limits, cache, budget, queue)

**Files:**
- Create: `src/tryon-service.js`
- Test: `test/tryon-service.test.js`, using the demo provider plus a fake provider injected via `providers` for timing and failure.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `createTryonService({db, config, dirs:{products,people,results}, fetch, providers = PROVIDERS, now = () => new Date(), concurrency = 3, timeoutMs = 120000})` returns:
    - `submit(params) → {id, status, cacheHit}`, which is synchronous up to the insert. `params = {kind, productId, color, size, personBuffer, aspect, clientId, ip, providerId?}`; `providerId` is used for admin compare only.
    - `get(id) → TryonView | null`
    - `remaining(clientId, ip) → number`
    - `recoverOrphans() → number`
    - `idle() → Promise<void>`, which resolves when the queue is empty (for tests).
  - `TryonView = {id, kind, status, resultUrl, error, productId, color, size, provider, model, costUsd, cacheHit, latencyMs, createdAt}`
  - `class TryonError extends Error { status }`
  - `FRIENDLY_ERRORS` holds the pt-BR copy from spec §8.

- [ ] **Step 1: Write failing tests.**
  - **Happy path:** demo submit → `pending`; after `idle()` it is `done` with `resultUrl` `/media/results/<hex>.svg` and `costUsd 0`.
  - **Cache:** the same bytes, image and provider again give `cacheHit:true` immediately with `status:'done'`, the same `resultUrl` and cost 0. It does not reduce `remaining`.
  - **Limits:**
    - After 5 non-cached submits for the same `clientId`, the 6th throws `TryonError` with status 429 and message `'Você já usou as 5 provas de hoje. Volte amanhã!'`.
    - 15 per IP across different clientIds; the 16th gives 429.
    - Double-tap: with `perClientPerDay:1`, two back-to-back `submit` calls without awaiting give one success and one 429.
  - **Failures:**
    - A failed try-on does not count toward the limit, and its view `error` is the friendly copy, not the raw text.
    - A provider that never resolves fails with `kind timeout` after `timeoutMs` (use 50 ms in the test).
  - **Budget:**
    - With `dailyBudgetUsd:0.10`, gemini active and a fake gemini provider costing 0.0685: the 1st submit is ok; the 2nd throws 503 `'Provador indisponível hoje'`, because pending estimates are counted.
    - `kind:'admin_test'` is never blocked by the budget.
  - **Validation:**
    - Product without photos → 400 `'Esta peça ainda não tem foto para prova'`.
    - Inactive or missing product → 404.
    - A non-image buffer → 400 `'Envie uma foto JPG/PNG de até 10 MB'`.
  - **Concurrency and recovery:**
    - 5 slow jobs with `concurrency:3` never have more than 3 running at once.
    - `recoverOrphans()` marks `pending` rows `failed`.
  - **Cost recording:** the fake provider's usage is stored and `cost_usd` equals `computeCost` of it.
- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement.
  - **Ordering:** submit runs validate → hash → cache lookup → limit/budget counts → insert, all synchronously. Then it enqueues.
  - **Hashing:** the person is stored in `people/`; the IP is stored as `sha256(ip + sessionSecret)`.
  - **Worker:** reads the files, builds the prompt, calls the provider with an `AbortController` timeout, saves the result, computes the cost and updates the row.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit `feat: serviço de prova com limite, cache e teto`.

### Task 6: HTTP layer (auth, public and admin routes)

**Files:**
- Create: `src/auth.js`, `src/http.js` (`parseCookies`, `asyncHandler`, error middleware), `src/app.js`, `src/routes/public.js`, `src/routes/admin.js`, `server.js`
- Test: `test/routes.test.js` (supertest on `createApp` with a `:memory:` DB and a temp `DATA_DIR`)

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `createAuth({password, secret, now}) → {login(password, ip) → token, verify(token) → boolean, requireAdmin}`
    - Token: `<expiryMs>.<hmacSha256Base64url>`, valid for 7 days, compared with `timingSafeEqual`.
    - Login is limited to 5 failures per 15 min per IP, then 429.
  - `createApp({db, config, service, dirs, fetch}) → express.Application`, implementing all routes in spec §7.
    - Cookies: `pid` (uuid, 1 year, `httpOnly`, `sameSite=lax`) and `adm` (`httpOnly`, `sameSite=strict`). Both are `secure` when `NODE_ENV=production`.
    - `/media/products` and `/media/results` are static; `people/` is never served.
    - `POST /api/tryon` returns 202 `{id, status, cacheHit, remaining}`, and needs `consent=true` (otherwise 400 `'É preciso aceitar o termo de uso da foto'`).
    - `GET /api/tryon/:id` returns the view plus `remaining`, but only for the same `pid`; otherwise 404.
    - `GET /api/store` returns `{name, whatsapp, storeUrl, limitPerDay, remaining, tryonEnabled}`.
    - `POST /api/admin/compare` takes `providers[]` and returns `{ids}`; `GET /api/admin/tryon/:id` returns any try-on.
  - `server.js` wires config → db → `seedIfEmpty` → service.`recoverOrphans` → `startCleanup` → `listen`.

- [ ] **Step 1: Write failing tests.**
  - **Auth:** `/api/admin/*` without a cookie → 401. A wrong password 6 times → the 6th is 429. The right password sets `adm`, and `GET /api/admin/me` → 200.
  - **Products:**
    - The admin CRUD round-trip (`POST`/`PUT`/`DELETE`) works.
    - An image upload with a `.txt` renamed `.jpg` → 400.
    - The public `GET /api/products` omits inactive products.
  - **Settings:** `PUT /api/admin/settings` with `{activeProvider:'openai'}` and no key → 400; the `GET` includes `providerStatus`.
  - **Try-on:**
    - Without consent → 400.
    - With consent, a full demo flow: `POST /api/tryon` → 202, poll → done, and the `resultUrl` serves 200.
    - Another client's `pid` polling the same id → 404.
  - **Events:** `POST /api/events {type:'whatsapp', productId}` → 204; an unknown type → 400.
- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement. Multer uses memory storage with `limits.fileSize = MAX_UPLOAD_BYTES`; `LIMIT_FILE_SIZE` maps to the 400 copy.
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit `feat: rotas públicas e do painel`.

### Task 7: Stats, cleanup, seed

**Files:**
- Create: `src/stats.js`, `src/cleanup.js`, `src/seed.js`, `seed/images/*.jpg` (the 6 uploaded photos)
- Test: `test/stats.test.js`, `test/cleanup.test.js`, `test/seed.test.js`

**Interfaces:**
- Produces:
  - `getStats(db, settings, {period:'today'|'7d'|'30d'|'month', now, timeZone})` returns:
    - `totals: {tryons, done, failed, cacheHits, costUsd, costBrl, avgCostUsd, cacheSavingsUsd, failureRate}` (with `avgCostUsd` over paid `done` rows only)
    - `today: {tryons, costUsd, costBrl}` and `month: {tryons, costUsd, costBrl}`
    - `byProvider: [{provider, tryons, costUsd, avgCostUsd, avgLatencyMs}]`
    - `byProduct: [{productId, name, tryons, costUsd, whatsapp, buyLink, downloads}]`
    - `estimates: {gemini, openai, fashn}`
    - `budget: {dailyBudgetUsd, spentTodayUsd}`
  - `listTryons(db, {limit=50}) → TryonView[]`, including the product name.
  - `cleanupExpired({db, dirs, retentionHours, now}) → {deleted}` and `startCleanup(opts) → stop()`, hourly plus once at start.
  - `seedIfEmpty(db, {seedDir, productsDir}) → number`, creating the 5 products from spec §10 with photos copied and colors assigned. The cowboy tee gets 2 images, Verde Militar and Marrom.
    - Each image is marked as the try-on reference.
    - `aiNotes` describe the visible print or embroidery, e.g. "Bordado pequeno de águia com jaqueta vermelha no peito esquerdo".

- [ ] **Step 1: Write failing tests.**
  - **Stats:**
    - Fixture rows: 3 done at 0.0685 gemini, 1 cache hit, 1 failed, 1 whatsapp event.
    - Expected: `costUsd 0.2055`, `avgCostUsd 0.0685`, `cacheSavingsUsd 0.0685`, `failureRate 0.2` (1 failed out of 5) and `costBrl 1.07` at 5.2.
    - After `deleteProduct`, the totals are unchanged and `byProduct` shows `name:'Peça removida'`.
  - **Cleanup:** a row 25 h old has its files deleted and `person_file`/`result_file` set to NULL while the row remains; a 1 h old row is untouched.
  - **Seed:** an empty DB gets 5 products, the cowboy tee has `colors ['Verde Militar','Marrom']`, and a second call returns 0.
- [ ] **Step 2:** Run the tests and expect FAIL.
- [ ] **Step 3:** Implement. Copy the uploads to `seed/images/`:
  - `polo-cafe.jpg`
  - `camiseta-offroad-verde.jpg`
  - `camiseta-cowboy-verde.jpg`
  - `camiseta-cowboy-marrom.jpg`
  - `bone-jeans.jpg`
  - `babylook-marinho.jpg`
- [ ] **Step 4:** Run the tests and expect PASS.
- [ ] **Step 5:** Commit `feat: estatísticas de custo, limpeza LGPD e peças iniciais`.

### Task 8: Storefront UI

**Files:**
- Create: `public/index.html`, `public/peca.html`, `public/css/store.css`, `public/js/api.js`, `public/js/catalog.js`, `public/js/product.js`, `public/js/tryon.js`
- Create: `test/e2e/smoke.mjs` (manual; not in `npm test`)

**Interfaces:**
- Consumes: the public routes (Task 6).
- Produces: `resizeImage(file, maxSide=1280, quality=0.85) → Promise<{blob, width, height, dataUrl}>`, exported from `public/js/tryon.js`.

- [ ] **Step 1: Catalog.** Category filter chips, product cards (photo, name, price or "Consulte") and the store name. It is mobile-first in earthy tones (café, verde militar, jeans).
- [ ] **Step 2: Product page.**
  - Gallery filtered by the chosen color, color and size pickers, and the "Experimentar em mim" button.
  - The button is hidden if `pickGarmentImage` would return null for the color; the client mirrors this rule with the image list.
- [ ] **Step 3: Try-on sheet.**
  - Photo tips, then `<input type=file accept="image/*" capture="user">` plus gallery upload, then the LGPD checkbox with the spec §9 copy.
  - Resize → submit → progress animation with polling every 2 s.
  - Result shown with a before/after slider, plus Baixar, WhatsApp (`https://wa.me/<num>?text=<spec copy>`), Comprar and "Experimentar outra peça".
  - Each action posts `/api/events`. The photo is kept in `sessionStorage`, and the remaining try-ons are shown.
  - Error copy comes from the API.
- [ ] **Step 4: Smoke script.** `test/e2e/smoke.mjs` starts the server on a temp `DATA_DIR` in demo mode, runs catalog → product → try-on with a fixture photo → result, and writes screenshots at 390×844 and 1280×800.
  - Run: `node test/e2e/smoke.mjs`. Expected: `SMOKE OK` and the PNGs exist.
- [ ] **Step 5:** Commit `feat: loja e provador virtual`.

### Task 9: Admin UI

**Files:**
- Create: `public/admin/index.html`, `public/admin/admin.css`, `public/admin/admin.js`
- Modify: `test/e2e/smoke.mjs` (adds the admin flow)

**Interfaces:**
- Consumes: the admin routes (Task 6) and `simulateMonthly` (Task 3, imported from `/js/simulate.js`).

- [ ] **Step 1: Login screen.**
- [ ] **Step 2: "Peças" tab.**
  - List and form: the category select sets the try-on type.
  - Sizes and colors are chip inputs.
  - Photo grid with a color select, ★ reference, ←/→ order and delete.
  - Uploads are resized client-side to a max of 1600 px.
- [ ] **Step 3: "Comparar IAs" tab.** Photo, product and color, with provider checkboxes (disabled without a key). Result cards show the image, US$/R$ cost and time.
- [ ] **Step 4: "Custos" tab.** Period selector, cards, provider and product tables, the last 50 try-ons, and the simulator (inputs prefilled with the actual average cost or the estimate).
- [ ] **Step 5: "Configurações" tab.** Store, active provider with key status, per-provider model/params/prices, limits and money.
- [ ] **Step 6: Smoke test.**
  - Extend `smoke.mjs`: login → create a product with a photo → compare (demo) → costs tab shows ≥ 1 try-on.
  - Screenshots of each tab. Run it and expect `SMOKE OK`.
- [ ] **Step 7:** Commit `feat: painel do dono`.

### Task 10: Deploy, docs and cost report

**Files:**
- Create: `Dockerfile` (`node:22-alpine`, `npm ci --omit=dev`, `VOLUME /data`, `ENV DATA_DIR=/data`), `.dockerignore`, `docs/CUSTOS.md`
- Modify: `README.md`

- [ ] **Step 1: README (pt-BR).**
  - What it is, running locally (`cp .env.example .env`, `npm install`, `npm start`), where to get each API key, and deploying on Railway/Render/VPS with a volume.
  - The first test via "Comparar IAs", backup of `data/`, and how to update the prices.
- [ ] **Step 2: `docs/CUSTOS.md`.**
  - Per-try-on cost per provider with the formulas.
  - Monthly scenarios (10/50/200 try-ons per day) in US$ and R$, with fixed costs, and the sources and dates of the prices.
  - Every figure must match `estimateCost` and `simulateMonthly` outputs; generate them with a one-off node script.
- [ ] **Step 3: Verify.** Run `npm test` (all pass) and `node test/e2e/smoke.mjs` (`SMOKE OK`).
- [ ] **Step 4:** Commit `docs: README, deploy e relatório de custos` and push.
