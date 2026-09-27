# 319 — Ativar modal sazonal numa transação única (RPC `ativar_modal_sazonal`)

crítica: SIM (escrita de estado que decide o que o cliente vê; mesmo vetor V8 da RPC `salvar_modal_sazonal`)
Spec: specs/modal-sazonal-mensagem-formatada.md (Fora do Escopo: "ativação em dois passos" — sai do Fora do Escopo neste PR)

## Origem

Achado do `orquestrar-autonomo` no ciclo do PR #159, deixado fora do escopo. O usuário pediu para
resolver neste ciclo.

## Problema

`ativarModalSazonal` (`src/lib/actions/modalSazonal.ts`) faz dois UPDATEs em requests separados:
desativa o ativo anterior da loja, depois ativa o alvo. Falha entre os dois (rede, timeout, erro do
banco) deixa a loja sem nenhum modal ativo. O índice único parcial `modais_sazonais_um_ativo_por_loja`
impede dois ativos, mas não impede zero.

## Fix

RPC `ativar_modal_sazonal(p_modal_id uuid)` no molde de `salvar_modal_sazonal`
(`20260927121000_rpc_salvar_modal_sazonal.sql`): `security invoker`, RLS continua valendo, recusa sessão
sem `auth.uid()`, revoke de `anon`/`public`, confere que o modal é da loja do dono antes de tocar em
linha, desativa o anterior e ativa o alvo na mesma transação. A action passa a fazer uma chamada só.
Mesma política de erro genérico para o cliente.

## Aceite

RED em `tests/seguranca/modal-sazonal/v8-atomicidade.test.ts`: falha forçada depois do desativar
reverte tudo (o anterior continua ativo); modal de outra loja recusado sem mudar nada (também em
`v6-isolamento.test.ts`); anon recusado. Trava estática: a action não chama mais `.update({ ativo`.
