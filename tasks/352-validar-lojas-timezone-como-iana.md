# 352 — Validar `lojas.timezone` como fuso IANA

**crítica:** NÃO
**Mundo:** painel
**Spec:** —

## Origem

`auditar` do PR #181 (issues 350 e 351, commit auditado `41c57c4`): um achado BAIXO e uma observação sobre
problema anterior que aquele diff não cria.

## Problema

`lojas.timezone` é `text not null default 'America/Sao_Paulo'` sem CHECK
(`supabase/migrations/20260614000129_schema_inicial.sql:40`), e o dono consegue gravar a coluna direto pelo
PostgREST com o próprio JWT.

1. **Cache sem limite (BAIXO).** `formatarDataHora` (`src/lib/utils/formatarDataHora.ts`) e `horaLocal`
   (`src/components/painel/TabelaPedidos.tsx`) guardam um `Intl.DateTimeFormat` por fuso num `Map` cuja chave é a
   string bruta. O Intl aceita grafias diferentes para o mesmo fuso (`america/sao_paulo`, `Brazil/East`), e cada
   grafia vira uma entrada nova na memória do processo. Exige uma requisição por entrada e não dá acesso a outra
   loja.
2. **Fuso inválido derruba o próprio painel (observação).** Valor que não é IANA faz o `Intl` lançar `RangeError` em
   `/painel`, `/painel/pedidos` e `/painel/clientes`. Antes do PR #181 o mesmo já acontecia em `/painel/clientes`
   e em `fusoLoja.ts`. Só afeta o painel de quem gravou.

## Direção sugerida

- Normalizar a chave do cache com `new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone`, ou
  deixar de memoizar. Teste: duas grafias do mesmo fuso deixam o `Map` com tamanho 1.
- Validar o fuso como IANA na escrita: CHECK no banco ou trava no trigger de `lojas`, com migration nova e teste
  pglite.
