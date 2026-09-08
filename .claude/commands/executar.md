---
name: executar
description: Implementa uma issue planejada (fase GREEN). Em issue crítica, só age depois do teste vermelho do `tdd` existir — escreve o mínimo para passar, depois refatora. Reusa libs/utils existentes, valida no servidor, nunca confia no cliente.
argument-hint: [caminho de uma issue com plano técnico em tasks/]
---

Invoque o agente `executar` (Agent tool, `subagent_type: "executar"`, em foreground — o próximo passo da sessão depende da implementação).

Passe `$ARGUMENTS` como a issue a implementar, somado ao contexto que esta sessão já tem e que o agente não teria:

- branch ativa (`git branch --show-current`) e estado do working tree;
- arquivos, páginas ou fluxos já identificados como envolvidos;
- issue, spec ou PR relacionado, se houver;
- se a issue é `crítica: SIM`, o caminho do teste vermelho já escrito pelo `tdd`, se existir;
- restrições que o usuário já declarou nesta conversa.

O agente roda em `opus` e carrega as regras canônicas em `.claude/agents/executar.md`. Não repita essas regras aqui nem no prompt: o agente já as tem.

Quando a implementação voltar:

1. Apresente-a ao usuário — arquivos criados/modificados, resultado de testes e `npm run build`, como cada regra inegociável foi respeitada (recálculo no servidor, RLS, reuso).
2. **Pare.** Não invoque `auditar`/`testar`/`verificar` nem feche a issue sem o usuário decidir o próximo passo — a implementação aprovada para esta issue não autoriza a próxima.
