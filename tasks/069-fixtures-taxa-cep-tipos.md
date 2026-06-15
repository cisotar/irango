# [069] Dívida de tipos em fixtures de teste (cep_inicio/cep_fim, Uint8Array)

**crítica:** NÃO (type-only em testes, não bloqueia `next build`)
**Mundo:** infra
**Origem:** finding da auditoria/verificação 064

## Contexto
`npx tsc --noEmit` acusa erros type-only em arquivos de teste (não tocados pelo `next build`):
- `src/lib/actions/upload.test.ts`: `Uint8Array<ArrayBufferLike>` vs `ArrayBuffer` (lib DOM)
- `src/lib/utils/confirmacao.test.ts`: globals de vitest não resolvidos no tsc isolado + narrowing de union
- `tests/migrations/rpc_pedido_e2e.test.ts`: `Expected 0 arguments, but got 1` (linhas 182, 190)

`src/lib/utils/calcularFrete.test.ts` (fixtures sem `cep_inicio`/`cep_fim`) já foi CORRIGIDO na 064.

## Escopo
- [ ] Ajustar fixtures/tipos para `tsc --noEmit` limpo
- [ ] Avaliar incluir `vitest/globals` no `types` do tsconfig de teste

## Critério de aceite
- [ ] `npx tsc --noEmit` sem erros nos arquivos de teste listados
