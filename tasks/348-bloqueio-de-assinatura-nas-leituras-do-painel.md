# 348 — Bloqueio de assinatura também nas leituras do painel (banco)

**Origem:** auditoria da issue 346 (achado BAIXA), decisão do usuário 2026-10-03 (opção c).
**Crítica:** SIM (autorização) — TDD red-first.

## Contexto
Hoje o bloqueio de loja/assinatura no painel é aplicado no layout (`(bloqueavel)`). As leituras do lojista no banco (RLS e funções como `clientes_da_loja`/`cliente_da_loja`) não consideram esse estado. Não há vazamento entre lojas: o lojista só lê os dados da própria loja.

## Objetivo
Decidir e aplicar, de forma uniforme para todas as leituras do painel, se o bloqueio de assinatura também deve valer no banco.

## Escopo
- Inventariar as leituras do lojista (policies de SELECT e funções SECURITY DEFINER do painel).
- Definir a regra única (ex.: reusar a checagem de loja ativa já existente) e aplicá-la em todas, não só em clientes.
- Testes em pglite: lojista bloqueado → 0 linhas; lojista ativo inalterado.

## Fora de escopo
- Mudança no fluxo de cobrança ou no layout `(bloqueavel)`.
