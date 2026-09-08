---
name: arquitetar
description: Arquiteto sênior para planos técnicos profundos — issue complexa demais para o `planejar` (múltiplas camadas, mudança de contrato de dados, impacto cross-cutting, risco arquitetural, ou problema que voltou). Ataca a causa raiz, rejeita remendos.
argument-hint: [caminho da issue em tasks/]
---

Invoque o agente `arquitetar` (Agent tool, `subagent_type: "arquitetar"`, em foreground — o próximo passo da sessão depende do plano).

Passe `$ARGUMENTS` como a issue a aprofundar, somado ao contexto que esta sessão já tem e que o agente não teria:

- branch ativa (`git branch --show-current`) e estado do working tree;
- arquivos, páginas ou fluxos já identificados como envolvidos;
- issue, spec ou PR relacionado, se houver;
- restrições que o usuário já declarou nesta conversa;
- por que o `planejar` não basta (o sinal de complexidade que motivou escalar para `arquitetar`).

O agente roda em `opus` e carrega as regras canônicas em `.claude/agents/arquitetar.md`. Não repita essas regras aqui nem no prompt: o agente já as tem.

Quando o plano voltar:

1. Apresente-o ao usuário — mapa de impacto resumido, decisões e porquês, riscos e mitigação, estimativa de complexidade.
2. **Pare.** Se o agente propôs reescopo (issue dividida ou ampliada), a aprovação do reescopo é do usuário, não sua. Só invoque `tdd`/`executar` depois de confirmação explícita do plano.
