# 349 — Agendador das funções de retenção (LGPD)

**Origem:** plano de cadastro de clientes, P46 (lacuna de infra).
**Crítica:** NÃO (infra), mas toca dado pessoal.

## Contexto
`anonimizar_clientes_inativos()` (conta inativa há 24 meses) e `expurgar_pedidos_antigos()` (pedido finalizado há mais de 5 anos) existem no banco, com EXECUTE só para `service_role`, mas nada as executa periodicamente. A Política de Privacidade promete essa retenção.

## Decisão pendente (usuário)
- pg_cron no Supabase, ou
- rotina externa (ex.: cron da Vercel chamando endpoint protegido).

## Escopo
- Agendar as duas funções (frequência a definir; diária basta).
- Registro de execução/falha sem PII.
- Teste de que a rotina não é chamável por anon/authenticated.
