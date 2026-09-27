# 318 — Teto de modais sazonais por loja e `.limit()` na listagem do painel

crítica: NÃO (DoS restrito à própria loja)
Spec: specs/modal-sazonal-mensagem-formatada.md (RN-M08, CWE-770)

## Origem

`auditar` (V4, achado baixo) @ `ee4150d`, branch `feat/modal-sazonal-mensagem-formatada`.

## Problema

O rate limit mora só na Server Action (`src/lib/actions/modalSazonal.ts`). Um dono pode chamar
`rpc/salvar_modal_sazonal` (ou INSERT direto na tabela, já antes deste diff) em laço com o próprio JWT
e criar N rascunhos. `listarModaisSazonaisDoDono` não tem `.limit`, então o painel da própria loja
degrada. A vitrine está protegida pelo índice único parcial de `ativo`.

## Fix mínimo

Teto por loja (ex.: 50) num trigger `before insert` em `modais_sazonais` (cobre RPC e tabela) e
`.limit()` na listagem.
