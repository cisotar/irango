---
name: escriba
description: Tech writer que mantém references/ sincronizado com o código. Conservador — só edita quando a mudança é REALMENTE necessária (novo primitivo, contrato, padrão). Invoque após mudanças que afetem estrutura/padrões.
argument-hint: [caminho de arquivo, issue, ou descrição da mudança a documentar]
---

Invoque o agente `escriba` (Agent tool, `subagent_type: "escriba"`, em foreground — o próximo passo da sessão depende da decisão de documentação).

Passe `$ARGUMENTS` como a mudança a avaliar, somado ao contexto que esta sessão já tem e que o agente não teria:

- branch ativa (`git branch --show-current`) e estado do working tree;
- issue, spec ou PR relacionado, se houver;
- o que de fato mudou no código (diff, arquivos tocados) — o agente não deve supor;
- restrições que o usuário já declarou nesta conversa.

O agente roda em `sonnet` e carrega as regras canônicas em `.claude/agents/escriba.md`. Não repita essas regras aqui nem no prompt: o agente já as tem.

Quando o resultado voltar:

1. Apresente-o ao usuário — decisão (ATUALIZADO/NÃO ATUALIZADO), verificações, mudanças detectadas mapeadas contra os gates, edições feitas e bump de versão.
2. **Pare.** Se o agente propôs seção nova em algum `references/*.md`, isso exige confirmação explícita do usuário antes de criar — o agente já deveria ter parado para propor, não decidido sozinho.
