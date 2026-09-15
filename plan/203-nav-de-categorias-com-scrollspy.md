## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (nada disso se reimplementa):**

- `src/lib/utils/ancoraCategoria.ts` — `ancoraCategoria(id, indice)`, módulo puro (sem `'use client'`), já consumido por `SecaoCatalogo` para emitir o `id` da `<section>`. **Fonte única do href do chip.** Proibida qualquer segunda implementação de âncora.
- `src/components/vitrine/medicaoBarraVitrine.ts` — `VAR_ALTURA_BARRA` (o literal `--altura-barra`) e `medirEObservarBarra`. O `rootMargin` do scrollspy lê **essa constante**, nunca o literal repetido, e nunca uma segunda medição.
- `src/components/vitrine/CatalogoVitrine.tsx` — já é dono da barra sticky (`sticky top-0 z-30`), do `useLayoutEffect` de medição e do `<main>`. Tem um **slot vazio comentado** (`{/* 203: <NavCategorias/> — o slot traz o próprio px-4 pb-2 */}`) que esta issue preenche. Nenhum `<main>` novo, nenhuma barra nova.
- `src/components/vitrine/SecaoCatalogo.tsx` — emite as `<section id={ancoraCategoria(...)}>` com `ESTILO_ANCORA_CATEGORIA` (`scroll-margin-top: calc(var(--altura-barra) + 0.75rem)`). **Não se toca:** os alvos do observer já existem e já estão compensados.
- `src/components/vitrine/layoutVitrine.ts` — `ESCADA_LARGURA_VITRINE` já aplicada dentro da barra; o trilho herda a largura, só traz o próprio padding.
- `src/hooks/useMediaQuery.ts` — hook SSR-safe existente. **Reuso para `prefers-reduced-motion: no-preference`** no `behavior` do `scrollIntoView`. Devolve `false` no SSR e no primeiro paint → o default é `"auto"` (sem movimento), que é o lado seguro do 2.3.3. Não criar `useReducedMotion`.
- `src/app/globals.css` §`@layer base` — o guard de `scroll-behavior: smooth` sob `@media (prefers-reduced-motion: no-preference)` **já existe** (linhas ~220-229, escrito pela 201 justamente para a 203). Não duplicar, não sobrescrever.
- Tokens `--cor-primaria`, `--cor-destaque`, `--texto`, `--borda-nav` e classes `border-borda-nav` / `text-marrom-cafe`: já mapeados em `globals.css` (`@theme`). **Zero token novo.**
- Padrão `min-h-[44px]` literal: precedente em `LinhaCategoriaReordenavel.tsx` (`const ALVO_TOQUE`) e `ReordenarCategorias.tsx`. Mesma régua (`design-system.md` §5 — `min-h-11` = 52,8px na base 120%, não é a régua; `size="icon-sm"` proibido).
- `mockups/vitrine-nav-categorias-e-busca.html` — CSS de `.trilho`/`.chip` e o JS de scrollspy já aprovados: **portar**, não redesenhar.

**O que precisa ser criado e por quê:**

| Arquivo | Por que não dá para reusar |
|---|---|
| `src/components/vitrine/scrollspyCategorias.ts` (**módulo neutro**, sem diretiva) | Mecânica do `IntersectionObserver` + desempate. Não existe equivalente: `grep -rn "IntersectionObserver" src/` → **zero ocorrências** no projeto. Módulo separado pelo mesmo motivo de `medicaoBarraVitrine.ts` / `criarControladorPolling` (`confirmacao/StatusPedidoLive.tsx`) / `prepararAbaWhatsapp` (`checkout/aberturaWhatsapp.ts`): o repo roda Vitest em `environment: node`, **sem jsdom** — só com o observer injetado por parâmetro a lógica de desempate vira testável. |
| `src/components/vitrine/NavCategorias.tsx` (`'use client'`) | Componente novo. Não existe `ui/tabs.tsx` nem `ui/carousel.tsx` e **não devem ser gerados** (spec §Fora do Escopo): as seções não são painéis mutuamente exclusivos e "aba 3 de 7" mentiria para o leitor de tela. É `<nav>` + `<ul>` + `<a href="#ancora">`. |
| `src/components/vitrine/scrollspyCategorias.test.ts` | Teste unitário ao lado do módulo, com observer fake. |
| `src/components/vitrine/NavCategorias.test.tsx` | Teste de árvore via `renderToStaticMarkup` (mesmo padrão de `CatalogoVitrine.test.tsx`): prova `<nav aria-label>`, gate de ≥3, hrefs vindos de `ancoraCategoria`, `min-h-[44px]`. Efeitos não rodam em `renderToStaticMarkup` — scrollspy não é testável aqui. |

**Lib madura > artesanal:** nada aqui pede lib. `IntersectionObserver`, `scroll-snap`, `mask-image` e `scrollIntoView` são plataforma. Zero dependência nova (orçamento do spec §Performance: "sem lib nova, sem dependência nova").

**Query / validação:** não se aplica — esta issue não lê banco, não valida input, não tem Server Action. Nomes e ordem das categorias chegam pelo payload RSC que `page.tsx` já monta (`buscarCategorias` + `buscarCatalogoPublico`, role `anon`, RLS + `vitrine_lojas`).

---

### Decisões de projeto

**D1 — A mecânica do observer sai do componente.** `scrollspyCategorias.ts` é módulo **neutro** (sem `'use client'`, sem `'use server'`), com `IntersectionObserver` e o elemento raiz **injetados**. Assinatura proposta:

```ts
export function escolherAtivo(ordem: string[], visiveis: ReadonlySet<string>): string | null;
export function criarScrollspy(deps: DepsScrollspy): () => void; // devolve o cleanup
```

`escolherAtivo` é pura e cobre o desempate (RN: vence a **primeira na ordem do catálogo**, não a de maior `intersectionRatio`). `criarScrollspy` recebe `{ ordem, obterSecao, IntersectionObserverCtor, rootMargin, aoAtivar }` e devolve o `disconnect`. Sem `IntersectionObserverCtor` (browser antigo / SSR), **degrada em silêncio**: nenhum chip fica marcado, os links âncora continuam funcionando. Nunca lança.

**D2 — O `rootMargin` lê a MESMA var, via a MESMA constante.**
```
rootMargin = `-${alturaBarra} 0px -55% 0px`
```
onde `alturaBarra` vem de `getComputedStyle(document.documentElement).getPropertyValue(VAR_ALTURA_BARRA).trim() || "0px"` — importando `VAR_ALTURA_BARRA` de `medicaoBarraVitrine.ts`. **Proibido** o literal `"--altura-barra"` digitado de novo, e proibido valor fixo (RN-6).

**D3 — Ordem dos efeitos: o efeito do scrollspy é `useEffect`, NUNCA `useLayoutEffect`.** O React roda *layout effects* de filho antes do pai; a var `--altura-barra` é publicada no `useLayoutEffect` do **pai** (`CatalogoVitrine`). Um `useLayoutEffect` em `NavCategorias` leria a var **antes** de ela existir e montaria o observer com `rootMargin: "-0px ..."`, deslocando o scrollspy em ~60px de forma silenciosa. Efeito passivo roda depois de todos os layout effects → var já publicada.

**D4 — Rebuild do observer quando a barra muda de altura.** `rootMargin` é congelado na construção do `IntersectionObserver`. A barra muda de altura ao montar a nav, ao girar o celular e (na 202) ao trocar trilho↔resumo. Solução **sem segunda medição**: acrescentar um callback opcional a `DepsMedicaoBarra` em `medicaoBarraVitrine.ts` —

```ts
export type DepsMedicaoBarra = {
  raiz: RaizInjetavel;
  ResizeObserverCtor?: ConstrutorResizeObserver;
  /** 203: notificado só quando a altura MUDA (a guarda de `ultimaAltura` já existe). */
  aoMedir?: (alturaPx: number) => void;
};
```
`CatalogoVitrine` guarda `alturaBarra` em `useState` e passa a `NavCategorias`; o efeito do observer tem `alturaBarra` nas deps. A guarda `ultimaAltura` já existente evita `setState` redundante (não há loop). Custo: um re-render da vitrine por **mudança real** de altura (montagem, rotação, toggle de busca) — não por scroll, não por tecla digitada. Alternativa rejeitada: listener de `resize`/`orientationchange` — vira segunda fonte de verdade e reintroduz listener global, contra o espírito do "proibido listener de `scroll`".

**D5 — Rebuild quando o conjunto de seções muda.** O efeito depende de `ordem.join("|")` (string estável derivada dos ids das categorias) e de `alturaBarra`. Quando a 202 filtrar o catálogo, a lista muda, o efeito reexecuta, o observer antigo é desconectado e um novo observa as `<section>` que existem agora. Cleanup **sempre** desconecta (unmount incluído).

**D6 — Clique marca o ativo imediatamente.** `onClick` no `<a>` faz `setAtivo(ancora)` e **não** dá `preventDefault`: a navegação âncora nativa continua sendo quem rola (é o que faz o critério "com JS desligado ainda funciona"). Durante o scroll suave o observer pode piscar em categorias intermediárias — comportamento aceito no mockup aprovado; **não** introduzir janela de supressão por `setTimeout` (timer é estado escondido e quebra com scroll do usuário no meio).

**D7 — Foco não recebe handler.** "Chip focado fora da viewport do trilho é trazido para dentro" é **comportamento nativo do navegador** ao focar um elemento dentro de um container com `overflow-x: auto`. Escrever um `onFocus` com `scrollIntoView` brigaria com o scroll nativo e produziria salto duplo. **Zero código**; verificação manual por Tab.

**D8 — `scrollIntoView` do chip ativo.** Só quando `ativo` muda e só sobre o `<a>` correspondente (`ref` por `Map<string, HTMLAnchorElement>` ou `querySelector` escopado ao `ref` do `<ul>`):
```ts
el.scrollIntoView({ inline: "center", block: "nearest", behavior: aceitaMovimento ? "smooth" : "auto" });
```
`block: "nearest"` é **obrigatório** — sem ele o scroll vertical da página é sequestrado e o catálogo pula sozinho. `aceitaMovimento = useMediaQuery("(prefers-reduced-motion: no-preference)")`.

**D9 — CSS do trilho: inline `CSSProperties` hoisted, não classe Tailwind arbitrária.** O commit `4c60783` desta mesma branch corrigiu exatamente o modo de falha oposto: literal de classe Tailwind com vírgula/underscore vira classe órfã em silêncio. `mask-image: linear-gradient(90deg, transparent 0, #000 16px, ...)` tem vírgulas e parênteses — vai num `const ESTILO_TRILHO: CSSProperties` no topo do módulo (mesmo precedente de `ESTILO_ANCORA_CATEGORIA` em `SecaoCatalogo.tsx`, que também evita realocação por render). Inclui `WebkitMaskImage` além de `maskImage` (Safari iOS), `scrollSnapType: "x proximity"`, `scrollPaddingInline: "1rem"`, `scrollbarWidth: "none"`. O `::-webkit-scrollbar` é pseudo-elemento e **não** cabe em `style`: uma regra de 3 linhas em `globals.css` (`.trilho-categorias::-webkit-scrollbar { display: none; }`), fora do `@layer base`, ao lado de `.print-only`. Os chips usam classes Tailwind normais (sem vírgula), exceto `boxShadow: "inset 0 -3px 0 rgba(255,255,255,.45)"` e `scrollSnapAlign: "center"`, que vão em `const ESTILO_CHIP_ATIVO` / `ESTILO_CHIP`.

**D10 — Sinal de "modo busca" (RN-5): sem prop.** `NavCategorias` **não** recebe `emBusca`. A 202 vai envolver o slot com `{termo === "" ? <NavCategorias .../> : <ResumoBusca .../>}` em `CatalogoVitrine` — desmontar é estritamente melhor que ocultar: o observer é desconectado pelo cleanup e não fica observando `<section>` que a filtragem removeu do DOM. O gate de **≥3 categorias** (RN-4) vive **dentro** de `NavCategorias` (`if (categorias.length < 3) return null`), para que a regra ande junto do componente.

---

### Cenários

**Caminho feliz**
1. `page.tsx` (Server Component) monta `categoriasComProdutos` e entrega a `CatalogoVitrine`.
2. `CatalogoVitrine` renderiza a barra sticky; o slot da 203 agora traz `<NavCategorias categorias={categorias} alturaBarra={alturaBarra} />`.
3. SSR/pré-hidratação: sai `<nav aria-label="Categorias do cardápio"><ul><li><a href="#cat-<uuid>">` com o primeiro chip já `aria-current="true"`. **Tocar num chip já rola** — é link âncora nativo.
4. Hidratação: `useLayoutEffect` do pai publica `--altura-barra`; `useEffect` da nav lê a var e monta o `IntersectionObserver` com `rootMargin: "-<altura> 0px -55% 0px"`, `threshold: 0`, sobre todas as `<section id=...>`.
5. O cliente rola. Cada entry entra/sai do `Set` de visíveis; `escolherAtivo` devolve a primeira na ordem do catálogo; o chip ganha `aria-current="true"` + fundo `--cor-primaria` + texto branco + sublinhado interno, e é trazido ao centro do trilho com `block: "nearest"` (a página **não** se move).
6. O cliente toca num chip: `setAtivo` marca na hora, o browser rola até a `<section>`, que para com o título visível graças ao `scroll-margin-top` da 201.

**Casos de borda**

| Situação | Comportamento exigido |
|---|---|
| 0 categorias | `CatalogoVitrine` já não renderiza a barra (`temBarra`). Nada a fazer. |
| 1 ou 2 categorias | `NavCategorias` devolve `null` (RN-4). A barra fica com 1px (só a borda) até a 202 pôr a busca — mesmo estado de hoje, não é regressão desta issue. |
| Categoria sem `id` (grupo "Outros") | `ancoraCategoria(null, indice)` → `grupo-<indice>`. Já coberto pela fonte única; o chip funciona igual. |
| Nome de categoria muito longo | `whitespace-nowrap`, **sem truncar** (fora de escopo). O trilho rola em X. |
| Duas seções visíveis ao mesmo tempo | `escolherAtivo` vence pela **primeira na ordem do catálogo** — determinístico, sem depender de `intersectionRatio`. |
| Nenhuma seção visível (entre duas, ou topo/rodapé extremos) | `escolherAtivo` devolve `null` → **mantém o ativo anterior**, nunca zera (chip nenhum marcado é pior que chip levemente atrasado). |
| Browser sem `IntersectionObserver` | `criarScrollspy` devolve cleanup no-op; sem marcação dinâmica, âncoras intactas. Nunca lança. |
| `prefers-reduced-motion: reduce` | `scroll-behavior` da página já é `auto` (guard da 201) e o `scrollIntoView` usa `behavior: "auto"`. |
| Rotação de tela | `ResizeObserver` (201) remede → `aoMedir` → `setAlturaBarra` → observer reconstruído com o novo `rootMargin` (D4). |
| Hidratação ainda não ocorreu / JS desligado | Links âncora funcionam; o chip inicial marcado no SSR é o da primeira categoria. |
| `--altura-barra` ainda vazia no momento da leitura | Fallback `"0px"` — scrollspy levemente adiantado por um frame, nunca `rootMargin` inválido (string vazia quebraria o construtor). |
| Unmount (navegação para o checkout) | Cleanup desconecta o observer; `medirEObservarBarra` já remove a CSS var. |

**Tratamento de erros.** Não há I/O, rede, banco nem Server Action — não há erro para vazar. A única superfície de falha é API de plataforma ausente, tratada por degradação silenciosa (nada de `try/catch` cosmético, nada de `console.error` na vitrine do cliente). Se algum dia algo aqui lançar, cai no error boundary já existente da rota; mensagem genérica na UI, detalhe só no log do servidor (`seguranca.md` §14).

---

### Schema de Banco

**Nenhuma mudança.** Zero migration, zero tabela, zero coluna, zero índice, zero política RLS. O spec é explícito (§Modelos de Dados: "Nenhuma mudança de schema"). Nada nesta issue consulta o Supabase.

### Validação (zod)

**Não se aplica.** Não há input de usuário validado, nem formulário, nem payload atravessando fronteira cliente→servidor. Não criar schema em `lib/validacoes/` — seria arquivo morto.

### Recálculo no Servidor

**Não se aplica — e essa ausência é auditada, não presumida.** Esta issue não cria, lê nem exibe valor monetário novo: rola a página e marca um chip. As invariantes de valor e de permissão que a vitrine tem continuam **inteiramente** no servidor e **intocadas** por este diff:

| Invariante | Onde é garantida (caminho existente, não alterado) |
|---|---|
| Quais produtos o cliente pode ver | RLS + view `vitrine_lojas` + gate de assinatura em `page.tsx` (SSR, role `anon`). RN-1. A nav não amplia o conjunto: ela nem filtra, só rola. |
| Preço / subtotal / frete / total cobrados | Recalculados do banco na Server Action de checkout (`seguranca.md` §10). RN-8. Nenhum arquivo desse caminho é tocado. |
| Escopo por loja | O slug da rota já escopou a página no servidor. Nada aqui consulta por `loja_id`. |

**Nenhum arquivo `'use client'` desta issue guarda invariante alguma.** O chip ativo é estado de UX puro: um cliente que force `aria-current` em todos os chips com o devtools vê chips coloridos — e mais nada.

**Superfície de entrada não confiável:** só o nome da categoria (texto de lojista, vindo do banco). Renderizado **exclusivamente por JSX** (escape automático do React) — sem `dangerouslySetInnerHTML`, sem concatenação de HTML (`seguranca.md` §15). A âncora é derivada do **`id` (uuid)**, nunca do nome: nenhum seletor CSS, `querySelector` ou fragmento de URL é montado com texto livre. O `document.getElementById(ancora)` usado pelo observer recebe string no formato `cat-<uuid>` / `grupo-<n>`.

---

### Arquivos a Criar / Modificar / NÃO tocar

**Criar**

| Arquivo | Conteúdo |
|---|---|
| `src/components/vitrine/scrollspyCategorias.ts` | Módulo **neutro**. `escolherAtivo` (pura, desempate pela ordem do catálogo) + `criarScrollspy` (observer injetado, devolve cleanup). Tipos `DepsScrollspy`, `ConstrutorIntersectionObserver`. |
| `src/components/vitrine/scrollspyCategorias.test.ts` | Vitest `environment: node` com observer fake: desempate, `null` sem visíveis, cleanup desconecta, ausência do construtor degrada sem lançar, `rootMargin` montado com a altura recebida. |
| `src/components/vitrine/NavCategorias.tsx` | `'use client'`. Gate ≥3, `<nav aria-label="Categorias do cardápio">` + `<ul>` + `<a href={"#" + ancoraCategoria(...)}>`, estado `ativo`, `useEffect` (D3) do scrollspy, `scrollIntoView` do chip ativo, `useMediaQuery` de reduced-motion. Constantes de estilo hoisted (D9). |
| `src/components/vitrine/NavCategorias.test.tsx` | `renderToStaticMarkup`: 2 categorias → string vazia; 3+ → `<nav aria-label=...>`, hrefs iguais aos ids das `<section>` de `SecaoCatalogo`, `min-h-[44px]` presente, primeiro chip com `aria-current`. |

**Modificar**

| Arquivo | Mudança | Motivo |
|---|---|---|
| `src/components/vitrine/CatalogoVitrine.tsx` | Preenche o slot da 203; adiciona `useState` de `alturaBarra` alimentado pelo novo `aoMedir`. | Slot já reservado pela 201. Sem `alturaBarra` o `rootMargin` congela desatualizado (D4). |
| `src/components/vitrine/medicaoBarraVitrine.ts` | Campo opcional `aoMedir?: (alturaPx: number) => void` em `DepsMedicaoBarra`, chamado dentro de `medir()` **depois** da guarda `ultimaAltura`. | Única forma de reagir à mudança de altura **sem** segunda medição e sem listener global. Campo opcional → não quebra chamador nem teste existente. |
| `src/components/vitrine/medicaoBarraVitrine.test.ts` | +1 caso: `aoMedir` é chamado só quando a altura muda. | A guarda de re-entrada é o que impede loop de render. |
| `src/components/vitrine/CatalogoVitrine.test.tsx` | +2 casos: com 3+ categorias a árvore SSR contém `<nav aria-label="Categorias do cardápio">`; com 2, não contém. | Prova o gate RN-4 no ponto de integração. |
| `src/app/globals.css` | Uma regra: `.trilho-categorias::-webkit-scrollbar { display: none; }`, fora do `@layer base`. | Pseudo-elemento não cabe em `style` inline (D9). |

**NÃO tocar**

- `src/components/vitrine/SecaoCatalogo.tsx` — os `id` e o `scroll-margin-top` já estão certos (201). Mexer aqui reabre o risco que a 201 fechou.
- `src/lib/utils/ancoraCategoria.ts` — a assinatura serve como está; importar, não editar.
- `src/app/(publica)/loja/[slug]/page.tsx` — não fica sabendo da nav; ela é filha de `CatalogoVitrine`.
- `src/components/vitrine/HeaderLoja.tsx` — tornar o header sticky está **fora do escopo** do spec.
- `src/components/ui/*` — gerado pelo shadcn CLI, não se edita à mão. E **não gerar** `ui/tabs.tsx` nem `ui/carousel.tsx` (spec §Fora do Escopo).
- `src/lib/utils/buscarProdutos.ts` e qualquer coisa de busca — é a 202, que roda **depois** desta.
- `src/components/vitrine/VitrineClient.tsx`, `CardProduto.tsx`, `ItemProdutoLista.tsx`.
- `supabase/migrations/`, `src/lib/actions/`, `src/lib/supabase/queries/` — esta issue não encosta em banco.

---

### Dependências Externas

**Nenhuma.** Zero pacote novo, zero API externa, zero chamada de rede (cliente ou servidor).

**Custo e quota (`architecture.md` §9 nº1):** não há custo variável a analisar — nada aqui chama Upstash, Nominatim, Google, Sentry, Supabase ou qualquer endpoint. `IntersectionObserver`, `scrollIntoView`, `scroll-snap`, `mask-image` e `getComputedStyle` são API de plataforma do browser: sem quota, sem cobrança, sem fail-closed a desenhar. Suporte: `IntersectionObserver` e `scroll-snap` são baseline desde 2019 (Safari iOS 12.2+); `mask-image` exige o par `-webkit-` no Safari, já previsto em D9. Ausência de `IntersectionObserver` degrada para "links âncora sem marcação" — nunca quebra.

**Orçamento de bundle (spec §Performance):** `NavCategorias` + `scrollspyCategorias` somam código próprio da ordem de ~3KB não-minificado, sem import novo além de `ancoraCategoria`, `VAR_ALTURA_BARRA` e `useMediaQuery` (todos já no grafo da vitrine). Auditoria com o agente `acelerar` após a implementação (bundle da vitrine + jank em 360×640).

---

### Ordem de Implementação

Issue **não-crítica** pelos três mandatos (zero dinheiro, zero RLS, zero Server Action de valor, zero auth) — **não** exige `tdd` red-first. A ordem abaixo é por dependência: o núcleo puro e testável primeiro, o DOM depois.

1. **`scrollspyCategorias.ts` + teste** — `escolherAtivo` e `criarScrollspy` com observer injetado. A única lógica desta issue que é testável neste ambiente; escrevê-la primeiro evita que ela nasça grudada no componente e só verificável a olho.
2. **`aoMedir` em `medicaoBarraVitrine.ts` + caso no teste existente** — pré-requisito de D4; campo opcional, diff mínimo, suíte verde antes de seguir.
3. **`NavCategorias.tsx`** — árvore (`<nav>`/`<ul>`/`<a>`), gate ≥3, estilos hoisted, `min-h-[44px]` literal, `aria-current` + sublinhado interno. Ainda sem efeito: aqui já se ganha o critério "funciona sem JS".
4. **`NavCategorias.test.tsx`** — trava o gate, o `aria-label`, os hrefs e o alvo de toque antes de a fiação entrar.
5. **Fiação em `CatalogoVitrine.tsx`** — slot + `useState` de `alturaBarra`; `+` casos no `CatalogoVitrine.test.tsx`.
6. **Efeitos em `NavCategorias`** — `useEffect` (nunca `useLayoutEffect`, D3) do scrollspy e `scrollIntoView` do chip ativo com `useMediaQuery`.
7. **`.trilho-categorias::-webkit-scrollbar` em `globals.css`** — último, para o diff de CSS ficar isolado e fácil de reverter.
8. **Gate:** `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
9. **Verificação manual em 360×640** (scrollspy, `scroll-snap`, sticky e alvo de toque **não são testáveis neste ambiente** — sem jsdom, sem Playwright, sem MCP de browser): (a) chip marca ao rolar e o catálogo **não** pula verticalmente; (b) o trilho rola em X e o `<main>` **nunca** rola em X; (c) Tab percorre e ←/→ continuam rolando a página; (d) loja com 2 categorias não mostra trilho; (e) com o devtools, confirmar que **não existe** nenhum listener de `scroll` no código desta issue.
10. **`acelerar`** sobre a vitrine (bundle + jank), depois `revisar` ‖ `testar` ‖ `auditar`.
