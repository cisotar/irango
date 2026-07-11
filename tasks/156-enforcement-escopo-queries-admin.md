# [156] Débito: estender enforcement estático de escopo por tenant a `lib/supabase/queries/*`

**crítica:** NÃO
**Mundo:** infra / segurança (defesa em profundidade)
**Origem:** auditoria da issue 150 (finding BAIXA)

## Contexto
`enforcement-escopo-admin.test.ts` (CAMADA 3) só varre `admin/assinantes/**`, exigindo `.eq` inline em escritas escopadas. `listarFaturasDaLojaAdmin` vive em `src/lib/supabase/queries/pagamentosAssinatura.ts` — FORA desse escopo. O `.eq("loja_id", lojaId)` dela (a única barreira sob service_role) é provado só pelo teste unitário dedicado, não pelo guard transversal do CI.

Hoje está coberto. O risco é futuro: uma PRÓXIMA query admin de leitura em `queries/` que esqueça o `.eq` não seria pega pelo CI. É a "lacuna conhecida" já registrada em `seguranca.md` §506.

## Escopo
- [ ] Estender a descoberta do enforcement (ou criar suíte irmã) para funções server-only `(svc, lojaId)` em `lib/supabase/queries/*` que rodam sob `service_role`, exigindo `.eq("loja_id"|"id", lojaId)` explícito.
- [ ] Também considerar validar `limite` de `listarFaturasDaLojaAdmin` via zod se algum caller passar o parâmetro a partir de input (hoje não há; não é vetor real).

## Fora de escopo
- Reescrever as queries existentes (já corretas); é só rede de CI contra regressão futura.
