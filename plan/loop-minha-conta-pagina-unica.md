# Loop · /minha-conta em página única com navegação lateral
gerado: orquestrar-autonomo · 2026-10-06 10:23 · degrau: 2 · resumo humano: plan/loop-minha-conta-pagina-unica.resumo.md

## Pedido
Refatorar /minha-conta: página única com três seções sempre expandidas (Dados pessoais, Endereços, Pedidos),
lateral fixa no PC (aberta por padrão) e gaveta no mobile (fechada por padrão), aberta por um kebab fixo no
canto superior esquerdo. Excluir conta vai para o rodapé da lateral. Sub-rotas `/minha-conta/enderecos` e
`/minha-conta/pedidos` continuam, com o mesmo conteúdo em componentes compartilhados. `max-w-sm` sai de
`(cliente)/layout.tsx` e desce para `/conta/*`. Referência visual: `mockups/minha-conta-refat.html`.
Autorizações: push + PR sim; merge não; db push não; dependência nova só com audit limpo.

## Arquivos
criar:
1. `src/app/(cliente)/conta/layout.tsx` — wrapper centralizado `max-w-sm` que saiu do grupo.
2. `src/components/cliente/conta/secoesConta.ts` — lista única de seções (id, rótulo, ícone) + `hrefSecao` + `secaoAtiva` (puros).
3. `src/components/cliente/conta/secoesConta.test.ts`
4. `src/components/cliente/conta/ShellConta.tsx` — client: kebab (PC/mobile por CSS), `<aside>` fixed no PC, `Sheet` no mobile, `<main @container>`, scroll suave, destaque da seção.
5. `src/components/cliente/conta/ShellConta.test.tsx` — SSR markup (renderToStaticMarkup).
6. `src/components/cliente/HistoricoPedidos.tsx` — server: lista/estado vazio/Carregar mais + `carregarHistorico`.
7. `src/components/cliente/HistoricoPedidos.test.tsx`
8. `src/app/(cliente)/layout.test.tsx` — grupo sem `max-w-sm`; `/conta/*` com `max-w-sm justify-center`.
modificar:
9. `src/app/(cliente)/layout.tsx` — só `min-h-dvh bg-fundo`.
10. `src/app/(cliente)/minha-conta/layout.tsx` — `exigirCliente` + `ShellConta` (email, soPerfil).
11. `src/app/(cliente)/minha-conta/page.tsx` — três seções inline.
12. `src/app/(cliente)/minha-conta/enderecos/page.tsx`, `.../enderecos/ListaEnderecos.tsx` — título por prop, grid auto-fit 18rem.
13. `src/app/(cliente)/minha-conta/pedidos/page.tsx` — usa `HistoricoPedidos`.
14. `src/app/(cliente)/minha-conta/ExcluirConta.tsx` — sem Card; botão destructive + frase sob o botão.
15. `src/components/cliente/FormPerfilCliente.tsx` — modo `editar` em grid auto-fit 15rem (email/checkbox/salvar `col-span-full`); `completar` intacto.
16. `src/lib/actions/cliente.ts` — endereço revalida `/minha-conta` e `/minha-conta/enderecos`.
17. `src/lib/actions/cliente.ramos.test.ts` — espera as duas rotas.
não tocar: `src/components/ui/*`, `src/components/vitrine/menuCliente.ts`, `guard.ts`, schema/RLS, `plan/tecnico-identidade-cliente.md`, `plan/loop-cadastro-lojista-*`.

## Reuso (grep feito)
- `src/components/ui/sheet.tsx` (base-ui Dialog: foco preso, Esc, clique fora) → gaveta mobile; nenhum `npx shadcn add`.
- `ListaEnderecos.tsx:126` (autosave, MAX_ENDERECOS, Remover desabilitado no último) → seção e página dedicada.
- `historicoPedidos.ts` `montarHistorico`/`paginaDoParam` → `HistoricoPedidos`.
- `BotaoSair` (preserva next), `LinkVoltarLoja`, `comNext`, `sanitizarNext`, `BadgeStatusPedido`, `formatarDataHora`, `formatarMoeda`.
- Container query nativa do Tailwind v4 (`@container`, `@min-[34rem]:`).

## Risco por fatia
| fatia | superfície | prova |
|---|---|---|
| layout do grupo | visual de /conta/* | teste SSR: wrapper idêntico ao anterior em `conta/layout.tsx` |
| shell/lateral | a11y, sem flash | teste SSR: aside `hidden lg:flex`, kebabs com aria-expanded/controls/rótulo, Excluir no aside, next preservado |
| revalidatePath | dado desatualizado | `cliente.ramos.test.ts` vermelho antes |
| guard | autorização | `exigirCliente` no layout e nas 3 páginas, client da sessão; nenhuma query nova |

## Passos
### P1 — testes vermelhos (revalidatePath, secoesConta, layouts)
### P2 — implementação (sessão principal; mesma mão que leu o código, sem custo de re-contexto)
### P3 — gates tsc → lint → test → build
### P4 — `revisar` (diff), correções; auditoria de guard feita pela sessão (grep `exigirCliente`, sem service role)
### P5 — arquivar plano em `plan/arquivo/`, commit, push, `/pr` (sem merge)

## Travas
- Sem migration, sem db push, sem merge, sem `.env*`.
- `git add` por caminho; nunca `plan/tecnico-identidade-cliente.md` nem `plan/loop-cadastro-lojista-*`.
- `max_iterations`: 3; estagnação: 2.
