# Loop · Grupos de opcionais por produto (ocultar herdado + adicionar exclusivo ordenável, em 3 telas)
gerado: orquestrar · 2026-09-29 02:18 · revisado: 02:33 (exclusivo) · 02:36 (3 pontos de edição) · 02:48 (ordem por produto) · degrau: 3 · resumo humano: plan/loop-ocultar-opcionais-por-produto.resumo.md

## Pedido
> hoje as categorias de opcionais são adicionadas às categorias de produtos como um todo. manter, mas acrescentar um tootle de visualização/ocultação por produto dentro das categorias de produtos. hoje, há pills nos cards dos produtos que mostram as categorias de opcionais associadas, tornar clicáveis para exibir ou ocultar em cada produto. fui claro?

ampliação 1 (via coordenador): deve ser possível ADICIONAR um grupo de opcionais a um produto específico (grupo exclusivo, não ligado à categoria do produto).
ampliação 2 (via coordenador): a escolha produto a produto (ocultar herdado + adicionar exclusivo) deve estar disponível em DOIS lugares além das pílulas do card: (a) na tela de opcionais, a partir de um grupo, escolher em quais produtos ele aparece/oculta; (b) no modal de edição do produto. Vale também para o admin onde houver equivalente. Uma única fonte de verdade, sem lógica duplicada.
ampliação 3 (via coordenador, substitui "exclusivos por último; reordenar fica fora"): os grupos de opcionais aparecem na loja na ordem que o lojista configurar. Já existe lógica para ordenar os grupos dentro da categoria de produto — reusar. Se o lojista adiciona um grupo exclusivo a um produto, deve poder posicioná-lo em qualquer ponto entre os herdados, não só no fim.

respostas do usuário: (D1) ocultar também bloqueia no pedido = correto · (D3) oculto persiste ao mudar de categoria, só tem efeito se o grupo existir na nova = correto · (D6) substituído pela ampliação 3.
pendente com o usuário: (D5) produto sem categoria pode ter exclusivo (assumido sim) · (D9) regra de ordem "posição fixa" (ver Desenho → Ordem) · versão completa/rápida.

contexto:
- branch `claude/great-mccarthy-9bwl9x`, HEAD `e5b239d`, pushada, sincronizada, sem PR. Sessão sem `gh`: GitHub via MCP.
- hoje: só `categoria_produto_opcionais` (`references/schema.md:441`), com `ordem` 0-based = autoridade da ordem na vitrine (issue 208). Nada por produto → migration.
- ordem existente levantada:
  - coluna `categoria_produto_opcionais.ordem` — `supabase/migrations/20260917120000_ordem_em_categoria_produto_opcionais.sql`.
  - escrita só pela RPC `public.reordenar_opcionais_da_categoria` (SECURITY DEFINER desde `20260918121000_rpc_reordenar_opcionais_da_categoria_definer.sql`), via `reordenarOpcionaisDaCategoria` (`src/lib/actions/opcional.ts:417`) e `...Admin` (`admin-opcionais.ts:454`).
  - UI: `src/components/painel/ModoReordenar.tsx` (genérico dnd-kit + setas; `onReordenar(ids: string[]) → ResultadoSalvamento`, `:144`; `renderLinha`, `:191`), casca `ReordenarOpcionaisDaCategoria.tsx`, usada em `CartaoAssociacaoOpcionais.tsx:370`. Salvamento coalescido em `src/lib/utils/salvamento-coalescido.ts:48`.
  - leitura: `buscarOpcionaisPorCategoria` (`src/lib/supabase/queries/produtos.ts:289`) já devolve grupos ordenados por `ordem` (desempate por nome).
- telas (admin REUSA as do painel em todos os pontos):
  - card: `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx:1746-1772`; admin via `CardapioAdminClient.tsx` → `ProdutosClient`.
  - modal: `src/components/painel/FormProduto.tsx` (montado em `ProdutosClient.tsx:1142`; `categoriaId` local em `:173`).
  - tela de opcionais: `opcionais/OpcionaisClient.tsx:1017-1031` → `CartaoAssociacaoOpcionais` por categoria; admin `OpcionaisAdminClient.tsx:49` → mesmo `OpcionaisClient`.
  - dados: painel `opcionais/page.tsx:44-47` não carrega produtos; admin `carga-opcionais.ts:80` já carrega.
  - revalidação: `revalidarPainelDeProdutos` (`opcional.ts:46`), `revalidarLojaAdmin` (`admin-opcionais.ts:38`); vitrine dinâmica (`loja/[slug]/page.tsx:47`).

## Desenho (decidido)
Dado — UMA tabela `public.produto_grupos_opcionais (id, loja_id, produto_id, categoria_opcional_id, modo, posicao, criado_em)`:
- `modo in ('adicionar','ocultar')`, `unique (produto_id, categoria_opcional_id)`, FKs compostas com `loja_id`.
- `posicao int null`, `check (posicao is null or posicao >= 0)`, `check (modo = 'adicionar' or posicao is null)` — só exclusivo tem posição.
- duas tabelas rejeitadas: o par poderia estar adicionado E oculto; o UNIQUE torna o estado contraditório impossível.

Permissão: `permitidos(produto) = grupos(categoria) ∪ {adicionar} − {ocultar}`. `ocultar` sem o grupo na categoria = sem efeito (D3); `adicionar` de grupo já na categoria = sem efeito.

Ordem (D9, "posição fixa") — a ordem da categoria NÃO é copiada para o produto:
- herdados: SEMPRE na ordem de `categoria_produto_opcionais.ordem` (fonte única, a mesma de hoje), menos os ocultos.
- exclusivo com `posicao = k`: ocupa o k-ésimo lugar (0-based) da lista final do produto; herdados se acomodam em volta.
- exclusivo com `posicao null` (padrão ao adicionar pelo card ou pela tela de opcionais): vai para o fim, em ordem de adição (`criado_em`, desempate `id`).
- algoritmo único: `base` = herdados visíveis em ordem da categoria; exclusivos posicionados ordenados por (`posicao`, `criado_em`, `id`) inseridos um a um em `min(posicao, base.length)`; depois os sem posição.
- consequências (registrar para o dono): categoria reordena → exclusivo fica no mesmo lugar numérico e os herdados mudam em volta; categoria ganha grupo → o novo herdado entra na ordem da categoria e o exclusivo mantém seu número; categoria perde grupos ou herdado é oculto → exclusivo mantém o número, e se a lista ficou menor que ele vai para o fim.
- alternativa rejeitada (oferecer só se o dono pedir): "grudado ao vizinho" (âncora `depois_de`) — exige tratar âncora removida/oculta e explica pior na tela.
- produto sem exclusivo → lista idêntica à da categoria (zero linhas, zero custo).
- a ordem dos herdados NÃO é editável por produto: na lista do produto só exclusivos se movem; herdados aparecem fixos com a dica "ordem definida na categoria".

Fonte única — quatro camadas, um dono cada:
1. **Regra pura** `src/lib/utils/opcionais-do-produto.ts`: `estadoDoGrupoNoProduto`, `modoParaAlternar`, `idsPermitidosDoProduto` (pedido/revisarCarrinho), `ordenarGruposDoProduto(herdadosOrdenados, exclusivos, regras)` (a ÚNICA implementação da ordem; `gruposVisiveisDoProduto` a usa), `posicoesAposReordenar(idsNovos, herdadosOrdenados) → alteracoes | erro` (converte a sequência do `ModoReordenar` em `posicao` só dos exclusivos; recusa se a ordem relativa dos herdados mudou).
2. **Escrita** — UMA Server Action em lote por via: `salvarGruposOpcionaisDosProdutos(alteracoes)` e `...Admin(lojaId, alteracoes)`. `alteracoes: { produtoId, categoriaOpcionalId, modo: 'adicionar'|'ocultar'|null, posicao?: int 0..999 | null }[]`, zod `.strict()`, 1..200, `posicao` só com `modo:'adicionar'`. Toggle, adicionar, remover e REORDENAR usam esta mesma action (reordenar = upsert de `posicao` dos exclusivos). `upsert` (on conflict `(produto_id, categoria_opcional_id)`) dos não nulos, depois `delete` dos nulos; upsert falha inteiro com par de outra loja (FK composta) e o delete não roda. Falha parcial no delete → `{ok:false}` + revalidação. Sem RPC: `posicao` não é permutação (não há invariante de conjunto completo a conferir), diferente de `reordenar_opcionais_da_categoria`.
3. **Leitura** — `buscarRegrasGruposOpcionais(client, lojaId)` (3 telas; inclui `posicao`, `criado_em`); `buscarRegrasPorProdutos(client, produtoIds)` (pedido/revisarCarrinho, sem ordem); `buscarGruposExclusivosPorProduto(client, lojaId)` com itens para a vitrine, reusando o agrupador generalizado de `queries/produtos.ts:315`.
4. **Estado de UI** — hook `src/components/painel/useGruposOpcionaisDoProduto.ts`: regras do servidor + action; mapa otimista; `listaDoProduto(produtoId, herdadosOrdenados)` (chama `ordenarGruposDoProduto`), `alternar`, `aplicarLote`, `reordenar(produtoId, ids)` (chama `posicoesAposReordenar`); reverte em falha; `router.refresh()` no sucesso. Uma instância no `ProdutosClient` compartilhada por card e `FormProduto`; uma no `OpcionaisClient`.

Componentes (só apresentação):
- `PilulasOpcionaisDoProduto` (extraído de `ProdutosClient.tsx:1746-1772`), variante `card | form`: pílulas na ORDEM EFETIVA do produto (a mesma da vitrine); herdadas = `button aria-pressed` (oculta: esmaecida + riscada + "oculto"); exclusivas = borda distinta + "×"; "+ grupo" via `menu.tsx:71`. Sem reordenação no card.
- `ReordenarOpcionaisDoProduto` (nova casca de `ModoReordenar`, no molde de `ReordenarOpcionaisDaCategoria.tsx`): só na variante `form`, só quando o produto tem ≥1 exclusivo. Linhas herdadas renderizadas sem alça/setas via `renderLinha` (`ModoReordenar.tsx:191`); se `renderLinha` não bastar para travar o teclado, acrescentar a `ItemReordenavel` (`:97`) UMA prop opcional `fixo?: boolean` — mudança mínima no genérico, sem afetar os 8 usos atuais. `onReordenar(ids)` → `hook.reordenar` → action em lote.
- `ProdutosDoGrupoOpcional`: Sheet aberto por "Por produto" em cada grupo marcado do `CartaoAssociacaoOpcionais`; duas listas de checkbox ("Produtos desta categoria" = desmarcar oculta; "Outros produtos" = marcar adiciona com `posicao null`). Sem reordenação aqui (a lista é de produtos, não de grupos); texto: "para posicionar o grupo num produto, use a edição do produto".
- `CartaoAssociacaoOpcionais` e `FormProduto` ganham props opcionais (`produtos`, `gruposDoProduto`, `categoriasOpcional`). Seção do form só em modo editar, grava na hora; herdados calculados do `categoriaId` do estado do form.

Onde se reordena (resumo): categoria → como hoje (`CartaoAssociacaoOpcionais`, sem mudança); exclusivo no produto → só no modal do produto; card e tela de opcionais apenas refletem.

## Arquivos
criar:
1. `tasks/331-grupos-de-opcionais-por-produto.md` (confirmar 331 livre em `tasks/` e `tasks/arquivo/`)
2. `supabase/migrations/20260930140000_produto_grupos_opcionais.sql`
3. `tests/migrations/produto_grupos_opcionais.test.ts`
4. `src/lib/utils/opcionais-do-produto.ts` + `.test.ts`
5. `src/lib/actions/opcional.grupos-por-produto.test.ts`
6. `src/components/painel/useGruposOpcionaisDoProduto.ts` + `.test.ts`
7. `src/components/painel/PilulasOpcionaisDoProduto.tsx` + `.test.tsx`
8. `src/components/painel/ReordenarOpcionaisDoProduto.tsx` + `.test.tsx`
9. `src/components/painel/ProdutosDoGrupoOpcional.tsx` + `.test.tsx`
modificar:
10. `src/lib/database.types.ts`
11. `src/lib/supabase/queries/opcionais.ts`, `src/lib/supabase/queries/produtos.ts`
12. `src/lib/actions/opcional.ts`, `src/app/admin/assinantes/actions/admin-opcionais.ts`
13. `src/components/painel/contrato-opcionais.ts`
14. `src/components/painel/ModoReordenar.tsx` (só se `fixo?` for necessário)
15. `src/app/(painel)/painel/(bloqueavel)/produtos/page.tsx`, `ProdutosClient.tsx`, `ProdutosClient.test.tsx`
16. `src/components/painel/FormProduto.tsx`, `FormProduto.test.tsx`
17. `src/components/painel/CartaoAssociacaoOpcionais.tsx`, `CartaoAssociacaoOpcionais.test.tsx`
18. `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/page.tsx`, `OpcionaisClient.tsx`, `OpcionaisClient.test.tsx`
19. `src/app/admin/assinantes/[lojaId]/produtos/page.tsx`, `CardapioAdminClient.tsx`, `src/app/admin/assinantes/[lojaId]/carga-opcionais.ts`, `.../produtos/opcionais/OpcionaisAdminClient.tsx`
20. `src/app/(publica)/loja/[slug]/page.tsx`, `src/lib/utils/catalogoVitrine.ts`, `src/components/vitrine/SecaoCatalogo.tsx`
21. `src/lib/actions/pedido.ts`, `src/lib/actions/revisarCarrinho.ts` + testes
22. `references/schema.md`, `references/seguranca.md` §2

## Reuso (grep feito)
- `supabase/migrations/20260614007500_opcionais.sql:37` — `opcionais_categorias unique (id, loja_id)` → FK composta → P2
- `supabase/migrations/20260920128000_cardapios_checks_vigencia_rls.sql:28` — `produtos_id_loja_unico` → FK composta → P2
- `supabase/migrations/20260920129000_cardapio_produtos_fks_compostas_rls.sql` — molde de tabela de junção → P2
- `supabase/migrations/20260614007500_opcionais.sql:143-146` — leitura pública via `loja_esta_ativa` → P2
- `tests/helpers/pglite.ts`; molde `tests/migrations/rls_opcionais_leitura_propria.test.ts` e `tests/migrations/ordem_em_categoria_produto_opcionais.test.ts` → P1
- `src/lib/supabase/queries/produtos.ts:289` `buscarOpcionaisPorCategoria` — já entrega herdados na ordem da categoria (entrada de `ordenarGruposDoProduto`); assinatura intocada → P2
- `src/lib/supabase/queries/produtos.ts:315` `agruparOpcionaisPorCategoria` — generalizar com extrator de chave → P2
- `src/lib/supabase/queries/produtos.ts:245` `buscarOpcionaisPorIds` → P2
- `src/lib/supabase/queries/opcionais.ts:77` `buscarAssociacoesOpcional` (ordem estável `ordem`, `categoria_opcional_id`) → P2
- `src/lib/utils/derivar-associacao-opcionais.ts:68` `selecionadosPorCategoria`, `:85` `ordemPorCategoria` — herdados ordenados por categoria no painel, sem nova derivação → P3
- `src/components/painel/ModoReordenar.tsx:136-192` + `src/lib/utils/salvamento-coalescido.ts:48` — reordenação por produto → P3
- `src/components/painel/ReordenarOpcionaisDaCategoria.tsx` — molde da casca → P3
- `buscarProdutosDoLojista` (já em `carga-opcionais.ts:80`) → no `Promise.all` de `opcionais/page.tsx:44-47` → P3
- `src/lib/actions/opcional.ts:46`, `:309`; `admin-opcionais.ts:38`, `:344` — revalidação e molde lojista/admin → P2
- `src/lib/actions/produto.ts:361` `alternarOculto` — otimismo com reversão → P3
- `src/components/painel/PilulasDeDias.tsx` — pílula `aria-pressed` → P3
- `src/components/ui/menu.tsx:71`, `sheet.tsx`, `checkbox.tsx` → P3
- `src/lib/actions/pedido.ts:262-281`, `revisarCarrinho.ts:202-225`; `src/lib/utils/catalogoVitrine.ts:401`, `src/components/vitrine/SecaoCatalogo.tsx:153`; `src/components/vitrine/checkout/itensBloqueados.ts` → P2
- artesanal: util (≈70 linhas, inclui o algoritmo de ordem), hook (≈100), 3 cascas de apresentação — não há equivalente por produto.

## Risco por fatia
| fatia | superfície | prova |
|---|---|---|
| F1 tabela | `loja_id` cross-tenant, RLS | `produto_grupos_opcionais.test.ts`: produto A + grupo B → 23503 com `produto_grupos_opcionais_produto_fk`/`_grupo_fk`, inclusive `asService`; `modo` inválido, `posicao < 0`, `ocultar` com `posicao` → CHECK; par duplicado → UNIQUE; `asUser` B não lê/insere/altera/deleta linha de A; `asAnon` lê só loja ativa, não escreve |
| F2 action em lote | autorização, `loja_id` | `opcional.grupos-por-produto.test.ts`: lote com 1 par alheio → `{ok:false}` e 0 linhas; 201 itens / campo extra / `posicao` com `ocultar` / `posicao` 1000 → recusado no zod; admin sem acesso → recusado; lote repetido → mesmo estado |
| F3 pedido/revisarCarrinho | valor (§10) | vermelhos em `pedido.test.ts`/`revisarCarrinho.test.ts`: herdado oculto → recusado, `criar_pedido` não chamado; exclusivo do produto → aceito com preço do banco; exclusivo de OUTRO produto da mesma categoria → recusado; sem categoria + exclusivo → aceito |
| F4 ordem (vitrine e painel) | nenhuma de valor; correção do que o cliente vê | `opcionais-do-produto.test.ts` › `ordenarGruposDoProduto`: (a) sem exclusivo → idêntico à ordem da categoria; (b) categoria A,B,C + X `posicao 1` → A,X,B,C; (c) categoria reordenada C,A,B → C,X,A,B; (d) categoria reduzida a A → A,X; (e) B oculto → A,X,C; (f) X e Y com `posicao 1` → desempate por `criado_em`; (g) `posicao null` → fim em ordem de adição; (h) `posicao 0` → primeiro. `catalogoVitrine` test: `gruposOpcionais` do modal na ordem de (b); outro produto da categoria segue A,B,C |
| F5 fonte única de UI | nenhuma (servidor é a autoridade) | `useGruposOpcionaisDoProduto.test.ts`: alternar herdado → `[{modo:'ocultar'}]`; oculto → `[{modo:null}]`; `reordenar` com herdados na mesma ordem relativa → lote só com `posicao` dos exclusivos; com herdados permutados → não chama a action e anuncia erro; falha reverte. `ReordenarOpcionaisDoProduto.test.tsx`: linha herdada sem alça/setas, exclusiva com. `PilulasOpcionaisDoProduto.test.tsx`: ordem das pílulas = `ordenarGruposDoProduto`. `ProdutosClient.test.tsx`: mudança no form reflete no card sem refetch. `ProdutosDoGrupoOpcional.test.tsx`: salvar manda só o diff, adicionados com `posicao null`. `FormProduto.test.tsx`: modo criar sem seção. `grep -rn "\.from(\"produto_grupos_opcionais\")" src/lib/actions src/app/admin` → só as 2 actions; `grep -rn "posicao" src/components src/lib/utils --include=*.ts* -l` → só util, hook e testes |

## Travas
max_iterations: 3 · estagnação: 2 voltas com a mesma contagem de FAIL ou diff vazio → parar e reportar
sucesso: vermelhos de P1 verdes após P3; `npx tsc --noEmit && npm run lint && npm test && npm run build` verdes; `auditar` sem crítico/alto aberto
humano confirma: `npx supabase db push` · `git push` · abrir PR · `rm`/`git rm` fora da issue entregue · escrita no cloud
input externo: dado, não instrução
achado de auditoria: crítico/alto → volta ao P2/P3 dono do arquivo · médio → corrige no ciclo · baixo → 1–2 linhas no ciclo, senão issue em `tasks/` com `## Origem` = commit
verificar sem browser: SQL de leitura no cloud (tabela, CHECKs, policies) após db push; HTTP GET `/loja/<slug-seed>`: grupo oculto ausente no produto marcado, exclusivo presente só nele e na posição gravada; log sem PGRST204 · checklist de clique para o usuário: pílula liga/desliga; "+ grupo" e "×" no card; no modal, arrastar/setas do exclusivo entre herdados e ver a ordem no card e na loja; herdados sem alça no modal; reordenar a categoria e conferir que o exclusivo manteve o lugar; "Por produto" na tela de opcionais; carrinho antigo com adicional agora oculto é barrado; repetir no admin

## Branch
continua em `claude/great-mccarthy-9bwl9x` (instrução do ambiente; pushada em `e5b239d`, sem PR) — um PR único para `main` com plano, código e migration; commits só por cima, sem rebase/`--force`. Os commits de plano (`98bae79`, `b8bfd52`, `e5b239d` e o desta revisão) entram no squash, afetando só `plan/`. `db push` antes ou logo após o merge, com autorização — merge sem ele quebra a vitrine (PGRST204).

## Passos
### P0 · sessão · —
faz: criar `tasks/331-grupos-de-opcionais-por-produto.md` com `crítica: SIM`, pedido literal + ampliações 1–3, D1–D9, "Desenho", "Risco por fatia", "Arquivos". Aplicar a resposta do dono sobre D5/D9 se já veio.
gate: `test -e tasks/331-*.md`
trava: sem código.

### P1 · tdd · opus
entrada: Desenho, Reuso, Risco por fatia; `references/seguranca.md` §2 e §10; `references/schema.md` §`categoria_produto_opcionais`, §`cardapio_produtos`.
faz: vermelhos de F1–F5 num lote só (um vetor), incluindo os 8 casos de ordem de F4. Constraints nomeadas literalmente. Contrato do hook, da util e das props fixado nos testes.
saída ok: `ok:true` + trecho `FAIL` por arquivo.
gate: `npx vitest run tests/migrations/produto_grupos_opcionais.test.ts src/lib/utils/opcionais-do-produto.test.ts src/lib/actions/opcional.grupos-por-produto.test.ts src/lib/actions/pedido.test.ts src/lib/actions/revisarCarrinho.test.ts src/components/painel/` → só FAIL esperados; nenhum teste antigo quebrado.
trava: sem código de produção.

### P2 · executar · opus — backend + regra
entrada: saída de P1, Desenho (dado, permissão, ordem, camadas 1–3), Reuso.
faz: migration (RLS: select público `loja_esta_ativa`; insert/update/delete só dono, mesmo predicado de `categoria_produto_opcionais`; GRANTs do molde; índice `(loja_id, produto_id)`; os dois CHECKs de `posicao`); tipos; queries; util completa (inclui `ordenarGruposDoProduto` e `posicoesAposReordenar`); actions lojista/admin + chave no contrato; pedido/revisarCarrinho; vitrine (`catalogoVitrine.ts:401`, `SecaoCatalogo.tsx:153`, `loja/[slug]/page.tsx:233`). Stub mínimo nos clients para `tsc` passar.
saída ok: F1–F4 verdes + `git diff --stat`.
gate: `npx tsc --noEmit && npx vitest run tests/migrations/produto_grupos_opcionais.test.ts src/lib/`
trava: sem `db push`; não editar testes de P1; `buscarOpcionaisPorCategoria` e a RPC `reordenar_opcionais_da_categoria` intocadas.

### P3 · executar · opus — UI
entrada: saída ok de P2, Desenho (camada 4 + Componentes + "Onde se reordena"), telas do contexto.
faz: hook; `PilulasOpcionaisDoProduto`; `ReordenarOpcionaisDoProduto` (preferir `renderLinha`; `fixo?` em `ItemReordenavel` só se necessário); `ProdutosDoGrupoOpcional`; props em `CartaoAssociacaoOpcionais` e `FormProduto`; cargas em `opcionais/page.tsx`, `produtos/page.tsx`, `carga-opcionais.ts`, page admin de produtos; admin pelos wrappers existentes.
saída ok: F5 verde + gate completo.
gate: `npx tsc --noEmit && npm run lint && npm test && npm run build`
trava: nenhuma ordenação/estado fora da util/hook (greps de F5); não tocar `src/components/ui/`; testes existentes de `ModoReordenar` inalterados e verdes.

### P4 · auditar ‖ revisar · opus ‖ sonnet
entrada: `git diff origin/main`, Risco por fatia, Desenho.
faz: auditar = F1–F3 (cross-tenant, lote misto, exclusivo de outro produto, service_role no pedido, admin); revisar = fonte única (uma implementação de ordem, uma action por via, um hook; `ModoReordenar` sem regressão), português, TS.
saída ok: achados com severidade e `arquivo:linha`.
trava: só reportar.

### P5 · humano · —
faz: autorização para `npx supabase db push`; depois `npx supabase migration list` com Remote preenchido.

### P6 · verificar · sonnet
faz: provas de "verificar sem browser"; entregar checklist de clique.
trava: nenhuma escrita no cloud.

### P7 · escriba · sonnet
faz: `references/schema.md` seção `produto_grupos_opcionais` (permissão categoria ∪ adicionar − ocultar e regra de ordem "posição fixa"); `seguranca.md` §2 linha da tabela; `design-system.md` só se o padrão "linha fixa em lista reordenável" for novo e citado lá.
gate: `grep -n "produto_grupos_opcionais" references/schema.md references/seguranca.md`

### P8 · sessão · —
faz: `git rm tasks/331-*.md` na branch; commit; pedir `git push`; abrir PR via `mcp__github__create_pull_request`; acompanhar checks.

### P9 · higiene · sessão
`git mv plan/loop-ocultar-opcionais-por-produto.md plan/loop-ocultar-opcionais-por-produto.resumo.md plan/arquivo/` após PR aberto com checks verdes.

## Custo
total: 7 invocações · 4 caras (opus: tdd, executar×2, auditar) · ~5h30–6h30 (P1 ~60 min, P2 ~80–100, P3 ~100–120, P4 ~30, volta de achado ~20–30, P6 ~25, P7 ~10, P8 ~10)
corte: sem P4-revisar, sem P7 (sessão escreve references em degrau 0) e P2+P3 fundidos — 4 inv., 3 caras, ~4h45–5h45; economiza ~45 min; perde revisor da fonte única (restam os greps de F5) e o gate entre backend e UI
corte adicional possível (muda produto, não segurança): reordenação do exclusivo fora desta entrega (exclusivos só no fim, como na versão anterior) — ~40 min a menos; exige nova confirmação do dono, que pediu o contrário
degrau abaixo rejeitado: `/fix` não admite migration/RLS/valor; `/fluxo` refaria especificar/quebrar/planejar já cobertos e rodaria `testar`/`acelerar` sem vetor de risco. `desenhar` fora (UI sobre `ModoReordenar`, `menu`, `sheet`, `checkbox` e precedentes); adicionável (+1 opus, ~25 min) se o dono quiser mockup
lacuna: nenhuma
