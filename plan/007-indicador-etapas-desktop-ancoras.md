## Plano Técnico

### Análise do Codebase

**Descoberta central:** a maior parte do comportamento desejado pela issue 007 **já foi implementada inline** pelo commit `4a358d9` (issue 006), porém de forma duplicada dentro de `CheckoutWizard.tsx`, e **não dentro de `IndicadorEtapas`** como a issue pede ("mesmo componente, dois comportamentos via breakpoint"). O trabalho de 007 é, portanto, majoritariamente **refator + 1 ajuste funcional faltante (scroll suave)**, não construção do zero.

O que já existe e será reusado:
- `src/components/vitrine/checkout/CheckoutWizard.tsx` — orquestra estado único (`useMediaQuery("(min-width: 768px)")` → `ehDesktop`). Já bifurca a barra:
  - **Desktop (linhas 365-392):** `<nav aria-label="Seções do checkout">` com âncoras `#secao-itens`/`#secao-entrega`/`#secao-pagamento`, label "Ir para:", pílulas numeradas. **Já é exatamente o que a issue descreve**, mas escrito inline.
  - **Mobile (linhas 393-401):** `<nav aria-label="Etapas do pedido">` → `<IndicadorEtapas etapaAtual={etapa} />`. Stepper sequencial inalterado.
- `src/components/vitrine/checkout/IndicadorEtapas.tsx` — stepper numérico 1/2/3 mobile-first. Recebe `etapaAtual: 1|2|3`. Será reusado como está pelo ramo mobile.
- `src/components/vitrine/checkout/EtapaItens.tsx` (linha 100-103), `EtapaEntrega.tsx` (159), `EtapaPagamento.tsx` (118) — **já têm** `id="secao-itens|entrega|pagamento"` e `className="scroll-mt-[130px]"` (offset = 72px header + ~58px nav). Alvo das âncoras pronto. **Não tocar.**
- `src/hooks/useMediaQuery.ts` — SSR-safe (`false` no servidor/primeiro paint, sincroniza no client). Já é a fonte do `ehDesktop`. Sem estado de navegação paralelo: o ramo desktop usa âncoras nativas (`href="#..."`) que **não dependem de estado React** — zero risco de duplicar o `etapa`.
- `src/app/globals.css` (bloco `@layer base`, `html` na linha 205) — onde entra `scroll-behavior: smooth`.

### Decisão de arquitetura (não reinventar / não duplicar)

A issue exige: "Reusar `IndicadorEtapas.tsx` — mesmo componente, dois comportamentos via breakpoint" e "Nenhum estado de navegação duplicado". O estado atual tem a navegação desktop **fora** de `IndicadorEtapas`, em JSX solto no Wizard. Para cumprir o critério de aceite "mesmo componente, dois comportamentos", o ramo de âncoras desktop deve **migrar para dentro de `IndicadorEtapas`**, que passa a decidir internamente entre os dois modos via uma prop explícita `modo: "stepper" | "ancoras"` (decisão de breakpoint permanece no Wizard, que já tem `ehDesktop` — não duplicar `useMediaQuery` dentro do componente).

Por que prop `modo` e não `useMediaQuery` interno: o Wizard renderiza **uma árvore por vez** (mobile vs desktop) com base em `ehDesktop`; reabrir um segundo `useMediaQuery` dentro de `IndicadorEtapas` duplicaria a lógica de breakpoint e arriscaria divergência no primeiro paint. O Wizard passa `modo="ancoras"` quando `ehDesktop`, `modo="stepper"` (default) caso contrário.

### Cenários

**Caminho Feliz (desktop ≥768px):**
1. Usuário abre checkout; as 3 seções renderizam empilhadas (006).
2. Barra "Ir para: · 1 Itens · 2 Entrega · 3 Pagamento" fica sticky abaixo do header.
3. Clicar numa pílula → âncora nativa navega à seção; `scroll-behavior: smooth` + `scroll-mt-[130px]` posicionam abaixo das duas barras sticky.
4. Nenhuma navegação bloqueia outra; usuário pode ir/voltar livremente.

**Caminho Feliz (mobile <768px):**
1. Stepper numérico 1/2/3 sequencial idêntico ao atual; nenhuma mudança visual.

**Casos de Borda:**
- **Primeiro paint / SSR:** `useMediaQuery` retorna `false` → renderiza ramo mobile (stepper) antes de hidratar. Comportamento já existente (006); aceitável (mobile-first). Sem regressão introduzida por 007.
- **`prefers-reduced-motion`:** `scroll-behavior: smooth` global pode incomodar quem pediu menos movimento. Mitigar com `@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }` (acessibilidade WCAG, `design-system.md`).
- **Âncora sem alvo:** impossível — IDs garantidos nas 3 etapas (verificado). Mesmo assim, âncora nativa que não acha alvo é no-op silencioso.
- **Scroll global afetando outras páginas:** `scroll-behavior: smooth` no `html` é global. Verificar que não quebra a vitrine (`SecaoCatalogo.tsx` já usa `scroll-mt-24` e âncoras de categoria — passa a ter scroll suave também, o que é desejável/consistente).

**Tratamento de Erros:** N/A — navegação puramente client-side, sem rede, sem Server Action, sem dado. Nenhuma mensagem de erro nova.

### Schema de Banco
N/A — issue puramente de UX/navegação. Nenhuma tabela, query ou migration.

### Validação (zod)
N/A — sem input, sem formulário novo.

### Recálculo no Servidor
N/A — `seguranca.md` §10 não se aplica: zero valor monetário trafegado. O CTA "Confirmar pedido" e o recálculo continuam intocados (responsabilidade da 006/071).

### Camada cliente ↔ servidor
Toda a issue é cliente (`'use client'`). **Justificativa de ausência de enforcement server-side:** não há invariante de valor, permissão ou acesso. É navegação por âncora HTML nativa entre seções já renderizadas. Conforme a própria seção "Segurança" da issue: "Navegação puramente de UX. Nenhuma RLS." Nada a garantir no servidor.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/components/vitrine/checkout/IndicadorEtapas.tsx` — adicionar prop `modo: "stepper" | "ancoras"` (default `"stepper"`). Quando `"ancoras"`, renderizar a barra de âncoras (mover o JSX inline das linhas 375-390 do Wizard para cá), reusando a constante `PASSOS` para os rótulos. Quando `"stepper"`, manter o `<ol>` atual sem mudança. `etapaAtual` continua usado só no modo stepper.
- `src/components/vitrine/checkout/CheckoutWizard.tsx` — substituir o bloco `ehDesktop ? <nav âncoras inline> : <nav><IndicadorEtapas/></nav>` (linhas 365-401) por uma única chamada `<nav>` com `<IndicadorEtapas modo={ehDesktop ? "ancoras" : "stepper"} etapaAtual={etapa} />`. Os `aria-label`/classes sticky de cada `<nav>` migram para dentro do componente ou ficam num wrapper único. Elimina a duplicação de JSX de navegação.
- `src/app/globals.css` — no `@layer base`, bloco `html` (linha 205): adicionar `scroll-behavior: smooth;` + a media query `prefers-reduced-motion`.

**NÃO tocar:**
- `EtapaItens.tsx` / `EtapaEntrega.tsx` / `EtapaPagamento.tsx` — IDs e `scroll-mt-[130px]` já corretos.
- `useMediaQuery.ts` — reusado como está.
- `components/ui/` (shadcn) — não se edita à mão.
- Lógica de `estado.ts`, `useEnviarPedido`, `podeConfirmar`, CTA, ResumoValores — fora de escopo.

### Dependências Externas
Nenhuma. `lucide-react` (já em uso, ícone `Check`) e Tailwind v4 (tokens em `globals.css @theme`) bastam. `scroll-behavior` é CSS nativo.

### Ordem de Implementação
Issue **NÃO crítica** (sem dinheiro/RLS/auth/token) → sem fase RED obrigatória (`/tdd`). Ordem por dependência:
1. `globals.css` — `scroll-behavior: smooth` + guarda `prefers-reduced-motion` (ajuste funcional faltante; independente).
2. `IndicadorEtapas.tsx` — adicionar prop `modo` e o ramo `"ancoras"` (encapsular o que hoje é inline no Wizard).
3. `CheckoutWizard.tsx` — trocar os dois `<nav>` bifurcados por chamada única ao componente, removendo o JSX duplicado de âncoras. Depende de (2).
4. Verificação manual via `/verificar`: desktop rola suave às seções e nenhuma navegação bloqueia; mobile stepper inalterado; conferir que a vitrine não regrediu com o scroll suave global.
