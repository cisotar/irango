import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * [270] `cardapioPertenceALoja` (`src/lib/supabase/queries/cardapios.ts`) é a
 * prova de POSSE que fecha a brecha do `ON CONFLICT DO NOTHING`: `select id`
 * escopado por `.eq("loja_id", lojaId).eq("id", cardapioId)`. O contrato da
 * FORMA da query já está travado em `cardapios.test.ts` (client mockado); este
 * arquivo prova o que o mock não alcança — que, sob POSTGRES REAL com as
 * policies de `cardapios` aplicadas (20260920128000), o resultado do PADRÃO
 * EXATO da query é o mesmo tanto sob `service_role` (o caminho admin, BYPASSRLS)
 * quanto sob um lojista autenticado (o caminho do lojista, RLS ligada) — e por
 * que o `.eq("loja_id")` explícito não é dispensável.
 *
 * O ponto que a suíte mockada não pode provar: `cardapios_leitura_publica`
 * (`ativo = true and loja_esta_ativa(...)`) é uma policy PERMISSIVA que
 * qualquer role autenticada enxerga — inclusive o dono de OUTRA loja. Sem o
 * `.eq("loja_id", lojaId)` explícito, um `select id from cardapios where id =
 * $1` como o dono A leria o cardápio ATIVO da loja B e devolveria posse
 * FALSA. O `.eq("loja_id")` é o que faz a resposta ser `false` mesmo quando a
 * linha é visível pela RLS — é essa concordância (RLS deixa passar, o filtro
 * explícito barra) que os testes abaixo travam.
 */

const DONO_A = "a2700000-0000-4000-8000-000000000001";
const DONO_B = "b2700000-0000-4000-8000-000000000002";

/** O padrão exato de `cardapioPertenceALoja`: select id, dois `.eq`, maybeSingle. */
const QUERY_POSSE = `select id from public.cardapios where loja_id = $1 and id = $2`;

describe("270 — cardapioPertenceALoja sob Postgres real: RLS e .eq('loja_id') concordam", () => {
  let t: TestDb;
  let lojaA: string;
  let lojaB: string;
  let cardapioAAtivo: string;
  let cardapioAInativo: string;
  let cardapioBAtivo: string;
  let cardapioBInativo: string;

  beforeAll(async () => {
    t = await createTestDb();
    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-270@teste.local'),
         ($2, 'dono-b-270@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B],
    );

    await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-270', 'Loja A', true),
           ($2, 'loja-b-270', 'Loja B', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const inserirCardapio = async (lojaId: string, ativo: boolean) => {
        const r = await db.query<{ id: string }>(
          `insert into public.cardapios (loja_id, nome, ativo, modo, dias_semana)
           values ($1, 'Card 270', $2, 'recorrente', array[1]::smallint[])
           returning id`,
          [lojaId, ativo],
        );
        return r.rows[0].id;
      };

      cardapioAAtivo = await inserirCardapio(lojaA, true);
      cardapioAInativo = await inserirCardapio(lojaA, false);
      cardapioBAtivo = await inserirCardapio(lojaB, true);
      cardapioBInativo = await inserirCardapio(lojaB, false);
    });
  }, 120_000);

  afterAll(async () => {
    await t.close();
  });

  it("service_role (admin): cardápio da PRÓPRIA loja-alvo ⇒ 1 linha", async () => {
    const r = await t.asService((db) =>
      db.query(QUERY_POSSE, [lojaA, cardapioAAtivo]),
    );
    expect(r.rows).toHaveLength(1);
  });

  it("service_role (admin): cardápio de OUTRA loja (mesmo ativo) ⇒ 0 linhas — BYPASSRLS não ajuda o alheio", async () => {
    const ativo = await t.asService((db) => db.query(QUERY_POSSE, [lojaA, cardapioBAtivo]));
    const inativo = await t.asService((db) => db.query(QUERY_POSSE, [lojaA, cardapioBInativo]));
    expect(ativo.rows).toHaveLength(0);
    expect(inativo.rows).toHaveLength(0);
  });

  it("lojista autenticado: cardápio PRÓPRIO ⇒ 1 linha, mesmo INATIVO (leitura_propria não olha `ativo`)", async () => {
    const ativo = await t.asUser(DONO_A, (db) => db.query(QUERY_POSSE, [lojaA, cardapioAAtivo]));
    const inativo = await t.asUser(DONO_A, (db) =>
      db.query(QUERY_POSSE, [lojaA, cardapioAInativo]),
    );
    expect(ativo.rows).toHaveLength(1);
    // Posse não é "está no ar": um rascunho de temporada inativo continua SEU.
    expect(inativo.rows).toHaveLength(1);
  });

  it("lojista autenticado: cardápio de OUTRA loja ⇒ 0 linhas, MESMO quando `cardapios_leitura_publica` o tornaria visível", async () => {
    // cardapioBAtivo É lido por qualquer role via `cardapios_leitura_publica`
    // (loja B ativa, cardápio ativo) — mas o `.eq("loja_id", lojaA)` é um
    // predicado de WHERE, não uma checagem de RLS, e a linha física tem
    // `loja_id = lojaB`. A recusa aqui não depende de a RLS negar a linha.
    const ativo = await t.asUser(DONO_A, (db) => db.query(QUERY_POSSE, [lojaA, cardapioBAtivo]));
    const inativo = await t.asUser(DONO_A, (db) =>
      db.query(QUERY_POSSE, [lojaA, cardapioBInativo]),
    );
    expect(ativo.rows).toHaveLength(0);
    expect(inativo.rows).toHaveLength(0);
  });

  it("DOCUMENTAÇÃO: sem o `.eq('loja_id')`, a RLS sozinha deixaria o dono A ler o cardápio ATIVO da loja B", async () => {
    // Não é o padrão de `cardapioPertenceALoja` (que SEMPRE inclui o
    // loja_id) — é a prova de que a proteção real é o predicado explícito, e
    // não a RLS: `cardapios_leitura_publica` é permissiva e não distingue
    // "dono" de "qualquer autenticado". Se um refactor futuro trocasse o
    // `.eq("loja_id", lojaId).eq("id", cardapioId)` por só `.eq("id",
    // cardapioId)` confiando na RLS, a posse de um cardápio ATIVO alheio
    // voltaria a ser reportada como verdadeira.
    const semFiltroDeLoja = await t.asUser(DONO_A, (db) =>
      db.query(`select id from public.cardapios where id = $1`, [cardapioBAtivo]),
    );
    expect(semFiltroDeLoja.rows).toHaveLength(1);
  });

  it("anon: nenhum papel sem sessão passa pelo caminho de posse (nem público nem próprio sem loja_id casando)", async () => {
    // anon não tem `auth.uid()`, então `cardapios_leitura_propria` nunca
    // casa; só o cardápio ATIVO da PRÓPRIA loja-alvo (que aqui é sempre A)
    // aparece, e o alheio nem sequer entra em jogo porque o filtro de
    // loja_id já corta.
    const proprioAtivo = await t.asAnon((db) => db.query(QUERY_POSSE, [lojaA, cardapioAAtivo]));
    const proprioInativo = await t.asAnon((db) =>
      db.query(QUERY_POSSE, [lojaA, cardapioAInativo]),
    );
    expect(proprioAtivo.rows).toHaveLength(1);
    // Rascunho inativo não é público — nem para a própria loja-alvo do filtro.
    expect(proprioInativo.rows).toHaveLength(0);
  });
});
