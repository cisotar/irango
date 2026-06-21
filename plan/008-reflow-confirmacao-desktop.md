## Plano Técnico

### Correção de premissa (importante)
A issue diz "Refluir `ConfirmacaoClient.tsx`". **Isso está incorreto.** `ConfirmacaoClient.tsx` é um client boundary mínimo (Issue 037) que renderiza `null` — só limpa `sessionStorage` no mount. **Toda a UI da confirmação está no Server Component `page.tsx`** (`src/app/(publica)/loja/[slug]/confirmacao/page.tsx`). O reflow acontece **só no `page.tsx`**, alterando classes Tailwind no JSX. `ConfirmacaoClient.tsx` NÃO é tocado.

### Análise do Codebase

O que já existe e será reusado (zero código novo):
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` — Server Component que lê o pedido por `id + token_acesso` via `buscarPedidoPorToken` (service_role) e renderiza todo o resumo. **Único arquivo modificado** — só classes de layout.
- `src/lib/utils/formatarMoeda.ts` — `formatarMoeda(valor)`. Já usado no arquivo. Mantido.
- `src/lib/supabase/queries/pedidos.ts` (`buscarPedidoPorToken`) — leitura por token. **Intocado.**
- `src/lib/supabase/queries/entregaPagamento.ts` (`listarFormasPagamento`) — instrução de pagamento da loja. **Intocado.**
- `src/lib/utils/confirmacao.ts` (`resolverAcaoConfirmacao`) — gate de token/redirect. **Intocado.**
- `@/components/ui/{card,button,separator}` (shadcn) — primitivos. **NÃO editar à mão.**
- `@/components/vitrine/ListaOpcionaisItem` — render de opcionais por item. **Intocado.**
- Helpers locais do `page.tsx` (`numeroCurto`, `rotuloForma`, `rotuloTipoEntrega`, `formatarEndereco`, `instrucaoPagamento`, `instrucaoPadrao`) — lógica de apresentação. **Intocados** (só o JSX que os consome reflui).

O que precisa ser criado: **nada.** É reflow puro de classes Tailwind.

Convenção do projeto: a página hoje usa `max-w-lg`. Não há ainda página de checkout em rota separada (issues 002/006 ainda não implementadas), então não há um container "irmão" canônico a espelhar além do que a spec §131 define (`md:max-w-2xl`). Tailwind v4 com tokens em `globals.css @theme` (sem `tailwind.config.ts`) — usar utilitários padrão.

### Cenários

**Caminho Feliz (desktop ≥ `md`):**
1. Cliente abre `/loja/[slug]/confirmacao?pedido=<id>&token=<token>` (token válido).
2. Server Component lê o pedido por token (inalterado).
3. UI renderiza num container mais largo (`md:max-w-2xl`); coluna única estreita em mobile.
4. Instruções de pagamento (chave Pix / troco / instrução da loja) legíveis no layout amplo.

**Caminho Feliz (mobile < `md`):** idêntico ao atual — coluna única `max-w-lg` (ou estreita equivalente).

**Casos de Borda:**
- Sem `pedido`/`token` ou token errado → `resolverAcaoConfirmacao` retorna `redirecionar` → `redirect()`. **Inalterado** — o reflow ocorre depois desse gate.
- `ped.desconto === 0` → linha de desconto não renderiza (condicional atual mantida).
- `tipo_entrega === "retirada"` → bloco de endereço some; taxa "Grátis". Mantido.
- Forma de pagamento sem `config` da loja → cai em `instrucaoPadrao` (dinheiro/cartão) ou nada. Mantido.
- Pedido com muitos itens → no layout 2-colunas, a coluna de itens cresce; o card não deve quebrar. Mitigação: preferir **single card `md:max-w-2xl`** (abordagem A) que é imune a desbalanceamento de altura. Ver "Decisão de layout".
- Falha de rede na leitura server-side → comportamento atual (erro do Server Component / not found via gate). Não é objeto desta issue.

**Tratamento de Erros:** nenhuma mudança. O gate por token e a leitura server-side já tratam ausência/erro com redirect sem vazar dado (`seguranca.md` §14 e §pedidos). Reflow não adiciona caminho de erro novo.

### Decisão de layout (escolher A — recomendado)

A spec §131 oferece duas opções; escolher **A** por menor risco:

- **A (recomendada) — card único centralizado `md:max-w-2xl`.** Troca apenas o container externo: `max-w-lg` → `max-w-lg md:max-w-2xl` (ou `mx-auto ... max-w-2xl`). Conteúdo permanece em fluxo vertical único. Zero risco de colunas desbalanceadas, preserva 1:1 a ordem visual canônica de `design-claude/vitrine/confirmacao.html` (que é coluna única, `max-width: 480px`). Atende ao critério de aceite ("card mais largo... instruções de pagamento legíveis").
- **B — 2 colunas em `md`+** (resumo do pedido | pagamento+instruções). Maior custo: reorganizar o `CardContent` em `md:grid md:grid-cols-2`, decidir o que vai em cada coluna, e tratar alturas desiguais. Só justifica se a revisão visual pedir explicitamente. Não recomendada para issue não-crítica de reflow.

Implementar **A**. Se durante `/verificar` o resultado parecer vazio/largo demais, reavaliar para B.

### Schema de Banco
Nenhum. Issue não toca dados, migrations nem seed.

### Validação (zod)
Nenhuma. Sem formulário e sem input do cliente nesta página.

### Recálculo no Servidor (valor monetário)
Nenhum recálculo novo. **Todos os valores (`subtotal`, `desconto`, `taxa_entrega`, `total`, `preco`/`preco_snapshot` dos itens) já são snapshot autoritativo lido por token (RN-O6, server-side).** O reflow só reposiciona números já calculados — não os recalcula nem aceita valor do cliente. Invariante de valor permanece garantida no servidor (leitura por token + snapshot), inalterada.

### Camada de enforcement (cliente ↔ servidor)
| Invariante | Onde é garantida | Mudança nesta issue |
|-----------|------------------|---------------------|
| Leitura do pedido sem login | Server Component + `service_role` escopado por `id + token_acesso` (`buscarPedidoPorToken`) | **Nenhuma** |
| Gate de token errado/ausente | `resolverAcaoConfirmacao` → `redirect()` antes de renderizar | **Nenhuma** |
| Valores monetários (snapshot) | Servidor — lidos por token, nunca recalculados do cliente | **Nenhuma** |
| Apresentação/layout | Cliente (classes Tailwind no markup do Server Component) | **Reflow (esta issue)** |

Nenhum campo novo é exposto; a leitura não muda. Nenhuma RLS nova (não há SELECT anon em `pedidos`).

### Arquivos a Criar / Modificar / NÃO tocar
**Modificar (1 arquivo):**
- `src/app/(publica)/loja/[slug]/confirmacao/page.tsx` — apenas classes Tailwind de layout no `<main>` (e, se A, nada além do container). Sem mudança de lógica, query ou helper.

**NÃO tocar:**
- `src/app/(publica)/loja/[slug]/confirmacao/ConfirmacaoClient.tsx` — boundary mínimo, renderiza `null`. A issue erra ao apontá-lo; não há UI nele.
- `src/lib/supabase/queries/pedidos.ts`, `entregaPagamento.ts` — leitura por token / formas.
- `src/lib/utils/confirmacao.ts`, `formatarMoeda.ts` — lógica/util.
- `@/components/ui/*` (shadcn) — não editar à mão.
- `@/components/vitrine/ListaOpcionaisItem`.

### Dependências Externas
Nenhuma. Tailwind v4 já no projeto; utilitários `md:max-w-2xl` são built-in. Padrão Next.js App Router (Server Component) já em uso.

### Ordem de Implementação
Issue **não crítica** (sem dinheiro/RLS/auth/token alterados) → sem fase RED obrigatória de `tdd`.
1. Editar o container `<main>` de `page.tsx`: `max-w-lg` → `max-w-lg md:max-w-2xl` (abordagem A). Conferir que `mx-auto`/`px`/`py` permanecem.
2. `/verificar` no app real em mobile (< `md`) e desktop (≥ `md`): mobile idêntico ao atual; desktop com card mais largo e instruções legíveis.
3. Conferência visual contra `design-claude/vitrine/confirmacao.html` — cores/fontes/tokens inalterados.
4. (Opcional) Teste de regressão visual/snapshot não é exigido para reflow puro; cobertura existente (`confirmacao.test.ts`) já protege a lógica de apresentação, que não muda.
