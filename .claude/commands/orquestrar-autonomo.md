---
name: orquestrar-autonomo
description: Variante autônoma do /orquestrar — projeta e EXECUTA o loop de ponta a ponta sem parar para aprovação humana, incluindo db push, git push, abrir PR e ações destrutivas quando o plano exigir. Risco maior que /orquestrar; use só quando o pedido for literalmente execução autônoma.
argument-hint: [descrição da tarefa a executar de forma autônoma]
---

**Antes de invocar:** se a tarefa é só visual (copy, cor, espaçamento, ícone, classe Tailwind),
não dispare o agente — responda "use `/polir`" e pare. Autonomia em `opus` custa mais que fazer.

**Confirme o opt-in antes de disparar.** Este comando existe porque o usuário pediu explicitamente
execução sem gates humanos. Se o pedido que chegou aqui não deixar isso claro — se parecer um
pedido comum que caiu neste comando por engano — pergunte uma vez ("quer que eu rode até o fim
sozinho, incluindo push/PR/migration se o plano exigir, ou prefere `/orquestrar` normal com
aprovação no meio?") antes de invocar. Depois de confirmado, não pergunte de novo no meio do loop.

Invoque o agente `orquestrar-autonomo` (Agent tool, `subagent_type: "orquestrar-autonomo"`).
Rode em background (`run_in_background: true`) — o loop pode levar dezenas de minutos e o
usuário não precisa ficar bloqueado esperando; você será notificado quando ele terminar.

Passe `$ARGUMENTS` como a tarefa, somado ao contexto que esta sessão já tem e que o agente não teria:

- branch ativa (`git branch --show-current`) e estado do working tree;
- arquivos, páginas ou fluxos já identificados como envolvidos;
- issue, spec ou PR relacionado, se houver;
- restrições que o usuário já declarou nesta conversa;
- se o pedido autoriza mesclar PR ao final, ou só abrir PR com gates verdes (padrão, na ausência
  de instrução explícita, é **só abrir**, nunca mesclar sozinho).

O agente roda em `opus`, carrega as regras canônicas de `.claude/agents/orquestrar.md` e a
disciplina de execução autônoma de `.claude/agents/orquestrar-autonomo.md`. Não repita essas
regras aqui: o agente já as tem.

Passe também, quando existir, o **diagnóstico que esta sessão já fez** — causa raiz lida no
código, chamadores levantados, blast radius. É insumo: o agente não deve pagar um `planejar`
para reproduzir o que já está pronto.

Diferente do `/orquestrar` normal, **não há passo de apresentar o plano e parar**: o agente
projeta, executa, trata achado de auditoria, arquiva os dois arquivos em `plan/arquivo/` e volta
com o relatório final — o que foi pedido, o que foi entregue (commits, PR, migration aplicada ou
não), quantas iterações rodaram, e onde parou se não chegou ao fim (estagnação, orçamento
esgotado, lacuna sem cobertura).

Quando a notificação de conclusão chegar, repasse ao usuário o relatório final do agente na
íntegra — especialmente qualquer ação irreversível que tenha sido tomada (`db push` aplicado,
PR aberto ou mesclado, arquivo removido) — mesmo que o comando não tenha pedido aprovação para
executá-las.
