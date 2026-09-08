---
name: especificar
description: Especialista em product design e arquitetura — transforma uma descrição de feature/projeto em um spec acionável em specs/, mapeando páginas, behaviors, modelos de dados e regras de negócio, já marcando dado/valor autoritativo do servidor vs. preview de UX no cliente.
argument-hint: [descrição da feature ou do projeto]
---

Invoque o agente `especificar` (Agent tool, `subagent_type: "especificar"`, em foreground — o próximo passo da sessão depende do spec).

Passe `$ARGUMENTS` como a descrição da feature/projeto, somado ao contexto que esta sessão já tem e que o agente não teria:

- branch ativa (`git branch --show-current`) e estado do working tree;
- arquivos, páginas ou fluxos já identificados como envolvidos;
- issue, spec ou PR relacionado, se houver;
- restrições que o usuário já declarou nesta conversa (escopo, prazo, o que já está descartado).

O agente roda em `opus` e carrega as regras canônicas em `.claude/agents/especificar.md`. Não repita essas regras aqui nem no prompt: o agente já as tem.

Quando o spec voltar:

1. Apresente-o ao usuário — total de páginas e behaviors, pontos de segurança críticos identificados (recálculo no servidor, RLS nova).
2. **Pare.** Só invoque `quebrar` sobre o spec depois que o usuário confirmar que ele captura o escopo certo.
