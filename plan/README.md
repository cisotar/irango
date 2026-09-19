# `plan/` — planos de execução

Plano técnico de issue (saída de `planejar`/`arquitetar`), plano de loop (saída de
`orquestrar`), handoff de pentest e handoff de verificação. Complementa, não substitui:
`specs/` guarda o **o quê**, `tasks/` a **issue**, `plan/` o **como executar**.

## `plan/` vs `plan/arquivo/`

- **`plan/` (raiz)** — trabalho ainda aberto. Um arquivo aqui significa que existe ação
  pendente: código não escrito, fix não aplicado, ou procedimento não executado.
- **`plan/arquivo/`** — concluído. Mantido no repo porque o plano registra a *justificativa*
  das decisões (desvios de padrão, seams entre issues, alternativas rejeitadas) que o código
  sozinho não conta.

## Critério de arquivamento

Arquiva-se por **entregável no disco**, nunca por menção em commit:

1. Ler a seção "Arquivos a Criar / Modificar" do plano — é o entregável.
2. Provar que o artefato existe (`arquivo:linha`), não que a dependência citada em
   "o que já existe e será reusado" existe. Plano cita dependências pré-existentes; a
   presença delas não prova nada.
3. Grep por número de issue em `git log` é **evidência fraca**: os números colidem com
   números de PR (`Merge pull request #103` ≠ issue 103).
4. Plano cujo alvo foi deletado por refactor posterior conta como concluído se a intenção
   landou no sucessor (ex.: 119 mirava `ConfiguracaoAdminClient.tsx`, hoje extinto pelas
   sub-rotas 152/153 — a injeção vive em `PerfilAdminClient.tsx`).
5. **Handoff de procedimento** (verificação E2E, pentest) só é concluído quando o
   procedimento *rodou*. Código pronto não fecha um handoff de verificação.
6. Recomendação condicional dentro de um plano ("se o projeto voltar a precisar disso, o
   usuário decide") não é entregável e não impede o arquivamento.

## Estado (triagem de 2026-09-19)

Ambos os itens da triagem de 2026-09-08 foram entregues e arquivados desde então
(`loop-160-props-action-obrigatorias.md` — série `feat(160)`; `verify-handoff-146-teto-itens.md`
— PRs #111/#112). `plan/` (raiz) hoje só contém trabalho genuinamente aberto: `orquestrar`
(agente e skill) agora inclui, no próprio plano gerado, um passo final de higiene que arquiva o
loop em `plan/arquivo/` assim que o entregável estiver no disco — ver `.claude/agents/orquestrar.md`
regra 8. Não repita a varredura manual completa sem motivo; confira `plan/` (raiz) para o que
ainda está pendente.
