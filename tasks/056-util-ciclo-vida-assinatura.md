# [056] Util puro — ciclo de vida da assinatura (evento Hotmart → status + acesso)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 017
**Spec:** specs/spec_irango_mvp.md (Adendo — RN-A4; "Mapear eventos da Hotmart → estados internos")

## Objetivo
Funções puras e testáveis que (1) traduzem um evento Hotmart no novo estado de assinatura da loja e (2) decidem se um estado + data permite acesso (carência). Sem I/O — base reusada pelo webhook (057), pelo guard (016) e pelo gate (060).

## Escopo
- [ ] Criar `src/lib/assinatura/ciclo-vida.ts`
- [ ] `traduzirEvento(evento): { status, mutacao }` — mapa evento→estado (RN-A4):
  - compra aprovada / assinatura ativada → `ativa` (define `assinatura_inicio`, `assinatura_fim_periodo`)
  - recorrência aprovada → `ativa`, estende `assinatura_fim_periodo` para o fim do novo ciclo
  - cancelamento → `cancelada` (mantém `assinatura_fim_periodo`, acesso até o fim do período)
  - reembolso / chargeback → `suspensa` (corte imediato)
  - atraso / inadimplência → `inadimplente`
  - evento desconhecido → `{ ignorar: true }` (não muda estado)
- [ ] Criar `src/lib/assinatura/acesso.ts` com `assinaturaPermiteAcesso(status, fimPeriodo, agora): boolean` (RN-A4/RN-A6):
  - `ativa` → true
  - `trial` → true se `agora <= fimPeriodo`
  - `inadimplente` / `cancelada` → true se `agora <= fimPeriodo` (carência), senão false
  - `suspensa` → false sempre
- [ ] Mapa de nomes de evento Hotmart isolado em uma constante com TODO **"confirmar nomes na doc oficial Hotmart"** (`PURCHASE_APPROVED`, `PURCHASE_COMPLETE`, `SUBSCRIPTION_CANCELLATION`, `PURCHASE_REFUNDED`, `PURCHASE_CHARGEBACK`, `PURCHASE_DELAYED`, etc.)

## Fora de escopo
Route Handler do webhook (057). Leitura/escrita no banco. Validação de token. Persistência de idempotência.

## Reuso esperado
- `StatusAssinatura` (017)
- Nenhuma lib externa de data além de `Date`/timestamptz nativo

## Segurança
- Funções puras: o estado de pagamento é decidido só pelo evento validado da Hotmart, nunca por input de client (Adendo Segurança — equivalente ao "recálculo no servidor")
- Sem `suspensa` reativável por carência — corte imediato é invariante

## Critério de aceite
- [ ] (crítica) Teste vermelho: cada evento mapeia ao status correto; recorrência estende o fim do período; cancelamento mantém acesso até `fim_periodo` e nega depois; reembolso/chargeback → `suspensa` nega acesso mesmo dentro do período; `trial` válido permite e expirado nega; evento desconhecido → ignorar sem mudar estado
