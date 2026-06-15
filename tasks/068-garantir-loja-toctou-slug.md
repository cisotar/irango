# [068] TOCTOU de slug em garantir_loja_do_dono → NULL transitório

**crítica:** NÃO (blip transitório, auto-recupera)
**Mundo:** auth
**Origem:** finding BAIXA da auditoria 065

## Contexto
`garantir_loja_do_dono` (`supabase/migrations/20260615011500_*.sql`) deriva slug com `EXISTS` + sufixo numérico, com janela TOCTOU até o INSERT. Se outra transação inserir o mesmo slug para OUTRO dono entre check e INSERT, o `unique_violation` é no índice de **slug** (não `dono_id`), então `ON CONFLICT (dono_id) DO NOTHING` não captura → cai no `EXCEPTION WHEN unique_violation` que re-seleciona por `dono_id` e retorna NULL (este dono não tem loja). Caller faz `redirect("/painel")` → guard volta a `onboarding`.

## Impacto
Blip de disponibilidade p/ 1 usuário; auto-recupera no retry (slug agora existe → sufixa). Sem vazamento cross-tenant nem valor. Probabilidade ínfima (colisão de slug-base entre donos distintos na janela de corrida).

## Escopo
- [ ] Loop de retry com re-derivação de slug, OU `ON CONFLICT (slug)` explícito além de `(dono_id)`

## Critério de aceite
- [ ] Colisão de slug entre donos distintos na janela → função ainda retorna loja válida (não NULL)
