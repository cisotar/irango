# [146] Débito: log de auditoria de acesso admin a PII (`registrarAcessoAdmin`)

**crítica:** NÃO
**Mundo:** infra (débito / rastreamento)
**Depende de:** —
**Spec:** specs/paridade-hub-admin-painel.md (§Segurança — Auditoria/LGPD)

## Objetivo
Registrar e elevar a prioridade do débito: `registrarAcessoAdmin` continua no-op, mas esta feature aumenta muito o volume de PII de cliente exposta ao admin (pedidos). NÃO é construído nesta feature — issue de rastreamento para priorização.

## Escopo
- [ ] Documentar o débito (LGPD): acesso do admin a PII de cliente via pedidos não é logado hoje.
- [ ] Elevar prioridade do log de acesso (volume de PII cresce com as rotas de pedidos do hub admin).
- [ ] (Fase futura) Especificar destino do log (tabela de auditoria + retenção) — fora desta feature.

## Fora de escopo
Implementação do log de auditoria (explicitamente Fora de Escopo v1 do spec). Não bloqueia as demais issues.

## Reuso esperado
- `registrarAcessoAdmin` (hoje no-op) — futuro ponto de gravação.

## Segurança
- Rastreabilidade/LGPD do acesso a PII. Não é barreira de acesso — é trilha de auditoria.

## Critério de aceite
- [ ] Débito registrado com prioridade elevada e escopo definido para fase futura (sem implementação nesta feature).
