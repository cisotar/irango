---
name: planejar
description: Arquiteto sênior que enriquece uma issue com plano técnico preciso — análise do codebase, cenários, schema, RLS, arquivos a criar/modificar/não-tocar e ordem de implementação. Para issues complexas (multi-camada, mudança de contrato), prefira `arquitetar`.
argument-hint: [caminho de uma issue em tasks/]
---

Invoque o agente `planejar` (Agent tool, `subagent_type: "planejar"`, em foreground — o próximo passo da sessão depende do plano).

Passe `$ARGUMENTS` como a issue a planejar, somado ao contexto que esta sessão já tem e que o agente não teria:

- branch ativa (`git branch --show-current`) e estado do working tree;
- arquivos, páginas ou fluxos já identificados como envolvidos;
- issue, spec ou PR relacionado, se houver;
- restrições que o usuário já declarou nesta conversa.

O agente roda em `opus` e carrega as regras canônicas em `.claude/agents/planejar.md`. Não repita essas regras aqui nem no prompt: o agente já as tem.

Quando o plano voltar:

1. Apresente-o ao usuário — arquivos a criar/modificar, riscos e, se a issue é crítica, o lembrete de começar por `tdd` (RED).
2. **Pare.** Só invoque `tdd`/`executar` depois de confirmação explícita do plano.
