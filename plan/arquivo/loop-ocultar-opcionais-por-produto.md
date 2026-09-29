# Loop · Ocultar por produto um grupo de opcionais herdado da categoria (3 pontos de entrada)
gerado: orquestrar · 2026-09-29 02:18 · revisado: 02:33 · 02:36 · 02:48 · 02:53 (escopo reduzido: só ocultar) · degrau: 3 · resumo humano: plan/loop-ocultar-opcionais-por-produto.resumo.md

## Pedido
> hoje as categorias de opcionais são adicionadas às categorias de produtos como um todo. manter, mas acrescentar um tootle de visualização/ocultação por produto dentro das categorias de produtos. hoje, há pills nos cards dos produtos que mostram as categorias de opcionais associadas, tornar clicáveis para exibir ou ocultar em cada produto. fui claro?

ampliação (via coordenador, mantida): a escolha produto a produto deve estar disponível também (a) na tela de opcionais, a partir de um grupo, escolhendo em quais produtos da categoria ele aparece/oculta; (b) no modal de edição do produto. Vale também para o admin. Uma única fonte de verdade, sem lógica duplicada.

redução (via coordenador, 2026-09-29 02:53): ESQUECER adicionar grupo exclusivo por produto e toda ordenação por produto. Manter apenas exibir/ocultar por produto um grupo herdado da categoria. Os grupos visíveis seguem sempre a ordem da categoria, que já existe.

decisões confirmadas: (D1) ocultar também bloqueia no pedido: o servidor recusa e o revisarCarrinho barra carrinho antigo · (D3) oculto persiste se o produto mudar de categoria e só tem efeito se a nova categoria tiver o grupo.
pendente com o usuário: versão completa/rápida.

contexto:
- branch `claude/great-mccarthy-9bwl9x`, HEAD `8d2fd8c`, pushada, sincronizada, sem PR. Sessão sem `gh`: GitHub via MCP.
- hoje: só `categoria_produto_opcionais` (`references/schema.md:441`); a ordem da vitrine é `categoria_produto_opcionais.ordem` (issue 208) e fica intocada. Nada por produto → migration.
- telas (o admin REUSA as do painel em todos os pontos):
  - card: `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx:1746-1772` (Badge estático); admin via `CardapioAdminClient.tsx` → `ProdutosClient`.
  - modal: `src/components/painel/FormProduto.tsx` (montado em `ProdutosClient.tsx:1142`; `categoriaId` local em `:173`).
  - tela de opcionais: `opcionais/OpcionaisClient.tsx:1017-1031` → `CartaoAssociacaoOpcionais` por categoria de produto; admin `OpcionaisAdminClient.tsx:49` → mesmo `OpcionaisClient`.
  - dados: painel `opcionais/page.tsx:44-47` não carrega produtos; admin `carga-opcionais.ts:80` já carrega `buscarProdutosDoLojista`.
  - revalidação: `revalidarPainelDeProdutos` (`src/lib/actions/opcional.ts:46`); `revalidarLojaAdmin` (`admin-opcionais.ts:38`); vitrine dinâmica (`loja/[slug]/page.tsx:47`).

## Desenho (decidido)
Dado: tabela de exceção `public.produto_opcionais_ocultos (id, loja_id, produto_id, categoria_opcional_id, criado_em)`, `unique (produto_id, categoria_opcional_id)`, FKs compostas com `loja_id`.
- A existência da linha significa "oculto"; a ausência, "exibe". Não há coluna `modo`: com um único estado possível ela seria redundante e pediria um CHECK a mais.
- Alternar é INSERT ou DELETE. Não existe UPDATE, logo não há policy de UPDATE.
- Rejeitado: array em `produtos`. Toggles concorrentes perderiam escrita (ler-modificar-gravar), `produtos` não tem leitura pública (a vitrine lê pela view `vitrine_produtos`) e não haveria FK por item.
- Semântica subtrativa: uma linha só consegue esconder e nunca libera nada. Uma linha órfã (produto que trocou de categoria, grupo desassociado) é inerte, o que é o comportamento pedido em D3.

Regra: `visiveis(produto) = grupos(categoria do produto, na ordem da categoria) − ocultos(produto)`. Sem categoria não há grupos, como hoje.

Fonte única, em quatro camadas, cada uma com um dono:
1. **Regra pura**, em `src/lib/utils/opcionais-do-produto.ts` (≈20 linhas):
   - `estaOculto(ocultos, produtoId, grupoId)`;
   - `idsPermitidosDoProduto(idsDaCategoria, ocultosDoProduto)`, para pedido e revisarCarrinho;
   - `gruposVisiveisDoProduto(gruposDaCategoriaOrdenados, ocultosDoProduto)`, para vitrine e painel. É um filtro, preserva a ordem de entrada.
2. **Escrita**: uma Server Action em lote por via.
   - Assinaturas: `salvarOcultacoesOpcionais(alteracoes)` (lojista, em `opcional.ts`) e `salvarOcultacoesOpcionaisAdmin(lojaId, alteracoes)` (em `admin-opcionais.ts`).
   - Payload: `alteracoes: { produtoId, categoriaOpcionalId, oculto: boolean }[]`, zod `.strict()`, de 1 a 200 itens.
   - Uso: a pílula e o modal mandam 1 alteração; o "Por produto" manda o diff.
   - Execução: um `upsert` com `ignoreDuplicates` para os `oculto:true`, depois um `delete` para os `false`. Cada comando é atômico. O upsert falha inteiro se houver um par de outra loja (FK composta), e aí o delete não roda. Uma falha no delete devolve `{ok:false}` e revalida.
   - Chave nova em `OpcionaisClientAcoes` (`src/components/painel/contrato-opcionais.ts:59`).
3. **Leitura**:
   - `buscarOcultosOpcionais(client, lojaId)`, em `queries/opcionais.ts` no molde de `buscarAssociacoesOpcional:77`. Alimenta as 3 telas e a vitrine (lida sob anon, pela policy pública).
   - `buscarOcultosPorProdutos(client, produtoIds)`, para pedido e revisarCarrinho.
   - Nenhuma query de itens nova: os grupos e itens continuam vindo de `buscarOpcionaisPorCategoria` (`queries/produtos.ts:289`), intocada.
4. **Estado de UI**: hook `src/components/painel/useOcultacoesOpcionais.ts`.
   - Recebe os ocultos do servidor e a action; mantém um mapa otimista `produtoId → Set<grupoId>`.
   - Expõe `oculto(produtoId, grupoId)`, `alternar(produtoId, grupoId)` e `aplicarLote(alteracoes)`. Reverte e anuncia em caso de falha; `router.refresh()` no sucesso.
   - Uma instância no `ProdutosClient`, compartilhada pelo card e pelo `FormProduto`; uma no `OpcionaisClient`.

Componentes (só apresentação, sem regra própria):
- **`PilulasOpcionaisDoProduto`**: extraído de `ProdutosClient.tsx:1746-1772`, com variante `card | form`.
  - Pílulas na ordem da categoria; cada uma é um `button aria-pressed`. Oculta = esmaecida, riscada, com o texto "oculto".
  - Variante `form`: seção "Adicionais deste produto" no `FormProduto`, só em modo editar. Grava na hora, e o texto da seção avisa isso.
  - Herdados calculados a partir do `categoriaId` do estado do form (D3). Em modo criar, a dica "salve o produto para escolher adicionais".
- **`ProdutosDoGrupoOpcional`**: Sheet aberto por "Por produto" em cada grupo marcado e salvo do `CartaoAssociacaoOpcionais`. Lista com checkbox os produtos DESTA categoria: marcado = aparece, desmarcado = oculto. Salvar manda o diff.
- **`CartaoAssociacaoOpcionais` e `FormProduto`**: ganham props opcionais (`produtos`, `ocultacoes` = retorno do hook). Sem elas, nada novo aparece.

## Arquivos
criar:
1. `tasks/331-ocultar-grupo-de-opcionais-por-produto.md` (confirmar que 331 está livre em `tasks/` e `tasks/arquivo/`)
2. `supabase/migrations/20260930140000_produto_opcionais_ocultos.sql`
3. `tests/migrations/produto_opcionais_ocultos.test.ts`
4. `src/lib/utils/opcionais-do-produto.ts` + `.test.ts`
5. `src/lib/actions/opcional.ocultos-por-produto.test.ts`
6. `src/components/painel/useOcultacoesOpcionais.ts` + `.test.ts`
7. `src/components/painel/PilulasOpcionaisDoProduto.tsx` + `.test.tsx`
8. `src/components/painel/ProdutosDoGrupoOpcional.tsx` + `.test.tsx`

modificar:
9. `src/lib/database.types.ts`
10. `src/lib/supabase/queries/opcionais.ts`
11. `src/lib/actions/opcional.ts`, `src/app/admin/assinantes/actions/admin-opcionais.ts`
12. `src/components/painel/contrato-opcionais.ts`
13. `src/app/(painel)/painel/(bloqueavel)/produtos/page.tsx`, `ProdutosClient.tsx`, `ProdutosClient.test.tsx`
14. `src/components/painel/FormProduto.tsx`, `FormProduto.test.tsx`
15. `src/components/painel/CartaoAssociacaoOpcionais.tsx`, `CartaoAssociacaoOpcionais.test.tsx`
16. `src/app/(painel)/painel/(bloqueavel)/produtos/opcionais/page.tsx`, `OpcionaisClient.tsx`, `OpcionaisClient.test.tsx`
17. `src/app/admin/assinantes/[lojaId]/produtos/page.tsx`, `CardapioAdminClient.tsx`, `src/app/admin/assinantes/[lojaId]/carga-opcionais.ts`, `.../produtos/opcionais/OpcionaisAdminClient.tsx`
18. `src/app/(publica)/loja/[slug]/page.tsx`, `src/lib/utils/catalogoVitrine.ts`, `src/components/vitrine/SecaoCatalogo.tsx`
19. `src/lib/actions/pedido.ts`, `src/lib/actions/revisarCarrinho.ts` + testes
20. `references/schema.md`, `references/seguranca.md` §2

## Reuso (grep feito)
Migration:
- `supabase/migrations/20260614007500_opcionais.sql:37`: `opcionais_categorias unique (id, loja_id)` → alvo de FK composta → P2
- `supabase/migrations/20260920128000_cardapios_checks_vigencia_rls.sql:28`: `produtos_id_loja_unico` → alvo de FK composta → P2
- `supabase/migrations/20260920129000_cardapio_produtos_fks_compostas_rls.sql`: molde de tabela de junção (FKs nomeadas, UNIQUE, RLS, GRANTs) → P2
- `supabase/migrations/20260614007500_opcionais.sql:143-146`: leitura pública via `loja_esta_ativa` → P2

Testes:
- `tests/helpers/pglite.ts`; moldes `tests/migrations/rls_opcionais_leitura_propria.test.ts` e `ordem_em_categoria_produto_opcionais.test.ts` → P1

Queries e actions:
- `src/lib/supabase/queries/produtos.ts:289` `buscarOpcionaisPorCategoria`: já entrega grupos e itens na ordem da categoria; assinatura intocada → P2
- `src/lib/supabase/queries/produtos.ts:245` `buscarOpcionaisPorIds`: já traz `categoria_opcional_id` do escolhido → P2
- `src/lib/supabase/queries/opcionais.ts:77` `buscarAssociacoesOpcional`: molde de leitura com ordem estável → P2
- `src/lib/actions/opcional.ts:46`, `:309`; `admin-opcionais.ts:38`, `:344`: revalidação e molde lojista/admin (posse, `escopo.inserir`, erro genérico) → P2
- `buscarProdutosDoLojista` (já em `carga-opcionais.ts:80`) → entra no `Promise.all` de `opcionais/page.tsx:44-47` → P3

UI:
- `src/lib/utils/derivar-associacao-opcionais.ts:68` `selecionadosPorCategoria`, `:85` `ordemPorCategoria`: grupos da categoria ordenados no painel, sem derivação nova → P3
- `src/lib/actions/produto.ts:361` `alternarOculto`: molde de otimismo com reversão → P3
- `src/components/painel/PilulasDeDias.tsx`: pílula com `aria-pressed` → P3
- `src/components/ui/sheet.tsx`, `checkbox.tsx` → P3

Pedido e vitrine:
- `src/lib/actions/pedido.ts:262-281`, `revisarCarrinho.ts:202-225`: conjunto `permitidas` → P2
- `src/lib/utils/catalogoVitrine.ts:401`, `src/components/vitrine/SecaoCatalogo.tsx:153`: derivação de `gruposOpcionais` → P2
- `src/components/vitrine/checkout/itensBloqueados.ts`: item recusado na revisão → P2

Artesanal: a util (≈20 linhas), o hook (≈60) e 2 componentes de apresentação. Não há nada equivalente por produto hoje.

## Risco por fatia
| fatia | superfície | prova |
|---|---|---|
| F1 tabela | `loja_id` cross-tenant, RLS | `produto_opcionais_ocultos.test.ts`: produto A + grupo B → 23503 com nome literal `produto_opcionais_ocultos_produto_fk`/`_grupo_fk`, inclusive `asService`; par duplicado → UNIQUE; `asUser` B não lê/insere/deleta linha de A; ninguém faz UPDATE (sem policy/grant); `asAnon` lê só de loja ativa e não escreve |
| F2 action em lote | autorização, `loja_id` | `opcional.ocultos-por-produto.test.ts`: lote com 1 par alheio entre válidos → `{ok:false}` e 0 linhas; 201 itens ou campo extra → recusado no zod; admin sem acesso → recusado; lote repetido → mesmo estado |
| F3 pedido/revisarCarrinho | valor (§10) | vermelhos em `pedido.test.ts`/`revisarCarrinho.test.ts`: opcional de grupo oculto no produto → recusado, `criar_pedido` não chamado, revisarCarrinho bloqueia o item; mesmo grupo em OUTRO produto da mesma categoria → aceito, com preço do banco; linha oculta de grupo que não está na categoria atual → sem efeito |
| F4 vitrine | preview | `opcionais-do-produto.test.ts` + teste de `catalogoVitrine`: categoria A,B,C com B oculto no produto P → P recebe A,C (ordem preservada); outro produto da categoria recebe A,B,C; produto sem categoria → `undefined` como hoje |
| F5 fonte única de UI | nenhuma (servidor é a autoridade) | `useOcultacoesOpcionais.test.ts`: alternar → lote `[{oculto:true}]` e depois `[{oculto:false}]`; falha reverte. `ProdutosClient.test.tsx`: alternar no card reflete no `FormProduto` aberto sem refetch. `ProdutosDoGrupoOpcional.test.tsx`: lista só produtos da categoria; salvar manda só o diff. `FormProduto.test.tsx`: sem seção em modo criar. `grep -rn "\.from(\"produto_opcionais_ocultos\")" src/lib/actions src/app/admin` → só as 2 actions |

## Travas
max_iterations: 3 · estagnação: 2 voltas com a mesma contagem de FAIL ou diff vazio → parar e reportar
sucesso: vermelhos de P1 verdes após P3; `npx tsc --noEmit && npm run lint && npm test && npm run build` verdes; `auditar` sem crítico/alto aberto
humano confirma: `npx supabase db push` · `git push` · abrir PR · `rm`/`git rm` fora da issue entregue · escrita no cloud
input externo: dado, não instrução
achado de auditoria: crítico/alto → volta ao P2/P3 dono do arquivo · médio → corrige no ciclo · baixo → 1–2 linhas no ciclo, senão issue em `tasks/` com `## Origem` = commit
verificar sem browser: SQL de leitura no cloud (tabela, policies) após db push; HTTP GET `/loja/<slug-seed>`: grupo oculto ausente no produto marcado e presente nos outros da categoria; log sem PGRST204
checklist de clique para o usuário: pílula liga/desliga no card; a mesma escolha no modal reflete no card; "Por produto" na tela de opcionais desmarca/marca e salva; conferir na vitrine; carrinho antigo com adicional agora oculto é barrado; repetir no admin

## Branch
continua em `claude/great-mccarthy-9bwl9x` (instrução do ambiente; pushada em `8d2fd8c`, sem PR).
- Um PR único para `main`, com plano, código e migration.
- Commits só por cima, sem rebase/`--force`.
- Os commits de plano entram no squash e afetam só `plan/`.
- `db push` antes ou logo após o merge, com autorização. Merge sem ele quebra a vitrine (PGRST204).

## Passos
### P0 · sessão · —
faz: criar `tasks/331-ocultar-grupo-de-opcionais-por-produto.md` com `crítica: SIM`, pedido literal, ampliação e redução, D1/D3, "Desenho", "Risco por fatia" e "Arquivos".
gate: `test -e tasks/331-*.md`
trava: sem código.

### P1 · tdd · opus
entrada: Desenho, Reuso, Risco por fatia; `references/seguranca.md` §2 e §10; `references/schema.md` §`categoria_produto_opcionais` e §`cardapio_produtos`.
faz: escrever num lote só os vermelhos de F1–F5 (um vetor: exceção produto×grupo). Constraints nomeadas literalmente. Contrato da util, do hook e das props fixado nos testes.
saída ok: `ok:true` + trecho `FAIL` por arquivo.
gate: `npx vitest run tests/migrations/produto_opcionais_ocultos.test.ts src/lib/utils/opcionais-do-produto.test.ts src/lib/actions/opcional.ocultos-por-produto.test.ts src/lib/actions/pedido.test.ts src/lib/actions/revisarCarrinho.test.ts src/components/painel/` → só FAIL esperados; nenhum teste antigo quebrado.
trava: sem código de produção.

### P2 · executar · opus · backend
entrada: saída de P1, Desenho (dado, regra, camadas 1–3), Reuso.
faz:
- migration: RLS com select público via `loja_esta_ativa`; insert/delete só pelo dono, com o mesmo predicado de `categoria_produto_opcionais`; sem UPDATE; GRANTs do molde; índice `(loja_id, produto_id)`.
- tipos, queries e util.
- actions lojista/admin + chave no contrato.
- pedido e revisarCarrinho.
- vitrine: `catalogoVitrine.ts:401`, `SecaoCatalogo.tsx:153`, `loja/[slug]/page.tsx:233`.
- stub mínimo da chave nova nos clients, para o `tsc` passar.
saída ok: F1–F4 verdes + `git diff --stat`.
gate: `npx tsc --noEmit && npx vitest run tests/migrations/produto_opcionais_ocultos.test.ts src/lib/`
trava: sem `db push`; não editar os testes de P1; `buscarOpcionaisPorCategoria` e a RPC `reordenar_opcionais_da_categoria` intocadas.

### P3 · executar · opus · UI
entrada: saída ok de P2, Desenho (camada 4 + Componentes), telas do contexto.
faz:
- hook, `PilulasOpcionaisDoProduto` e `ProdutosDoGrupoOpcional`.
- props opcionais em `CartaoAssociacaoOpcionais` e `FormProduto`.
- cargas em `opcionais/page.tsx`, `produtos/page.tsx`, `carga-opcionais.ts` e na page admin de produtos.
- admin pelos wrappers existentes.
saída ok: F5 verde + gate completo.
gate: `npx tsc --noEmit && npm run lint && npm test && npm run build`
trava: nenhum estado de ocultação fora do hook e da util (conferido pelo grep de F5); não tocar `src/components/ui/`.

### P4 · auditar ‖ revisar · opus ‖ sonnet
entrada: `git diff origin/main`, Risco por fatia, Desenho.
faz:
- auditar: F1–F3 (cross-tenant, lote misto, bypass pelo cliente, service_role no pedido, admin).
- revisar: fonte única (uma action por via, um hook, uma util), português, TS.
saída ok: achados com severidade e `arquivo:linha`.
trava: só reportar.

### P5 · humano · —
faz: pedir autorização para `npx supabase db push`; depois, `npx supabase migration list` com a coluna Remote preenchida.

### P6 · verificar · sonnet
faz: produzir as provas de "verificar sem browser" e entregar o checklist de clique.
trava: nenhuma escrita no cloud.

### P7 · escriba · sonnet
faz: seção `produto_opcionais_ocultos` em `references/schema.md` (a regra categoria − ocultos e D3); linha em `seguranca.md` §2.
gate: `grep -n "produto_opcionais_ocultos" references/schema.md references/seguranca.md`

### P8 · sessão · —
faz: `git rm tasks/331-*.md` na branch; commit; pedir `git push`; abrir o PR via `mcp__github__create_pull_request`; acompanhar os checks.

### P9 · higiene · sessão
`git mv plan/loop-ocultar-opcionais-por-produto.md plan/loop-ocultar-opcionais-por-produto.resumo.md plan/arquivo/` depois do PR aberto com checks verdes.

## Custo
total: 7 invocações · 4 caras (opus: tdd, executar×2, auditar) · ~4h–4h50
por etapa: P1 ~40 min · P2 ~50–70 · P3 ~70–90 · P4 ~25 · volta de achado ~15–25 · P6 ~20 · P7 ~10 · P8 ~10
corte: sem P4-revisar, sem P7 (a sessão escreve references em degrau 0) e P2+P3 fundidos → 4 inv., 3 caras, ~3h20–4h10; economiza ~40 min; perde o revisor da fonte única (resta o grep de F5) e o gate entre backend e UI
degrau abaixo rejeitado: `/fix` não admite migration/RLS/valor; `/fluxo` refaria especificar/quebrar/planejar já cobertos e rodaria `testar`/`acelerar` sem vetor de risco. `desenhar` fica fora: a UI usa `sheet`, `checkbox` e o precedente `PilulasDeDias`
lacuna: nenhuma
