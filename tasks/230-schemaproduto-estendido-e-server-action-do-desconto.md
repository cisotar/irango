# [230] `schemaProduto` estendido + `mensagemDescontoMaiorQuePreco` + a Server Action que grava o desconto

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** [219] (`tasks/219-migration-colunas-de-desconto-em-produtos-e-checks.md`), [222] (`tasks/222-extrair-fusoloja-de-lojaaberta.md`) e [223] (`tasks/223-preco-efetivo-e-vigencia.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D1, D10 · RN-03, RN-04, RN-05, RN-06, RN-07

## Objetivo

Dar ao lojista (e ao admin, pelo mesmo schema) a **barreira legível** que os CHECKs da 219
só sabem recusar com `23514`: validação zod das cinco colunas de desconto e a mensagem
literal de D10, montada por **uma** função pura que form e Server Action compartilham.

## Escopo

- [ ] estender `src/lib/validacoes/produto.ts` (`schemaProduto`) com os campos de desconto:
      `desconto_ativo` (boolean), `desconto_tipo` (`"percentual" | "fixo"`), `desconto_valor`,
      `desconto_inicio`, `desconto_fim` — nulabilidade explícita, sem default silencioso;
- [ ] percentual em `1..100` (mesma forma que `cupomSchema` já usa) e valor fixo `> 0` (RN-04, RN-05);
- [ ] `superRefine` cross-field: `desconto_ativo = true` exige tipo **e** valor (coerência, RN-07);
      `fixo` com `desconto_valor > preco` é **recusado** (RN-05/RN-06); `desconto_fim > desconto_inicio`
      quando os dois existem;
- [ ] `export function mensagemDescontoMaiorQuePreco(preco, desconto): string` **pura**, no mesmo
      módulo, consumida pelo `superRefine` (M7 do design §8.2) — nomeia os **dois números** e as
      **duas saídas**, literal:
      `Não dá para salvar: o preço novo (R$ 8,00) é menor que o desconto configurado (R$ 10,00).
      Reduza o desconto para no máximo R$ 8,00 ou desligue a promoção deste produto.`;
- [ ] `criarProduto`/`atualizarProduto` (`src/lib/actions/produto.ts`) gravam as colunas novas com
      `loja_id` derivado de `buscarLojaDoDono`, **nunca do payload**;
- [ ] escrita do prazo: o horário local digitado pelo lojista vira instante **no fuso da loja**
      (`lojas.timezone`) usando `lib/utils/fusoLoja.ts` — RN-03, dois lugares de borda só;
- [ ] desligar (`desconto_ativo = false`) **preserva** tipo, valor e prazo (RN-07);
- [ ] `23514` vindo do banco é mapeado para mensagem genérica na UI + detalhe no log
      (`seguranca.md` §14) — o texto cru do Postgres nunca chega a ninguém.

## Fora de escopo

O bloco "Promoção" no `FormProduto` e a superfície de exibição do erro (issue 235). O teste de
paridade do caminho admin (issue 241). Os CHECKs (issue 219, já entregues — aqui eles são
backstop, não a barreira). **O sistema não ajusta dinheiro sozinho**: nenhuma correção automática
de desconto ou desligamento automático de promoção (D10, RN-06).

## Reuso esperado

- `src/lib/validacoes/produto.ts` — **estender** o `schemaProduto` existente; nada de schema paralelo.
- `src/lib/validacoes/cupom.ts` — precedente do "1..100" para percentual.
- `src/lib/utils/formatarMoeda.ts` — a mensagem de D10 formata os dois números com ele.
- `src/lib/utils/fusoLoja.ts` (issue 222) — a única aritmética de fuso do projeto.
- `src/lib/actions/produto.ts` + `buscarLojaDoDono` — padrão de escopo já existente (`cupom.ts`).
- `src/lib/utils/precoEfetivo.ts` (issue 223) — a prévia do form consome esta, nunca uma 2ª fórmula.

## Segurança

- **Valor monetário:** um `desconto_valor` maior que o preço produziria preço efetivo no piso e o
  cliente pagaria menos do que o lojista quis. zod é a 1ª camada, CHECK a 2ª, o clamp de
  `precoEfetivo` a 3ª.
- **Permissão:** `loja_id` vem de `buscarLojaDoDono`; a RLS `produtos_acesso_proprio` é o
  isolamento real. Nenhum patch por spread do payload.
- Erro interno não vaza: `23514` → mensagem genérica; a mensagem de D10 é decidida **antes** da
  escrita, não extraída do Postgres.

## Critério de aceite

- [ ] teste vermelho escrito e depois verde: percentual 101 recusado; fixo `> preco` recusado com
      **a mensagem literal de D10** afirmada byte a byte; `desconto_ativo = true` sem tipo/valor
      recusado; `desconto_fim <= desconto_inicio` recusado;
- [ ] desligar e salvar mantém tipo, valor e prazo no banco (RN-07);
- [ ] prazo digitado "31/12 23:59" numa loja `America/Sao_Paulo` grava o instante correto;
- [ ] `grep -rn "mensagemDescontoMaiorQuePreco" src/` mostra **uma** definição;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
