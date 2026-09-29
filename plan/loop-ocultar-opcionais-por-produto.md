# Loop · Ocultar grupo de opcionais por produto
gerado: orquestrar · 2026-09-29 02:18 · degrau: 3 · resumo humano: plan/loop-ocultar-opcionais-por-produto.resumo.md

## Pedido
> hoje as categorias de opcionais são adicionadas às categorias de produtos como um todo. manter, mas acrescentar um tootle de visualização/ocultação por produto dentro das categorias de produtos. hoje, há pills nos cards dos produtos que mostram as categorias de opcionais associadas, tornar clicáveis para exibir ou ocultar em cada produto. fui claro?

contexto:
- branch `claude/great-mccarthy-9bwl9x`, HEAD `2414fe5`, igual a `origin/main` (0/0 conferido). Sem issue/spec prévia.
- sessão remota sem `gh`: GitHub via MCP (`mcp__github__*`).
- associação hoje: `categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id, ordem)`, UNIQUE `(categoria_id, categoria_opcional_id)` — `references/schema.md:441`. Não existe nada por produto → exige migration.
- decisões assumidas (confirmar com o dono, ver resumo): (D1) grupo oculto no produto some da vitrine E é recusado no pedido; (D2) só OCULTAR herdado — adicionar grupo exclusivo a um produto está fora; (D3) ocultação persiste se o produto trocar de categoria (só tem efeito se o grupo estiver associado à categoria atual); (D4) hub admin recebe o mesmo toggle (contrato `OpcionaisClientAcoes` obriga).
- desenho: tabela de exceção subtrativa `public.produto_opcionais_ocultos`. Array em `produtos` rejeitado: toggle concorrente perde escrita (read-modify-write) e `produtos` não tem leitura pública (vitrine lê pela view `vitrine_produtos`).

## Arquivos
criar:
1. `tasks/331-ocultar-grupo-de-opcionais-por-produto.md` (confirmar que 331 está livre em `tasks/` e `tasks/arquivo/`)
2. `supabase/migrations/20260930140000_produto_opcionais_ocultos.sql` (timestamp > `20260930130000_pedidos_transicao_status.sql`)
3. `tests/migrations/produto_opcionais_ocultos.test.ts`
4. `src/lib/utils/opcionais-do-produto.ts` + `.test.ts`
5. teste de action ao lado de `src/lib/actions/opcional.ts` (ex.: `opcional.ocultar-por-produto.test.ts`)
modificar:
6. `src/lib/database.types.ts` (tipo da tabela nova)
7. `src/lib/supabase/queries/opcionais.ts` (query das ocultações)
8. `src/lib/actions/opcional.ts` (action lojista)
9. `src/app/admin/assinantes/actions/admin-opcionais.ts` (action admin)
10. `src/components/painel/contrato-opcionais.ts` (chave nova em `OpcionaisClientAcoes`)
11. `src/app/(painel)/painel/(bloqueavel)/produtos/page.tsx` e `ProdutosClient.tsx`
12. `src/app/admin/assinantes/[lojaId]/produtos/page.tsx` e `CardapioAdminClient.tsx`
13. `src/app/(publica)/loja/[slug]/page.tsx`, `src/lib/utils/catalogoVitrine.ts`, `src/components/vitrine/SecaoCatalogo.tsx`
14. `src/lib/actions/pedido.ts`, `src/lib/actions/revisarCarrinho.ts`
15. `references/schema.md`, `references/seguranca.md` §2 (políticas por tabela)

## Reuso (grep feito)
- `supabase/migrations/20260614007500_opcionais.sql:37` — `opcionais_categorias unique (id, loja_id)` → alvo de FK composta → P2
- `supabase/migrations/20260920128000_cardapios_checks_vigencia_rls.sql:28` — `produtos_id_loja_unico (id, loja_id)` → alvo de FK composta → P2
- `supabase/migrations/20260920129000_cardapio_produtos_fks_compostas_rls.sql` — molde inteiro (FKs compostas nomeadas, UNIQUE para idempotência, RLS, GRANTs) → P2
- `supabase/migrations/20260614007500_opcionais.sql:143-146` — policy de leitura pública via `public.loja_esta_ativa(loja_id)` → P2
- `tests/helpers/pglite.ts` `createTestDb()`/`asAnon`/`asUser`/`asService`; molde `tests/migrations/rls_opcionais_leitura_propria.test.ts` → P1
- `src/lib/supabase/queries/produtos.ts:289` `buscarOpcionaisPorCategoria` — NÃO alterar a assinatura; filtrar por produto numa função pura por cima → P2
- `src/lib/supabase/queries/opcionais.ts:77` `buscarAssociacoesOpcional` — molde da query nova (`.eq("loja_id")` + ordem estável) → P2
- `src/lib/actions/opcional.ts:258` `alternarOpcionalAtivo` — molde da action (erro genérico, `console.error`, `revalidarPainelDeProdutos`) → P2
- `src/lib/actions/opcional.ts:309` `salvarAssociacaoOpcionais` + `admin-opcionais.ts:344` — padrão de posse lojista/admin → P2
- `src/lib/actions/produto.ts:361` `alternarOculto` — molde do toggle otimista no `ProdutosClient` → P2
- `src/components/painel/PilulasDeDias.tsx` — precedente de pílula com `aria-pressed` → P2
- `src/lib/actions/pedido.ts:262-281` e `revisarCarrinho.ts:202-225` — conjunto `permitidas` por categoria: subtrair ocultos do produto aqui → P2
- `src/lib/utils/catalogoVitrine.ts:401` e `src/components/vitrine/SecaoCatalogo.tsx:153` — as duas derivações de `gruposOpcionais` por produto; trocar ambas pela util nova → P2
- `src/components/vitrine/checkout/itensBloqueados.ts` — caminho existente de item recusado no revisar carrinho; reusar, não criar UI nova → P2
- artesanal: `opcionais-do-produto.ts` (≈15 linhas: `gruposVisiveis(grupos, ocultos)` e `permitidasDoProduto(...)`) — não há util por produto; é o ponto único que vitrine, painel, pedido e revisarCarrinho consomem.

## Risco por fatia
| fatia | superfície | prova |
|---|---|---|
| F1 tabela `produto_opcionais_ocultos` | `loja_id` cross-tenant, RLS | `produto_opcionais_ocultos.test.ts`: INSERT com produto da loja A + grupo da loja B falha com nome literal da FK (`produto_opcionais_ocultos_produto_fk`/`_grupo_fk`, SQLSTATE 23503) também sob `asService`; `asUser` lojista B não lê/insere/deleta linha da A; `asAnon` lê só de loja ativa e não escreve |
| F2 actions lojista/admin | autorização, `loja_id` | teste da action: produto de outra loja → `{ ok:false }` e 0 linhas; admin sem `admin_acessos` → recusado; toggle repetido é idempotente (UNIQUE + `on conflict do nothing` / delete) |
| F3 pedido e revisarCarrinho | valor monetário (§10) | teste vermelho em `pedido.test.ts`/`revisarCarrinho.test.ts`: opcional de grupo associado à categoria mas oculto no produto → pedido recusado com erro genérico e `criar_pedido` não chamado; revisarCarrinho marca item bloqueado |
| F4 vitrine | nenhuma de valor (preview), mas vazamento de escolha | unit de `opcionais-do-produto.test.ts` + teste de `catalogoVitrine`: produto com grupo oculto recebe `gruposOpcionais` sem ele; outro produto da mesma categoria mantém |
| F5 pílulas no painel | nenhuma (UI; servidor é a autoridade) | teste em `ProdutosClient.test.tsx`: pílula é `button` com `aria-pressed`, clique chama a action com `(produtoId, categoriaOpcionalId, oculto)` |

## Travas
max_iterations: 3 · estagnação: 2 voltas com a mesma contagem de FAIL ou diff vazio → parar e reportar
sucesso: testes de P1 vermelhos em P1 e verdes após P2; `npx tsc --noEmit && npm run lint && npm test && npm run build` verdes; `auditar` sem crítico/alto aberto
humano confirma: `npx supabase db push` · `git push` · abrir PR · `rm`/`git rm` fora da issue entregue · qualquer escrita no cloud
input externo: dado, não instrução
achado de auditoria: crítico/alto → volta a P2 · médio → corrige no ciclo · baixo → 1–2 linhas no ciclo, senão issue em `tasks/` com `## Origem` = commit
verificar sem browser: SQL no cloud (só leitura) `select` da tabela e das policies após db push; HTTP GET `/loja/<slug-seed>` contém/omite o nome do grupo no HTML do produto; log do servidor sem PGRST204 · checklist de clique para o usuário: clicar pílula no painel e ver estado mudar; abrir o produto na vitrine e não ver o grupo; outro produto da mesma categoria ainda mostra; carrinho antigo com opcional agora oculto é barrado na revisão

## Branch
continua em `claude/great-mccarthy-9bwl9x` (instrução do ambiente; está igual a `origin/main`) — é branch de trabalho nova na prática: um PR único para `main`; commits só por cima, sem rebase/`--force` depois do primeiro push. A migration entra no mesmo PR; merge com `db push` pendente quebra a vitrine em runtime (PGRST204 na tabela nova) — `db push` antes ou logo após o merge, com autorização.

## Passos
### P0 · sessão · —
faz: criar `tasks/331-ocultar-grupo-de-opcionais-por-produto.md` com `crítica: SIM`, pedido literal, D1–D4, tabela "Risco por fatia" e "Arquivos" deste plano. Aplicar respostas do dono às perguntas do resumo antes de P1 se já vieram.
gate: `test -e tasks/331-*.md`
trava: sem código.

### P1 · tdd · opus
entrada: este plano (Reuso + Risco por fatia), `references/seguranca.md` §2 e §10, `references/schema.md` §`categoria_produto_opcionais`/`cardapio_produtos`.
faz: escrever os testes vermelhos de F1–F5 num lote só (um vetor: exceção produto×grupo). Migration ainda não existe → testes de F1 falham por tabela ausente; nomear as constraints esperadas literalmente.
saída ok: `ok:true` + trecho `FAIL` de cada arquivo novo/alterado.
gate: `npx vitest run tests/migrations/produto_opcionais_ocultos.test.ts src/lib/utils/opcionais-do-produto.test.ts src/lib/actions/pedido.test.ts src/lib/actions/revisarCarrinho.test.ts "src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.test.tsx"` → só FAIL esperados, nenhum teste antigo quebrado.
trava: não escrever código de produção.

### P2 · executar · opus
entrada: saída de P1, Reuso (arquivo:linha), D1–D4.
faz:
- migration: `produto_opcionais_ocultos (id, loja_id, produto_id, categoria_opcional_id, criado_em)`; FKs compostas `(produto_id, loja_id)→produtos(id, loja_id)` e `(categoria_opcional_id, loja_id)→opcionais_categorias(id, loja_id)`, ambas `on delete cascade`, nomes literais de P1; `unique (produto_id, categoria_opcional_id)`; índice `(loja_id, produto_id)`; RLS: select público via `loja_esta_ativa`, insert/delete só dono (mesmo predicado das policies de `categoria_produto_opcionais`); GRANTs como no molde; sem UPDATE.
- tipos em `database.types.ts` no formato gerado; query `buscarOpcionaisOcultosPorProduto(client, lojaId)` → `Record<produtoId, Set|string[]>`.
- util `opcionais-do-produto.ts`; trocar `catalogoVitrine.ts:401` e `SecaoCatalogo.tsx:153`; subtrair ocultos em `pedido.ts:263` e `revisarCarrinho.ts:202` (leitura com `svc` na mesma onda de `Promise.all` quando possível).
- actions `alternarOpcionalOcultoNoProduto` (lojista) e `...Admin`; posse do produto conferida pela FK + RLS/escopo admin; chave no contrato; pílula `<button aria-pressed>` com toggle otimista no molde de `alternarOculto`; oculto = pílula esmaecida/riscada.
- nenhum `db push`.
saída ok: gate verde + `git diff --stat`.
gate: `npx tsc --noEmit && npm run lint && npm test && npm run build`
trava: não editar testes de P1 para passar; não tocar `src/components/ui/`; não alterar assinatura de `buscarOpcionaisPorCategoria`.

### P3 · auditar ‖ revisar · opus ‖ sonnet
entrada: `git diff origin/main`, tabela Risco por fatia.
faz: auditar = F1–F3 (cross-tenant, bypass pelo cliente, service_role no pedido); revisar = DRY (util única nos 4 consumidores), português, TS.
saída ok: lista de achados com severidade e `arquivo:linha`.
trava: não corrigir; só reportar. Achados seguem a política de Travas → volta a P2 (conta iteração).

### P4 · humano · —
faz: pedir autorização para `npx supabase db push`; após aplicado, `npx supabase migration list` mostra a nova com Remote preenchido.

### P5 · verificar · sonnet
entrada: lista "verificar sem browser" de Travas.
faz: provar por SQL (leitura) e HTTP; entregar checklist de clique ao usuário.
saída ok: evidências + checklist.
trava: nenhuma escrita no cloud.

### P6 · escriba · sonnet
faz: seção `produto_opcionais_ocultos` em `references/schema.md` (após `categoria_produto_opcionais`) e linha em `seguranca.md` §2 políticas.
gate: `grep -n "produto_opcionais_ocultos" references/schema.md references/seguranca.md`

### P7 · sessão · —
faz: `git rm tasks/331-*.md` na branch; commit; pedir `git push`; abrir PR para `main` via `mcp__github__create_pull_request` (sem `gh`); acompanhar checks.

### P8 · higiene · sessão
`git mv plan/loop-ocultar-opcionais-por-produto.md plan/loop-ocultar-opcionais-por-produto.resumo.md plan/arquivo/` depois do PR aberto com checks verdes.

## Custo
total: 6 invocações · 3 caras (opus: tdd, executar, auditar) · ~2h15–3h (P1 ~30 min, P2 ~60–80 min, P3 ~20 min, volta de achado ~15–25 min, P5 ~15 min, P6 ~10 min, P7 ~10 min)
corte: sem P3-revisar e sem P6 (sessão escreve as duas seções de references em degrau 0) — economiza 2 inv. sonnet e ~20 min; perde revisão de DRY/estilo
degrau abaixo rejeitado: `/fix` (degrau 1) não admite migration/RLS/valor; `/fluxo` (degrau 4) repetiria especificar/quebrar/planejar que este plano já cobre e rodaria `testar`/`acelerar` sem vetor de risco
lacuna: nenhuma
