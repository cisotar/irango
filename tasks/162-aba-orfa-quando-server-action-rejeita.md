# [162] Aba órfã quando a Server Action REJEITA (não retorna erro)

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [126]
**Origem:** finding BAIXA da auditoria de segurança da issue 126.

## Problema

Em `src/components/vitrine/checkout/useEnviarPedido.ts`, o retorno de
`await criarPedido(...)` só é tratado para o caso `{ erro }`. Se a chamada
REJEITAR — queda de rede, 500 do endpoint RSC — `aba.concluir()` nunca roda:

- a aba pré-aberta fica órfã em `about:blank`;
- o cliente não recebe toast nenhum, e fica sem saber o que aconteceu.

Sem impacto de segurança (a aba órfã é same-origin). É robustez e UX.

## Escopo

- [ ] `try/catch` em volta do `await criarPedido(...)` que faça
      `aba.concluir(null)` (fecha a aba) e `toast.error(...)` com mensagem
      genérica.
- [ ] Teste cobrindo a rejeição, não só o retorno `{ erro }`.

## Critério de aceite

- [ ] Rejeição da Server Action fecha a aba pré-aberta e avisa o cliente.
- [ ] Nenhuma regressão no caminho de sucesso nem no de `{ erro }`.
