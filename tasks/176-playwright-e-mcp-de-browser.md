# [176] Infra de teste de browser: Playwright e MCP de browser

**crítica:** NÃO
**Mundo:** infraestrutura de teste (afeta vitrine e painel)
**Depende de:** —
**Origem:** a issue 175 (reordenação de categorias) esbarrou três vezes no mesmo
buraco: o plano de execução marcou como lacuna, o agente `testar` marcou de novo
ao não conseguir escrever regressão, e no fim o arrasto ficou dependendo de
verificação manual. Registrada em 2026-09-08.

## Problema

O projeto não consegue testar interação de browser. `vitest.config.ts` roda com
`environment: "node"`, e `package.json` não tem `jsdom`, `happy-dom`,
`@testing-library/react` nem `react-test-renderer`.

Teste de client component hoje usa `renderToStaticMarkup` e prova **derivação de
estado → HTML**. Isso é honesto e barato, mas não executa efeito, não dispara
handler e não avança timer. A limitação está documentada por extenso no cabeçalho
de `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.test.tsx`, desde
a issue 089.

Consequências concretas, todas já observadas:

- **Gesto de toque não é testável.** O arrasto da issue 175 tem cobertura zero.
  O item mais arriscado do contrato de interação — arrastar sem disparar o scroll
  vertical da página, que é a razão de existir a alça dedicada — só se verifica à
  mão, em aparelho real.
- **Bug real passou por dois agentes de revisão sem virar teste.** Os dois
  defeitos de salvamento debounced da 175 (perda do último movimento ao sair do
  modo; revert com estado desatualizado em chamadas sobrepostas) só ganharam
  regressão depois de extrair a máquina de estado para
  `src/lib/utils/salvamento-coalescido.ts`. A extração foi boa por outros motivos,
  mas ela foi feita **para contornar a falta de infra**, não por desenho.
- **`verificar` infere em vez de enxergar.** Não há `.mcp.json` no repositório e
  nenhum servidor MCP de browser configurado, então o agente não vê a tela.

## Duas ferramentas, dois propósitos — não confundir

### 1. Playwright — regressão automatizada no CI

Fecha a lacuna de gesto: `page.touchscreen` e contexto com `hasTouch` emitem
toque de verdade, então arrasto vira teste. Roda headless, não precisa de Docker
(baixa binários de browser, ~300 MB).

**Ressalva que precisa ficar no escopo:** emulação de toque não é aparelho real.
Pega o essencial (arrastar sem levar o scroll junto, alvo de 44px, foco pós-ação)
e não pega quirk de Safari iOS. **Reduz** o teste manual, não elimina — o
checklist em aparelho continua valendo para mudança de interação por toque.

Decisões a tomar na implementação:
- Segundo runner ao lado do vitest: como separar (`e2e/` próprio? script npm
  próprio?) sem que `npm test` fique lento demais para o loop de desenvolvimento.
- Contra qual banco. `npm run dev` aponta para o Supabase **cloud**; e2e que
  escreve precisa de loja de teste descartável, ou de um caminho que não suje
  dado real.
- Onde entra no CI, que hoje roda `tsc` → `lint` → `test` → `build`.

### 2. MCP de browser — verificação interativa na sessão

Servidor em `.mcp.json` (Playwright MCP da Microsoft, ou Chrome DevTools MCP).
Permite ao agente dirigir um browser durante a sessão: clicar, tirar screenshot,
inspecionar DOM. É o que faria o `verificar` observar comportamento real em vez
de inferir de código e de teste.

Exige autorização em sessão interativa — não dá para configurar em sessão
não-interativa.

## Escopo

- [ ] Decidir se entram os dois ou só um, com justificativa de custo.
- [ ] Playwright: instalar, configurar, separar do vitest, escrever o primeiro
      teste de toque (o arrasto de `/painel/produtos` é o candidato natural,
      porque é o caso que motivou esta issue).
- [ ] Definir a estratégia de dado para e2e contra o cloud.
- [ ] Integrar ao CI sem estourar o tempo do gate.
- [ ] MCP de browser: configurar `.mcp.json` e registrar em
      `references/architecture.md`.
- [ ] Atualizar `.claude/agents/verificar.md` para usar as ferramentas novas
      quando existirem, e o cabeçalho de `ProdutosClient.test.tsx`, que hoje
      afirma que a infra não existe.

## Critério de aceite

- [ ] Existe ao menos um teste que emite gesto de toque e falha se a alça de
      arrasto quebrar.
- [ ] O gate do CI continua verde e em tempo aceitável.
- [ ] Está documentado o que a emulação **não** cobre, para que ninguém escreva
      "validado em mobile" com base só nela.

## Relacionada

- Issue 175 — a que expôs a lacuna três vezes.
- `src/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.test.tsx` — o
  cabeçalho que documenta a limitação desde a issue 089.
- `src/lib/utils/salvamento-coalescido.ts` — extração feita para contornar a
  falta desta infra.
