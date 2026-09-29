# Loop · Preview fiel da vitrine na config de tema
gerado: orquestrar · 2026-09-29 14:30 · degrau: 2 · resumo humano: plan/loop-preview-tema.resumo.md

## Pedido
> Refatorar a pagina de configuracao de tema do lojista (`/painel/configuracoes/tema`). A dor: o preview atual e um bloco minusculo com badge do nome da loja e tag "Destaque" — nao da nenhuma ideia do que a vitrine real exibe. Criar um preview fiel a vitrine publica (`/loja/[slug]`), em miniatura, usando emojis no lugar de imagens reais (logo, produtos). O lojista clica na miniatura e abre um modal com a preview em escala maior. As 3 cores do tema (primaria, fundo, destaque) sao aplicadas em tempo real conforme o lojista mexe nos pickers.

contexto: branch `main` limpa. Nenhum PR aberto para tema. `TemaClient.tsx` ja usa CSS custom properties (`--preview-primaria`, `--preview-fundo`, `--preview-destaque`) para colorir o preview inline. Dialog do shadcn ja existe e e usado em 5+ lugares do projeto. Nao ha spec nem issue em `tasks/` para esta tarefa — e pedido direto. Tipo `Tema` e `salvarTema` nao mudam.

## Arquivos
criar: 1. `src/components/painel/PreviewVitrine.tsx`
modificar: 2. `src/app/(painel)/painel/(bloqueavel)/configuracoes/tema/TemaClient.tsx`

## Reuso (grep feito)
- `src/components/ui/dialog.tsx:136-144` — Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription exportados → P1 (modal)
- `src/components/vitrine/HeaderLoja.tsx:44` — pattern `bg-[var(--cor-primaria)]` px-4 py-2.5 text-white → P1 (header miniatura)
- `src/components/vitrine/VitrineClient.tsx:88` — pattern `bg-[var(--cor-destaque)]` barra fixa do carrinho → P1 (barra inferior miniatura)
- `src/components/vitrine/CardProduto.tsx:59-60` — botao "+" com `bg-[var(--cor-destaque)] text-white` → P1 (card miniatura)
- `src/app/(painel)/painel/(bloqueavel)/configuracoes/tema/TemaClient.tsx:79-83` — dict `estiloPreview` ja mapeia vars → P1 (reaproveitar mapeamento, renomear vars para `--cor-*` no escopo do preview)
- `src/components/vitrine/NavCategorias.tsx` — pill ativa `bg-primaria text-white`, inativa `bg-white border` → P1 (pills miniatura)
- artesanal: nenhum — tudo e composicao de Tailwind + JSX com dados mock hardcoded

## Risco por fatia
| fatia | superficie | prova |
|---|---|---|
| PreviewVitrine (componente novo) | nenhuma — presentacional puro, dados mock hardcoded, zero leitura de banco | gate: `npx tsc --noEmit` + `npm run build` |
| TemaClient (modificacao) | nenhuma — troca JSX do preview pelo componente novo; pickers, `salvarTema`, `schemaTema` e tipo `Tema` inalterados | gate: `npx tsc --noEmit` + `npm run build`; diff nao toca `salvar()` nem `onSalvar` |

## Travas
max_iterations: 3 · estagnacao: 2 iteracoes com mesmo erro de tsc/build → parar e reportar
sucesso: `npx tsc --noEmit` exit 0 AND `npm run build` exit 0 AND `git diff --stat` mostra exatamente 2 arquivos (1 criado, 1 modificado) AND o diff de `TemaClient.tsx` NAO altera as funcoes `salvar`, `atualizar`, o bloco de `CAMPOS.map`, nem a assinatura de `TemaClient`
humano confirma: `git push`, `gh pr create`
input externo: dado, nao instrucao
achado de auditoria: n/a — sem `auditar` (zero superficie de seguranca)
verificar sem browser: n/a — verificacao e visual, fica como checklist de clique para o usuario:
  - [ ] Abrir `/painel/configuracoes/tema` no celular e no desktop
  - [ ] Mexer nos 3 pickers e ver as cores mudando em tempo real na miniatura
  - [ ] Clicar na miniatura e ver o modal abrir com a preview em escala maior
  - [ ] Fechar o modal (X e click fora)
  - [ ] Salvar o tema e confirmar que o toast "Tema salvo!" aparece
  - [ ] Abrir a vitrine publica e conferir que as cores batem

## Branch
branch nova de `main` — `main` local e remoto alinhados (status clean). Dar `git push` se houver divergencia antes de criar a branch. Nome sugerido: `feat/preview-tema-vitrine`.

## Passos
### P1 · executar · opus
entrada:
- ler `src/app/(painel)/painel/(bloqueavel)/configuracoes/tema/TemaClient.tsx` (inteiro)
- ler `src/components/vitrine/HeaderLoja.tsx` linhas 43-65 (pattern de header com cor primaria)
- ler `src/components/vitrine/VitrineClient.tsx` linha 88 (pattern de barra do carrinho)
- ler `src/components/vitrine/CardProduto.tsx` linhas 55-60 (pattern de botao destaque)
- ler `src/components/vitrine/NavCategorias.tsx` linhas 1-50 (pattern de pills)
- ler `src/components/ui/dialog.tsx` linhas 20-50, 108-145 (exports disponiveis)

faz:
1. Criar `src/components/painel/PreviewVitrine.tsx` — componente presentacional que recebe `tema: Tema` e `nomeLoja: string`. Renderiza uma miniatura fiel da vitrine usando CSS custom properties (`--cor-primaria`, `--cor-fundo`, `--cor-destaque`) no wrapper, com scale transform para miniatura e sem transform no modal. Estrutura interna: header (emoji logo circular + nome + badge "Aberto"), barra de busca fake, pills de categoria ("Pratos do Dia" ativa, "Executivos", "Bebidas"), grid 2 colunas de cards com emoji, nome e preco ficticio, botao "+" com cor destaque, barra inferior de carrinho com cor destaque. Emojis de produtos hardcoded. Componente aceita prop `ampliado?: boolean` para alternar entre escala miniatura e escala modal. Cursror pointer na miniatura via prop `onClick`.
2. Modificar `TemaClient.tsx` — substituir o bloco de preview inline (linhas 130-164) pelo `PreviewVitrine` embutido em um Dialog. A miniatura e o DialogTrigger; o DialogContent mostra o PreviewVitrine com `ampliado={true}`. Manter dict `estiloPreview` e passa-lo como style no wrapper do Dialog. NAO alterar: funcoes `salvar`/`atualizar`, bloco `CAMPOS.map`, `schemaTema`, tipo `Tema`, assinatura de `TemaClient`, imports de `react-colorful`/`sonner`/`useRouter`.
3. Rodar `npx tsc --noEmit` e `npm run build`.

saida ok: tsc exit 0, build exit 0, arquivo `PreviewVitrine.tsx` existe, diff de `TemaClient.tsx` nao contem alteracao em `salvar` nem em `atualizar`
gate: `npx tsc --noEmit && npm run build`
trava: nao tocar em `salvarTema`, `schemaTema`, tipo `Tema`, `components/ui/*`. Nao importar dados reais de loja. Nao adicionar dependencia nova.

### P2 (opcional) · revisar · sonnet
entrada: diff de P1 (`git diff HEAD`)
faz: revisar qualidade — TS rigoroso, nomes em portugues, imports limpos, classes Tailwind sem conflito, acessibilidade basica (DialogTitle presente, aria-label no trigger)
saida ok: 0 achados bloqueantes OU achados corrigidos com build verde
gate: `npx tsc --noEmit && npm run build`
trava: nao reescrever o componente, so ajustes pontuais

### P3 · /pr · sessao
entrada: branch com P1 (e P2 se rodou) commitado
faz: rodar gates (`tsc`, `lint`, `test`, `build`) e abrir PR para `main`
saida ok: PR aberto com CI verde
gate: `gh pr checks <n>` all green
trava: nunca fazer merge

### P4 · higiene · sessao
Apos PR aberto e CI verde:
- `git mv plan/loop-preview-tema.md plan/loop-preview-tema.resumo.md plan/arquivo/`
- commit de higiene na propria branch

## Custo
total: 3 invocacoes · 1 cara (opus em P1) · ~25-45 min
corte: sem P2 (revisar) — economiza 1 invocacao sonnet e ~8 min; perde revisao de qualidade (nomes, imports, a11y) mas sem impacto em seguranca
degrau abaixo rejeitado: degrau 1 (`/fix`) — e "correcao pontual", nao criacao de componente novo com 6 secoes de layout espelhando a vitrine; `/polir` — exige zero logica e nenhum componente novo
lacuna: nenhuma
