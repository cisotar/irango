# [065] Reconciliação de user órfão (signUp ok + criarLoja falhou)

**crítica:** SIM
**Mundo:** auth
**Depende de:** 015, 016
**Origem:** finding MÉDIA da auditoria 015

## Objetivo
Tratar o user órfão: `signUp` cria o user, `criarLoja` falha, e a compensação `deleteUser` TAMBÉM falha → user fica no auth.users sem loja, e o re-cadastro com o mesmo email cai em "email já cadastrado" sem nunca recriar a loja (trava permanente).

## Escopo
- [ ] Detectar no login/guard (016): user autenticado + `buscarLojaDoDono === null` → fluxo de criação de loja (auto-cura) em vez de travar
- [ ] OU trigger `on auth.users` que cria a loja atomicamente (avaliar trade-off vs duplicar lógica)
- [ ] Garantir que a auto-cura grava consentimento/trial server-side igual ao cadastro

## Critério de aceite
- [ ] User órfão consegue, no próximo login, ter sua loja criada sem travar; não cria loja duplicada (RN-01)
