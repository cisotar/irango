# [241] Paridade do hub admin: mesmo `schemaProduto`, mesmo `precoEfetivo`, nenhum patch por spread

**crítica:** SIM (TDD red-first)
**Mundo:** painel admin
**Depende de:** [230] (`tasks/230-schemaproduto-estendido-e-server-action-do-desconto.md`), [231] (`tasks/231-allowlist-de-modal-promocoes-em-montarpatchperfil.md`) e [223] (`tasks/223-preco-efetivo-e-vigencia.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D10 · RN-04, RN-05, RN-06 · §Segurança, "Caminho admin (service_role)"

## Objetivo

Provar por **teste** que o admin, que edita produto e perfil em nome do lojista com `service_role`
(`BYPASSRLS`), não ganha nenhuma regra monetária mais generosa que o lojista. O Spec A marca esta
fatia como `crítica: SIM` — a RLS **não** protege esse caminho.

## Escopo

- [ ] teste de paridade afirmando que `src/app/admin/assinantes/actions/admin-produtos.ts` (linhas 56 e 94) usa
      **exatamente o mesmo** `schemaProduto` estendido — percentual 101 recusado, fixo `> preco`
      recusado **com a mesma mensagem literal de D10**, `desconto_ativo` sem tipo/valor recusado;
- [ ] teste afirmando que **nenhum caminho admin monta patch por spread** do payload: escrita de
      produto e de perfil passa por allowlist/schema, nunca por `{ ...payload }`;
- [ ] teste afirmando que o admin liga/desliga `modal_promocoes` pela **mesma** `montarPatchPerfil`
      (`src/app/admin/assinantes/actions/admin-perfil.ts`), sem segunda allowlist;
- [ ] teste de escopo cross-tenant: `loja_id` de outra loja no payload admin é recusado por
      `validarLojaIdAdmin` + `escopo.*` — afirmando **o fragmento da mensagem** além do SQLSTATE
      (trava de escopo passa por acidente aritmético quando só se checa o código do erro);
- [ ] conferência **negativa** e explícita: `admin-cupom.ts` **não muda e não deve mudar** — ele
      não é caller de `calcularDesconto` (a única ocorrência ali é um comentário) e só persiste a
      definição comercial do cupom.

## Fora de escopo

Escrever a validação (issue 230) e a allowlist (issue 231) — esta issue **prova** que elas valem
nos dois mundos. Nenhum cálculo de desconto acrescentado ao caminho admin: se um dia o hub ganhar
preview de valor de cupom, ele usa `calcularDesconto` com base elegível como todo mundo. Nenhuma
política RLS nova (não há tabela nova).

## Reuso esperado

- `schemaProduto` + `mensagemDescontoMaiorQuePreco` (issue 230) — o teste afirma **a mesma** saída
  nos dois caminhos.
- `montarPatchPerfil` (issue 231) — allowlist compartilhada.
- `precoEfetivo()` (issue 223) — a única função que transforma desconto em preço.
- `verificarAdminSaaS()`, `validarLojaIdAdmin`, `escopo.*` — o isolamento real do hub admin.
- `admin-loja.binding.test.ts` — precedente de teste de amarração do caminho admin.

## Segurança

- **`service_role` tem `BYPASSRLS`:** toda regra nova que more só na RLS não existe no hub admin.
  O que protege ali é o escopo por `loja_id` + o schema zod + os CHECKs.
- Um caminho admin mais frouxo é o oráculo generoso mais fácil de esquecer: ele grava dinheiro na
  loja de outra pessoa.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde, cobrindo os quatro pontos acima;
- [ ] `grep -rn "\.\.\.payload\|\.\.\.dados" src/app/admin/assinantes/actions/admin-produtos.ts src/app/admin/assinantes/actions/admin-perfil.ts`
      **não devolve nada** que chegue ao `update`/`insert`;
- [ ] `grep -rn "calcularDesconto" src/app/admin/assinantes/actions/admin-cupom.ts` devolve **só o comentário**;
- [ ] `grep -rn "schemaProduto" src/lib/actions/ src/app/admin/` mostra o **mesmo** schema nos dois mundos;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
