# 363 — Remover a assinatura antiga `salvar_faixas_entrega(uuid, integer, jsonb)` (contract)

crítica: SIM (valor de frete, RPC chamada pelos dois mundos)

## Origem

Expand/contract do PR das issues 325/327/328 (migration
`20261018120000_zonas_entrega_versao_e_formas.sql`, commits 853884e e c63e87b). Achado BAIXA 2 do
`auditar` no mesmo PR. Ver `plan/arquivo/tecnico-formas-de-frete.md` §1 e §9. Ativação explícita da
forma (`definir_forma_frete`, migration `20261018140000_definir_forma_frete.sql`): commits 2427cd5 e
1b0c73d, plano `plan/loop-ativar-forma-frete.md`.

## Problema

A RPC antiga `public.salvar_faixas_entrega(p_loja_id, p_incremento, p_faixas)` continua no banco depois do
PR 325/327/328, para a produção anterior ao deploy seguir funcionando. Ela grava as faixas de km **sem
versão**: não confere nem incrementa `lojas.versao_zonas_entrega`. Qualquer chamador que ainda a use (deploy
antigo da Vercel aberto por URL de deployment, script, chamada direta ao PostgREST) reabre a sobrescrita
silenciosa da 328. O efeito fica restrito à loja do próprio chamador, porque a T2 de posse continua valendo.

Motivo extra (mudança de requisito do 325, migration `20261018130000_lojas_forma_frete_ativa.sql`): as zonas
das três formas agora ficam guardadas lado a lado e só as de `lojas.forma_frete` cobram. A RPC antiga apaga
**todas** as zonas da loja, inclusive as guardadas das outras formas, e força `forma_frete = 'raio_km'`.
Um chamador antigo destrói a configuração de bairro/CEP que o lojista deixou guardada.

## Pré-condição (não começar antes)

- [ ] PR 325/327/328 mesclado e deploy de produção concluído.
- [ ] `grep -rn "salvar_faixas_entrega\b" src` sem ocorrência fora de `src/lib/database.types.ts`.
- [ ] Logs do Supabase (API → filtro `/rpc/salvar_faixas_entrega`) sem chamada nos 7 dias depois do deploy.

## Escopo

1. Migration nova `<ts>_drop_salvar_faixas_entrega_3_args.sql`:
   `drop function if exists public.salvar_faixas_entrega(uuid, integer, jsonb);`
   ROLLBACK: reaplicar o corpo de `salvar_faixas_entrega` de `20261018130000_lojas_forma_frete_ativa.sql`
   (sem versão, com `update public.lojas set forma_frete = 'raio_km'`); a `20261018140000` não redefine
   essa função, então esse continua sendo o último corpo. NÃO usar o de `20260930120000`: ele não define a
   forma ativa e deixaria a loja cobrando por uma forma cujas zonas o DELETE acabou de apagar. Se o trigger
   de "Avaliar no mesmo ciclo" entrar junto, o corpo reaplicado precisa ligar o mesmo GUC antes do `UPDATE`
   em `lojas`, senão a chamada do dono é recusada pelo trigger.
2. Apagar `tests/migrations/rpc_salvar_faixas_entrega.test.ts`. A cobertura equivalente com versão está em
   `tests/migrations/rpc_salvar_zonas_entrega.test.ts`. Antes, conferir caso a caso que cada teste de posse,
   claim forjado, valor por item e prefixo de ativas tem par na suíte nova.
3. Teste RED antes do drop, em `tests/migrations/rpc_salvar_zonas_entrega.test.ts`:
   `[contract] salvar_faixas_entrega(uuid,int,jsonb) não existe mais (pg_proc vazio para a assinatura)`.
4. `npx supabase gen types typescript > src/lib/database.types.ts` (some a entrada `salvar_faixas_entrega`).
5. `references/schema.md` e `references/seguranca.md` (instância INVOKER com controle otimista): as RPCs
   passam a ser só `salvar_zonas_entrega` e `definir_forma_frete`; tirar a menção à assinatura antiga e ao
   risco aceito correspondente.

## Avaliar no mesmo ciclo (decisão no planejamento)

A RLS `zonas_escrita_propria` ainda deixa o dono escrever direto em `zonas_entrega`/`taxas_entrega`/
`bairros_zona` pelo PostgREST, também sem versão (efeito só na própria loja; já existia antes do PR).
Restringir a escrita direta ao caminho da RPC fecha o último desvio do compare-and-set. Confirmar antes que
nenhum caminho do app (painel, admin, seed) escreve nessas tabelas fora de `salvar_zonas_entrega`.

Avaliar também `lojas.forma_frete` e `lojas.versao_zonas_entrega`. Hoje o app grava `forma_frete` só
por `definir_forma_frete` (botão "Usar esta forma", junto da versão) e pela RPC legada
`salvar_faixas_entrega` (força `raio_km`); `salvar_zonas_entrega` não grava mais a forma, só sobe a versão.
A RLS `lojas_update_proprio` deixa o dono gravar as duas colunas por PATCH direto no PostgREST, sem versão
(troca a forma ativa sem passar pelo compare-and-set; efeito só na própria loja).

Grant de coluna NÃO serve: `definir_forma_frete` e `salvar_zonas_entrega` são `SECURITY INVOKER` e rodam o
`UPDATE` em `lojas` como `authenticated`; revogar o UPDATE dessas colunas desse papel quebra as duas RPCs
com 42501 para o lojista. Use um trigger `BEFORE UPDATE` em `lojas` no padrão de `lojas_protege_billing`
(`20260708120000_lojas_protege_billing_v4_consentimento.sql`: bypass por `current_user` de sistema,
`NEW` vs `OLD`): recusar mudança de `forma_frete` ou `versao_zonas_entrega` quando o papel for
`authenticated` e o GUC de transação `irango.via_rpc_frete` não estiver ligado. Só as funções ligam o GUC,
com `perform set_config('irango.via_rpc_frete', 'on', true)` imediatamente antes do `UPDATE` (escopo da
transação). Confirmar que o nome fica fora do namespace `request.*`, que o PostgREST preenche a partir do
request, e que nenhuma função exposta em `public` deixa o cliente ligar o GUC.

A regra "≥ 1 zona ativa na forma ativa" é garantida pela tela e pela `definir_forma_frete`, mas PATCH direto
em `lojas` e `salvar_zonas_entrega` gravando todas as zonas da forma ativa com `ativo = false` passam por
cima. O frete falha fechado: sem zona ativa da forma ativa, `calcularFrete` trata o endereço como fora de
área (entrega indisponível, ou a `taxa_entrega_fora_zona` da loja), nunca cobra por zona de outra forma.

## Fora do escopo

Corpo de `salvar_zonas_entrega` e `definir_forma_frete` (exceto ligar o GUC, se o trigger entrar), telas,
`calcularFrete.ts`.

## Gates

`npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`; `npx supabase migration list` com a
migration na coluna Remote (o `db push` exige autorização).
