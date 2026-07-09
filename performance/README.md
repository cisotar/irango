# performance/

Registros das auditorias do agente `acelerar` (revisor de performance).

- Um arquivo por auditoria: `AAAA-MM-DD-<escopo>.md` (`<escopo>` = slug da issue ou área auditada).
- Toda invocação do agente gera registro, mesmo sem achados.
- Conteúdo: contexto, medições (`EXPLAIN ANALYZE`, bundle, payload) e findings com severidade (GARGALO / CUSTO / POLIMENTO) e status.
- Histórico serve de baseline: compare medições entre auditorias antes de declarar regressão ou melhora.

Convenção definida em `.claude/agents/acelerar.md` (§ Saída) e no `/fluxo` (passo 6a).
