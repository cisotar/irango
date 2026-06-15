# [070] Zerar lint e tornar o passo de lint um gate duro no CI

**crítica:** NÃO (qualidade/CI)
**Mundo:** infra
**Origem:** setup de CI (GitHub Actions) — débito de lint pré-existente

## Contexto
O workflow `.github/workflows/ci.yml` roda `npm run lint` como passo **não-bloqueante** (`continue-on-error: true`) porque há débito pré-existente: 1 erro + 15 warnings na baseline.

- **Erro:** `src/components/vitrine/ProdutoModal.tsx:74` — `setState` síncrono dentro de `useEffect` (regra React Compiler `set-state-in-effect`). O reset de quantidade ao abrir o modal deve migrar para handler de abertura / `key` / ref, não effect.
- **Warnings (15):** `no-unused-vars` em vários testes/utils (`_tipoDeclarado`, `_d`, `_cols`, `_colunas`, `DONO_ID_OU` etc.) — prefixo `_` não está sendo ignorado pela config, ou são realmente mortos.

Gates duros do CI hoje: `tsc --noEmit`, `npm test` (vitest+pglite), `npm run build`.

## Escopo
- [ ] Corrigir o erro de `ProdutoModal.tsx` (reset fora do effect)
- [ ] Zerar os 15 warnings (remover mortos ou ajustar `argsIgnorePattern`/`varsIgnorePattern: '^_'` no eslint)
- [ ] Trocar o passo de lint no CI para bloqueante (remover `continue-on-error`)

## Critério de aceite
- [ ] `npm run lint` sai 0 (zero erro, zero warning)
- [ ] CI falha se um lint novo for introduzido
