# [075] Util: estender `assinatura.ts` com `cortesia` + `eventoBillingParaStatus`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Estender a fonte única de regras de assinatura para suportar o estado `cortesia` (acesso pleno sem cobrança) e adicionar o mapa puro `eventoBillingParaStatus(provider, tipo)`, espelhando `eventoParaStatus`. É a issue base que webhook (077), gate de painel (079) e admin (078) dependem.

## Escopo
- [ ] Em `src/lib/utils/assinatura.ts`: adicionar `"cortesia"` ao type `StatusAssinatura`.
- [ ] Em `assinaturaPermiteAcesso`: `cortesia` → sempre `true` (acesso pleno, ignora `fimPeriodo`, como `ativa`). **Estender, não reescrever** o switch.
- [ ] Adicionar `eventoBillingParaStatus(provider: string, tipo: string): ResultadoEvento` — função pura, mesmo padrão de `eventoParaStatus`, mapeando o "evento lógico" do provider conforme a tabela do spec (Webhook → "Mapa evento provider → status"):
  - cobrança aprovada / primeira compra → `ativa`, renova
  - recorrência aprovada → `ativa`, renova
  - pagamento falhou → `inadimplente`, não renova
  - cancelada → `cancelada`, não renova
  - reembolso / chargeback → `suspensa`, não renova
  - evento desconhecido → `{ ignorar: true }` (não rejeita, evita retry infinito).

## Fora de escopo
A tradução de nomes externos crus de cada provider → "evento lógico" (isso é o adapter, issue 076). Aqui o `tipo` já é o evento lógico, igual `eventoParaStatus`.

## Reuso esperado
- `src/lib/utils/assinatura.ts` — `StatusAssinatura`, `ResultadoEvento`, padrão de `MAPA_EVENTO`/`eventoParaStatus`. NÃO criar arquivo novo.

## Segurança
- Regra de acesso (`cortesia` libera) e mapa evento→status (reembolso/chargeback → `suspensa` = corte) são invariantes que decidem quem paga e quem acessa (RN-4, RN-8, RN-12) → crítica.
- Função PURA: `agora` injetado, sem `Date.now()`. Evento fora do union → ignorar (nunca muda estado).

## Critério de aceite
- [ ] Teste RED: `assinaturaPermiteAcesso('cortesia', qualquerData, agora) === true`; `eventoBillingParaStatus` retorna o status/renova correto por evento lógico e `{ignorar:true}` para desconhecido.
- [ ] `acessoPainel.ts` já lista `cortesia`? Não — esta issue NÃO altera `acessoPainel.ts` (vai na 079); aqui só o util base.

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
| `src/lib/utils/assinatura.ts` `assinaturaPermiteAcesso` | `switch (status)` exaustivo, sem `default` | **QUEBRA o build** (TS2366) até adicionar `case "cortesia"`. **Faz parte do escopo desta issue.** |
| `src/lib/utils/acessoPainel.ts` | array `STATUS_CONHECIDOS: readonly StatusAssinatura[]` (sem `cortesia`) | NÃO quebra build (array não é exaustivo-checado). `cortesia` cairia no fail-closed. **Correção é da issue 079** (fora de escopo aqui). Registrar como dívida conhecida. |
| `src/components/painel/StatusAssinatura.tsx` | `Record<StatusUnion, string>` (`ROTULO`) e `Record<StatusUnion, ...>` (`VARIANTE`) | **QUEBRA o build** — `Record<StatusAssinatura, X>` passa a exigir a chave `cortesia`. Ver "Arquivos a Modificar". |
| `src/lib/actions/pedido.ts`, `src/app/(publica)/loja/[slug]/page.tsx` | cast `as StatusAssinatura` + chamam `assinaturaPermiteAcesso` | NÃO quebra; herdam `true` de `cortesia` via util. Nenhuma mudança. |
| `webhooks/hotmart/route.ts`, `assinatura/reconciliar.ts`, `queries/webhookHotmart.ts` | `eventoParaStatus`/`aplicarStatusAssinatura` | NÃO quebra; `cortesia` nunca é produzido por evento Hotmart. Nenhuma mudança. |

### Cenários

**Caminho Feliz (`eventoBillingParaStatus`):** o webhook (077) recebe o "evento lógico" já normalizado pelo adapter (076) → chama `eventoBillingParaStatus(provider, tipo)` → recebe `{status, renova}` → aplica via `service_role` (fora desta issue).

**Caminho Feliz (`cortesia`):** admin concede cortesia (078) → gate chama `assinaturaPermiteAcesso('cortesia', fim, agora)` → `true`, ignorando `fim` (igual `ativa`).

**Casos de Borda:**
- `tipo` fora do mapa → `{ ignorar: true }` (não rejeita — evita retry infinito). Mesma postura de `eventoParaStatus`.
- `provider` desconhecido → nesta v1 o mapa é provider-agnóstico (semântica única espelhando Hotmart); `provider` é aceito por contrato mas **não** ramifica. Ramificação por provider = evolução futura.
- `cortesia` com `fim` no passado/`null` → `true` mesmo assim (ignora `fim`).
- Reembolso/chargeback → `suspensa` (corte imediato, sem carência) — RN-8.

**Tratamento de Erros:** funções puras, sem I/O, não lançam. Entrada inválida nunca muda estado.

### Schema de Banco
Esta issue NÃO toca banco. O CHECK `assinatura_status IN (...,'cortesia')` (spec L168) e a coluna de provider são da issue de migration do épico, não da 075.

### Validação (zod)
Não se aplica — sem fronteira de entrada de usuário. `tipo` chega já normalizado pelo adapter (076).

### Recálculo no Servidor
Sem valor monetário. As funções decidem estado de acesso e mapeamento evento→status — ambos invariantes server-side (gate de acesso + webhook com `service_role`). O cliente nunca chama estas funções para decidir o próprio acesso.

### Assinatura e mapa exatos a implementar

```ts
// 1) union
export type StatusAssinatura =
  | "trial" | "ativa" | "inadimplente" | "cancelada" | "suspensa" | "cortesia";

// 2) evento lógico de billing (provider-agnóstico; NÃO é o nome cru do provider — isso é 076)
export type EventoBilling =
  | "cobranca_aprovada" | "recorrencia_aprovada" | "pagamento_falhou"
  | "assinatura_cancelada" | "reembolso" | "chargeback";

// 3) mapa puro (espelha MAPA_EVENTO; reusa ResultadoEvento)
const MAPA_EVENTO_BILLING: Record<EventoBilling, { status: StatusAssinatura; renova: boolean }> = {
  cobranca_aprovada:    { status: "ativa",        renova: true  },
  recorrencia_aprovada: { status: "ativa",        renova: true  },
  pagamento_falhou:     { status: "inadimplente", renova: false },
  assinatura_cancelada: { status: "cancelada",    renova: false },
  reembolso:            { status: "suspensa",     renova: false },
  chargeback:           { status: "suspensa",     renova: false },
};

// 4) função pura — `tipo: string` (não-confiável) → desconhecido vira { ignorar: true }
export function eventoBillingParaStatus(_provider: string, tipo: string): ResultadoEvento {
  const r = Object.prototype.hasOwnProperty.call(MAPA_EVENTO_BILLING, tipo)
    ? MAPA_EVENTO_BILLING[tipo as EventoBilling] : undefined;
  if (!r) return { ignorar: true };
  return { status: r.status, renova: r.renova };
}

// 5) estender o switch (NÃO reescrever)
case "cortesia":
  return true; // igual "ativa": acesso pleno, ignora fimPeriodo (RN-4)
```

Notas: `tipo: string` e `_provider: string` conforme a assinatura exigida; `hasOwnProperty` garante "ignorar desconhecido" como em `eventoParaStatus`. Os literais snake_case dos eventos são o contrato com a issue 076 — usar exatamente os mesmos no `tdd` e no `executar`.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:** nenhum (mandato de reuso).

**Modificar:**
- `src/lib/utils/assinatura.ts` — (a) `"cortesia"` no union; (b) `EventoBilling` + `MAPA_EVENTO_BILLING` + `eventoBillingParaStatus`; (c) `case "cortesia": return true;`.
- `src/components/painel/StatusAssinatura.tsx` — **obrigatório p/ build:** `ROTULO` e `VARIANTE` são `Record<StatusUnion,...>` → adicionar chave `cortesia` (rótulo "Cortesia", variante `"secondary"`). 2 linhas; não altera outros status.
- `src/lib/utils/assinatura.test.ts` — estendido pelo `tdd` (RED).

**NÃO tocar:**
- `src/lib/utils/acessoPainel.ts` — `STATUS_CONHECIDOS` ganha `cortesia` SÓ na 079 (escopo explícito).
- `src/components/ui/*` (shadcn) — nunca à mão.
- Webhook Hotmart, `reconciliar.ts`, `webhookHotmart.ts`, `pedido.ts`, `loja/[slug]/page.tsx` — herdam sem mudança.

### Regra cliente ↔ servidor

| Invariante | Camada que garante |
|---|---|
| `cortesia` libera acesso pleno | `assinaturaPermiteAcesso` (util puro, server) consumido pelos gates server-side |
| Reembolso/chargeback → `suspensa` | `eventoBillingParaStatus` consumido pelo webhook via `service_role` (077) |
| Evento desconhecido nunca muda estado | `{ ignorar: true }` no util (server) |

Nenhuma destas funções é importada em `'use client'` para decisão de acesso/valor.

### Dependências Externas
Nenhuma. Funções puras, sem pacote novo. O provider real (DA-1) entra no adapter da 076.

### Ordem de Implementação
Issue **crítica** → começa pela fase RED.
1. **RED (`tdd`)** — estender `assinatura.test.ts`: um caso por linha do mapa de `eventoBillingParaStatus` + desconhecido → `{ignorar:true}`; `assinaturaPermiteAcesso('cortesia', fimNoPassado, agora) === true` e com `fim` qualquer/`null`. Confirmar falha por ASSERÇÃO (ou símbolo inexistente), não por ambiente. PARAR.
2. **GREEN (`executar`)** — 3 mudanças em `assinatura.ts` + `StatusAssinatura.tsx` (`ROTULO`/`VARIANTE`). Rodar `vitest` (verde) e `next build` (sem erro de exhaustividade no switch nem no `Record`).
3. **Refator** — conferir que `eventoBillingParaStatus` espelha fielmente `eventoParaStatus` (mesma estratégia `hasOwnProperty`).
