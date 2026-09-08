# Handoff de verificação — issue 146 (teto `.max(50)` em `itens` + dedupe)

**Criado:** 2026-07-09 · **PR:** #111 (branch `fix/teto-cardinalidade-itens-pedido`)
**Motivo do handoff:** a verificação runtime decisiva **não fecha nesta máquina** (disco 97%, 3,1G livres — não dá pra subir Supabase local com seed). Rodar em máquina com espaço.

---

## O que já está verificado (não precisa refazer)

- **RED unitário** `src/lib/validacoes/pedido.itens-cap.test.ts` — 4/4 verde. Isola a fronteira: `schemaPayloadPedido.safeParse` aceita 30 e 1 item, rejeita 51 / 1.000 / 50.000.
- **Suíte completa** `npx vitest run` — 2489 verdes (179 arquivos).
- **`next build`** — compila limpo.
- **Auditoria** (`auditar`) — LIMPO (0 crítica/alta/média). Teto na fronteira certa; nenhuma outra Server Action recebe o array de itens; dedupe matematicamente neutro pro valor.

## O que NÃO deu pra verificar aqui (o objetivo do handoff)

Provar em runtime o **efeito comportamental** do fix ponta-a-ponta:
- carrinho de **≤50** linhas → pedido criado, total correto;
- carrinho de **51** linhas → barrado.

**Por que travou:** a superfície real é a Server Action `criarPedido`, chamada só pelo checkout do browser. Por design (`references/seguranca.md` §14), toda rejeição de `criarPedido` volta o **mesmo erro genérico** — então, **sem loja/produtos no banco**, um payload de 51 itens e um de 50 morrem no mesmo `ERRO_GENERICO` (51 → schema `.max(50)`; 50 → loja inexistente). O output é **idêntico com e sem o fix** quando o banco está vazio. O cloud (`.env.local`) tem `lojas.count = 0`; o Supabase local está desligado e o disco não permite subir.

Conclusão: para distinguir boundary-reject de I/O-reject é obrigatório ter **dados de loja+produtos** — logo, Supabase local com seed.

---

## Passo-a-passo pra fechar em PASS (máquina com espaço)

### 1. Subir stack local + seed
```bash
cd irango-1
git checkout fix/teto-cardinalidade-itens-pedido
npx supabase start          # sobe Postgres/API locais (Docker)
npx supabase db reset       # aplica migrations + supabase/seed.sql (cria loja-teste + produtos)
```
> Usar **npx supabase** (nunca pnpm). O seed cria a loja `loja-teste` e o dono `dono.teste@irango.local` (dados fictícios — ver memória `setup-stack-supabase`).

### 2. Apontar o dev pro Supabase local
Trocar `NEXT_PUBLIC_SUPABASE_URL` / chaves em `.env.local` para as que o `supabase start` imprime (API `http://localhost:54321`), **sem commitar**. Guardar os valores cloud pra restaurar depois.

### 3. Subir o app
```bash
NODE_OPTIONS='--max-old-space-size=2048' npx next dev --turbopack
```
> Dirigir sempre por **localhost:3000** (nunca 127.0.0.1 — mata a hidratação; ver memória `dev-server-localhost-hydration`).

### 4a. Caminho feliz (E2E no browser) — prova ≤50 + dedupe neutro
- Abrir `http://localhost:3000/loja/<slug-do-seed>` → montar carrinho com ~algumas linhas → checkout → finalizar.
- **Esperado:** pedido criado; subtotal/frete/total corretos. Confirma que o teto NÃO barra o caminho real e que o recálculo de valor segue intacto.
- Repetir com o **mesmo produto em 2+ linhas** (opcionais diferentes) → total continua somando por linha. Prova que o dedupe da busca é neutro pro valor.

### 4b. Fronteira do atacante — prova >50 barrado ANTES de I/O (bypassa o gate client)
O gate client (`useEnviarPedido.ts`) roda o mesmo schema, então >50 nem sai do browser. Pra testar a **fronteira servidor** (o vetor real), invocar a Server Action direto por HTTP:

1. Encoding de Server Action (capturado nesta sessão): `POST` na rota worker, header `Next-Action: <id>`, `Content-Type: text/plain`, body = **`[{...args...}]`** (array JSON dos args, sem prefixo flight `0:`).
2. Descobrir o action ID de `criarPedido` (muda por build; no dev sai do manifesto):
```bash
# warm-up da rota primeiro (curl http://localhost:3000/loja/x/pedido), depois:
node -e 'const m=require(require("path").resolve(".next/dev/server/server-reference-manifest.json"));
for(const [id,info] of Object.entries({...(m.node||{}),...(m.edge||{})}))
  if(JSON.stringify(info).includes("actions/pedido")) console.log(id);'
# são 3 ids (cupom/frete/pedido). O de criarPedido é o que responde
# "Não foi possível criar o pedido" a um payload com itens.
```
3. Com loja **real do seed** (loja_id do banco), mandar:
   - **50 itens** → agora vai ALÉM do schema: cria pedido (ou cai numa checagem posterior real, ex. "Loja fechada", forma de pagamento) — **comportamento distinto** do erro de schema.
   - **51 itens** → `ERRO_GENERICO`, barrado no `.safeParse` antes de qualquer I/O.
   - A **divergência de comportamento** entre 50 e 51 (com loja válida) é a prova que faltou aqui.

Payload base (ajustar `loja_id`/`produto_id` pros do seed):
```bash
node -e 'const n=51,pid="<produto_id_do_seed>";const itens=Array.from({length:n},()=>({produto_id:pid,quantidade:1}));
process.stdout.write(JSON.stringify([{loja_id:"<loja_id_do_seed>",tipo_entrega:"retirada",forma_pagamento:"pix",nome_cliente:"probe",itens}]))' > body.txt
curl -s -X POST http://localhost:3000/loja/<slug>/pedido \
  -H "Next-Action: <id>" -H "Content-Type: text/plain;charset=UTF-8" --data-binary @body.txt
```

### 5. Restaurar
- Reverter `.env.local` pros valores cloud. `npx supabase stop` se quiser liberar recursos.

---

## Critério de PASS
- [ ] Checkout no browser com ≤50 linhas **cria pedido**, total correto (inclui repetição de produto → soma por linha).
- [ ] POST direto com **51 itens** (loja real) → `ERRO_GENERICO`, e o de **50 itens** diverge (vai além do schema). Isso isola o `.max(50)`.
- [ ] Nenhum pedido de >50 itens persiste no banco.

## Referências
- Código: `src/lib/validacoes/pedido.ts` (`.max(50)`), `src/lib/actions/pedido.ts` (dedupe `[...new Set(...)]`, ~linha 93).
- Doc: `references/seguranca.md` §10 (recálculo) e §14 (erro genérico — a razão de o output ser opaco).
- Tasks: `tasks/146` (o fix), `tasks/147` (doc `faixa_cep`).
