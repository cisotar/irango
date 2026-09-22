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

Passe também, quando existir, o **diagnóstico que esta sessão já fez** — causa raiz lida no
código, chamadores levantados, blast radius. É insumo: o agente não deve pagar um `planejar`
para reproduzir o que já está pronto.

Quando o plano voltar:

1. Apresente-o ao usuário — agentes e skills envolvidos, ordem, travas, e o custo nas **duas**
   unidades: número de invocações (com quantas em modelo caro) **e duração estimada**. Apresente
   junto o corte disponível dentro do degrau (seção 7 do plano), para ele poder escolher a
   versão mais rápida em uma linha.
2. Diga em que **branch ou PR** o trabalho entra, conforme a seção 5 do plano — e, se for emenda
   de PR aberto, avise que o push invalida o CI verde atual.
3. **Pare.** Só execute o plano após confirmação explícita. Plano aprovado para uma tarefa não autoriza a próxima.

Ao executar um plano já aprovado (nesta sessão ou numa futura), o próprio arquivo do plano
traz, como último passo do "Passo a passo da execução", a higiene de arquivar-se em
`plan/arquivo/` via `git mv` assim que o entregável estiver no disco. Não pule esse passo —
é o que mantém `plan/` mostrando só trabalho aberto.
