---
name: depurar
description: Especialista em debug do iRango — isola a causa raiz quando `executar` trava ou `verificar` encontra comportamento errado, e propõe o fix mínimo. Não reimplementa; não re-planeja sem necessidade.
argument-hint: [erro exato + o que foi implementado/alterado recentemente]
---

Invoque o agente `depurar` (Agent tool, `subagent_type: "depurar"`, em foreground — o próximo passo da sessão depende do diagnóstico).

Passe `$ARGUMENTS` como o erro a investigar, somado ao contexto que esta sessão já tem e que o agente não teria:

- branch ativa (`git branch --show-current`) e estado do working tree;
- mensagem de erro/stacktrace completo, se ainda não estiver em `$ARGUMENTS`;
- arquivo e linha onde o erro ocorre, se conhecido;
- o que foi implementado/alterado recentemente (issue, PR ou diff);
- restrições que o usuário já declarou nesta conversa.

O agente roda em `opus` e carrega as regras canônicas em `.claude/agents/depurar.md`. Não repita essas regras aqui nem no prompt: o agente já as tem.

Quando o diagnóstico voltar:

1. Apresente-o ao usuário — causa raiz, evidência, fix proposto, como verificar.
2. **Pare.** Se o fix exigir push de migration, peça autorização explícita antes de aplicar. Se a causa raiz for arquitetural ou de schema em tabela populada, não aplique o fix — sinalize para invocar `arquitetar` ou `migrar` e aguarde decisão do usuário.
