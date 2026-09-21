# [281] Leitura pública de `cardapio_produtos` ignora `produtos.oculto`

**crítica: SIM** — mudança de policy RLS (TDD red-first em pglite). Severidade da auditoria: **BAIXA**.

**Depende de:** nada. Fora do loop da vigência por item (mudança de policy pública merece ciclo próprio).

## Origem

Auditoria da issue 272 em `9b737de` (branch `feat/vigencia-por-item-do-cardapio`).

## O problema

`cardapio_produtos_leitura_publica` (`supabase/migrations/20260920133000`) exige loja ativa e cardápio
ativo, mas não consulta `produtos.oculto` nem `produtos.disponivel`. Com a anon key do bundle:

```
GET /rest/v1/cardapio_produtos?loja_id=eq.<loja>&select=produto_id,cardapio_id,dias_semana
```

devolve o vínculo de qualquer produto de cardápio ativo, inclusive de produto oculto. O atacante
aprende `{uuid de produto invisível} + agenda semanal`. Sem nome, preço nem foto (`produtos` não
tem SELECT público desde `20260920125000`). `produto_id` e `criado_em` já vazavam antes da 272; a
coluna `dias_semana` só acrescenta "em quais dias". Classe pré-existente, não regressão.

## Correção proposta

Acrescentar à policy pública:

```sql
and exists (select 1 from public.produtos p
             where p.id = produto_id and p.loja_id = loja_id and p.oculto = false)
```

Risco: a vitrine e o painel leem `cardapio_produtos` por caminhos distintos (anon vs dono vs
`service_role`); a policy própria do dono e o `service_role` não mudam. Confirmar que
`COLUNAS_CARDAPIO_VIGENCIA` na vitrine (anon) não perde vínculo de produto **visível**.

## Critério de aceite

- [ ] RED em `tests/migrations/`: `asAnon` não lê vínculo de produto `oculto = true` em loja e
      cardápio ativos; segue lendo o de produto visível; `asUser` do dono lê os dois.
- [ ] `vitrine_produtos.test.ts` e `cardapio_produtos_fks_compostas_rls.test.ts` sem regressão.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
