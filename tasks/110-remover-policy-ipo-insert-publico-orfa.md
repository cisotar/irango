# 110 — Remover policy `ipo_insert_publico` órfã (defesa em profundidade)

crítica: NÃO (BAIXA — defesa em profundidade, sem dano financeiro)
origem: débito da auditoria da issue 108

## Contexto

A auditoria da issue 108 confirmou que o isolamento de **leitura** de
`itens_pedido_opcionais` é sólido (no-op). Achou, porém, uma superfície de
ESCRITA anon viva e não usada pela produção:

- `ipo_insert_publico` (`supabase/migrations/20260614007500_opcionais.sql:207-209`)
  + grant `ALL` a anon (`20260614008500_grants_roles_supabase.sql:20`) deixam a
  chave anon (pública no browser) inserir em `itens_pedido_opcionais`.
- A produção **nunca** insere por anon — o único caminho é a RPC `criar_pedido`
  com **service_role** (que tem `revoke ... from anon, authenticated`).
- O helper `item_pedido_aceita_opcionais` fecha o pior (só item de pedido
  `pendente` de loja ativa), mas dentro dessa janela um anon com o
  `item_pedido_id` (vai na URL de confirmação) pode anexar opcional fantasma
  com nome/preço/quantidade arbitrários a um item de pedido alheio.

## Impacto (por que BAIXA)

Dano **cosmético/confusional, não financeiro**. O valor cobrado é
`pedidos.total`, gravado no INSERT da RPC e **imutável** depois. Uma linha
injetada só faz a soma por item na página de confirmação divergir do
subtotal/total (inconsistência visual) e injeta opcional fantasma no painel do
lojista. Não altera o que o cliente paga. `item_pedido_id` é UUIDv4 (sem
enumeração fácil), mas vaza em links de confirmação compartilhados.

## Escopo

- Migration **aditiva** `<ts > 20260614007500>_ipo_remove_insert_publico.sql`:
  `drop policy if exists "ipo_insert_publico" on public.itens_pedido_opcionais;`
- INSERT passa a ser exclusivo da RPC `criar_pedido` (service_role ignora RLS).
  anon/authenticated ficam deny-all em escrita.
- NUNCA editar a 080; NUNCA `using(true)`/`service_role` em policy.
- Crítica: SIM se tratada via /fluxo (mexe em RLS) → exige teste RED negativo:
  anon tenta `insert into itens_pedido_opcionais` em item de pedido pendente de
  loja ativa → deve falhar; RPC `criar_pedido` via service_role com opcionais →
  segue inserindo (suíte de pedido permanece verde).
- DEPLOY no cloud obrigatório antes de `verificar` (passo 6b½).

## Critérios
- [ ] Migration aditiva drop da policy criada
- [ ] Teste RED: anon insert negado; RPC service_role intacta
- [ ] Suíte de pedido/opcionais verde
- [ ] Migration aplicada no cloud

## Débito BAIXA adjacente (issue 109, não bloqueia)
Previews de upload (`UploadFotoProduto`/`LogoLoja`/`QrPix`) usam
`URL.createObjectURL` (blob local) ou `urlAtual`/`logoUrlInicial` no painel
autenticado — fora da superfície pública. Idealmente seguiriam o mesmo guard
§15 por consistência, mas risco baixo (painel autenticado).
