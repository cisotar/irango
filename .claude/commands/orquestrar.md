---
name: orquestrar
description: Projeta o loop de execução mais seguro e mais barato para uma tarefa, reusando os agentes, skills e primitivos que já existem no projeto. Devolve o plano — não implementa. Use antes de disparar vários agentes "no feeling".
argument-hint: [descrição da tarefa a orquestrar]
---

Invoque o agente `orquestrar` (Agent tool, `subagent_type: "orquestrar"`, em foreground — o próximo passo da sessão depende do plano).

Passe `$ARGUMENTS` como a tarefa, somado ao contexto que esta sessão já tem e que o agente não teria:

- branch ativa (`git branch --show-current`) e estado do working tree;
- arquivos, páginas ou fluxos já identificados como envolvidos;
- issue, spec ou PR relacionado, se houver;
- restrições que o usuário já declarou nesta conversa.

O agente roda em `opus` e carrega as regras canônicas em `.claude/agents/orquestrar.md`. Não repita essas regras aqui nem no prompt: o agente já as tem.

Quando o plano voltar:

1. Apresente-o ao usuário — agentes e skills envolvidos, ordem, travas, custo estimado.
2. **Pare.** Só execute o plano após confirmação explícita. Plano aprovado para uma tarefa não autoriza a próxima.
