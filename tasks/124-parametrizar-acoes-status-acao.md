# [124] Parametrizar `AcoesStatus` com prop `acao?`

**crítica:** NÃO
**Mundo:** painel (componente compartilhado)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (rota 4)

## Objetivo
Permitir injetar a Server Action de mudança de status (default = `atualizarStatusPedido` do lojista) para que o wrapper admin possa injetar a variante admin, sem duplicar os botões nem a lógica de transição.

## Escopo
- [ ] `AcoesStatus`: adicionar prop opcional `acao?: (pedidoId, novoStatus) => Promise<{ ok: true } | { ok: false; erro: string }>`; usar `acao ?? atualizarStatusPedido`.
- [ ] Manter `transicaoPermitida` como fonte única das transições exibidas (inalterada).

## Fora de escopo
A action admin `atualizarStatusPedidoAdmin` (issue 133) e sua fiação de `lojaId` (feita na page admin, 140). A UI não decide autoridade.

## Reuso esperado
- `transicaoPermitida` de `lib/utils/transicaoStatus.ts`.
- `atualizarStatusPedido` de `lib/actions/status.ts` (default).

## Segurança
- A UI é só conveniência: exibe apenas transições válidas. A autoridade da máquina de estados permanece na Server Action (revalida no servidor). Este prop não afrouxa isso.

## Critério de aceite
- [ ] Sem `acao`, comportamento idêntico ao atual (zero regressão no painel).
- [ ] Com `acao` injetada, os botões chamam a action fornecida.
