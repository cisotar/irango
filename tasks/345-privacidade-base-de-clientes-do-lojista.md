# 345 — Política de Privacidade: o que a loja vê na base de clientes

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** Marco D (base de clientes do lojista)
**Spec:** specs/cliente-base-do-lojista.md

## Origem

Pergunta P3 do spec do Marco D: o usuário decidiu fazer depois (2026-10-03).

## Problema

`src/app/(publica)/privacidade/page.tsx` diz só que os dados do pedido são compartilhados com a loja. Com a base de
clientes do lojista, a loja onde a pessoa comprou logada também vê nome, telefone, dia e mês do aniversário e se ela
aceita promoções da loja (opt-in de marketing, que vale para as lojas — resposta P2).

## Direção sugerida

Rascunho do texto na seção de compartilhamento e na de marketing, mantendo o aviso de revisão jurídica, e subir
`VERSAO_TERMOS`.
