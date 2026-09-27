# 317 — anon lê as junções (categorias/cardápios) de modal sazonal em rascunho

crítica: SIM (RLS)
Spec: specs/arquivo/modal-divulgacao-sazonal.md (RN-03 — rascunho não vaza)

## Origem

`auditar` (V6, achado baixo pré-existente) @ `ee4150d`, branch `feat/modal-sazonal-mensagem-formatada`.
Nasce na migration `20260925140000_modais_sazonais_rls.sql` (PR #158), não neste diff.

## Problema

`modal_sazonal_categorias_leitura_publica` e `modal_sazonal_cardapios_leitura_publica` filtram só
`loja_esta_ativa(loja_id)`. Com o modal de A em rascunho, `asAnon select * from modal_sazonal_categorias
where loja_id = A` devolve as linhas (a tabela `modais_sazonais` devolve 0). Vaza o id do rascunho e
quais categorias/cardápios a próxima campanha vai divulgar. Sem escrita, sem `mensagem`.

## Fix mínimo

Migration nova recriando as duas policies com
`exists (select 1 from public.modais_sazonais m where m.id = modal_sazonal_id and m.loja_id = <tabela>.loja_id and m.ativo and public.loja_esta_ativa(m.loja_id))`.

## Aceite

RED pglite `asAnon` → 0 linhas para rascunho, e a vitrine continua lendo as junções do modal ativo.
