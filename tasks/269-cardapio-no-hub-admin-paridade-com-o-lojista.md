# [269] Cardápio no hub admin: paridade com o lojista, sem uma segunda cópia da regra

**crítica:** SIM (TDD red-first — `tdd` antes de `executar`; `auditar` em **fable**, como a 241)
**Mundo:** painel admin (`/admin/assinantes/[lojaId]`) + contrato compartilhado com o painel do lojista
**Depende de:** [250] (RPC `aplicar_cardapio_em_categoria`), [251] (actions de lote), [255] (CRUD do cardápio),
[256] (`/painel/cardapios`), [257]–[259] (`FormVigencia`), [260] (`SeletorProdutosDoCardapio`),
[261] (`visibilidade` + `hrefCardapios`)
**Spec:** `specs/cardapio-sazonal.md`
**Decisões:** D2, D3, D3-a, D3-b, D14, D16 · RN-01, RN-02, RN-04, RN-09, RN-09-a, RN-10, RN-11, RN-14, RN-15
**Branch:** `feat/cardapio-sazonal-painel-vitrine` (PR #144), a partir de `b657917`

---

## Origem

Relato do dono do SaaS em teste local. No hub admin, editando a loja de um terceiro
("Lanches base"), ele não consegue criar cardápio:

- `/admin/assinantes/[lojaId]/cardapios` **não existe**;
- o item "Cardápios" foi **omitido** do menu admin via `rotasAusentes: ["cardapios"]`
  (`src/app/admin/assinantes/[lojaId]/layout.tsx:57`, contrato em `NavPainel.tsx:98-108`, issue 256);
- no modal do produto, marcar *"Só aparece quando um cardápio dele estiver aberto"* mostra
  *"Cardápios são gerenciados pelo painel do lojista"* (`FormProduto.tsx:724-727`, via
  `hrefCardapios={null}` em `CardapioAdminClient.tsx:114`, commit `f26cc6a`);
- salvar devolve a recusa do trigger RN-14 (`produto exclusivo sem cardapio`, migration
  `20260920131000`) como toast: *"Este produto não está em nenhum cardápio…"*.

Beco sem saída: o admin é convidado a declarar um estado que só um cardápio justifica, e não tem
como criar o cardápio.

## Objetivo

Fechar a assimetria: **o hub admin faz, na loja-alvo, tudo o que o lojista faz na própria loja —
pelo mesmo contrato de regra, não por uma segunda cópia dela.** Três rotas admin espelhadas, nove
Server Actions admin, e a extração para módulo neutro de tudo que hoje só existe dentro de
`src/lib/actions/cardapio.ts`.

---

## Escopo

- [ ] **Migration** convertendo `public.aplicar_cardapio_em_categoria` de `security invoker` para
      `security definer` + travas T1–T7 no corpo, com `grant execute` também para `service_role`
      (é a conversão que a própria migration `20260920134000:162-169` prescreve para este dia).
- [ ] **Módulo neutro** `src/lib/actions/cardapio-contrato.ts` — as mensagens literais, o
      reconhecedor do trigger, a normalização de prazo pelo fuso e o resumo da prévia, **uma
      cópia, dois callers** (precedente: `produto-contrato.ts`, issue 241).
- [ ] **Query compartilhada** `buscarProdutosQueFicariamOrfaos` migrada de dentro de `cardapio.ts`
      para `src/lib/supabase/queries/cardapios.ts` (a condição de RN-14 é uma só nos dois mundos).
- [ ] **`src/app/admin/assinantes/actions/admin-cardapios.ts`** com as 9 actions admin, assinatura
      `(lojaId, …)`, `prepararContextoAdmin` + `escopo.*` + `registrarAcessoAdmin` +
      `revalidarLojaAdmin`, `loja_id` **sempre** do `lojaId` da URL validado, **nunca** do payload.
- [ ] **`definirVisibilidadeEmProdutosAdmin`** em `admin-produtos.ts` — é uma das cinco actions
      obrigatórias de `AcoesLote` e o `devolverAoMenu` de `AcoesCardapios`; sem ela nenhuma das
      duas superfícies compila no mundo admin.
- [ ] **Loaders** `carga-cardapios.ts` (estendido) e `carga-cardapio-detalhe.ts`, no mesmo formato
      fail-closed de `carga.ts`.
- [ ] **Três rotas admin** espelhando as do lojista (`cardapios/`, `cardapios/novo/`,
      `cardapios/[cardapioId]/`), reusando `CardapiosClient`, `FormVigencia` e
      `SeletorProdutosDoCardapio` — nenhum markup copiado.
- [ ] **`CardapiosClient` ganha `baseCardapios: string` obrigatória** (hoje tem três
      `href="/painel/cardapios/…"` hardcoded: linhas 203, 272 e 439) e a trava
      `rotaCardapiosInjetada.test.tsx` passa a vigiar a pasta `cardapios/` do lojista.
- [ ] `rotasAusentes` **deixa de listar** `"cardapios"`; `hrefCardapios` no `CardapioAdminClient`
      passa a ser `/admin/assinantes/${lojaId}/cardapios`.
- [ ] A prop `lote` do `ProdutosClient` passa a ser injetada também no hub admin (a barra de
      seleção em lote de `/painel/produtos`): as actions já existirão e deixá-la de fora
      recriaria a assimetria que esta issue mata.
- [ ] **Enforcement:** camada 3 de `enforcement-escopo-admin.test.ts` passa a casar `upsert`
      (hoje `ESCRITA` só casa `update|delete|insert` — ver §Riscos, item R1).

## Fora de escopo

- Qualquer mudança em **regra de negócio** de cardápio. Esta issue não altera vigência, não muda
  RN-14, não converte `visibilidade` automaticamente, não toca na vitrine.
- `CAMINHO_PAINEL = "/painel/cardapio"` (`produto.ts:25`, débito do `architecture.md` §10) —
  continua fora, como já está em `cardapio.ts:91-93`.
- Log de acesso admin **de leitura** (os loaders não logam hoje; isso é resíduo das 146/147).
- Reordenar cardápios (`cardapios.ordem`) em qualquer um dos dois mundos — não existe no lojista.
- Trocar `revalidarLojaAdmin` por revalidação por slug (ver §Riscos, R4).

## Reuso esperado

| Já existe | Papel nesta issue |
|---|---|
| `prepararContextoAdmin`, `validarLojaIdAdmin`, `revalidarLojaAdmin`, `registrarAcessoAdmin`, `criarEscopoLoja` (`lib/actions/admin-loja.ts`) | contrato inteiro da fronteira admin — **nada disso é reescrito** |
| `EscopoLoja.inserir/atualizar/remover/buscarPorId` | toda escrita de linha única em `cardapios` |
| `buscarLojaAdminPorId(svc, lojaId)` (`queries/lojas.ts`) | `timezone` e `slug` da **loja-alvo** |
| `buscarCardapiosDoPainel`, `buscarCardapiosComProdutos`, `buscarCardapioPorId` (`queries/cardapios.ts`) | já são `(client, lojaId)` com `.eq("loja_id")` explícito — servem `svc` sem alteração |
| `buscarProdutosDoLojista`, `buscarCategorias` (`(svc, lojaId)`) | o seletor de produtos do detalhe |
| `CardapiosClient`, `FormVigencia`, `PreviewVigencia`, `SeletorProdutosDoCardapio`, `DialogoLoteCardapio`, `BarraSelecaoLote`, `useLoteDeProdutos`, `contrato-lote.ts` | **os mesmos componentes**, com `acoes` injetadas |
| `estadoDoCardapio`, `descreverVigencia`, `rotuloAgora`, `contarProdutosEscondidos`, `listarProdutosEscondidos`, `cardapioAberto`, `visibilidadeDe`, `horaLocalNoFuso`, `rotuloFusoLoja`, `calcularFimDoPreset`, `instanteNoFuso` | puros, sem I/O — reusados com o fuso da loja-alvo |
| `schemaCardapio`, `schemaIdCardapio`, `schemaLoteDeProdutos`, `schemaLoteDeCategoria`, `schemaPreviaDeLote`, `schemaVisibilidadeEmLote`, `ehMensagemDeVigencia` (`lib/validacoes/`) | **o mesmo zod nos dois mundos** — nenhum schema paralelo |
| `ehErroDeExclusivoSemCardapio`, `erroDeEscritaDeProduto`, `MSG_EXCLUSIVO_SEM_CARDAPIO` (`produto-contrato.ts`) | já neutros; o módulo novo é o irmão deles |
| `enforcement-escopo-admin.test.ts` (camadas 2/3/4), `enforcement-props-action-admin.test.ts`, `enforcement-escopo-queries.test.ts`, `rotaCardapiosInjetada.test.tsx` | **descobrem sozinhos** os arquivos novos — nenhuma lista manual a editar |
| `tests/helpers/pglite.ts` (`asAnon`/`asUser`/`asService`) | o RED da RPC convertida |

**Nenhum primitivo novo é criado.** Os dois arquivos "novos" que não são rota nem action
(`cardapio-contrato.ts`, `buscarProdutosQueFicariamOrfaos`) são **extrações** de código que já
existe em `cardapio.ts` — saldo líquido de linhas próximo de zero.

## Segurança

- **`service_role` tem `BYPASSRLS`.** `cardapios_escrita_propria` e
  `cardapio_produtos_escrita_propria` (migrations `20260920128000`/`20260920129000`) **não
  protegem** o caminho admin. O que protege é: `verificarAdminSaaS()` antes de elevar + escopo
  por `lojaId` da URL + as FKs compostas `(cardapio_id, loja_id)` / `(produto_id, loja_id)`
  (`20260920129000:45-50`, que valem sob qualquer role) + o trigger `security definer` de
  `20260920131000` + a **paridade de validação** com o caminho do lojista.
- **Nenhum valor monetário.** O análogo do mandato 1 aqui é **data**: `prazo_fim` sob preset é
  recalculado no servidor (`calcularFimDoPreset`) e o `fim` do cliente é descartado (RN-04); a
  travessia hora local → instante usa `lojas.timezone` da **loja-alvo, lido do banco**, nunca um
  fuso vindo do payload.
- **Sem oráculo de existência:** id inexistente e id de outra loja têm resposta byte a byte
  idêntica, nas rotas (`notFound()`), na prévia e nas actions (`seguranca.md` §14).
- `metadados` de `admin_acessos` carrega só contagem e ids de entidade — **nunca** nome de
  produto, nome de cardápio ou qualquer PII (`seguranca.md` §7, §8).
- `23514`, `23000`, `23503` e o texto cru do Postgres ficam no log; a UI recebe a genérica, salvo
  as frases de regra de negócio já promovidas hoje (RN-14 e as cinco de vigência de §9.6).

## Critério de aceite

- [ ] Admin em `/admin/assinantes/<lojaId>/cardapios` cria, edita, liga/desliga e remove cardápio
      **da loja-alvo**, e nenhuma linha nasce na loja do admin logado.
- [ ] `aplicar_cardapio_em_categoria` sob `asService` **funciona** para o trio coerente e é
      recusada com o fragmento literal `cardapio fora da loja` / `categoria fora da loja` quando
      qualquer id é de outra loja.
- [ ] `asUser` (dono da loja B) chamando a RPC com `p_loja_id` da loja A é recusado com `loja alheia`
      — a trava que, sob `invoker`, era a RLS, e que a conversão relocou para T2.
- [ ] `asAnon` não tem `EXECUTE` na função (`42501`).
- [ ] O `grep` de `rotaCardapiosInjetada.test.tsx` cobre `CardapiosClient.tsx` e passa: zero
      `"/painel/cardapios` em código compartilhado.
- [ ] `enforcement-props-action-admin.test.ts` descobre os três wrappers novos e exige todas as
      props de action deles — sem editar a suíte.
- [ ] Payload admin com `loja_id` hostil não muda a loja escrita (afirmar **a linha gravada**,
      não só o SQLSTATE).
- [ ] Mensagens byte a byte idênticas entre `cardapio.ts` e `admin-cardapios.ts` para: parse
      inválido, vigência §9.6, RN-14 com número, RN-14 sem número, lote genérico, órfão no lote.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.

---

## Plano Técnico

### Diagnóstico

**Causa raiz.** A fatia de cardápio sazonal (issues 242–264) foi construída com **um** caminho de
escrita — o do lojista, cuja autoridade é RLS + `buscarLojaDoDono(auth.uid())`. Todas as features
anteriores do projeto ganharam um gêmeo admin (`admin-produtos`, `admin-categorias`, `admin-cupom`,
`admin-opcionais`, `admin-entrega`…), porque o hub admin é um segundo caminho de escrita que, por
construção, **não passa pela RLS**. Cardápio não ganhou. A invariante violada é a que
`produto-contrato.ts` e `EscopoLoja` existem para sustentar: *o hub admin faz, na loja-alvo, tudo
o que o lojista faz na própria loja, pelo mesmo contrato de regra*.

Os dois "remendos" aplicados desde então — `rotasAusentes: ["cardapios"]` (256) e
`hrefCardapios={null}` (261, commits `8bfe902` e `f26cc6a`) — **estão corretos** como mitigação:
sem a rota, qualquer href fixo mandaria o admin para o painel da própria loja dele, e a issue 261
regrediu duas vezes exatamente por isso. Mas eles **codificam a ausência como contrato
permanente**. O trigger RN-14 então torna a ausência visível: o admin pode *declarar* um produto
exclusivo e não pode criar o cardápio que justifica a declaração — a escrita é recusada no COMMIT.

O sintoma é "falta uma rota". A causa é "falta o segundo caminho de escrita, e a regra mora dentro
do primeiro". Criar as rotas copiando `cardapio.ts` com `lojaId` no lugar de `buscarLojaDoDono`
**seria o remendo de verdade**: duas cópias da mesma regra, das mesmas frases e do mesmo
reconhecedor de erro, divergindo na primeira correção que alguém fizer só de um lado. O plano
extrai primeiro, escreve depois.

**Por que é complexo.**
1. Atravessa quatro camadas: migration/RPC → módulo neutro + query → Server Actions → rotas/UI.
2. **Muda contrato de banco:** a RPC vira `security definer`, o que move a autoridade da RLS
   para o corpo da função **também para o caminho do lojista, que hoje funciona**.
3. **Muda contrato de componente:** `CardapiosClient` ganha prop obrigatória; `NavPainel` perde
   uma entrada de `rotasAusentes`; `FormProduto` passa a receber href no mundo admin.
4. **Cross-cutting em teste:** quatro suítes de enforcement descobrem arquivos por filesystem/AST
   e passam a cobrir os arquivos novos automaticamente — e uma delas (camada 3) tem um furo que
   esta issue alargaria se não for fechado (R1).
5. O mesmo bug (admin caindo na própria loja) já voltou **duas vezes** nesta mesma branch.

---

### Mapa de Impacto

```
ROTA ADMIN (nova)
/admin/assinantes/[lojaId]/cardapios/page.tsx
  └─ carregarCardapiosDoPainelAdmin(lojaId)          [carga-cardapios.ts — service_role]
        ├─ validarLojaIdAdmin → verificarAdminSaaS → createServiceClient   [fail-closed, D-4]
        ├─ buscarLojaAdminPorId(svc, lojaId)         → timezone da LOJA-ALVO
        └─ buscarCardapiosDoPainel(svc, lojaId)      → .eq("loja_id") explícito
  └─ CardapiosAdminClient  ['use client']
        └─ CardapiosClient (do lojista)  + baseCardapios={/admin/assinantes/${lojaId}/cardapios}
              └─ acoes: { ligarDesligar, remover, converter, devolverAoMenu }
                    └─ admin-cardapios.ts / admin-produtos.ts   [AUTORITATIVO]

/admin/assinantes/[lojaId]/cardapios/novo/page.tsx
  └─ NovoCardapioAdminClient → FormVigencia (salvar = criarCardapioAdmin)

/admin/assinantes/[lojaId]/cardapios/[cardapioId]/page.tsx
  └─ carregarCardapioDetalheAdmin(lojaId, cardapioId)  [carga-cardapio-detalhe.ts]
        ├─ buscarCardapioPorId(svc, lojaId, id)  → null ⇒ notFound()  [sem oráculo]
        ├─ buscarProdutosDoLojista(svc, lojaId)
        ├─ buscarCategorias(svc, lojaId)
        └─ buscarCardapiosComProdutos(svc, lojaId)
  └─ CardapioDetalheAdminClient
        ├─ FormVigencia (salvar = atualizarCardapioAdmin)
        └─ SeletorProdutosDoCardapio (acoes: as 5 de AcoesLote)

SERVER ACTIONS  (src/app/admin/assinantes/actions/admin-cardapios.ts)
  criarCardapioAdmin ────────┐
  atualizarCardapioAdmin ────┤
  ligarDesligarCardapioAdmin ┼─ escopo.* (loja_id + id por construção) → tabela `cardapios`
  removerCardapioAdmin ──────┘        └─ trigger 20260920131000 (definer, vale sob service_role)
  converterExclusivosParaMenuAdmin ─→ produtos.visibilidade  [update escopado .eq("loja_id")]
  aplicarCardapioEmProdutosAdmin ──→ escopo.inserirVarios("cardapio_produtos")
                                        └─ FKs compostas: cross-tenant IMPOSSÍVEL, inclusive svc
  aplicarCardapioEmCategoriaAdmin ─→ svc.rpc("aplicar_cardapio_em_categoria", { p_loja_id: … })
                                        └─ T2 (definer) é a ÚNICA autoridade da via de serviço
  tirarDeCardapioAdmin ────────────→ delete .eq("loja_id").eq("cardapio_id").in("produto_id")
  preverLoteAdmin ─────────────────→ LEITURA pura, .eq("loja_id"), sem log, sem escrita

CONTRATO COMPARTILHADO (novo, neutro)
  src/lib/actions/cardapio-contrato.ts
        ↑ importado por lib/actions/cardapio.ts        (lojista)
        ↑ importado por actions/admin-cardapios.ts     (admin)

CAMADA DE BANCO
  aplicar_cardapio_em_categoria: invoker → DEFINER + T1..T7
        ├─ afeta o lojista: RLS deixa de ser avaliada dentro da função → T2 assume
        └─ afeta o admin:   ganha uma trava que hoje NÃO existe (hoje é fail-closed por ausência)

QUEM MAIS É AFETADO (não óbvio)
  NavPainel.tsx            ← rotasAusentes deixa de listar "cardapios" (layout admin)
  CardapioAdminClient.tsx  ← hrefCardapios: null → rota admin; ganha prop `lote`
  FormProduto.tsx          ← passa a renderizar o botão no mundo admin (nenhuma mudança de código)
  rotaCardapiosInjetada.test.tsx ← lista de vigiados cresce
  enforcement-escopo-admin.test.ts ← camadas 2/3/4 auto-descobrem admin-cardapios.ts
  enforcement-props-action-admin.test.ts ← auto-descobre os 3 *AdminClient.tsx novos
  tests/migrations/rpc_aplicar_cardapio_em_categoria.test.ts ← a asserção `asService` INVERTE
```

---

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `supabase/migrations/20260920134000_rpc_aplicar_cardapio_em_categoria.sql` | RPC `security invoker`, grant só a `authenticated`; T2 recusa `service_role` por `auth.uid() IS NULL` | **não é editada** (migration aplicada é imutável); uma migration nova faz `create or replace` |
| `src/lib/actions/cardapio.ts` | 9 actions do lojista + todas as mensagens, `linhaDoCardapio`, `ehErroDeExclusivoOrfao`, `produtosQueFicariamOrfaos`, `produtosVinculados` | perde o que é regra pura (vai para `cardapio-contrato.ts`) e a leitura de órfãos (vai para `queries/cardapios.ts`); as 9 actions continuam idênticas em comportamento |
| `src/lib/validacoes/cardapio.ts` | zod isomórfico | **não muda** — é importado pelos dois mundos |
| `src/lib/supabase/queries/cardapios.ts` | `buscarCardapiosComProdutos`, `buscarCardapiosDoPainel`, `buscarCardapioPorId`, todas `(client, lojaId, …)` com `.eq("loja_id")` explícito | ganha `buscarProdutosQueFicariamOrfaos(client, lojaId, cardapioId)` |
| `src/lib/actions/produto.ts` | `definirVisibilidadeEmProdutos` (lojista) | **não muda** |
| `src/app/admin/assinantes/actions/admin-produtos.ts` | 6 actions admin de produto | ganha `definirVisibilidadeEmProdutosAdmin` |
| `src/lib/actions/admin-loja.ts` | `EscopoLoja` com `inserir` (1 linha) | ganha `inserirVarios(tabela, linhas[], opcoes?)` — injeta `loja_id` por último em **cada** linha |
| `src/app/admin/assinantes/[lojaId]/layout.tsx:57` | `rotasAusentes: ["cardapios"]` | vira `rotasAusentes: []` (ou a chave sai) + comentário atualizado |
| `src/app/admin/assinantes/[lojaId]/carga-cardapios.ts` | leitura só de `buscarCardapiosComProdutos` | ganha `carregarCardapiosDoPainelAdmin(lojaId)` no mesmo arquivo |
| `src/app/admin/assinantes/[lojaId]/produtos/CardapioAdminClient.tsx:110-114` | `hrefCardapios={null}` | vira a rota admin; ganha `lote={{ cardapios, acoes }}` |
| `src/app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient.tsx:203,272,439` | **três `/painel/cardapios/…` hardcoded** | prop `baseCardapios: string` **obrigatória, sem default** (issue 160) |
| `src/components/painel/rotaCardapiosInjetada.test.tsx:48-53` | vigia `components/painel/**` + `ProdutosClient.tsx` | passa a vigiar também `app/(painel)/painel/(bloqueavel)/cardapios/**` |
| `src/app/admin/assinantes/enforcement-escopo-admin.test.ts:173` | `ESCRITA` casa `update\|delete\|insert` | passa a casar `upsert`; `admin-entrega.ts`/`taxas_entrega` entra na `ALLOWLIST_INSERT` com o motivo já revisado |
| `tests/migrations/rpc_aplicar_cardapio_em_categoria.test.ts` | afirma que `asService` é recusado com `loja alheia` | essa asserção **inverte** e é substituída por 4 novas (ver §Cenários) |

---

### Decisões de Design

#### D1 — Como o admin aplica cardápio por CATEGORIA

A RPC de hoje é `security invoker` e recusa `service_role` **por desenho**: T2 exige
`lojas.dono_id = auth.uid()`, e sob `service_role` não há JWT, `auth.uid()` é `NULL`, o `exists`
é falso e a função levanta `loja alheia` (`20260920134000:95-105`).

| Opção | Prós | Contras |
|---|---|---|
| **(a) Converter para `SECURITY DEFINER` + T1–T7 e conceder `execute` a `service_role`** | é **literalmente** o caminho que a própria migration 250 documenta para este dia (`:162-169`) e que `seguranca.md` §2 formaliza; mesmo desenho já aplicado duas vezes (`reordenar_opcionais_da_categoria` e `reordenar_itens_do_grupo_opcional`, issue 215); **acrescenta** uma trava à via de serviço, que hoje não tem nenhuma; a expansão da categoria continua dentro da transação (RN-10) | migration nova + `db push` (irreversível, exige autorização); a autoridade do **lojista** deixa de ser a RLS e passa a ser T2 — precisa de teste explícito |
| (b) `insert … select` pelo service client com escopo explícito | nenhuma migration | **impossível**: PostgREST não faz `insert … select`. Só sobra ler os ids em JS e reenviá-los — exatamente a janela TOCTOU que RN-10 proíbe e que a RPC existe para fechar |
| (c) RPC nova, `definer`, só para o admin | não toca no caminho do lojista | duas funções com o mesmo corpo, divergindo na primeira correção; é o remendo que esta issue existe para rejeitar; e o furo da via de serviço continuaria aberto na função antiga |
| (d) Não oferecer "categoria inteira" no admin | escopo menor | recria a assimetria que a issue mata; o admin veria um botão a menos sem nenhuma razão legível |

**Escolhida: (a).** Racional de `seguranca.md` §2 ("RPC de escrita em lote reusada por lojista E
admin"): `service_role` tem `BYPASSRLS`, então a RLS **nunca** foi autoridade para ele em nenhum
dos dois modos. Sob `definer`, a autoridade sai da RLS por construção e é **provada no corpo** —
para o lojista a garantia é **relocada**, para o admin ela é **criada**. Acrescentar só o `grant`
sem converter é o afrouxamento que a §2 proíbe em letra.

Forma exata da migration `20260921120000_rpc_aplicar_cardapio_em_categoria_definer.sql`
(`create or replace`, mesma assinatura, mesmas mensagens literais):

```sql
create or replace function public.aplicar_cardapio_em_categoria(
  p_loja_id uuid, p_cardapio_id uuid, p_categoria_id uuid
) returns integer
language plpgsql
security definer                      -- era: security invoker
set search_path = public, pg_temp     -- pg_temp EXPLÍCITO e por ÚLTIMO
as $$
declare
  v_inseridos   int;
  -- Sinal 1: claim `role` do JWT já verificado pelo PostgREST.
  -- Sinal 2: role efetivo da sessão. `current_user` vale o DONO da função dentro
  -- de uma DEFINER, e `row_security_active()` é sempre false — nenhum dos dois serve.
  v_role_sessao text    := coalesce(nullif(current_setting('role', true), ''), 'none');
  -- `coalesce(auth.role(), '')` é OBRIGATÓRIO: sem JWT `auth.role()` é NULL e
  -- `not (NULL or false)` avalia para NULL, que o plpgsql trata como ELSE —
  -- a T2 viraria fail-OPEN (achado real, corrigido por 20260918130000).
  v_e_servico   boolean := coalesce(auth.role(), '') = 'service_role'
                           and v_role_sessao not in ('authenticated', 'anon');
begin
  -- T1 (inalterada): parâmetros presentes.
  -- T2 AUTORIDADE: dono da loja OU via de serviço. Substitui a RLS perdida com o
  --    definer; para o admin é a ÚNICA checagem de tenant que existe.
  if not (
    v_e_servico
    or exists (select 1 from public.lojas where id = p_loja_id and dono_id = auth.uid())
  ) then
    raise exception 'aplicar_cardapio_em_categoria: loja alheia';
  end if;
  -- T3 (inalterada, 2 pares): 'cardapio fora da loja' / 'categoria fora da loja'.
  --    DEPOIS de T2 — a ordem inversa vira oráculo de existência em loja alheia.
  -- T4 não se aplica: isto não é permutação. O análogo da completude é o
  --    `insert … select` ler o conjunto DENTRO da transação (RN-10).
  -- T5 (inalterada): escreve só o vínculo, derivado do SELECT no servidor;
  --    `and p.loja_id = p_loja_id` continua como escopo explícito.
  -- T6: `get diagnostics v_inseridos = row_count` — com `on conflict do nothing`
  --    contar MENOS que o esperado é legítimo (idempotência), então aqui não há
  --    comparação que derrube a transação; quem derruba id cruzado são as FKs
  --    compostas de 20260920129000.
  -- T7 (ACL, abaixo).
end; $$;

revoke all on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid) from public, anon;
grant execute on function public.aplicar_cardapio_em_categoria(uuid, uuid, uuid)
  to authenticated, service_role;      -- era: só authenticated
```

O `comment on function` é reescrito para descrever o modelo novo. **Nenhuma tabela, coluna,
índice, policy ou grant de tabela é tocado.** Rollback documentado no rodapé: reaplicar o corpo
`invoker` de `20260920134000` (e, antes, reverter o deploy da aplicação — do contrário o hub admin
chama uma função que o recusa).

#### D2 — Módulo neutro vs. cópia das mensagens

| Opção | Prós | Contras |
|---|---|---|
| (a) Copiar as constantes e helpers para `admin-cardapios.ts` | zero refatoração | duas cópias de seis frases literais e de dois reconhecedores de erro; a primeira correção num lado vira drift silencioso — e o lado admin é o que **não tem RLS** |
| **(b) Extrair para `src/lib/actions/cardapio-contrato.ts` (neutro, sem `'use server'`)** | precedente direto: `produto-contrato.ts` (issue 241) e `logo-contrato.ts`, `upload-contrato.ts`, `revisarCarrinho-contrato.ts`; arquivo `'use server'` **não pode** exportar função síncrona nem tipo, então o módulo neutro não é estilo, é exigência do Next | um arquivo a mais |

**Escolhida: (b).** Conteúdo exato (tudo movido, nada reescrito):

```ts
// src/lib/actions/cardapio-contrato.ts   (NEUTRO — sem 'use server')
export const MSG_GENERICA_LOTE, MSG_ORFAO_NO_LOTE, MSG_SALVAR, MSG_REMOVER,
             MSG_CONVERTER, MSG_LOJA, MSG_INVALIDO, MSG_EXCLUSIVOS_SEM_NUMERO
export function mensagemExclusivos(n: number): string
export function ehErroDeExclusivoOrfao(erro: unknown): boolean     // par 23000 + fragmento
export function erroDoLote(erro: unknown): string
export function erroDeParseCardapio(issues: readonly {message:string}[]): string
export function linhaDoCardapio(dados: DadosCardapio, timezone: string): DadosCardapio
export function resumirPrevia(linhas: LinhaDaPrevia[]): Omit<Previa & {ok:true}, "ok">
export type Resultado, ResultadoCardapio, ResultadoRemocao, LinhaDaPrevia
```

`resumirPrevia` existe para que as duas prévias sejam idênticas **por construção**: hoje as quatro
contagens (`total`, `nomes`, `menu`, `cardapio`, `ocultos`) são calculadas inline em
`preverLoteAction` (`cardapio.ts:257-265`) e copiá-las seria a divergência mais fácil de não notar.

#### D3 — Onde mora a leitura de "quem ficaria órfão"

`produtosQueFicariamOrfaos` faz **I/O** (duas queries), e `architecture.md` §8 diz que módulo
neutro em `lib/actions/` exporta só função pura. Mas a mesma §8 diz que query não se escreve
inline: vai para `lib/supabase/queries/`.

**Escolhida:** mover `produtosQueFicariamOrfaos` + `produtosVinculados` para
`src/lib/supabase/queries/cardapios.ts` como

```ts
export async function buscarProdutosQueFicariamOrfaos(
  client: Client, lojaId: string, cardapioId: string,
): Promise<string[]>
```

com o mesmo `.eq("loja_id", lojaId)` explícito das irmãs do arquivo. O lojista passa o client
autenticado, o admin passa `svc` — exatamente como `buscarCardapiosComProdutos` já faz hoje
(vitrine sob RLS **e** `carga-cardapios.ts` sob `service_role`). O parâmetro fica chamado
`client` (não `svc`) por consistência com as três funções vizinhas — ver R3 sobre o efeito disso
no `enforcement-escopo-queries.test.ts`.

#### D4 — Como as actions admin chegam aos componentes

`seguranca.md` §545 sanciona duas formas: `.bind(null, lojaId)` quando o Server Component passa a
action **direto** ao Client Component, e wrapper `*AdminClient.tsx` com closure quando há
intermediário.

| Opção | Prós | Contras |
|---|---|---|
| (a) `.bind(null, lojaId)` direto nas três pages | menos arquivos; `lojaId` fixado no servidor | **não é coberto** por `enforcement-props-action-admin.test.ts`, que descobre por filesystem só `*AdminClient.tsx` |
| **(b) Três wrappers `*AdminClient.tsx`** | a suíte AST **auto-descobre** e exige que **toda** prop de action do componente do painel seja injetada — a rede que impede exatamente o cross-tenant silencioso da issue 160 | três arquivos finos |

**Escolhida: (b)**, por ser issue `crítica: SIM`: esquecer uma das 4 ou das 5 actions faria a
action **do lojista** rodar, resolvendo a loja por `auth.uid()` e gravando **na loja do admin**.
A suíte já resolve tag importada → tipo de props → props planas de action **e** o membro `acoes`
(`enforcement-props-action-admin.test.ts:304-331`), então cobre tanto `FormVigencia` (`salvar`)
quanto `SeletorProdutosDoCardapio` (`acoes`) e `CardapiosClient` (`acoes`). Nomes obrigatórios:
`CardapiosAdminClient.tsx`, `NovoCardapioAdminClient.tsx`, `CardapioDetalheAdminClient.tsx`.

#### D5 — `upsert` de N linhas em `cardapio_produtos` sob `service_role`

`escopo.inserir` grava **uma** linha. `aplicarCardapioEmProdutos` grava N com
`onConflict: "cardapio_id,produto_id", ignoreDuplicates: true`.

| Opção | Prós | Contras |
|---|---|---|
| (a) `svc.from("cardapio_produtos").upsert(linhas, …)` cru | direto | `upsert` **não tem** `.eq`; e a camada 3 do enforcement **não casa `upsert`** (R1) — a escrita ficaria invisível ao CI |
| (b) N chamadas de `escopo.inserir` | coberto pelo wrapper | grava os ids legítimos e falha nos alheios, **denunciando pela diferença** quais ids existem em outra loja; é o oráculo que `cardapio.ts:104-107` documenta ter evitado |
| **(c) `escopo.inserirVarios(tabela, linhas[], opcoes?)` novo em `admin-loja.ts`** | `loja_id` injetado **por último em cada linha**, por construção, igual ao `inserir`; uma instrução, tudo-ou-nada; nenhuma entrada de allowlist necessária | ~8 linhas no wrapper |

**Escolhida: (c).** Assinatura:

```ts
inserirVarios<T extends TabelaComLojaId>(
  tabela: T,
  linhas: Omit<Tabelas[T]["Insert"], "loja_id">[],
  opcoes?: { onConflict: string; ignoreDuplicates: boolean },
) {
  return from(tabela).upsert(
    linhas.map((l) => ({ ...l, loja_id: lojaId })),   // loja_id POR ÚLTIMO
    opcoes,
  );
}
```

(`FromSolto` ganha `upsert(dados: unknown, opts?: unknown): Encadeavel`.)
Independentemente disso, a camada 3 passa a casar `upsert` — ver R1.

#### D6 — Revalidação

`cardapio.ts` usa `revalidarCaminhosDoCardapio(slug)` (três caminhos reais, evitando a forma
coringa `("/loja/[slug]", "page")`). O mundo admin usa `revalidarLojaAdmin(lojaId)`, que **usa** a
forma coringa.

**Escolhida:** `revalidarLojaAdmin(lojaId)` — o mesmo de todas as outras 30+ actions admin.
Divergir criaria um segundo contrato de revalidação dentro do hub admin, o que é pior que o
custo (já assumido, já pago) da forma coringa. Registrado como resíduo em R4, **não** relitigado
aqui.

#### D7 — `preverLoteAdmin` é leitura: loga ou não?

**Não loga.** `registrarAcessoAdmin` cobre **escrita** (o precedente: nenhum `carga*.ts` loga).
Mas `preverLoteAdmin` **passa** por `prepararContextoAdmin` — exigência da camada 2 do
enforcement e, mais importante, a prova de admin antes de elevar a `service_role`.

---

### Cenários

**Caminho feliz.** Admin abre `/admin/assinantes/<lojaId>/cardapios` → vê a lista da loja-alvo
com badge e frase de vigência derivados com o **relógio do servidor e o fuso da loja-alvo** →
"Novo cardápio" → `FormVigencia` → salva → `criarCardapioAdmin` grava com
`ordem = max(ordem)+1` **da loja-alvo** → volta à lista → abre o detalhe → seleciona produtos →
prévia do servidor → confirma → vínculos gravados → em `/admin/assinantes/<lojaId>/produtos`
o `FormProduto` já mostra "Está em: …" e o botão "Escolher um cardápio" leva à rota **admin**.

**Bordas.**

| Situação | Comportamento exigido |
|---|---|
| `lojaId` não-UUID na URL | `validarLojaIdAdmin` → `notFound()` **antes** de `createServiceClient()`; nas actions, `{ ok:false, erro:"Loja inválida." }` |
| `cardapioId` de **outra loja** | `buscarCardapioPorId` devolve `null` → `notFound()` — **idêntico** a id inexistente |
| `cardapio_id` de outra loja no payload de lote | FK composta `cardapio_produtos_cardapio_fk` derruba a instrução inteira; **nenhuma** linha gravada; mensagem genérica |
| `produto_ids` misturando loja-alvo e loja alheia | FK composta `cardapio_produtos_produto_fk` derruba **o lote inteiro** — nunca "grava os bons e reclama do resto" |
| `categoria_id` de outra loja na RPC | T3 → `categoria fora da loja` no log, genérica na tela |
| `p_loja_id` divergente do `lojaId` da URL | impossível por construção: a action passa `loja.lojaId` validado; a camada 4 do enforcement exige isso estaticamente |
| Remover cardápio com exclusivo órfão | recusa com `mensagemExclusivos(n)` e `exclusivos: n`; o diálogo oferece converter |
| **Corrida**: exclusivo vira órfão entre a leitura e o COMMIT | trigger `20260920131000` (definer, vale sob `service_role`) levanta `23000` → `ehErroDeExclusivoOrfao` → `MSG_EXCLUSIVOS_SEM_NUMERO` (sem número, porque nesse instante não há contagem confiável) |
| **Duplo submit** do mesmo lote | `on conflict do nothing` / `ignoreDuplicates` — a segunda chamada grava 0 e devolve sucesso |
| **Duplo submit** de criar cardápio | gera duas linhas (não há unique em `(loja_id, nome)`) — **comportamento idêntico ao do lojista hoje**; não é regressão e não é corrigido aqui |
| Seleção acima de `TETO_LOTE` | `useLoteDeProdutos` mostra `MSG_TETO` antes de chamar; o `.max()` do zod continua sendo a autoridade |
| Loja-alvo sem linha em `lojas` (apagada entre o load e o submit) | `buscarLojaAdminPorId` → `null` → `{ ok:false, erro: MSG_LOJA }`, sem gravar |
| Loja-alvo **inativa** (não publicada) | tudo funciona — o hub admin edita loja em onboarding por desenho (`carga.ts:49`) |
| Sessão do admin expirada / env `SAAS_ADMIN_USER_ID` ausente | `verificarAdminSaaS()` **lança**, a exceção **propaga**, `createServiceClient()` nunca é chamado |
| Falha de `registrarAcessoAdmin` | fire-and-forget num try/catch isolado; **nunca** derruba a action |

**Tratamento de erro.** Uma genérica por família (`MSG_SALVAR`, `MSG_REMOVER`, `MSG_CONVERTER`,
`MSG_GENERICA_LOTE`), `console.error("[<nomeDaAction>]", erro)` no servidor. As únicas frases
promovidas literais são as que já são hoje: as cinco de vigência (§9.6) e as duas de RN-14. Os
fragmentos `loja alheia` / `cardapio fora da loja` / `categoria fora da loja` são de **log e
teste**, nunca de tela.

---

### Contratos de Dados

**Nenhuma tabela, coluna, índice ou policy muda.** O único contrato de banco alterado é a
assinatura de segurança da função:

| Antes (`20260920134000`) | Depois (`20260921120000`) |
|---|---|
| `security invoker` | `security definer` |
| `set search_path = public, pg_temp` | igual |
| autoridade: RLS do lojista + T2 (`dono_id = auth.uid()`) | autoridade: T2 **apenas** (`dono_id = auth.uid()` **OU** via de serviço, fail-closed com `coalesce(auth.role(), '')`) |
| `grant execute … to authenticated` | `grant execute … to authenticated, service_role` |
| `revoke all … from public, anon` | igual (obrigatório: o projeto tem `alter default privileges … grant all on routines to anon`) |
| mensagens literais | **byte a byte idênticas** |

**Tipos gerados:** a assinatura (nome, parâmetros, retorno) não muda, então
`src/lib/database.types.ts` **não precisa ser regenerado**. Confirmar com
`npx supabase gen types typescript > /tmp/…` + `diff` antes de fechar; se houver diff, regenerar
pelo comando canônico.

**Deploy:** `npx supabase db push` é irreversível → **pedir autorização ao usuário** (CLAUDE.md).
Sem o push, a rota admin de "categoria inteira" devolve `42501` em runtime mesmo com build e
suíte verdes.

---

### Recálculo no Servidor

Não há dinheiro nesta fatia. O análogo é **data e escopo**:

| O cliente envia | O servidor recalcula / impõe do zero |
|---|---|
| `nome`, `modo`, `dias_semana`, `dias_mes`, `hora_inicio/fim`, `prazo_inicio`, `prazo_preset` | `schemaCardapio` normaliza (array vazio → `NULL`, RN-02) e nega a disjunção de RN-01 pela forma |
| `prazo_fim` | **descartado** sob preset `diario`/`semanal`/`mensal`: vem de `calcularFimDoPreset` (RN-04). Só `customizado` aceita o digitado |
| hora **local** `"YYYY-MM-DDTHH:MM"` | vira instante via `instanteNoFuso(…, loja.timezone)` com o `timezone` da **loja-alvo lido do banco** (`buscarLojaAdminPorId`) — nunca um fuso do payload |
| — | `loja_id`: **sempre** do `lojaId` da URL validado; injetado **por último** pelo wrapper |
| — | `ordem`: `max(ordem)+1` lido da loja-alvo (RN-15); o schema nem aceita o campo |
| — | `ativo`: só `ligarDesligarCardapioAdmin` escreve; `atualizarCardapioAdmin` nunca |
| `produto_ids` / `categoria_id` | escopo provado no banco: FKs compostas (lote explícito) e T2/T3 + `where p.loja_id = p_loja_id` (categoria) |
| contagens da prévia | lidas e somadas **no servidor** (`resumirPrevia`); o cliente nunca as reenvia |

**Assimetria cliente ↔ servidor, explícita:**

```
Validação de vigência aplicada em:
  ├── FormVigencia.tsx / rascunhoCardapio.ts  — [cliente — preview de UX, contornável]
  ├── lib/validacoes/cardapio.ts (schemaCardapio) — [fonte única: mesmo zod nos dois lados]
  ├── lib/actions/cardapio.ts        — [Server Action lojista — AUTORITATIVA, RLS + auth.uid()]
  ├── actions/admin-cardapios.ts     — [Server Action admin — AUTORITATIVA, verificarAdminSaaS + escopo]
  └── CHECKs de 20260920128000       — [banco — backstop, vale sob service_role]

Escopo de tenant garantido em:
  ├── lojista: RLS (cardapios_escrita_propria) + .eq("loja_id", loja.id) explícito
  ├── admin:   verificarAdminSaaS() + escopo.* (loja_id por construção)  ← RLS NÃO vale aqui
  └── ambos:   FKs compostas (cardapio_id,loja_id)/(produto_id,loja_id) — valem sob qualquer role
```

---

### Arquivos a Criar

| Arquivo | Conteúdo (nível função) |
|---|---|
| `supabase/migrations/20260921120000_rpc_aplicar_cardapio_em_categoria_definer.sql` | `create or replace` da RPC: `security definer`, T2 com `v_e_servico`, grant a `service_role`, comment reescrito, rollback documentado |
| `src/lib/actions/cardapio-contrato.ts` | as 8 constantes `MSG_*`, `mensagemExclusivos`, `ehErroDeExclusivoOrfao`, `erroDoLote`, `erroDeParseCardapio`, `linhaDoCardapio`, `resumirPrevia`, tipos `Resultado`/`ResultadoCardapio`/`ResultadoRemocao` |
| `src/app/admin/assinantes/actions/admin-cardapios.ts` | `criarCardapioAdmin`, `atualizarCardapioAdmin`, `ligarDesligarCardapioAdmin`, `removerCardapioAdmin`, `converterExclusivosParaMenuAdmin`, `aplicarCardapioEmProdutosAdmin`, `aplicarCardapioEmCategoriaAdmin`, `tirarDeCardapioAdmin`, `preverLoteAdmin` |
| `src/app/admin/assinantes/[lojaId]/carga-cardapio-detalhe.ts` | `carregarCardapioDetalheAdmin(lojaId, cardapioId)` |
| `src/app/admin/assinantes/[lojaId]/cardapios/page.tsx` | Server Component, `dynamic = "force-dynamic"` |
| `src/app/admin/assinantes/[lojaId]/cardapios/CardapiosAdminClient.tsx` | injeta as 4 de `AcoesCardapios` + `baseCardapios` |
| `src/app/admin/assinantes/[lojaId]/cardapios/novo/page.tsx` | Server Component |
| `src/app/admin/assinantes/[lojaId]/cardapios/novo/NovoCardapioAdminClient.tsx` | injeta `salvar` + `voltarHref` |
| `src/app/admin/assinantes/[lojaId]/cardapios/[cardapioId]/page.tsx` | Server Component |
| `src/app/admin/assinantes/[lojaId]/cardapios/[cardapioId]/CardapioDetalheAdminClient.tsx` | injeta `salvar` + as 5 de `AcoesLote` |
| `src/app/admin/assinantes/actions/admin-cardapios.paridade.test.ts` | **RED** — paridade de schema, frases e escopo (espelha `admin-produtos.paridade.test.ts`) |
| `tests/migrations/rpc_aplicar_cardapio_em_categoria_definer.test.ts` | **RED** — as 4 provas de role da RPC convertida |

### Arquivos a Modificar (nível função)

| Arquivo | Mudança |
|---|---|
| `src/lib/actions/cardapio.ts` | remove as constantes/helpers movidos e passa a importá-los de `cardapio-contrato.ts`; `produtosQueFicariamOrfaos`/`produtosVinculados` saem e viram `buscarProdutosQueFicariamOrfaos(supabase, loja.id, id)`; `preverLoteAction` passa a usar a query compartilhada + `resumirPrevia`. **Zero mudança de comportamento** |
| `src/lib/supabase/queries/cardapios.ts` | `+ buscarProdutosQueFicariamOrfaos(client, lojaId, cardapioId)` e `+ buscarLinhasDaPrevia(client, lojaId, escopo)` (o `select("id, nome, visibilidade, oculto")` hoje inline) |
| `src/lib/actions/admin-loja.ts` | `+ EscopoLoja.inserirVarios`; `FromSolto` ganha `upsert` |
| `src/app/admin/assinantes/actions/admin-produtos.ts` | `+ definirVisibilidadeEmProdutosAdmin(lojaId, payload)` |
| `src/app/admin/assinantes/[lojaId]/carga-cardapios.ts` | `+ carregarCardapiosDoPainelAdmin(lojaId)` |
| `src/app/admin/assinantes/[lojaId]/layout.tsx` | `rotasAusentes` deixa de listar `"cardapios"`; comentário reescrito |
| `src/app/admin/assinantes/[lojaId]/produtos/CardapioAdminClient.tsx` | `hrefCardapios` → rota admin; `+ lote={{ cardapios, acoes }}`; a page passa a carregar `descreverVigencia` por cardápio |
| `src/app/admin/assinantes/[lojaId]/produtos/page.tsx` | monta `cardapios: CardapioParaLote[]` (id, nome, `descreverVigencia` com o fuso da loja-alvo) a partir de `carregarCardapiosAdmin` |
| `src/app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient.tsx` | `+ baseCardapios: string` obrigatória; os 3 `href` passam a derivar dela |
| `src/app/(painel)/painel/(bloqueavel)/cardapios/page.tsx` | passa `baseCardapios="/painel/cardapios"` |
| `src/components/painel/rotaCardapiosInjetada.test.tsx` | `vigiados()` inclui `app/(painel)/painel/(bloqueavel)/cardapios/**`; `+ it` afirmando que o `FormProduto` com href admin renderiza o botão |
| `src/app/admin/assinantes/enforcement-escopo-admin.test.ts` | `ESCRITA` casa `upsert`; `ALLOWLIST_INSERT` ganha `admin-entrega.ts`/`taxas_entrega` com o motivo já revisado |
| `tests/migrations/rpc_aplicar_cardapio_em_categoria.test.ts` | a asserção "`asService` é recusado com `loja alheia`" **inverte** (ver Ordem, fase 1) |
| `src/lib/actions/cardapio.crud.test.ts`, `cardapio.test.ts` | mantêm as asserções; só os imports mudam. **Se alguma frase mudar, o plano está errado** |
| `references/architecture.md`, `references/seguranca.md` | `escriba`: o `cardapio-contrato.ts` como 2ª instância do padrão de contrato neutro; a 3ª conversão invoker→definer em §2 |

### NÃO tocar (com motivo)

| Arquivo | Motivo |
|---|---|
| `supabase/migrations/20260920134000_*.sql` (e qualquer migration já aplicada) | migration aplicada é imutável; a conversão é `create or replace` numa migration NOVA |
| `src/lib/validacoes/cardapio.ts` | é o zod isomórfico; já serve os dois mundos sem alteração |
| `src/lib/utils/vigenciaCardapio.ts`, `descreverVigencia.ts`, `estadoCardapioPainel.ts`, `contarProdutosEscondidos.ts`, `calcularFimDoPreset.ts`, `fusoLoja.ts` | puros, sem I/O, sem noção de mundo — reusados como estão |
| `src/components/painel/FormVigencia.tsx`, `PreviewVigencia.tsx`, `SeletorProdutosDoCardapio.tsx`, `DialogoLoteCardapio.tsx`, `BarraSelecaoLote.tsx`, `useLoteDeProdutos.tsx`, `contrato-lote.ts` | já parametrizados por `acoes`/`voltarHref`; **se algum precisar mudar, o plano está errado** |
| `src/components/ui/**` | gerado pelo shadcn CLI |
| Qualquer coisa em `src/app/(publica)/**` | a vitrine não muda: nenhuma regra de vigência é tocada |
| `src/lib/actions/produto.ts` | o lojista não muda; só o gêmeo admin nasce |
| `src/types/supabase.ts` | morto (CLAUDE.md) |

---

### Dependências Externas

**Nenhuma.** Nenhum pacote novo, nenhuma API externa, nenhuma chamada de rede nova.

**Custo e quota (`architecture.md` §9 nº1):** custo variável **zero**. Supabase Pro é fixo em
$25/mês; a conversão da RPC não adiciona round trip (a função continua sendo **uma** chamada) e
as três rotas admin somam, no pior caso (detalhe), **4 queries em `Promise.all`** — o mesmo
perfil de `/admin/assinantes/[lojaId]/produtos`, que já roda com 3. Nenhuma query N+1: a
contagem de escondidos vem de duas leituras agregadas em memória
(`buscarCardapiosDoPainel`), não de um `count` por cardápio. Nenhum comportamento ao estourar a
definir, porque não há quota a estourar.

---

### Ordem de Implementação

Estrita. Cada fase depende da anterior por **contrato**, não por conveniência.

**Fase 0 — RED (agente `tdd`, obrigatório antes de qualquer código de produção).**
Dois arquivos, com output `FAIL` capturado:

1. `tests/migrations/rpc_aplicar_cardapio_em_categoria_definer.test.ts` (pglite, `createTestDb()`):
   - `asService` com o trio coerente → **insere** (hoje falha: `loja alheia`);
   - `asService` com `p_cardapio_id` da loja B → erro contendo **o fragmento** `cardapio fora da loja`;
   - `asService` com `p_categoria_id` da loja B → **fragmento** `categoria fora da loja`;
   - `asUser` (dono da loja B) com `p_loja_id` da loja A → **fragmento** `loja alheia` — a trava
     que a conversão reloca da RLS para T2;
   - `asAnon` → sem `EXECUTE` (`42501`);
   - **sem JWT** (fail-open de T2): `auth.role()` NULL não pode autorizar;
   - asserção de que nenhuma linha de `cardapio_produtos` cruza lojas em nenhum dos ramos.
   > Afirmar **o fragmento da mensagem**, não só o SQLSTATE — trava de escopo passa por acidente
   > aritmético quando só se checa o código.
2. `src/app/admin/assinantes/actions/admin-cardapios.paridade.test.ts` (vitest, mocks só de I/O,
   espelhando `admin-produtos.paridade.test.ts`):
   - mesmo `schemaCardapio`: recorrente sem eixo recusado com **a frase literal de §9.6**;
   - preset `mensal` com início 31/01 grava `prazo_fim = 28/02`, **descartando** o `fim` do cliente;
   - `timezone` usado é o da **loja-alvo**, não o do admin (asserção sobre o instante gravado);
   - `loja_id` gravado é o da URL mesmo com `loja_id` hostil no payload — **asserção sobre a
     linha**, não sobre o erro;
   - `ordem = max+1` lido da loja-alvo;
   - as seis frases (parse, vigência, RN-14 com e sem número, lote genérico, órfão no lote)
     **byte a byte** iguais às do lojista;
   - `registrarAcessoAdmin` chamado em cada uma das 8 escritas e **não** em `preverLoteAdmin`;
   - `preverLoteAdmin` com id de outra loja devolve **a mesma resposta** de id inexistente.

**Fase 1 — Migration.** Escrever `20260921120000_…definer.sql` e inverter a asserção `asService`
do RED antigo (`tests/migrations/rpc_aplicar_cardapio_em_categoria.test.ts`), com comentário
apontando para esta issue. *Depende de:* o RED existir, senão a conversão é feita sem prova.
**Pedir autorização antes do `npx supabase db push`.**

**Fase 2 — Extrações (refatoração pura, suíte existente verde sem edição).**
`cardapio-contrato.ts` + `buscarProdutosQueFicariamOrfaos`/`buscarLinhasDaPrevia` + `cardapio.ts`
reescrito para importar. *Depende de:* nada. *Precede tudo:* escrever a action admin antes desta
fase é escrever a cópia que a issue existe para impedir.

**Fase 3 — Wrapper.** `EscopoLoja.inserirVarios` + a camada 3 casando `upsert` + a entrada de
allowlist de `admin-entrega.ts`. *Depende de:* nada; *precede* a fase 4 porque a action nova usa
`inserirVarios` e não pode nascer com `svc.from(...).upsert` cru.

**Fase 4 — Server Actions admin.** `admin-cardapios.ts` (9) + `definirVisibilidadeEmProdutosAdmin`.
*Depende de:* 1 (a RPC aceita `service_role`), 2 (o contrato neutro existe), 3 (`inserirVarios`).
Ao fim desta fase o RED da fase 0 fica **verde**.

**Fase 5 — Loaders.** `carregarCardapiosDoPainelAdmin` + `carregarCardapioDetalheAdmin`.
*Depende de:* nada além das queries; separado da fase 4 porque loader e action caem sob camadas
**diferentes** do enforcement.

**Fase 6 — Rotas e wrappers client.** As 3 pages + os 3 `*AdminClient.tsx` +
`CardapiosClient.baseCardapios` + a lista de vigiados de `rotaCardapiosInjetada.test.tsx`.
*Depende de:* 4 e 5. **A prop `baseCardapios` entra antes da primeira rota admin existir** — o
contrário reintroduz, por uma janela de commit, o bug de `f26cc6a`.

**Fase 7 — Fiação final.** `rotasAusentes` sem `"cardapios"`; `hrefCardapios` e `lote` no
`CardapioAdminClient`; `descreverVigencia` na `produtos/page.tsx` admin. *Depende de:* 6 — soltar
o item do menu antes de a rota existir é publicar um 404.

**Fase 8 — Gates + `auditar` em fable + `escriba`.** `npx tsc --noEmit` → `npm run lint` →
`npm test` → `npm run build`; `verificar` no cloud com a loja "Lanches base".

---

### Checklist de Validação Pós-Implementação

- [ ] `npm run build` sem warning novo (é onde `const` exportada em `'use server'` quebra)
- [ ] `npx supabase migration list` — coluna **Remote** preenchida para `20260921120000`
- [ ] `npx supabase gen types typescript | diff - src/lib/database.types.ts` → sem diff
- [ ] RLS/RPC testada: `asAnon` recebe deny (`42501`); `asUser` de outra loja recebe `loja alheia`
- [ ] `service_role` **não** mistura lojas por nenhum caminho novo: RPC, upsert de lote, delete de
      lote, update de visibilidade e update de cardápio — cinco provas, uma por caminho
- [ ] Payload adulterado (`loja_id` hostil) não muda a loja escrita — asserção sobre a linha
- [ ] `grep -rn '"/painel/cardapios' src/components/painel src/app/\(painel\)/painel/\(bloqueavel\)/cardapios --include=*.tsx | grep -v '\.test\.'` → **vazio**
- [ ] `enforcement-escopo-admin.test.ts` descobre `admin-cardapios.ts` e passa nas camadas 2, 3 e 4
- [ ] `enforcement-props-action-admin.test.ts` descobre os 3 wrappers e passa
- [ ] Nenhum secret no client; nenhum nome de produto/cardápio em `admin_acessos.metadados`
- [ ] Verificação manual no cloud, loja "Lanches base": criar cardápio pelo hub admin, aplicar a
      uma categoria, marcar um produto como exclusivo e **salvar sem o toast de RN-14**

---

### Riscos que nenhum gate mecânico pega

**R1 — `upsert` é invisível para a camada 3 do enforcement.** `ESCRITA`
(`enforcement-escopo-admin.test.ts:173`) casa só `update|delete|insert`. Hoje já existe um
`svc.from("taxas_entrega").upsert(...)` cru em `admin-entrega.ts:131` que **nenhuma** camada vê —
é legítimo (filha ancorada por posse), mas passa por ausência de rede, não por aprovação. Esta
issue introduziria o segundo. *Mitigação:* fase 3, com prova de letalidade por mutação (plantar
um `upsert` cru numa tabela com `loja_id` e ver a suíte ficar vermelha).

**R2 — a conversão da RPC afeta o caminho que HOJE FUNCIONA.** Sob `definer`, a RLS deixa de ser
avaliada dentro da função **para o lojista também**. Se T2 for escrita errada, o lojista passa a
escrever em loja alheia — e nenhum teste atual cobre isso, porque hoje quem barra é a RLS.
*Mitigação:* o caso `asUser` (dono da loja B, `p_loja_id` da loja A) é **obrigatório** na fase 0.
E o `coalesce(auth.role(), '')` não é estético: sem ele T2 vira fail-**open** por `NULL`
(achado real de `20260918130000`).

**R3 — a query nova não entra na descoberta de `enforcement-escopo-queries.test.ts`.** A
descoberta casa a assinatura `(svc: …, lojaId: string)`; as funções de `queries/cardapios.ts`
usam `client`, por consistência com as irmãs. `buscarProdutosQueFicariamOrfaos` e
`buscarLinhasDaPrevia` herdam a lacuna. *Mitigação:* teste unitário dedicado afirmando o
`.eq("loja_id", lojaId)` por comportamento (cardápio da loja B → `[]` mesmo sob `svc`).
Generalizar a descoberta para `(client, lojaId)` é issue própria — mudaria o raio do guard sobre
todas as queries do lojista.

**R4 — `revalidarLojaAdmin` usa a forma coringa `("/loja/[slug]", "page")`.** Toda escrita admin
de cardápio invalida o Router Cache da vitrine de **todas** as lojas. É o comportamento de todas
as outras actions admin (custo já pago), mas a fatia de cardápio foi a primeira a evitá-lo de
propósito (`cardapio.ts:88-99`). Divergência consciente, registrada; não é bug.

**R5 — o admin pode desfazer a declaração do lojista.** `converterExclusivosParaMenuAdmin` e
`definirVisibilidadeEmProdutosAdmin` mudam `visibilidade`, que a spec define como **declaração do
lojista** e que o sistema nunca muda sozinho. No hub admin o clique é de **outra pessoa**. É
aceito (o hub admin existe para operar em nome do lojista) e fica rastreável em `admin_acessos` —
mas não há notificação ao lojista. *Nenhum gate pega isso.*

**R6 — três hardcodes de rota a mais de distância.** `CardapiosClient` tem três
`href="/painel/cardapios/…"`. Se a fase 6 injetar `baseCardapios` mas alguém adicionar um quarto
link depois, o `grep` de `rotaCardapiosInjetada.test.tsx` só pega **se a lista de vigiados tiver
sido estendida**. A extensão da lista é a parte da fase 6 que **não pode** ser cortada por falta
de tempo — é ela que trava a terceira reincidência do mesmo bug (`8bfe902`, `f26cc6a`).

**R7 — `npm test` verde com migration só-local.** O `db push` é o passo que nenhum gate local
alcança: RPC não convertida no cloud ⇒ `42501`/`42883` em runtime com CI verde (CLAUDE.md).
*Mitigação:* `npx supabase migration list` no checklist e verificação manual em "Lanches base".

**R8 — escopo que parece pequeno e não é.** "Só criar três rotas" tem 12 arquivos novos e 15
modificados, em 4 camadas. Se a fase 2 (extração) for pulada "para ganhar tempo", o resultado é
uma segunda cópia de seis frases literais e de dois reconhecedores de erro no caminho que **não
tem RLS** — e a issue terá produzido exatamente a classe de defeito que veio corrigir.
