# [307] RED V4: DoS, cardinalidade e padding (zod, CHECK de bytes, travas S3 da RPC)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Segurança, matriz V4; RN-M03, RN-M08, RN-M14, RN-M15 S3)

## Objetivo
Suíte vermelha que prova os tetos de RN-M08 no zod (brutos antes do transform, canônicos depois), o CHECK de bytes no banco e as travas de array da RPC chamada direto.

## Escopo
- [ ] Criar `tests/seguranca/modal-sazonal/v4-dos.test.ts`.
- [ ] **A5** zod: 10 mil trechos, 1 mil parágrafos, texto de 1 MB, URL de 1 MB reprovam **sem transformar** (spy/contagem: o transform não roda, ou tempo < limite razoável); fronteiras 120/121 trechos canônicos, 800/801 caracteres (`contarCaracteresMensagem`), 10/11 links, 1000/1001 URL canônica, 20/21 parágrafos canônicos, 200/201 trechos brutos por parágrafo, 3200/3201 texto bruto.
- [ ] **A7** canonização antes de medir: 300 trechos idênticos adjacentes viram 1 e passam; 50 parágrafos vazios entre textos viram 1; trechos vazios somem.
- [ ] **A22** profundidade: `nivel: 5`, `filhos: [...]`, parágrafo dentro de `trechos`, 1 mil níveis de aninhamento via JSON montado em loop → zod reprova sem `RangeError`. (O achatamento pelo conversor do editor fica no teste ao lado do conversor, 315.)
- [ ] **A30** pglite (`createTestDb`, `asUser(dono)`) chamando `public.salvar_modal_sazonal` direto: 51 e 10 mil ids, array 2D (`'{{a,b},{c,d}}'::uuid[]`), `null` dentro, duplicata → cada caso `raise` com SQLSTATE **e** fragmento de mensagem afirmados; linha e junções idênticas antes/depois.
- [ ] **A8b** pglite: UPDATE direto em `modais_sazonais` com `mensagem` de 70 KB (topo válido) → `23514` + fragmento `modais_sazonais_mensagem_tamanho`.
- [ ] Capturar o `FAIL` (módulo zod e migrations inexistentes).

## Fora de escopo
Forma de topo e contorno da Action (309, V6-A8). Produção (312, 313).

## Reuso esperado
- `tests/helpers/pglite.ts` (`createTestDb`, `asUser`).
- Seeds de loja/categoria/cardápio de `tests/migrations/modais_sazonais_rls.test.ts` (copiar o molde, ou extrair helper se a suíte 309/311 repetir: um helper `tests/seguranca/modal-sazonal/seed.ts` compartilhado pelas suítes pglite 307/308/309/311, criado por quem chegar primeiro).
- Memória "SQLSTATE não basta em teste de escopo": sempre afirmar o fragmento junto.

## Segurança
CWE-770. A RPC é chamável direto pelo PostgREST com a sessão do dono, contornando o zod.

## Critério de aceite
- [ ] A5, A7, A22, A30, A8b cobertos; `FAIL` capturado antes de produção.
- [ ] Nenhum arquivo em `src/` ou `supabase/` alterado.
