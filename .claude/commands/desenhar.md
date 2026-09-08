---
name: desenhar
description: Especialista UI/UX do iRango — garante usabilidade na vitrine pública e no painel do lojista, gera mockups, avalia acessibilidade WCAG AA e consistência de tokens Tailwind/shadcn. Invoque ao criar componente/tela nova, mudar fluxo crítico, ou quando houver atrito.
argument-hint: [tela/componente a avaliar ou criar, ou descrição do mockup pedido]
---

Invoque o agente `desenhar` (Agent tool, `subagent_type: "desenhar"`, em foreground — o próximo passo da sessão depende da avaliação/mockup).

Passe `$ARGUMENTS` como o pedido de UI/UX, somado ao contexto que esta sessão já tem e que o agente não teria:

- branch ativa (`git branch --show-current`) e estado do working tree;
- arquivos, telas ou componentes já identificados como envolvidos;
- issue, spec ou PR relacionado, se houver;
- se é vitrine pública ou painel do lojista, e qual tema/loja está em jogo (se relevante);
- restrições que o usuário já declarou nesta conversa.

O agente roda em `opus` e carrega as regras canônicas em `.claude/agents/desenhar.md`. Não repita essas regras aqui nem no prompt: o agente já as tem.

Quando o resultado voltar:

1. Apresente-o ao usuário — gate de reuso (shadcn/ui, componentes vitrine/painel, tokens varridos e decisão), atritos por impacto ou anatomia do componente proposto, achados de acessibilidade.
2. **Pare.** Mockup ou proposta de componente não autoriza implementação — só invoque `executar` depois que o usuário aprovar o design. Não trate atrito apontado como redesenho amplo sem o usuário pedir.
