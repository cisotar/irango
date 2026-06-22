## Plano Técnico

### Análise do Codebase

O que já existe e será reusado (NÃO criar arquivo novo — toda mudança é inline em `src/lib/utils/assinatura.ts`):

- `src/lib/utils/assinatura.ts` — fonte única das regras de assinatura.
  - `type StatusAssinatura` (union: `trial|ativa|inadimplente|cancelada|suspensa`) — **estender com `"cortesia"`**.
  - `type ResultadoEvento` = `{ status; renova } | { ignorar: true }` — **reusado tal qual** por `eventoBillingParaStatus` (não criar um tipo paralelo).
  - `const MAPA_EVENTO` + `eventoParaStatus(evento, statusAtual)` — **padrão a espelhar** para o novo `eventoBillingParaStatus`.
  - `assinaturaPermiteAcesso(status, fimPeriodo, agora)` — switch exaustivo SEM `default` → **estender** com `case "cortesia"`.
- `src/lib/utils/assinatura.test.ts` — suite RED/GREEN existente; o `tdd` estende, não recria.

Consumidores do union `StatusAssinatura` mapeados (quem quebra/precisa atenção ao adicionar `cortesia`):

| Arquivo | Como usa | Impacto desta issue |
|---|---|---|
| `src/lib/utils/assinatura.ts` `assinaturaPermiteAcesso` | `switch (status)` exaustivo, sem `default` | **QUEBRA o build** (TS2366 — nem todo caminho retorna) até adicionar `case "cortesia"`. **Faz parte do escopo desta issue.** |
| `src/lib/utils/acessoPainel.ts` | array `STATUS_CONHECIDOS: readonly StatusAssinatura[]` (sem `cortesia`) + branch `if ("ativa")`/`if ("suspensa")` | NÃO quebra build (array não é exaustivo-checado). Mas `cortesia` cairia no fail-closed (bloqueado). **Correção é da issue 079** (escopo explicitamente fora — issue diz "NÃO altera `acessoPainel.ts`"). Apenas registrar como dívida conhecida. |
| `src/components/painel/StatusAssinatura.tsx` | `Record<StatusUnion, string>` (`ROTULO`) e `Record<StatusUnion, ...>` (`VARIANTE`) | **QUEBRA o build** — `Record<StatusAssinatura, X>` passa a exigir a chave `cortesia`. Ver "Arquivos a Modificar". |
| `src/lib/actions/pedido.ts`, `src/app/(publica)/loja/[slug]/page.tsx` | cast `as StatusAssinatura` + chamam `assinaturaPermiteAcesso` | NÃO quebra build; herdam o `true` de `cortesia` automaticamente via o util. Nenhuma mudança. |
| `src/app/api/webhooks/hotmart/route.ts`, `src/lib/assinatura/reconciliar.ts`, `src/lib/supabase/queries/webhookHotmart.ts` | `eventoParaStatus` / `aplicarStatusAssinatura` com `StatusAssinatura` | NÃO quebra; `cortesia` nunca é produzido por evento Hotmart. Nenhuma mudança. |

### Cenários

**Caminho Feliz (`eventoBillingParaStatus`):**
1. Webhook do provider (issue 077) já normalizou o nome externo → "evento lógico" (responsabilidade do adapter 076).
2. Chama `eventoBillingParaStatus(provider, tipo)`.
3. Função consulta o mapa interno por `tipo` e devolve `{ status, renova }`.
4. Webhook aplica via `service_role` (fora desta issue).

**Caminho Feliz (`cortesia` no acesso):**
1. Admin concede cortesia (issue 078) → `assinatura_status = 'cortesia'`.
2. Qualquer gate chama `assinaturaPermiteAcesso('cortesia', fim, agora)` → `true`, ignorando `fim` (igual `ativa`).

**Casos de Borda:**
- `tipo` desconhecido / fora do mapa → `{ ignorar: true }` (não rejeita — evita retry infinito no webhook). Mesma postura de `eventoParaStatus`.
- `provider` desconhecido → nesta v1 o mapa é agnóstico de provider (semântica única espelhando Hotmart): `provider` é aceito na assinatura mas **não** ramifica a lógica; só `tipo` decide. Documentar que ramificação por provider é evolução futura (não há requisito de divergência no spec — "semântica espelha o Hotmart").
- `cortesia` com `fim` no passado / `null` → `assinaturaPermiteAcesso` retorna `true` mesmo assim (ignora `fim`, como `ativa`).
- Reembolso/chargeback → `suspensa` (corte imediato, sem carência) — invariante RN-8.

**Tratamento de Erros:** funções puras, sem I/O, não lançam. Entrada inválida nunca muda estado (retorna `{ ignorar: true }`). Nenhuma mensagem ao usuário neste nível.

### Schema de Banco

Esta issue NÃO toca banco. O CHECK constraint `assinatura_status IN (...,'cortesia')` (spec linha 168) e a coluna de provider são responsabilidade da issue de migration do épico, não da 075. Aqui é só o util TypeScript puro.

### Validação (zod)

Não se aplica — nenhuma fronteira de entrada de usuário nesta issue. As funções são puras e tipadas pelo union. O `tipo` chega já normalizado pelo adapter (076); a validação do payload cru do provider é da issue do webhook (077).

### Recálculo no Servidor

Não há valor monetário nesta issue. As funções decidem apenas estado de acesso e mapeamento evento→status — ambos invariantes server-side (são consumidos por gate de acesso e por webhook que roda com `service_role`). O cliente nunca chama estas funções para decidir o próprio acesso: quem aplica é o webhook (server) e os gates (Server Component/Server Action).

### Assinatura e mapa exatos a implementar

```ts
// 1) Estender o union (linha 5–10)
export type StatusAssinatura =
  | "trial" | "ativa" | "inadimplente" | "cancelada" | "suspensa" | "cortesia";

// 2) Evento lógico de billing (provider-agnóstico nesta v1).
//    NÃO é o nome externo cru do provider — isso é o adapter (issue 076).
export type EventoBilling =
  | "cobranca_aprovada"      // primeira compra / cobrança aprovada
  | "recorrencia_aprovada"
  | "pagamento_falhou"       // dunning
  | "assinatura_cancelada"
  | "reembolso"
  | "chargeback";

// 3) Mapa puro evento lógico → estado (espelha MAPA_EVENTO; reusa ResultadoEvento)
const MAPA_EVENTO_BILLING: Record<EventoBilling, { status: StatusAssinatura; renova: boolean }> = {
  cobranca_aprovada:    { status: "ativa",        renova: true  },
  recorrencia_aprovada: { status: "ativa",        renova: true  },
  pagamento_falhou:     { status: "inadimplente", renova: false },
  assinatura_cancelada: { status: "cancelada",    renova: false },
  reembolso:            { status: "suspensa",     renova: false },
  chargeback:           { status: "suspensa",     renova: false },
};

// 4) Função pura. `provider` aceito por contrato/futuro, sem ramificar nesta v1.
//    `tipo: string` (não `EventoBilling`) porque a entrada é não-confiável: tipo
//    fora do mapa → { ignorar: true } (nunca muda estado, evita retry infinito).
export function eventoBillingParaStatus(
  _provider: string,
  tipo: string,
): ResultadoEvento {
  const resultado = Object.prototype.hasOwnProperty.call(MAPA_EVENTO_BILLING, tipo)
    ? MAPA_EVENTO_BILLING[tipo as EventoBilling]
    : undefined;
  if (!resultado) return { ignorar: true };
  return { status: resultado.status, renova: resultado.renova };
}

// 5) Estender o switch (NÃO reescrever): cortesia = acesso pleno, ignora fim.
case "cortesia":
  return true; // igual "ativa": acesso pleno, sem olhar fimPeriodo (RN-4)
```

Notas de assinatura:
- `tipo: string` (não `EventoBilling`) é deliberado e espelha `eventoParaStatus`, que aceita `EventoHotmart` mas trata desconhecido via `hasOwnProperty`. Como o issue exige `eventoBillingParaStatus(provider: string, tipo: string)`, manter `string` nos dois parâmetros — a checagem `hasOwnProperty` garante a postura "ignorar desconhecido".
- `_provider` com underscore (não usado nesta v1) para passar lint de unused.
- Nomes dos eventos lógicos: alinhar com o adapter (076). Recomendo os snake_case acima; o `tdd` e o `executar` devem usar exatamente os mesmos literais que a issue 076 emitirá. Se 076 ainda não existe, estes literais viram o contrato.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:** nenhum (mandato de reuso).

**Modificar:**
- `src/lib/utils/assinatura.ts` — (a) adicionar `"cortesia"` ao union; (b) adicionar `EventoBilling`, `MAPA_EVENTO_BILLING`, `eventoBillingParaStatus`; (c) adicionar `case "cortesia": return true;` no switch de `assinaturaPermiteAcesso`. Remover o comentário "STUB TDD" do topo se a fase GREEN consolidar (decisão do `executar`).
- `src/components/painel/StatusAssinatura.tsx` — **obrigatório para o build passar.** `ROTULO` e `VARIANTE` são `Record<StatusUnion, ...>` → adicionar chave `cortesia` (ex.: rótulo "Cortesia", variante `"secondary"`). Sem isso, `tsc`/`next build` quebram. Mudança mínima de 2 linhas; não altera comportamento de outros status.
- `src/lib/utils/assinatura.test.ts` — estendido pelo `tdd` (fase RED): casos `assinaturaPermiteAcesso('cortesia', ...) === true` (incluindo `fim` no passado e `agora` arbitrário) e tabela de `eventoBillingParaStatus` (cada evento lógico + desconhecido → `{ignarar:true}`).

**NÃO tocar:**
- `src/lib/utils/acessoPainel.ts` — `STATUS_CONHECIDOS` ganha `cortesia` SÓ na issue 079 (escopo explícito da issue). Não inclui aqui.
- `src/components/ui/*` (shadcn) — nunca editar à mão; `StatusAssinatura.tsx` é componente de domínio, esse sim editável.
- Webhook Hotmart, `reconciliar.ts`, `webhookHotmart.ts`, `pedido.ts`, `loja/[slug]/page.tsx` — herdam o comportamento sem mudança.

### Regra cliente ↔ servidor

| Invariante | Camada que garante |
|---|---|
| `cortesia` libera acesso pleno | `assinaturaPermiteAcesso` (util puro, server) consumido pelos gates server-side (`acessoPainel`→layout, `loja/[slug]` Server Component, `pedido.ts` Server Action) |
| Reembolso/chargeback → `suspensa` (corte) | `eventoBillingParaStatus` consumido pelo webhook do provider que aplica via `service_role` (issue 077) |
| Evento desconhecido nunca muda estado | `{ ignorar: true }` no util (server) |

Nenhuma destas funções é importada em arquivo `'use client'` para decisão de acesso/valor — o enforcement vive 100% no servidor.

### Dependências Externas

Nenhuma. Funções puras TypeScript, sem pacote novo. (O provider real — Asaas/Stripe/etc., DA-1 — entra no adapter da issue 076, não aqui.)

### Ordem de Implementação

Issue **crítica** → começa pela fase RED.

1. **RED (`tdd`)** — estender `assinatura.test.ts`:
   - `eventoBillingParaStatus`: um caso por linha do mapa (`ativa/renova` para cobrança e recorrência; `inadimplente/não` para falha; `cancelada/não`; `suspensa/não` para reembolso e chargeback) + desconhecido → `{ignorar:true}`.
   - `assinaturaPermiteAcesso('cortesia', fimNoPassado, agora) === true` e com `fim` qualquer/`null`.
   - Confirmar que falha por ASSERÇÃO (ou por símbolo inexistente `eventoBillingParaStatus`), não por erro de ambiente. PARAR.
2. **GREEN (`executar`)** — aplicar as 3 mudanças em `assinatura.ts` + ajustar `StatusAssinatura.tsx` (`ROTULO`/`VARIANTE`) para o build compilar. Rodar `vitest` (verde) e `next build` (sem erro de exhaustividade no switch nem no `Record`).
3. **Refator** — conferir que `eventoBillingParaStatus` espelha fielmente o padrão de `eventoParaStatus` (mesma estratégia `hasOwnProperty`), sem duplicar lógica de forma divergente.
