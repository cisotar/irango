# 367 — Porta cliente: encerrar sessões após trocar a senha e alinhar papel na recuperação

crítica: SIM (auth, sessão, papel) · Spec: specs/cliente-identidade.md

## Origem
Achados do orquestrar na issue 366, commit `a5e9d9d` (branch feat/366-recuperacao-senha-lojista).

## Problema
1. `redefinirSenhaCliente` não faz `signOut({ scope: 'global' })` depois do `updateUser`. Outros dispositivos continuam logados
   e a sessão de recuperação continua podendo trocar a senha sem a atual.
2. `references/seguranca.md` §17 diz que a recuperação do cliente "não atribui papel novo", mas
   `src/app/(auth)/auth/callback/route.ts:73-78` chama `atribuirPapelInicial(..., "cliente")` também na recuperação da porta cliente.

## O que fazer
- (1) Encerrar todas as sessões após a troca, como o lojista na 366 (D2).
- (2) Decidir: corrigir o código (recuperação não atribui papel) ou corrigir a doc. Preferir o código: coerente com a 366.

## Critérios de aceite
- [ ] RED: teste de `redefinirSenhaCliente` falha enquanto `signOut({ scope: 'global' })` não é chamado depois de `updateUser` ok, e passa a não ser chamado quando `updateUser` falha.
- [ ] RED: teste do callback da porta cliente com `amr` recovery falha enquanto `atribuirPapelInicial` é chamado.
- [ ] `references/seguranca.md` §17 e o código dizem a mesma coisa.
