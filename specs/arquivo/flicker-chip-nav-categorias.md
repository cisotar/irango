# Spec: Flicker do chip ativo durante o scroll programático da nav de categorias

**Versão:** 0.1.0 | **Atualizado:** 2026-09-22

## Visão Geral

Na vitrine pública (`/loja/[slug]`), a barra sticky do catálogo tem um trilho horizontal de chips de
categoria (`NavCategorias`, issue 203). Tocar num chip rola a página até a seção correspondente via
link âncora nativo (`<a href="#ancora">` + `scroll-behavior: smooth` do `globals.css`), e o chip
ativo é marcado por um `IntersectionObserver` (`scrollspyCategorias.ts`).

**O bug:** durante a rolagem programática disparada pelo clique, o scrollspy continua ativo. As
seções intermediárias entram no recorte do viewport, `escolherAtivo` (que desempata pela PRIMEIRA
seção na ordem do catálogo) marca cada uma delas, e o chip pisca — clico em D, a marcação passa por
B/C e só então assenta em D. Nenhum dado errado é exibido: é acabamento. Mas é um flicker visível a
cada navegação de categoria, na tela mais usada do produto, e passa a impressão de software amador.

**O que NÃO pode regredir:** o scroll manual (o usuário rolando a tela com o dedo) marca o chip certo
hoje e continua sendo a única fonte de marcação fora do intervalo do clique.

**Mundo:** vitrine pública, sem autenticação. Nenhum valor monetário, nenhuma permissão e nenhum dado
sensível passam por esta feature — ver §Segurança.

## Atores Envolvidos

- **Cliente (vitrine, sem login):** toca no chip de uma categoria e rola a tela. É o único ator com
  comportamento nesta correção.
- **Lojista:** nenhum. As categorias e a ordem do catálogo já vêm prontas do SSR; nada no painel muda.
- **iRango (SaaS):** nenhum. Sem migration, sem Server Action, sem RLS nova.

## Páginas e Rotas

### Vitrine da loja — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)
**Descrição:** o cliente vê a barra sticky com busca + trilho de chips e o catálogo em seções. Tocar
num chip leva à seção; rolar a tela marca o chip da seção em tela. Depois da correção, o chip
marcado no clique permanece marcado do toque até o fim da rolagem — sem estados intermediários.

**Componentes:** todos já existem; **nenhum componente novo**.

- `NavCategorias` (`components/vitrine/NavCategorias.tsx`) — trilho de chips. Recebe a trava de
  alvo; é o único arquivo de componente alterado.
- `scrollspyCategorias.ts` (`components/vitrine/`) — módulo neutro (sem `"use client"`), dono da
  mecânica. **É aqui que a correção mora.** Ganha o estado de alvo travado e a função pura de decisão.
- `CatalogoVitrine` (`components/vitrine/CatalogoVitrine.tsx`) — **não muda.** Continua medindo a
  barra e passando `alturaBarra` como gatilho.
- `SecaoCatalogo`, `ancoraSecao` (`lib/utils/ancoraCategoria.ts`), `medicaoBarraVitrine.ts`,
  `layoutVitrine.ts` — **não mudam.** A âncora continua de fonte única e o `rootMargin` continua
  derivado de `--altura-barra` (RN-6 da 203).
- Nenhum primitivo `shadcn/ui` novo: o trilho é `<nav>/<ul>/<a>` de propósito (não é `Tabs`), e essa
  decisão permanece.

**Behaviors:**

- [x] **Tocar num chip marca esse chip imediatamente** — o `onClick` continua fazendo `setAtivo(ancora)`
      sem `preventDefault`, para o link âncora nativo seguir rolando (funciona com JS desligado).
      Garantido em: cliente (UX puro — estado visual de navegação).
- [x] **Tocar num chip trava o scrollspy no destino** — o mesmo `onClick` chama `irPara(ancora)` no
      controlador devolvido por `criarScrollspy`. Enquanto a trava existe, nenhuma seção que não seja
      o destino pode marcar chip. Garantido em: cliente (UX puro; nenhum dado autoritativo envolvido).
- [x] **Chegar ao destino destrava o scrollspy** — quando o destino entra no conjunto de seções
      visíveis, o controlador confirma o destino como ativo e volta ao modo normal. Garantido em:
      cliente (UX).
- [x] **Rolagem que nunca alcança o destino destrava por tempo** — fallback de tempo máximo
      (`TIMEOUT_ALVO_MS`, 1200ms) libera a trava mesmo que o destino nunca dispare interseção (destino
      já visível antes do clique, rolagem interrompida pelo usuário, seção removida pela busca).
      Sem esse fallback o chip congelaria. Garantido em: cliente (UX).
- [x] **Clicar num segundo chip antes de o primeiro assentar substitui o alvo** — o alvo anterior é
      descartado e o temporizador reiniciado; nunca há dois alvos em disputa. Garantido em: cliente (UX).
- [x] **Rolar a tela manualmente marca o chip da seção em tela** — comportamento atual, inalterado:
      sem trava ativa, vence a primeira seção visível na ordem do catálogo. Garantido em: cliente (UX).
- [x] **Sair da tela / trocar o conjunto de seções cancela tudo** — o cleanup do efeito (desmontagem,
      entrada em modo busca, rotação, mudança de `ancoras`/`alturaBarra`) desconecta o observer **e**
      cancela o temporizador pendente. Garantido em: cliente (UX; evita `setState` após desmontar).

---

## Modelos de Dados

**Nenhuma tabela é lida ou escrita por esta correção.** Nenhuma migration, nenhuma coluna nova,
nenhuma política RLS nova (`schema.md` inalterado). As seções do catálogo já chegam prontas do SSR
sob `anon` + RLS, como hoje.

Contratos de módulo alterados (TypeScript, não banco), em `components/vitrine/scrollspyCategorias.ts`:

- `criarScrollspy` passa a devolver um **controlador** `{ desligar(): void; irPara(ancora: string): void }`
  em vez de só a função de cleanup. Mudança fonte-a-fonte: o único chamador é `NavCategorias.tsx`, e o
  `tsc` (1º passo do CI) pega qualquer sobra.
- `DepsScrollspy` ganha `timeoutAlvoMs?: number` (default 1200) para o teste em `environment: node`
  poder encurtar/afirmar a janela com `vi.useFakeTimers()`.
- Função pura nova, exportada e testada ao lado do módulo:
  `decidirAtivo({ ordem, visiveis, alvo }): { ativo: string | null; destravar: boolean }`
  — reusa `escolherAtivo` internamente, não a duplica.

## Regras de Negócio

| # | Regra | Camada que garante |
|---|---|---|
| RN-1 | O chip marcado no clique permanece marcado até o destino ser alcançado ou o timeout expirar — nenhuma seção intermediária pode marcá-lo. | Cliente (UX) — `decidirAtivo` no módulo neutro |
| RN-2 | Sem alvo travado, vence a PRIMEIRA seção visível na ordem do catálogo (regra da 203, preservada). | Cliente (UX) — `escolherAtivo`, inalterada |
| RN-3 | Nenhuma visível → mantém o ativo anterior; chip nenhum marcado é pior que chip atrasado (regra da 203, preservada). | Cliente (UX) — `escolherAtivo` devolve `null` e o chamador ignora |
| RN-4 | A trava sempre termina: por chegada ao destino ou por timeout. Não existe caminho em que o scrollspy fique mudo. | Cliente (UX) — temporizador no controlador, cancelado no cleanup |
| RN-5 | Continua **proibido** listener de `scroll` (critério de aceite da 203). A marcação sai inteiramente do `IntersectionObserver`; a trava usa apenas `setTimeout`. | Revisão de código + teste do módulo |
| RN-6 | O `rootMargin` continua derivado da altura MEDIDA da barra (`--altura-barra`), nunca de valor fixo. | Cliente — `montarRootMargin`, inalterada |
| RN-7 | Browser sem `IntersectionObserver` continua degradando em silêncio: `irPara` é no-op, `desligar` é no-op, os links âncora seguem rolando. | Cliente — guard já existente em `criarScrollspy` |
| RN-8 | O trilho só existe com ≥3 seções navegáveis (RN-4 da 203), e o chip ativo continua com sinal não-cromático (`box-shadow` interno, WCAG 1.4.1) e `aria-current`. | Cliente — inalterado |

## Segurança (obrigatório)

- **Dado sensível entrando/saindo?** Não. Nenhum PII, nenhuma chave Pix, nenhum cupom. O único dado
  manipulado é uma string de âncora de categoria já pública no HTML do SSR.
- **Valor monetário?** Não. Nada aqui influencia preço, frete, desconto ou total. Forçar `aria-current`
  ou o estado de alvo pelo devtools **só pinta chip**: o conjunto de produtos veio do SSR sob `anon` +
  RLS e todo preço continua recalculado na Server Action do checkout (`seguranca.md` §10). Nenhum
  behavior desta spec exige "garantido em: Server Action + RLS", e nenhum deve ser movido para o
  servidor.
- **Tabela nova?** Não — nenhuma política RLS nova.
- **API externa com key?** Não.
- **Risco residual:** um temporizador pendente disparando `setState` após a desmontagem (React
  warning + vazamento). Mitigado por RN-4 (cleanup cancela o timer) e coberto por teste do módulo.

## Testabilidade (restrição de ambiente)

A suíte é Vitest `environment: node` — **sem jsdom, sem Playwright, sem MCP de browser**. Scroll real
e `IntersectionObserver` real não são observáveis por teste neste repo. Por isso:

- Toda a lógica nova vive no módulo neutro `scrollspyCategorias.ts` (mesmo padrão de
  `medicaoBarraVitrine.ts`, `anunciadorBusca.ts`, `layoutVitrine.ts`, `escolhaDeDias.ts`), com o
  `IntersectionObserver` **injetado** por parâmetro e o tempo controlado por `vi.useFakeTimers()`.
- `NavCategorias.tsx` continua sendo **só o fio** entre o módulo e o `useEffect`: nenhuma regra de
  decisão pode nascer dentro do componente, porque lá ela não seria travável por teste.
- `scrollspyCategorias.test.ts` (já existente) ganha os casos: alvo ignora intermediária; alvo visível
  destrava e ativa; timeout destrava; segundo `irPara` substitui o alvo; `desligar` cancela o timer.
  Os testes atuais de `escolherAtivo`, `montarRootMargin` e degradação silenciosa continuam valendo —
  só a forma do retorno de `criarScrollspy` muda nos que o usam.
- `NavCategorias.test.tsx` continua provando apenas a ÁRVORE (`renderToStaticMarkup` não roda efeitos);
  **não** tentar provar flicker ali.
- Verificação final do flicker é manual, no browser, na loja de teste padrão ("Lanches base"), em
  viewport mobile: clicar no último chip do trilho e observar que nenhum chip intermediário acende.

## Fora do Escopo (v1)

- Redesenhar a navegação de categorias (virar `Tabs`, carousel de lib, setas de overflow, menu suspenso).
- Trocar o link âncora nativo por `scrollTo` programático em JS — quebraria o funcionamento sem
  hidratação e com JS desligado, que é uma decisão deliberada da 203.
- Sincronizar a âncora com a URL (`history.replaceState`, deep-link por categoria).
- Introduzir listener de `scroll` ou de `scrollend` como fonte de marcação — o `scrollend` ainda não
  tem suporte universal (Safari recente) e viraria um segundo caminho de decisão; a trava por timeout
  resolve sem esse custo.
- Mexer no `scrollIntoView` que centraliza o chip no trilho (continua com `block: "nearest"`, que é o
  que impede o sequestro do scroll vertical).
- Qualquer mudança no comportamento em modo busca (a nav é desmontada, decisão D2 da 202).
- Animação/transição nova no chip para "suavizar" a troca — mascararia o sintoma em vez de remover a
  causa, e custa movimento para quem pediu `prefers-reduced-motion`.
