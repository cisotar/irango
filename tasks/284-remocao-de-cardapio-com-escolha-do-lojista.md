# [284] Remoção de cardápio: manter, arquivar ou apagar em cascata os produtos exclusivos

**crítica: SIM** — remoção permanente de produto em lote, escrita sob `service_role`, escopo
multitenant. TDD red-first obrigatório.

**Mundo:** `src/lib/actions/cardapio.ts` (lojista) e
`src/app/admin/assinantes/actions/admin-cardapios.ts` (hub admin).
**Depende de:** nada.
**Spec:** `specs/remocao-cardapio-exclusivos.md` — RN-01 a RN-13, Contrato das actions.

---

## Origem

Hoje `removerCardapio` recusa remover um cardápio com produtos exclusivos e só oferece
"converter para o menu". Faltam duas saídas: arquivar (sai da vitrine, reversível) e remover em
cascata (some para sempre, com histórico de pedido preservado).

## Escopo

- [ ] `ModoRemocaoExclusivos = "manter" | "arquivar" | "cascata"` em `cardapio-contrato.ts`,
      `schemaModoRemocao` isomórfico em `lib/validacoes/cardapio.ts` (RN-01).
- [ ] `removerCardapio(id, modo?)` — ausência de `modo` ou `"manter"` preserva o comportamento
      atual byte a byte (RN-10). `"arquivar"` e `"cascata"` seguem o fluxo do contrato da spec:
      posse (`cardapioPertenceALoja`, RN-04) → recalcular órfãos no servidor (RN-02) → request 1
      escrito nos produtos → request 2 remove o cardápio (RN-06, ordem normativa).
- [ ] `removerCardapioAdmin(lojaId, id, modo?)` — mesmo fluxo, `lojaId` da URL validado,
      `registrarAcessoAdmin` com `metadados: { modo, produtos: N }` (RN-13).
- [ ] `arquivar`: um único `update({ oculto: true, visibilidade: "menu" })` escopado por
      `loja_id + visibilidade='cardapio' + in(órfãos)` (RN-05).
- [ ] `cascata`: um único `delete()` no mesmo escopo (RN-07).
- [ ] Falha no request 1 não segue para o request 2 (RN-08 do fluxo interno da spec).
- [ ] Backstop de corrida (`ehErroDeExclusivoOrfao`) continua envolvendo o DELETE do cardápio
      nos três modos (RN-09).

## Fora de escopo

Tudo listado em "Fora do Escopo (v1)" da spec: vitrine, RPC/migration, desfazer cascata, lote fora
do diálogo, modo padrão por loja, reescrever `mensagemExclusivos`.

## Critério de aceite

Os 12 itens de "Critérios de Aceite (mecânicos)" da spec, nos dois mundos. Em especial:

- [ ] `manter` sem nenhuma escrita em `produtos`, resposta idêntica à de hoje.
- [ ] `arquivar` e `cascata` recalculam a lista no servidor — o teste usa um conjunto de órfãos
      diferente do "esperado ingênuo" (inclui um exclusivo com outro vínculo) e afirma que ele
      **não** aparece no `in(...)`.
- [ ] Produto de outra loja com nome parecido não é tocado; `lojaId` hostil no admin não muda o
      escopo.
- [ ] `cardapioPertenceALoja` falso ⇒ `MSG_REMOVER`, zero escrita, zero log com entidade alheia.
- [ ] Modo inválido ⇒ `MSG_INVALIDO`, sem nenhum I/O.
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
