# Loop · Modal de divulgação sazonal na vitrine
gerado: orquestrar · 2026-09-25 00:00 · degrau: 4 · resumo humano: plan/loop-modal-divulgacao-sazonal.resumo.md

## Pedido
> Implementar modal de divulgação sazonal/promocional na vitrine pública do iRango.
> Requisitos:
> - Lojista configura no painel: título do modal, data de início e fim da exibição
> - Lojista seleciona os produtos a exibir, podendo escolher por categoria de produtos ou por cardápios com vigência (menus sazonais — tabela cardapios com vigencia_inicio/vigencia_fim)
> - O modal aparece na vitrine na primeira visita do cliente no dia (mesma lógica do ModalPromocoes existente: localStorage com chave irango:promo:{slug} + data do dia)
> - Quando há modal sazonal ativo, o lojista decide (toggle no painel) se o ModalPromocoes (itens com desconto) também aparece ou não
> - Só pode haver um modal sazonal ativo por loja por vez

contexto:
- branch `main` limpa; `main` local == origin/main (e8997a5). Push antes de abrir branch.
- NÃO existe spec nem issue para esta feature (verificado em specs/, tasks/, plan/). Começa do zero.
- CORREÇÃO DE PREMISSA (levar ao `especificar`, não herdar o texto do pedido): a tabela `public.cardapios` NÃO tem colunas `vigencia_inicio`/`vigencia_fim`. Contrato real em `supabase/migrations/20260920128000_cardapios_checks_vigencia_rls.sql`: colunas `modo` ('recorrente'|'prazo_fixo'), `prazo_inicio`/`prazo_fim` (timestamptz, prazo fixo), `dias_semana`/`dias_mes`/`hora_inicio`/`hora_fim` (recorrente). A vigência do cardápio é AVALIADA em função pura TS (RN-06 do spec cardápio-sazonal), nunca em SQL. O modal reusa essa avaliação, não reimplementa.
- A infra de cardápio sazonal JÁ está entregue (spec arquivado em `specs/arquivo/cardapio-sazonal.md`): tabelas `cardapios` + `cardapio_produtos`, RLS, painel de cardápios, vínculo produto↔cardápio, derivação na vitrine. Esta feature é uma CAMADA NOVA por cima dela — não a recria.
- Precedente direto a copiar: o ModalPromocoes existente (`src/components/vitrine/ModalPromocoes.tsx` + `decisaoModalPromocoes.ts`) já resolve localStorage por-dia-por-loja, as 7 travas anti-gesto e a decisão pura testável. O modal sazonal é irmão dele.
- SUPOSIÇÃO declarada (o `especificar` confirma ou ajusta): "data de início e fim" do modal = janela de EXIBIÇÃO própria do modal (prazo fixo), independente da vigência dos cardápios que ele aponta. Um modal pode existir sem cardápio (só categorias) e vice-versa.

## Arquivos
criar:
1. `specs/modal-divulgacao-sazonal.md` — spec (via `especificar`)
2. `tasks/NNN-*.md` … — issues (via `quebrar`; N indefinido, provavelmente 3–5)
3. `supabase/migrations/AAAAMMDDHHMMSS_modais_sazonais.sql` — tabela nova + RLS + GRANTs + índice único parcial
4. `src/lib/validacoes/modalSazonal.ts` — schema zod (+ `.test.ts` ao lado)
5. `src/lib/actions/modalSazonal.ts` — Server Actions do lojista (criar/editar/ativar/desativar)
6. `src/lib/supabase/queries/modaisSazonais.ts` — leitura (painel: próprios; vitrine: ativo público)
7. `src/app/(painel)/painel/(bloqueavel)/configuracoes/promocoes/page.tsx` + `PromocoesClient.tsx` (+ `montarPayload*.ts` se o padrão perfil se aplicar)
8. `src/components/vitrine/ModalSazonal.tsx` + `src/components/vitrine/decisaoModalSazonal.ts` (+ `.test.ts`)
9. `src/lib/utils/derivarModalSazonal.ts` (ou dentro de `catalogoVitrine.ts`) — resolve produtos do modal a partir de categorias/cardápios ativos

modificar:
10. `src/app/(publica)/loja/[slug]/page.tsx` — SSR: buscar modal sazonal ativo, derivar produtos, decidir supressão do ModalPromocoes (linhas ~287–357)
11. `src/components/vitrine/VitrineClient.tsx` — passar props do modal sazonal e a decisão de suprimir promoções
12. `src/lib/supabase/queries/lojas.ts` / view `vitrine_lojas` — expor o toggle "mostrar ModalPromocoes junto" SE ele virar coluna em `lojas`; alternativa: coluna na própria tabela `modais_sazonais` (o `especificar` decide — ver Risco por fatia)
13. `references/schema.md` — documentar `cardapios`, `cardapio_produtos` E `modais_sazonais` (drift pré-existente: `cardapios` já existe no banco e não está no schema.md)

## Reuso (grep feito)
- `src/components/vitrine/decisaoModalPromocoes.ts:76` `decidirModalPromocoes` + `chaveModalPromocoes`/`lerUltimaVisualizacao`/`marcarVisualizado` — decisão pura por-dia-por-loja e helpers de localStorage. O modal sazonal COPIA o padrão (chave `irango:promo-sazonal:{slug}` ou variante) → P4. Não reescrever a aritmética de storage.
- `src/components/vitrine/ModalPromocoes.tsx:86` — as 7 travas anti-gesto (decisão única na montagem, scrollY>0 não abre, marca antes de mostrar, único `fechar()`, só `onClick`). Molde do `ModalSazonal` → P4.
- `src/lib/utils/catalogoVitrine.ts:401` `derivarPromocionaisParaModal` — molde da derivação SSR de produtos para modal (recebe categorias agrupadas + opcionais + rótulos, devolve `ProdutoModalDados[]`) → P3.
- `src/lib/supabase/queries/cardapios.ts:27` `buscarCardapiosComProdutos` + `:66` `cardapioPertenceALoja` — leitura de cardápio com `cardapio_produtos(produto_id, dias_semana)` e checagem de posse. A derivação de "produtos deste cardápio" reusa isto → P3.
- `src/lib/supabase/queries/categorias.ts:19` `buscarCategorias` — produtos por categoria → P3.
- `src/lib/validacoes/loja.ts:18` `schemaPerfil` (`.strict()`, opcionais sem `.default()`) e `src/lib/validacoes/cardapio.ts:47` `schemaLoteDeProdutos` (`.max(TETO_LOTE)`, `.strict()`) — molde do schema zod do modal sazonal, incluindo teto de cardinalidade na lista de produtos/categorias/cardápios (CWE-770) → P2/P3.
- `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/{page,PerfilClient,montarPayloadPerfil}.tsx/.ts` + `src/lib/actions/loja.ts:70` `salvarPerfil` (rate-limit → zod → allowlist patch → UPDATE → revalidate) — molde EXATO da sub-página de config nova → P3. Sub-páginas irmãs: entregas, horarios, pagamentos, perfil, tema.
- `src/lib/actions/patches-loja.ts:36` — allowlist-pick antes do UPDATE (nunca espalhar payload). Padrão obrigatório → P3.
- artesanal: só o índice único parcial "um modal ativo por loja" (`create unique index ... where ativo`) — não há primitivo pronto; é uma linha de migration.

## Risco por fatia
| fatia | superfície | prova |
|---|---|---|
| tabela `modais_sazonais` + RLS | escopo por `loja_id` (multitenant), leitura pública só de ativo | teste RED em `tests/migrations/`: `asUser(lojaB)` não lê/edita/apaga modal de `lojaA` (SELECT/INSERT/UPDATE/DELETE); `asAnon` lê só modal `ativo` de loja ativa e NÃO lê rascunho inativo. Molde: policies de `cardapios` (leitura_publica via `loja_esta_ativa`, escrita_propria com USING+WITH CHECK). GRANTs anon=SELECT / authenticated=CRUD (não detectável em pglite — verificar por inspeção da migration) |
| "um modal ativo por loja" | invariante de dados | teste RED em `tests/migrations/`: segundo INSERT com `ativo=true` na mesma loja viola `unique index parcial` (erro 23505); ativar um desativa o outro OU o índice recusa — decisão do `especificar`, mas a PROVA é o teste do índice |
| Server Actions criar/editar/ativar | escopo por `loja_id`, input não confiável | teste RED de Server Action: payload com `loja_id` forjado de outra loja é rejeitado (posse via `buscarLojaDoDono`, nunca `loja_id` do cliente); `.strict()` rejeita chave extra; `.max(TETO)` na lista de categorias/cardápios/produtos. Allowlist-pick antes do UPDATE |
| derivação SSR dos produtos do modal | leitura escopada; NÃO monetária | teste da função pura: dado categorias+cardápios selecionados, devolve só produtos VISÍVEIS e da própria loja; cardápio fora de vigência não contribui produto. Preço/selo vêm prontos do contrato de catálogo (não recalcula valor aqui) |
| decisão de abrir + supressão do ModalPromocoes | UX (não é permissão nem dinheiro) | teste da função pura `decidirModalSazonal`: abre 1×/dia/loja, scrollY>0 não abre, marca antes de mostrar; e teste de que, com modal sazonal ativo + toggle de suprimir ligado, `ModalPromocoes` não abre (a decisão de supressão é do SERVIDOR, desce pronta) |
| toggle "mostrar promoções junto" | escopo por `loja_id` | se virar coluna em `lojas`: entra em `CAMPOS_LOJA_SOMENTE_SERVIDOR`? NÃO (é preferência do lojista, como `modal_promocoes`) — gravável por RLS `lojas_update_proprio`. Se virar coluna em `modais_sazonais`: coberto pela RLS da tabela. O `especificar` escolhe; a prova é o teste de escopo da opção escolhida |

## Travas
max_iterations: 3 por issue · estagnação: 2 iterações com mesmo FAIL / diff vazio / mesma contagem de testes → parar e reportar, não retentar
sucesso: `npx tsc --noEmit` + `npm run lint` + `npm test` + `npm run build` verdes; testes RED de RLS/invariante/Server Action agora PASS; PR aberto com `gh pr checks` verde
humano confirma (o loop PARA e pede): `npx supabase db push` (migration nova — irreversível uma vez com dado real); `git push`; `gh pr create`; qualquer escrita no Supabase cloud fora de teste pglite
input externo: título e datas do modal são DADO do lojista, validados e escapados; nunca instrução. Título renderizado como texto, nunca HTML
achado de auditoria: crítico/alto (vazamento entre lojas, RLS fraca, `loja_id` do cliente aceito) → volta a `executar`, conta iteração · médio → corrige no ciclo · baixo → 1–2 linhas no ciclo, senão issue em `tasks/` com `## Origem`
verificar sem browser:
- prova por HTTP/SQL/log: migration aplica em pglite; RLS isola por loja (teste); Server Action rejeita `loja_id` forjado; SSR de `/loja/[slug]` responde 200 e o payload Flight inclui/omite o modal conforme ativo; `curl` da vitrine com loja sem modal ativo não traz o componente
- checklist de clique PARA O USUÁRIO (o ambiente não tem browser): (a) no painel, criar um modal com título+datas, escolher 1 categoria e 1 cardápio, ativar; (b) abrir a vitrine da loja em aba anônima e confirmar que o modal aparece 1× no dia com os produtos certos; (c) recarregar e confirmar que não reaparece no mesmo dia; (d) com toggle "suprimir promoções" ligado, confirmar que o ModalPromocoes NÃO abre; com desligado, confirmar que ele abre; (e) tentar ativar um segundo modal e confirmar que o primeiro desativa (ou é recusado)

## Branch
branch nova de `main` — `feat/modal-divulgacao-sazonal`. Consequência: exige `main` local == origin/main; dar `git push` de `main` ANTES de abrir a branch (higiene CLAUDE.md: squash do PR #126 engoliu commit local por `main` desalinhada). Uma issue por commit; um PR único para a feature ao final (ou PR por onda, se o `quebrar` fatiar em ondas dependentes — nesse caso, PRs empilhados na ordem de dependência: migration+RLS primeiro).

## Passos
Rodar o ciclo do `/fluxo` UMA VEZ para a feature inteira, agrupando por VETOR (não um ciclo por issue). As issues de RLS/escopo tocam o MESMO vetor (isolamento de `modais_sazonais` por `loja_id`) → um `tdd` e um `auditar` cobrindo o vetor, não N.

### P1 · especificar · opus
entrada: o pedido literal acima + a CORREÇÃO DE PREMISSA (colunas reais de `cardapios`) + `specs/arquivo/cardapio-sazonal.md` (contrato existente) + `references/modelo-negocio.md` (escopo de produto) + `references/design-system.md` §5 (padrão de modal na vitrine)
faz: produz `specs/modal-divulgacao-sazonal.md`. Decide, com justificativa: (a) modelo de dados de `modais_sazonais` (título, janela de exibição, FK para categorias e/ou cardápios selecionados — tabela de junção ou array?, `ativo`); (b) como "um ativo por loja" é garantido (índice único parcial vs. transição no server); (c) onde vive o toggle "suprimir promoções" (coluna em `lojas` vs. em `modais_sazonais`); (d) o que é autoritativo do servidor (a decisão de abrir e de suprimir promoções desce PRONTA do SSR) vs. preview de UX no cliente
saída ok: `specs/modal-divulgacao-sazonal.md` existe com Modelos de Dados, Behaviors, Regras de Negócio e marcação servidor-vs-cliente; `test -e specs/modal-divulgacao-sazonal.md`
gate: `test -e specs/modal-divulgacao-sazonal.md`
trava: não decidir schema de `cardapios` (já existe); não inventar `vigencia_inicio/fim`

### P2 · quebrar · opus
entrada: `specs/modal-divulgacao-sazonal.md`
faz: quebra em issues independentes na ordem de dependência, marcando `crítica: SIM` nas que tocam RLS/escopo (tabela+RLS, Server Actions, invariante "um ativo"). Ordem provável: (i) migration+RLS+índice, (ii) queries+validação+Server Actions, (iii) painel de config, (iv) vitrine SSR+componente+decisão+supressão. Marca `Spec:` em cada issue.
saída ok: 3–5 arquivos em `tasks/`, cada um com `crítica:` e `Spec:`; issues de RLS marcadas crítica
gate: `ls tasks/ | grep -c modal` > 0
trava: não fundir a migration com o painel numa issue só (camadas diferentes, PRs diferentes)

### P3 · migrar · opus  (issue da migration)
entrada: issue (i)
faz: migration ADITIVA e REVERSÍVEL para `modais_sazonais` — tabela, `enable row level security`, policies (leitura_publica via `loja_esta_ativa`; leitura_propria e escrita_propria com USING+WITH CHECK), GRANTs (anon SELECT; authenticated CRUD; service_role all), índice único parcial `where ativo`, comentário de ROLLBACK. Molde: `20260920128000_cardapios_checks_vigencia_rls.sql`
saída ok: arquivo em `supabase/migrations/` com RLS+GRANTs+índice; NÃO aplicada no cloud
gate: migration aplica em pglite via `createTestDb()` (P5 prova)
trava: NÃO `npx supabase db push` (humano confirma)

### P4 · tdd · opus  (UM tdd para o vetor de escopo)
entrada: issues críticas (migration + Server Actions + invariante), `specs/modal-divulgacao-sazonal.md`, molde `tests/migrations/` das policies de `cardapios`
faz: escreve os testes VERMELHOS do vetor inteiro ANTES do código: (1) RLS `asUser(A)`↔`asUser(B)` não cruza; `asAnon` só lê ativo; (2) índice único parcial recusa segundo ativo; (3) Server Action rejeita `loja_id` forjado, `.strict()` rejeita chave extra, `.max(TETO)` limita listas; (4) função pura `decidirModalSazonal` (1×/dia, scrollY>0, marca antes). Captura o output `FAIL`.
saída ok: testes existem e FALHAM com `FAIL` capturado (código de produção ainda não existe)
gate: `npx vitest run <arquivos de teste>` mostra FAIL
trava: não escrever código de produção aqui

### P5 · executar · opus  (GREEN — pode ser 1–2 invocações por onda de issues)
entrada: issues (i)→(iv) na ordem, testes RED de P4, os reusos citados em "Reuso"
faz: implementa o mínimo para o RED passar, depois refatora. Reusa `decisaoModalPromocoes`, `derivarPromocionaisParaModal`, o molde da sub-página `perfil`, `salvarPerfil`/`patches-loja` (allowlist), `buscarCardapiosComProdutos`. A decisão de SUPRIMIR o ModalPromocoes é computada no SSR e desce pronta ao `VitrineClient`; o cliente não decide supressão.
saída ok: todos os testes (RED de P4 + suíte) PASS; `tsc`+`lint`+`build` verdes
gate: `npx tsc --noEmit && npm run lint && npm test && npm run build`
trava: nunca aceitar `loja_id` do cliente; nunca renderizar título como HTML; não editar `components/ui/`

### P6 · revisar ‖ testar ‖ auditar · sonnet ‖ sonnet ‖ opus  (paralelo, UMA rodada)
entrada: o diff de P5, `references/seguranca.md` §2 (RLS), §6 (inputs), §548 (EscopoLoja)
faz: `revisar` (TS, DRY, português, dead code) ‖ `testar` (cobertura de cenários que P4 não pegou — ex. modal com só cardápio, só categoria, ambos vazios) ‖ `auditar` (UM auditar cobrindo o vetor de escopo por `loja_id` do modal, não um por issue: vazamento entre lojas, `loja_id` do cliente, título injetado, invariante "um ativo" contornável)
saída ok: cada um devolve `ok:true` ou lista de achados classificados (crítico/alto/médio/baixo)
gate: achado crítico/alto → volta a P5 (conta iteração)
trava: quem gerou (executar) não se audita

### P7 · verificar · sonnet
entrada: a feature implementada; a divisão HTTP/SQL vs. checklist de clique acima
faz: prova o que o ambiente alcança (migration em pglite, RLS isola, Server Action rejeita forja, SSR 200 com/sem modal no payload) e ENTREGA o checklist de clique como tal, marcado "para o usuário"
saída ok: relatório com o que passou por HTTP/SQL + o checklist de clique pendente
gate: `npm run dev` sobe e `/loja/[slug]` responde 200 (leitura só)
trava: não prometer verificação de gesto de browser; cloud é produção — só leitura

### P8 · escriba · sonnet
entrada: o diff mesclado
faz: documenta em `references/schema.md` a tabela `modais_sazonais` E fecha o drift pré-existente documentando `cardapios` + `cardapio_produtos` (hoje ausentes do schema.md apesar de existirem no banco). Marca os checkboxes do spec resolvidos; se 100% `[x]`, `git mv` do spec para `specs/arquivo/`
saída ok: `references/schema.md` tem as 3 tabelas; spec com checkboxes marcados
gate: `grep -c modais_sazonais references/schema.md` > 0
trava: conservador — só o que mudou de contrato

### P9 · /pr · sessão
entrada: branch pronta, gates verdes
faz: roda gates finais, abre PR para `main` (humano confirma o `gh pr create`). Não faz merge.
gate: `gh pr checks <n>` verde
trava: humano confirma `git push` e `gh pr create`

### P10 · higiene · sessão
`git rm` das issues entregues de `tasks/` na PRÓPRIA branch (antes do PR); marcar checkboxes do spec no MESMO PR que implementa; quando o entregável estiver no disco (PR mesclado ou aberto com gates verdes), `git mv plan/loop-modal-divulgacao-sazonal.md plan/loop-modal-divulgacao-sazonal.resumo.md plan/arquivo/`.

## Custo
total: ~10 invocações (P1 especificar, P2 quebrar, P3 migrar, P4 tdd, P5 executar ×1–2, P6 revisar+testar+auditar =3, P7 verificar, P8 escriba) · **8 caras** (opus: especificar, quebrar, migrar, tdd, executar, auditar; fable: nenhum) · faixa **~3h–4h30**
corte disponível: sem `revisar` e sem `escriba` (drift de schema vira issue em `tasks/` em vez de fechar agora), fundindo as duas ondas de `executar` numa só → ~7 invocações, ~2h30–3h30 · perde: revisão de qualidade/DRY e a documentação imediata do schema (o schema.md fica devendo `cardapios`+`modais_sazonais`). NÃO corta `tdd` nem `auditar` (fatia crítica de escopo por `loja_id`).
degrau abaixo rejeitado: degrau 3 (2–3 agentes soltos) não atende — a feature tem tabela nova + RLS + Server Action + painel + vitrine + interação com modal existente; sem spec e sem quebra em issues, o escopo (modelo de dados, "um ativo por loja", onde vive o toggle de supressão) fica indefinido e o TDD não tem alvo. É feature: `/fluxo`.
lacuna: nenhuma — todo o trabalho cabe nos agentes existentes.
