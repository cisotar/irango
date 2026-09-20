# [242] Migration 1: `produtos_id_loja_unico` + tabela `cardapios` (CHECKs de vigência) + RLS

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D2, D3, D3-a, D3-b, D16 (a coluna `ordem`) · RN-01, RN-02, RN-03, RN-04, RN-15
**Fatia crítica:** 1 (migration + RLS de `cardapios` e `cardapio_produtos`) — a metade de `cardapios`

## Objetivo

Criar a entidade **cardápio** no banco, com os CHECKs que tornam uma vigência incoerente
**impossível de gravar**, e a RLS que isola a tabela por loja. É a primeira migration do
Spec B: nada existe antes dela, tudo depende dela para valer.

## Escopo

- [ ] migration em `supabase/migrations/` com
      `alter table public.produtos add constraint produtos_id_loja_unico unique (id, loja_id)`
      (redundante com a PK, sempre satisfeito pelas linhas existentes: é só o alvo da FK
      composta da issue 243);
- [ ] `create table public.cardapios` **exatamente** com as colunas de §Modelos de Dados:
      `id`, `loja_id` (FK `lojas` `on delete cascade`), `nome`, `ativo boolean not null default true`,
      `ordem int not null default 0` (chave de ordenação das seções de destaque, RN-15),
      `modo text check (modo in ('recorrente','prazo_fixo'))`,
      `dias_semana smallint[]`, `dias_mes smallint[]`, `hora_inicio time`, `hora_fim time`,
      `prazo_inicio timestamptz`, `prazo_fim timestamptz`, `prazo_preset text`,
      `criado_em`, `atualizado_em`, `constraint cardapios_id_loja_unico unique (id, loja_id)`;
- [ ] os CHECKs, com os nomes literais do spec, nenhum a menos:
      `cardapios_recorrente_exclusivo`, `cardapios_prazo_exclusivo`,
      `cardapios_recorrente_tem_eixo` (`coalesce(cardinality(...),0) > 0` — recusa `NULL` **e** `'{}'`),
      `cardapios_hora_par`, `cardapios_hora_ordem` (`hora_fim > hora_inicio`, não cruza meia-noite),
      `cardapios_dias_semana_dominio` (`<@ array[0..6]`), `cardapios_dias_mes_dominio` (`<@ array[1..31]`),
      `cardapios_prazo_obrigatorio`, `cardapios_prazo_ordem`, e o CHECK de `prazo_preset`
      (`null` ou `in ('diario','semanal','mensal','customizado')`);
- [ ] `create index on public.cardapios (loja_id, ativo)`;
- [ ] `alter table public.cardapios enable row level security` + as três políticas literais de
      §Segurança: `cardapios_leitura_publica` (`ativo = true and public.loja_esta_ativa(loja_id)`),
      `cardapios_leitura_propria`, `cardapios_escrita_propria` (`using` **e** `with check`);
- [ ] testes em `tests/migrations/` via `createTestDb()` de `tests/helpers/pglite.ts`:
      asserções 1, 2, 5, 6 e 7 de §Segurança — lojista A (`asUser`) não lê cardápio da loja B
      (zero linhas); não cria, edita nem remove cardápio da loja B; `anon` lê cardápio **ativo**
      de loja ativa e **não** lê o inativo; `anon` não faz INSERT/UPDATE/DELETE;
      os CHECKs recusam modo misturado, recorrente sem nenhum eixo (com `NULL` **e** com `'{}'`),
      `hora_fim <= hora_inicio`, `dias_semana` com 7, `dias_mes` com 0 ou 32, prazo fixo sem `fim`;
- [ ] `npx supabase gen types typescript > src/lib/database.types.ts`.

## Fora de escopo

`cardapio_produtos` e as FKs compostas (issue 243) — esta issue só entrega o **alvo** delas.
A RPC `aplicar_cardapio_em_categoria` (issue 250). A coluna `produtos.visibilidade` (issue 244):
1 e 16 são independentes entre si e podem andar em paralelo. Nenhuma UI de reordenar cardápio
(§Fora do Escopo): `ordem` existe, a tela não. **`public.vitrine_lojas` não é recriada** —
`timezone` já está na projeção pública e é tudo de que a vigência precisa. Nenhum job/cron de
expiração: a vigência é avaliada por request.

## Reuso esperado

- `tests/helpers/pglite.ts` — `createTestDb()`, `asAnon`/`asUser`/`asService`; não escrever helper novo.
- `public.loja_esta_ativa(loja_id)` — já existe e é **obrigatória** na policy pública:
  `EXISTS` direto em `lojas` devolveria zero linhas sob a RLS do `anon` e quebraria a vitrine
  em silêncio (`seguranca.md` §2).
- Convenção de CHECK inline em vez de `CREATE TYPE` (`schema.md` §5), como `cupons.tipo` e
  `produtos_desconto_tipo_check` (issue 219).
- O `loja_id` redundante e o par de políticas leitura própria / escrita própria já usados em
  `categoria_produto_opcionais` e `cupons`.

## Segurança

- Tabela **nova** ⇒ RLS obrigatória antes de produção (`seguranca.md` §2). Não é opcional
  e não é "depois".
- Cardápio **inativo** é estratégia comercial do lojista (o rascunho "Cardápio de Natal" em
  setembro): a policy pública filtra `ativo = true`, mesma preocupação que impede SELECT
  público em `cupons`.
- `23514` e `23503` nunca viram texto na UI: mensagem genérica, detalhe no log (§14).
- **A policy não é a autoridade da janela** e não tenta ser — replicar aritmética de dia/hora/fuso
  em SQL seria a segunda implementação da regra e a primeira a divergir (RN-06).
- `npx supabase db push` é irreversível e exige autorização humana — não é critério desta issue.

## Critério de aceite

- [ ] teste **vermelho** escrito e `FAIL` capturado antes de a migration existir (fatia 1);
- [ ] o RED afirma, além do SQLSTATE, o **nome da constraint** em cada recusa de CHECK —
      trava de escopo checada só pelo código do erro passa por acidente aritmético;
- [ ] `anon` lê o cardápio ativo e **não** lê o inativo da mesma loja;
- [ ] lojista A recebe zero linhas ao ler cardápio da loja B e é recusado ao escrever nela;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
