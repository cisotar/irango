# [079] Gate de painel: reconhecer `cortesia` em `decidirAcessoPainel`

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [075]
**Spec:** specs/cobranca-assinatura-propria.md

## Objetivo
Garantir que o gate de acesso ao painel reconheça o novo status `cortesia` como liberador, sem reescrever a regra de carência. Mudança mínima e cirúrgica em `acessoPainel.ts`.

## Escopo
- [ ] Em `src/lib/utils/acessoPainel.ts`: adicionar `"cortesia"` a `STATUS_CONHECIDOS` e tratar `cortesia` como liberador (mesmo caminho que `ativa`, sem depender de `fim`).
- [ ] Confirmar precedência inalterada: sessão → email → loja → assinatura. NÃO mudar nada além do necessário para `cortesia`.
- [ ] Manter `ROTAS_EXCECAO_ASSINATURA` (anti-loop) apontando para `/painel/configuracoes/assinatura`.

## Fora de escopo
Reescrever `assinaturaPermiteAcesso` (proibido — só estender, feito na 075). Layout/redirect (já existem). Conceder cortesia (080).

## Reuso esperado
- `assinaturaPermiteAcesso` (075) e `decidirAcessoPainel` existentes — ESTENDER, não recriar (`Fora do Escopo` do spec exige reuso).

## Segurança
- Gate de acesso é autorização: se `cortesia` cair em fail-closed por estar fora do union conhecido, loja em cortesia perde acesso; se um status inválido liberar, é bypass. Postura fail-closed mantida (status fora do union → bloqueia) → crítica.

## Critério de aceite
- [ ] Teste RED: `decidirAcessoPainel(user, lojaComStatus='cortesia', rota, agora)` retorna `"ok"` mesmo com `assinatura_fim_periodo = null`; status fora do union continua `"assinatura-bloqueada"`; demais transições inalteradas (regressão).
