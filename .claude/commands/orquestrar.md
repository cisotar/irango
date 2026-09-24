---
name: orquestrar
description: Projeta o loop de execução mais seguro e mais barato para uma tarefa, reusando os agentes, skills e primitivos que já existem no projeto. Devolve o plano — não implementa. Use antes de disparar vários agentes "no feeling".
argument-hint: [descrição da tarefa a orquestrar]
---

**Antes de invocar:** se a tarefa é só visual (copy, cor, espaçamento, ícone, classe Tailwind),
não dispare o agente — responda "use `/polir`" e pare. Planejar isso em `opus` custa mais que fazer.

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

Quando o plano voltar, ele terá gravado dois arquivos: `plan/loop-<slug>.md` (para IA) e
`plan/loop-<slug>.resumo.md` (para humano leigo).

1. Apresente ao usuário o **resumo humano** que o agente devolveu, mais a linha de custo do
   arquivo para IA nas **duas** unidades — invocações (quantas em modelo caro) **e duração** — e
   o corte disponível, para ele poder escolher a versão mais rápida em uma linha.
2. Diga em que **branch ou PR** o trabalho entra, conforme a seção `## Branch` do arquivo para
   IA — e, se for emenda de PR aberto, avise que o push invalida o CI verde atual.
3. **Pare.** Só execute o plano após confirmação explícita. Plano aprovado para uma tarefa não autoriza a próxima.

Ao executar um plano já aprovado (nesta sessão ou numa futura), leia **só o arquivo para IA**.
Para cada subagente, cole no prompt o bloco `### Pn` do passo dele (mais o `## Pedido` e as
`## Travas`, se o passo precisar) — não mande o subagente ler o arquivo inteiro.

O último passo do plano é a higiene que arquiva **os dois arquivos** em `plan/arquivo/` via
`git mv` assim que o entregável estiver no disco. Não pule esse passo nem arquive só um —
é o que mantém `plan/` mostrando só trabalho aberto.
