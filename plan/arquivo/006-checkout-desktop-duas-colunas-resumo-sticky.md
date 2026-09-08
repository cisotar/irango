## Plano Técnico

> Issue **crítica** (TDD red-first). O risco real (spec §171/§176): ao mover `ResumoValores` para a coluna sticky desktop, um dev "passar o total calculado" como prop e o submit confiar nele. O plano fecha esse vetor extraindo o **builder do payload** e o gate **`podeConfirmar`** para funções puras testáveis — não há caminho de submit que toque valor monetário.

### Análise do Codebase

O que **já existe e será reusado** (nada disso se recria — §164 do spec, mandato "não reinventar a roda"):

- `src/components/vitrine/checkout/estado.ts` — **fonte única de estado** (`EstadoWizard`, `ESTADO_INICIAL`, ler/salvar sessionStorage). NÃO duplicar. Recebe duas funções puras novas (ver abaixo). `EstadoWizard` já é livre de campos monetários por design.
- `src/components/vitrine/checkout/CheckoutWizard.tsx` — container e dono do estado (`useState<EstadoWizard>`, `etapa`, `subtotalPreview`, `descontoPreview`, `fretePreview`). É o **único** ponto onde entra a bifurcação de layout responsivo.
- `src/components/vitrine/checkout/EtapaItens.tsx` / `EtapaEntrega.tsx` / `EtapaPagamento.tsx` — conteúdo inalterado; mesmos componentes nos dois mundos. Hoje cada uma embute seu próprio `ResumoValores` e botão "Continuar/Confirmar".
- `src/components/vitrine/checkout/ResumoValores.tsx` — preview puro (subtotal/desconto/frete/total via `formatarMoeda`). Recebe valores como props já hoje, mas é **só exibição**; não alimenta submit. Reusado na coluna sticky.
- `src/components/vitrine/checkout/IndicadorEtapas.tsx` — stepper mobile; inalterado nesta issue (desktop dele é a 007).
- `src/lib/validacoes/pedido.ts` (`schemaPayloadPedido`, `.strict()`) — fronteira que já rejeita campos monetários. Reusado no builder e na action; **não muda**.
- `src/lib/actions/pedido.ts` (`criarPedido`), `src/lib/actions/frete.ts` (`calcularFreteAction`), `src/lib/actions/cupomPreview.ts` (`validarCupomAction`) — recálculo autoritativo. **Intocados** (fora de escopo §188).
- `src/lib/utils/calcularTotal.ts` (`calcularSubtotal`), `formatarMoeda.ts` — preview. Reusados.
- Tailwind v4 com prefixos `md:`/`lg:` (tokens em `globals.css @theme`, sem `tailwind.config.ts`) — o reflow é só classes utilitárias; uma árvore que reflui, sem componente "desktop" paralelo.

O que **precisa ser criado** (justificado por não existir reuso):

- **Função pura `montarPayloadPedido(args)`** em `estado.ts` — hoje o builder do payload vive **inline** dentro de `EtapaPagamento.enviar()` (linhas 116-149). Extrair é o que torna o critério red-first testável em `environment: node` (sem jsdom não há clique). Justificativa: não existe função equivalente; manter inline impede o teste e mantém o vetor "total como prop" latente.
- **Função pura `podeConfirmar(estado, contexto)`** em `estado.ts` — a decisão da issue 001 (`enderecoValido && pagamentoValido`). Hoje a lógica de habilitar está espalhada (`podeAvancar` em `EtapaEntrega`, `podeEnviar` em `EtapaPagamento`). Para o desktop empilhado (sem etapas), o gate precisa ser **agregado e único** — derivado do estado, não da máquina `etapa`. Justificativa: a derivação agregada não existe; a 001 a exige explicitamente.

### Cenários

**Caminho Feliz (desktop `md`+):**
1. Cliente abre `/loja/[slug]/pedido` em viewport `md`+. `CheckoutWizard` detecta layout desktop (CSS, não JS — ver nota) e renderiza grid `md:grid-cols-[1fr_360px] lg:grid-cols-[1fr_400px]` em `max-w-5xl`/`6xl mx-auto`.
2. Coluna esquerda: `EtapaItens`, `EtapaEntrega`, `EtapaPagamento` empilhadas, todas visíveis. Coluna direita: `ResumoValores` em `lg:sticky lg:top-4`.
3. Cliente ajusta quantidade → `subtotalPreview` recalcula (preview). Preenche endereço → `calcularFreteAction` atualiza `fretePreview`. Aplica cupom → `validarCupomAction` atualiza `descontoPreview`. Tudo reflete no resumo sticky.
4. `podeConfirmar(estado, ctx)` vira `true` quando endereço (se entrega) + forma de pagamento válidos e loja aberta.
5. Clica "Confirmar pedido" → `montarPayloadPedido(...)` monta payload **sem valores monetários** → `schemaPayloadPedido.safeParse` → `criarPedido` → redirect confirmação.

**Caminho Feliz (mobile `< md`):** wizard sequencial idêntico ao atual (estado `etapa` 1→2→3); zero regressão.

**Casos de Borda:**
- Carrinho vazio → tela "carrinho vazio" (comportamento atual, mantido).
- Endereço incompleto / fora de zona (entrega) → `podeConfirmar = false`; botão desabilitado; resumo mostra frete preview = 0.
- Sem forma de pagamento selecionada → `podeConfirmar = false`.
- Loja só aceita retirada (`aceitaEntrega=false`) → `tipoEntrega` forçado `retirada`; endereço não exigido para confirmar.
- Loja fechada (`lojaAberta=false`) → botão "Loja fechada", `podeConfirmar=false`.
- Cupom expirado/inválido → `validarCupomAction` retorna `valido:false`; desconto preview volta a 0; não bloqueia confirmar (cupom é opcional).
- Falha de rede no submit → `criarPedido` retorna `{ erro }`; toast genérico; estado/idempotencyKey preservados para retry (comportamento atual).

**Tratamento de Erros (seguranca.md §14):** mensagens genéricas ao cliente (toast "Confira os dados…" / "Não foi possível criar o pedido."); detalhe só no `console.error` server-side dentro de `criarPedido` (já implementado, intocado).

### Schema de Banco

**Nenhuma mudança.** Feature 100% de apresentação. Sem migration, sem tabela, sem coluna.

**RLS:** nenhuma policy nova. Tabelas lidas já têm RLS (`produtos`, `formas_pagamento`, `zonas/taxas/bairros`, `pedidos` via token+service_role, `cupons` via Server Action escopada). O reflow não muda nenhuma query.

### Validação (zod)

`schemaPayloadPedido` (`src/lib/validacoes/pedido.ts`) — schema único já existente, `.strict()` na raiz e nos itens. Reusado **sem alteração** no builder (UX/gate client) e na Server Action `criarPedido` (segurança). Campos monetários não declarados → rejeitados na entrada.

### Recálculo no Servidor (valor monetário presente)

| Campo | Cliente envia? | Servidor |
|-------|----------------|----------|
| `produto_id`, `quantidade`, opcionais (`opcional_id`+`quantidade`) | sim | valida loja/disponível/categoria; preço do banco |
| `loja_id` | sim | valida ativa |
| `endereco_entrega` (cep/rua/numero/bairro/…) | sim | recalcula frete + reconcilia bairro↔CEP fail-closed (§10-A) |
| `codigo_cupom` | sim | revalida escopado por loja_id; desconto recalculado |
| `forma_pagamento`, `troco_para`, `nome/telefone/observacoes`, `tipo_entrega`, `idempotency_key` | sim | não-monetários |
| `subtotal` / `desconto` / `taxa_entrega` / `total` / `preco` | **NÃO** | **recalculado do zero**; `.strict()` rejeita se enviado |

O caminho autoritativo (`criarPedido` + RPC `criar_pedido` + RLS) **não é tocado** por esta issue. `montarPayloadPedido` é a garantia client-side de que o submit nunca carrega valor — e o teste red-first prova isso.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/components/vitrine/checkout/estado.test.ts` (RED) — agente `tdd`. Testa: (a) `montarPayloadPedido(...)` retorna objeto cujas chaves NÃO incluem `subtotal`/`desconto`/`taxa_entrega`/`total`/`preco`, e que passa `schemaPayloadPedido.safeParse`; (b) `podeConfirmar` só é `true` com endereço (se entrega) + pagamento válidos + loja aberta. Falha primeiro porque as funções ainda não existem.

**Modificar:**
- `src/components/vitrine/checkout/estado.ts` — adicionar funções puras `montarPayloadPedido(args)` e `podeConfirmar(estado, ctx)`. (Não tem `'use client'`/`'use server'` — módulo neutro; pode ser importado por teste e por componentes client.)
- `src/components/vitrine/checkout/EtapaPagamento.tsx` — substituir o builder inline por `montarPayloadPedido(...)`; usar/expor o gate via `podeConfirmar` quando em desktop (mobile mantém `podeEnviar` local equivalente, derivado da mesma função).
- `src/components/vitrine/checkout/EtapaEntrega.tsx` — `podeAvancar` passa a reusar a parte de endereço de `podeConfirmar` (DRY). Sem mudança de comportamento mobile.
- `src/components/vitrine/checkout/CheckoutWizard.tsx` — bifurcação de layout: `< md` wizard sequencial atual (intocado); `md`+ grid 2 colunas (etapas empilhadas à esquerda + `ResumoValores` sticky à direita) com **mesmo estado**. Resumo sticky recebe `subtotalPreview`/`descontoPreview`/`fretePreview` já existentes (props de exibição, não de submit).

**NÃO tocar:** `src/lib/actions/pedido.ts`, `frete.ts`, `cupomPreview.ts`; `src/lib/validacoes/pedido.ts`; RPC `criar_pedido`; `ResumoValores.tsx` (reusado como está); `IndicadorEtapas.tsx` (desktop é 007); `components/ui/*` (shadcn). Nenhuma migration.

### Dependências Externas

Nenhuma nova. Tailwind v4 (já no projeto), shadcn já instalado. ViaCEP segue client-side sem credencial para autocomplete; reconciliação de frete permanece server-side. Docs de referência: Next.js App Router (https://nextjs.org/docs/app), zod (https://zod.dev) — só padrões já em uso.

### Ordem de Implementação

Issue crítica → **fase RED antes do código de produção**:

1. **RED (`/tdd`)** — escrever `estado.test.ts` falhando: assert de ausência de campos monetários no payload de `montarPayloadPedido` + tabela-verdade de `podeConfirmar`. Confirmar falha real (funções inexistentes).
2. **GREEN (`/execute`)** — extrair `montarPayloadPedido` e `podeConfirmar` para `estado.ts`; refatorar `EtapaPagamento`/`EtapaEntrega` para consumi-las (mobile sem regressão). Teste passa.
3. Bifurcação de layout em `CheckoutWizard.tsx` (grid desktop + sticky), reusando o estado único e as funções puras.
4. `next build` (constraint `'use server'`: `estado.ts` é módulo neutro — sem `'use server'`, pode exportar funções não-async sem quebrar o build).

> **Nota de bifurcação (spec §195):** preferir UMA árvore que reflui via classes `md:`/`lg:` em vez de duas árvores com `display:none` (evita estado duplicado e DOM pesado). Se a navegação sequencial mobile exigir uma árvore separada, a invariante inegociável é **UM estado compartilhado** (`estado.ts`) — nunca duplicar `useState`.
