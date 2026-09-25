# 299 — Trigger impõe máquina de status (RN-08) e imutabilidade de tipo_entrega em pedidos

## Origem

`auditar` @ `43cdadc` (segunda auditoria da branch `feat/modalidades-entrega-loja`,
sobre o trigger `pedidos_protege_valor_trg` de
`supabase/migrations/20260925130000_pedidos_protege_valor.sql`).

## Problema

A RLS `pedidos_acesso_lojista` (`FOR ALL`, filtra por `lojas.dono_id = auth.uid()`)
deixa o lojista escrever `status` e `tipo_entrega` livremente via PostgREST direto.
A máquina de estados (RN-08, `transicaoPermitida` em
`src/lib/utils/transicaoStatus.ts`) só existe na Server Action — não há trigger nem
CHECK no banco impondo que `cancelado`/`entregue` são terminais.

O novo trigger `pedidos_protege_valor_trg` (D2, `specs/modalidades-entrega-loja.md`)
recusa registrar frete combinado em pedido `status='cancelado'`, mas só olha o
`status` do momento do UPDATE que tenta a transição de frete. Como o banco não trava
a máquina de status, o lojista contorna com uma sequência de 3 PATCHes na REST API:

1. `{"status":"confirmado"}` — nenhuma coluna de valor muda, o trigger de valor
   libera (não é escopo dele), e não há trigger de status barrando a saída de
   `cancelado`.
2. `{"taxa_entrega":5,"total":55,"frete_a_combinar":false}` — agora
   `old.status = 'confirmado'`, passa pelo `pedidos_protege_valor_trg`.
3. `{"status":"cancelado"}` — volta para cancelado.

Resultado: um pedido cancelado fica com frete registrado, violando D2. Sem ganho
financeiro (é o próprio pedido do lojista, sem cobrança de plataforma envolvida) —
por isso o achado original foi classificado BAIXO, não crítico.

## Correção proposta

Trigger novo, mesmo molde de `pedidos_protege_valor_trg` (SECURITY INVOKER,
whitelist `current_user in ('service_role','postgres','supabase_admin')`):

- recusa transição de `status` que `transicaoPermitida` (RN-08) não permite, para
  autor que não é sistema;
- recusa mudar `tipo_entrega` depois de o pedido já existir (nasce e morre com o
  tipo escolhido no checkout).

## Critério de pronto

Teste pglite com `asUser(dono)` reproduzindo a sequência de 3 UPDATEs acima:
o passo 1 (`status` de `cancelado` para `confirmado`) é recusado com fragmento de
mensagem próprio, verificado via `asService` que o `status` não mudou.

## Criticidade

Crítico (TDD red-first): trava de integridade sobre dado que aparece no comprovante
do comprador; envolve RLS e migration.
