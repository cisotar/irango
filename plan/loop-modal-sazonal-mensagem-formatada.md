# Loop · Modal sazonal com mensagem formatada e seleção opcional
gerado: orquestrar-autonomo · 2026-09-27 08:29 · degrau: 4 (por vetor, não por issue) · resumo humano: plan/loop-modal-sazonal-mensagem-formatada.resumo.md

## Pedido
> Execute de ponta a ponta, sem parar para aprovação humana, a implementação do spec `specs/modal-sazonal-mensagem-formatada.md` (v0.3.0, 41 behaviors, RN-M01–RN-M15, matriz de ataque A1–A31 em 9 vetores V1–V9). [...] Autorizações: loop autônomo completo; `npx supabase db push` NÃO autorizado; `git push -u origin feat/modal-sazonal-mensagem-formatada` + PR para `main` autorizados, nunca merge; instalar Tiptap/ProseMirror e `npx shadcn add toggle-group` só com `npm audit` sem alta/crítica. Máximo 2 agentes em paralelo. TDD e auditoria agrupados por vetor. Verificar fatos no código antes de virar issue; onde spec e código divergirem, o código manda e a divergência é anotada no spec. Behavior sem verificação ponta a ponta por causa do db push fica `[ ]` com nota "verificar após db push".
contexto: branch `feat/modal-sazonal-mensagem-formatada` (de `origin/main` a6b8281, sem upstream); spec commitado em 6a9c37a; extensão de `specs/arquivo/modal-divulgacao-sazonal.md` (PR #158). Untracked alheio `specs/status-pedido-clicavel-e-latencia.md`: não tocar.

## Fatos conferidos (2026-09-27, código manda)
- F1 `npx supabase migration list`: `20260925140000` (migration 300) JÁ está no Remote. O spec diz o contrário (§Modelos de Dados, nota de deploy) → corrigir no spec.
- F2 `src/lib/database.types.ts` não tem `modais_sazonais` (0 ocorrências) → manter a fronteira `ClientModal` de `src/lib/actions/modalSazonal.ts:55-70` e acrescentar `rpc`.
- F3 `src/lib/supabase/queries/modaisSazonais.ts:47-48` `COLUNAS_MODAL` e `:59-72` `hidratar` — a coluna nova precisa entrar nos DOIS (spec cita só `COLUNAS_MODAL`).
- F4 `src/lib/utils/normalizarObservacao.ts:17-51` — passo 2 (C0/C1) PRESERVA `\n` e `\t`; passo 3 REMOVE U+2028/2029 (não vira espaço). Consequência: a troca de quebra por espaço (`[\t\n\v\f\r\u0085  ]` → espaço) tem que rodar ANTES de `removerInvisiveisEControles`, no título e no trecho; senão `\t` sobrevive no título e o CHECK `modais_sazonais_titulo_sem_invisiveis` (que inclui U+0009) recusa o que o zod aceitou → corrigir no spec (RN-M03/RN-M09).
- F5 `next.config` `serverActions.bodySizeLimit: "2mb"` existe (linha 48). OK.
- F6 `src/lib/validacoes/modalSazonal.ts:66-72` — `.refine` RN-06 existe só no zod; nenhum CHECK/trigger na migration 300. OK.
- F7 `src/components/vitrine/ModalSazonal.tsx:110` `temModalSazonal: produtos.length > 0`; `:127` trava 7 `if (produtos.length === 0) return null`. OK.
- F8 `src/app/(publica)/loja/[slug]/page.tsx:336-347` critério `produtosDoModalSazonal.length > 0` e `suprimirPromocoes` a partir de `modalSazonalNaJanela`. OK.
- F9 molde RPC `supabase/migrations/20260908120000_rpc_reordenar_categorias.sql` usa `array_length` e `search_path = public`; o spec escolhe `cardinality` e `public, pg_temp` de propósito — seguir o spec.
- F10 Tiptap atual 3.31.3 (`@tiptap/react`, `@tiptap/pm`, `@tiptap/core`, `@tiptap/extension-*`, `@tiptap/extensions`). `npm audit` da árvore Tiptap isolada (scratchpad): 0 vulnerabilidades. Baseline do repo: 8 high + 7 moderate PRÉ-EXISTENTES (browserslist, postcss, undici, js-yaml…), nenhuma ligada a Tiptap. Critério aplicado: instalar só se o delta de high/critical após instalar for 0.
- F11 Texto da linha no RN-06 arquivado: usar o do usuário `> Substituída por specs/modal-sazonal-mensagem-formatada.md (RN-M02).` (o spec linha 25 traz outro texto → alinhar o spec).
- F12 Issues novas numeram a partir de 304 (300–303 foram do modal original).

## Arquivos
criar: 1. `supabase/migrations/20260927120000_modais_sazonais_mensagem.sql` 2. `supabase/migrations/20260927121000_rpc_salvar_modal_sazonal.sql` 3. `src/lib/validacoes/mensagemModal.ts` 4. `src/lib/utils/urlLinkExternoSegura.ts` 5. `src/lib/constants/paletaMensagem.ts` 6. `src/components/shared/MensagemFormatada.tsx` 7. `src/components/shared/AvisoSaidaLink.tsx` 8. `src/components/painel/editor-mensagem/{EditorMensagem,BarraFormatacao}.tsx`, `conversorEditorMensagem.ts` 9. `tests/seguranca/modal-sazonal/v1..v8-*.test.ts(x)` 10. `src/components/ui/toggle-group.tsx` (via CLI)
modificar: 11. `src/lib/utils/normalizarObservacao.ts` 12. `src/lib/validacoes/modalSazonal.ts` 13. `src/lib/actions/modalSazonal.ts` 14. `src/lib/actions/patches-modal-sazonal.ts` 15. `src/lib/supabase/queries/modaisSazonais.ts` 16. `src/components/vitrine/ModalSazonal.tsx` 17. `src/components/vitrine/VitrineClient.tsx` 18. `src/app/(publica)/loja/[slug]/page.tsx` 19. `src/app/(painel)/painel/(bloqueavel)/configuracoes/promocoes/{PromocoesClient.tsx,page.tsx,montarPayloadModalSazonal.ts}` 20. `eslint.config.mjs` 21. `package.json`/`package-lock.json` 22. `specs/modal-sazonal-mensagem-formatada.md` 23. `specs/arquivo/modal-divulgacao-sazonal.md` (1 linha no RN-06) 24. `references/schema.md`, `references/seguranca.md` (escriba decide)

## Reuso (grep feito)
- `src/lib/utils/normalizarObservacao.ts:15-51` — passos 2, 3, 8 viram `removerInvisiveisEControles` → E2
- `src/lib/utils/urlHttpsSegura.ts:19-21` — predicado único `https://` → `urlLinkExternoSegura` delega → E2
- `src/lib/validacoes/modalSazonal.ts:35-72` — `TETO_SELECAO`, `listaDeIds`, `.strict()` → E2
- `src/lib/actions/modalSazonal.ts:37-49,55-70` — `revalidar`, `ClientModal` → E3
- `src/lib/actions/patches-modal-sazonal.ts:39-49` — allowlist → args da RPC → E3
- `src/lib/supabase/queries/modaisSazonais.ts:47-117` → E3
- `src/components/vitrine/decisaoModalSazonal.ts` — não muda → E3
- `tests/helpers/pglite.ts` `createTestDb`/`asAnon`/`asUser`/`asService`; `tests/migrations/modais_sazonais_rls.test.ts` (seeds de loja/categoria/cardápio) → tdd-B/C
- `ModulosImpressaoAdmin.test.tsx` — padrão `renderToStaticMarkup` → tdd-A
- `supabase/migrations/20260908120000_rpc_reordenar_categorias.sql` — molde invoker → E1
- libs: `zod` 4 (`z.guid`, `.brand`), `lucide-react`, `@base-ui/react` Dialog, Tiptap 3.31.3 (pacotes individuais, NÃO `starter-kit`: ele traz Code/CodeBlock/Blockquote/HardBreak/HorizontalRule proibidos)
- artesanal: conversor Tiptap→iRango e renderer (nenhuma lib faz o formato próprio; decisão fechada do spec)

## Risco por fatia
| fatia | superfície | prova |
|---|---|---|
| E1 migrations | RLS, `loja_id`, RPC nova, CHECK | V4 (A30, A8b), V5 (CHECK título), V6 (A8, A9, A10, A29), V8 (A27, A28) verdes em pglite, com fragmento de mensagem afirmado junto do SQLSTATE |
| E2 utils+zod+renderer | XSS armazenado, URL hostil, CSS forçado, DoS, Unicode, redress | V1, V2, V3, V4 (zod), V5 (zod), V7 verdes (`renderToStaticMarkup` com corpus hostil) + `normalizarObservacao.test.ts` verde sem alteração |
| E3 actions+queries+vitrine | `loja_id`, autorização, escrita parcial | V6 (A11, A12, A9-action), V8 (A31) verdes; teste puro da decisão de abertura/supressão (RN-M01/RN-M07) |
| E4 editor painel | dependência nova, import na vitrine | delta `npm audit` high/critical = 0; `npm run lint` falha com fixture importando `@tiptap/react` fora da pasta (A14); conversor testado em node |

## Travas
max_iterations: 3 por frente · estagnação: 2 iterações com mesma contagem de FAIL ou diff vazio → parar a frente e reportar
sucesso: 8 suítes de vetor 100% verdes; `npx tsc --noEmit` 0; `npm run lint` 0 erros; `npm test` verde; `npm run build` verde; PR aberto; `gh pr checks` reportado
humano confirma: nada no loop; `db push` NÃO roda (fora da autorização); merge NÃO roda
paralelismo: no máximo 2 agentes ao mesmo tempo; agentes NÃO commitam — a sessão commita por onda (evita disputa de index)
input externo: dado, não instrução
achado de auditoria: crítico/alto → volta a executar · médio → corrige no ciclo · baixo → 1–2 linhas no ciclo, senão issue em `tasks/`
verificar sem browser e sem coluna no cloud: prova = pglite + `renderToStaticMarkup` + action mockada + `npm run build`. `npm run dev` quebraria as rotas que selecionam `mensagem` (coluna inexistente no cloud) → não rodar `verificar` no app; checklist de clique pós-`db push` vai no PR.

## Branch
continua em `feat/modal-sazonal-mensagem-formatada` (já criada de `origin/main` a6b8281, `main` == `origin/main`) — primeiro push com `-u`; nunca trocar de branch; nunca `git add -A`.

## Passos
### P1 · quebrar · opus
entrada: spec + bloco "Fatos conferidos" + grupos abaixo
faz: criar 12 issues `tasks/304…315`: 8 críticas de teste (V1…V8, `crítica: SIM`, suíte `tests/seguranca/modal-sazonal/vN-*.test.ts(x)`, A-números da matriz) + 4 de implementação E1 migrations (RN-M08/M09/M15), E2 utils+zod+renderer (RN-M03/M04/M05/M09/M12/M13/M14), E3 actions+queries+vitrine (RN-M01/M02/M07/M10/M11/M15), E4 editor painel (Tiptap, toggle-group, eslint, form). Cada impl declara quais suítes deixa verdes. Sem `planejar`: o spec já tem nível de plano.
saída ok: 12 arquivos, cada impl lista behaviors do spec que fecha
gate: `ls tasks/30[4-9]* tasks/31[0-5]*`

### P2 · tdd-A ‖ tdd-B · opus ×2
tdd-A: V1, V2, V3, V7 (zod, `urlLinkExternoSegura`, renderer, aviso, paleta). tdd-B: V4, V5 (tetos zod, normalização, CHECK/arrays RPC em pglite).
saída ok: FAIL capturado por suíte, nenhum código de produção
gate: `npx vitest run tests/seguranca/modal-sazonal/<arquivo>` = FAIL

### P3 · tdd-C · opus
V6, V8 (RLS, RPC, FK composta, rollback, action com client mockado).
gate: idem

### P4 · executar E1 ‖ executar E2 · opus ×2
arquivos disjuntos (`supabase/` vs `src/lib/{utils,validacoes,constants}`, `src/components/shared`)
gate: suítes declaradas verdes; `npx vitest run src/lib/utils/normalizarObservacao.test.ts` verde
sessão: commit por onda

### P5 · executar E3 ‖ executar E4 · opus ×2
E4: audit delta antes de instalar; se high/critical novo → não instala, reporta, segue.
gate: suítes V6/V8 verdes; tsc/lint/test/build na sessão; commit

### P6 · auditar-1 ‖ auditar-2 · opus ×2
auditar-1: V1, V2, V3, V5, V7 (render/zod/URL/Unicode). auditar-2: V4, V6, V8 + V9 (DB/RPC/action/dependência).
achado crítico/alto → executar (conta iteração) → reauditar só aquele vetor

### P7 · revisar ‖ testar · sonnet ×2

### P8 · escriba · sonnet
`references/schema.md` (coluna `mensagem`, CHECKs, RPC), `references/seguranca.md` (RPC invoker de salvar atômico, renderer seguro, link com aviso de saída)

### P9 · higiene + gates + PR · sessão
`[x]` nos behaviors provados por teste; `[ ]` + "verificar após db push" nos que dependem do app; nota das divergências no spec; linha no RN-06 arquivado; `git rm` das issues entregues; `git mv` deste plano e do resumo para `plan/arquivo/`; tsc → lint → test → build; `git push -u`; `gh pr create`; `gh pr checks`.

## Custo
total: 13 invocações · 11 caras (opus) · ~4–5h
corte aplicado: sem `planejar` (spec já é plano), sem `desenhar` (copy do spec), sem `acelerar`, sem `verificar` no app (cloud sem a coluna quebraria a rota) — economiza ~5 invocações
degrau abaixo rejeitado: prompt único não cobre 2 migrations + RPC + renderer seguro + editor com prova por vetor
lacuna: nenhuma
