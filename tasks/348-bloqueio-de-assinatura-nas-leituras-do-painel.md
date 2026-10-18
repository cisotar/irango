# 348 — Bloqueio de assinatura também nas leituras do painel (banco)

Em termos simples:

Quando a assinatura de um lojista vence ou a loja é bloqueada, o painel dele deixa de funcionar. Mas esse bloqueio só existe na tela (no layout (bloqueavel)). O banco de dados não sabe dele.

O problema: um lojista bloqueado ainda consegue ler os dados da própria loja, por exemplo a lista de clientes, se pedir direto ao banco sem passar pela tela. Isso não vaza dados entre lojas, porque ele só vê o que é dele. Mas o bloqueio fica "só de fachada", e a segurança deveria estar no banco (RLS), não na interface.

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
