# [308] RED V5: Trojan Source, bidi e Unicode no texto e no título

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Segurança, matriz V5; RN-M03, RN-M09, §Esclarecimento sobre emoji)

## Objetivo
Suíte vermelha que prova a remoção de invisíveis/bidi/controles no trecho e no título (zod) e a recusa pelo CHECK do título no banco (tabela e RPC).

## Escopo
- [ ] Criar `tests/seguranca/modal-sazonal/v5-unicode.test.ts`. Todo caractere invisível escrito como escape `\u....` no arquivo, nunca literal.
- [ ] **A6** zod do trecho: U+202E, U+2066–2069, U+200B, C0/C1, substituto desemparelhado são removidos antes de medir; `800 visíveis + 50 invisíveis` passa.
- [ ] **A6** zod do título (`schemaModalSazonal`): mesmos caracteres removidos; `"\tPromo"`, `"A\nB"`, `"A\u0085B"`, `"A B"` viram espaço/trim e o resultado passa; afirmação explícita de **ordem**: o título canônico não contém nenhum caractere do conjunto do CHECK `modais_sazonais_titulo_sem_invisiveis` (inclui U+0009). Motivo: `normalizarObservacao` passo 2 preserva `\n`/`\t` e passo 3 remove U+2028/2029; a troca de quebra por espaço tem que rodar ANTES de `removerInvisiveisEControles`.
- [ ] **A6** pglite `asUser(dono)`: título com U+202E recusado com `23514` + fragmento `modais_sazonais_titulo_sem_invisiveis`, (a) UPDATE direto na tabela e (b) via `salvar_modal_sazonal`; título de 121 caracteres → `modais_sazonais_titulo_tamanho`.
- [ ] **A26**: `"\u{1F468}‍\u{1F469}‍\u{1F467}"` preservado byte a byte pelo zod do trecho (`preservarJuncaoDeEmoji: true`); `"a‍b"` vira `"ab"`; `removerInvisiveisEControles` com opção padrão remove ZWJ também entre emojis; U+FE0F preservado.
- [ ] Guarda da refatoração: `src/lib/utils/normalizarObservacao.test.ts` roda inalterado (não editar).
- [ ] Capturar o `FAIL`.

## Fora de escopo
Produção (312, 313).

## Reuso esperado
- `src/lib/utils/normalizarObservacao.ts` (passos 2, 3, 8 viram `removerInvisiveisEControles` na 313).
- `tests/helpers/pglite.ts`; seed compartilhado (ver 307).

## Segurança
CVE-2021-42574. Afirmar fragmento da constraint junto do SQLSTATE.

## Critério de aceite
- [ ] A6 (zod trecho, zod título, CHECK tabela, CHECK via RPC) e A26 cobertos; `FAIL` capturado.
- [ ] `normalizarObservacao.test.ts` intocado.
