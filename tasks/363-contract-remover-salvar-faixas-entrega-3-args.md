# 363 — Remover a assinatura antiga `salvar_faixas_entrega(uuid, integer, jsonb)` (contract)

crítica: SIM (valor de frete, RPC chamada pelos dois mundos)

## Origem

Expand/contract do PR das issues 325/327/328 (migration
`20261018120000_zonas_entrega_versao_e_formas.sql`, commits 853884e e c63e87b). Achado BAIXA 2 do
`auditar` no mesmo PR. Ver `plan/arquivo/tecnico-formas-de-frete.md` §1 e §9.

## Problema

A RPC antiga `public.salvar_faixas_entrega(p_loja_id, p_incremento, p_faixas)` continua no banco depois do
PR 325/327/328, para a produção anterior ao deploy seguir funcionando. Ela grava as faixas de km **sem
versão**: não confere nem incrementa `lojas.versao_zonas_entrega`. Qualquer chamador que ainda a use (deploy
antigo da Vercel aberto por URL de deployment, script, chamada direta ao PostgREST) reabre a sobrescrita
silenciosa da 328. O efeito fica restrito à loja do próprio chamador, porque a T2 de posse continua valendo.

## Pré-condição (não começar antes)

- [ ] PR 325/327/328 mesclado e deploy de produção concluído.
- [ ] `grep -rn "salvar_faixas_entrega\b" src` sem ocorrência fora de `src/lib/database.types.ts`.
- [ ] Logs do Supabase (API → filtro `/rpc/salvar_faixas_entrega`) sem chamada nos 7 dias depois do deploy.

## Escopo

1. Migration nova `<ts>_drop_salvar_faixas_entrega_3_args.sql`:
   `drop function if exists public.salvar_faixas_entrega(uuid, integer, jsonb);`
   ROLLBACK: reaplicar o corpo de `20260930120000_rpc_salvar_faixas_entrega_ativo.sql` (sem versão).
2. Apagar `tests/migrations/rpc_salvar_faixas_entrega.test.ts`. A cobertura equivalente com versão está em
   `tests/migrations/rpc_salvar_zonas_entrega.test.ts`. Antes, conferir caso a caso que cada teste de posse,
   claim forjado, valor por item e prefixo de ativas tem par na suíte nova.
3. Teste RED antes do drop, em `tests/migrations/rpc_salvar_zonas_entrega.test.ts`:
   `[contract] salvar_faixas_entrega(uuid,int,jsonb) não existe mais (pg_proc vazio para a assinatura)`.
4. `npx supabase gen types typescript > src/lib/database.types.ts` (some a entrada `salvar_faixas_entrega`).
5. `references/schema.md` e `references/seguranca.md` (instância INVOKER com controle otimista): a RPC passa
   a ser `salvar_zonas_entrega`; tirar a menção à assinatura antiga e ao risco aceito correspondente.

## Avaliar no mesmo ciclo (decisão no planejamento)

A RLS `zonas_escrita_propria` ainda deixa o dono escrever direto em `zonas_entrega`/`taxas_entrega`/
`bairros_zona` pelo PostgREST, também sem versão (efeito só na própria loja; já existia antes do PR).
Restringir a escrita direta ao caminho da RPC fecha o último desvio do compare-and-set. Confirmar antes que
nenhum caminho do app (painel, admin, seed) escreve nessas tabelas fora de `salvar_zonas_entrega`.

## Fora do escopo

`salvar_zonas_entrega`, telas, `calcularFrete.ts`.

## Gates

`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`; `npx supabase migration list` com a
migration na coluna Remote (o `db push` exige autorização).
