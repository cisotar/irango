import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 300 — tabelas `public.modais_sazonais`,
 * `public.modal_sazonal_categorias`, `public.modal_sazonal_cardapios` com RLS,
 * GRANTs, CHECK de janela ordenada, FKs compostas cross-tenant e o índice único
 * parcial "um ativo por loja" (spec `specs/modal-divulgacao-sazonal.md`,
 * §Modelos de Dados e §Segurança; RN-02, RN-03, RN-05, RN-11).
 *
 * Escrito a partir da ISSUE e do SPEC, nunca do SQL. Molde:
 * `cardapios_checks_vigencia_rls.test.ts`. O que precisa ficar provado:
 *
 *  1. `anon` lê modal ATIVO de loja ATIVA; NÃO lê rascunho (`ativo = false`);
 *     NÃO lê modal de loja INATIVA (RN-03);
 *  2. dono lê os próprios (inclusive rascunhos); NÃO lê rascunho de outra loja e
 *     NÃO escreve na loja B (RLS);
 *  3. INSERT forjando `loja_id` alheio é barrado pelo WITH CHECK;
 *  4. segundo modal `ativo = true` na mesma loja é recusado (23505) — inclusive
 *     sob service_role (índice único parcial, RN-05);
 *  5. vincular categoria/cardápio de OUTRA loja à junção viola a FK composta
 *     (23503) — vetor cross-tenant estrutural impossível (RN-11);
 *  6. `exibicao_fim <= exibicao_inicio` é recusado (23514 · modais_sazonais_janela_ordem).
 *
 * Anti-falso-verde (padrão de cardapios_checks_vigencia_rls.test.ts):
 *  - negação NUNCA é aceita por "relation does not exist": a recusa exige o nome
 *    da constraint, o SQLSTATE, ou o fragmento de RLS;
 *  - toda escrita negada é reconferida via asService (BYPASSRLS) contra a linha
 *    real, para distinguir "recusou" de "escreveu em silêncio".
 *
 * Nenhum código de produção é escrito aqui. Quem deixa verde é a migration.
 */

const DONO_A = "a3000000-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "b3000000-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
/** Dono da loja DESLIGADA — `lojas_dono_unico` permite uma loja por dono. */
const DONO_C = "c3000000-cccc-cccc-cccc-cccccccccccc";

const INICIO = "2026-06-01T00:00:00-03:00";
const FIM = "2026-06-16T00:00:00-03:00";

type Cenario = {
  lojaA: string;
  lojaB: string;
  /** Modal ATIVO da loja A (público por desenho). */
  modalAtivoA: string;
  /** Modal INATIVO da loja A — rascunho, não pode vazar. */
  modalRascunhoA: string;
  /** Modal ATIVO da loja B. */
  modalAtivoB: string;
  /** Modal INATIVO da loja B — rascunho. */
  modalRascunhoB: string;
  categoriaA: string;
  categoriaB: string;
  cardapioA: string;
  cardapioB: string;
};

/** Escrita que DEVE ser recusada pelo banco — devolve a mensagem do erro. */
async function erroDe(t: TestDb, sql: string, params: unknown[] = []): Promise<string> {
  try {
    await t.asService(async (db) => db.query(sql, params));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Esperava recusa do banco, mas a escrita PASSOU: ${sql}`);
}

/** Mesma coisa, mas como lojista logado (RLS ligada). */
async function erroDoLojista(
  t: TestDb,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  try {
    await t.asUser(userId, async (db) => db.query(sql, params));
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`Esperava recusa da RLS, mas a escrita PASSOU: ${sql}`);
}

const INSERT_MODAL = `
  insert into public.modais_sazonais
    (loja_id, titulo, ativo, exibicao_inicio, exibicao_fim)
  values ($1, $2, $3, $4, $5)
  returning id`;

describe("300 · modais_sazonais + junções: RLS, FK composta, índice único parcial", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();

    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-300@teste.local'),
         ($2, 'dono-b-300@teste.local'),
         ($3, 'dono-c-300@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B, DONO_C],
    );

    c = await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-modal-300', 'Loja A', true),
           ($2, 'loja-b-modal-300', 'Loja B', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const categorias = await db.query<{ id: string; loja_id: string }>(
        `insert into public.categorias (loja_id, nome) values
           ($1, 'Categoria A'),
           ($2, 'Categoria B')
         returning id, loja_id`,
        [lojaA, lojaB],
      );
      const categoriaA = categorias.rows.find((r) => r.loja_id === lojaA)!.id;
      const categoriaB = categorias.rows.find((r) => r.loja_id === lojaB)!.id;

      const cardapios = await db.query<{ id: string; loja_id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim) values
           ($1, 'Cardapio A', 'recorrente', array[6]::smallint[], time '11:00', time '15:00'),
           ($2, 'Cardapio B', 'recorrente', array[6]::smallint[], time '11:00', time '15:00')
         returning id, loja_id`,
        [lojaA, lojaB],
      );
      const cardapioA = cardapios.rows.find((r) => r.loja_id === lojaA)!.id;
      const cardapioB = cardapios.rows.find((r) => r.loja_id === lojaB)!.id;

      const modais = await db.query<{ id: string; titulo: string }>(
        `insert into public.modais_sazonais
           (loja_id, titulo, ativo, exibicao_inicio, exibicao_fim) values
           ($1, 'Modal ativo A',    true,  $3, $4),
           ($1, 'Modal rascunho A', false, $3, $4),
           ($2, 'Modal ativo B',    true,  $3, $4),
           ($2, 'Modal rascunho B', false, $3, $4)
         returning id, titulo`,
        [lojaA, lojaB, INICIO, FIM],
      );
      const porTitulo = (tt: string) => modais.rows.find((r) => r.titulo === tt)!.id;

      return {
        lojaA,
        lojaB,
        modalAtivoA: porTitulo("Modal ativo A"),
        modalRascunhoA: porTitulo("Modal rascunho A"),
        modalAtivoB: porTitulo("Modal ativo B"),
        modalRascunhoB: porTitulo("Modal rascunho B"),
        categoriaA,
        categoriaB,
        cardapioA,
        cardapioB,
      };
    });
  });

  afterAll(async () => {
    await t.close();
  });

  // ─────────────────────────────────── estrutura: constraints / índices

  it("modais_sazonais tem a unique composta modais_sazonais_id_loja_unico (alvo das FKs compostas)", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ contype: string }>(
        `select contype from pg_constraint
          where conrelid = 'public.modais_sazonais'::regclass
            and conname = 'modais_sazonais_id_loja_unico'`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].contype).toBe("u");
  });

  it("existe o índice único PARCIAL modais_sazonais_um_ativo_por_loja (WHERE ativo)", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname = 'public'
            and indexname = 'modais_sazonais_um_ativo_por_loja'`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].indexdef.toLowerCase()).toContain("unique");
    expect(r.rows[0].indexdef.toLowerCase()).toContain("where");
    expect(r.rows[0].indexdef.toLowerCase()).toContain("ativo");
  });

  it("nasce com ativo, mostrar_promocoes_junto default false", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ ativo: boolean; mostrar_promocoes_junto: boolean }>(
        `insert into public.modais_sazonais (loja_id, titulo, exibicao_inicio, exibicao_fim)
         values ($1, 'Modal com defaults', $2, $3)
         returning ativo, mostrar_promocoes_junto`,
        [c.lojaA, INICIO, FIM],
      ),
    );
    expect(r.rows[0].ativo).toBe(false);
    expect(r.rows[0].mostrar_promocoes_junto).toBe(false);
  });

  // ─────────────────────────────────── CHECK · janela ordenada (RN-08)

  it("[RN-08] exibicao_fim IGUAL a exibicao_inicio é recusado por modais_sazonais_janela_ordem", async () => {
    const msg = await erroDe(t, INSERT_MODAL, [
      c.lojaA,
      "Janela de duração zero",
      false,
      INICIO,
      INICIO,
    ]);
    expect(msg).toContain("modais_sazonais_janela_ordem");
  });

  it("[RN-08] exibicao_fim ANTES de exibicao_inicio é recusado por modais_sazonais_janela_ordem", async () => {
    const msg = await erroDe(t, INSERT_MODAL, [c.lojaA, "Janela invertida", false, FIM, INICIO]);
    expect(msg).toContain("modais_sazonais_janela_ordem");
  });

  // ─────────────────────────────────── índice único parcial (RN-05)

  it("[RN-05] segundo modal ativo na mesma loja é recusado (23505), inclusive sob service_role", async () => {
    // A loja A já tem o modalAtivoA. Um segundo ativo colide no índice parcial —
    // defesa estrutural que vale mesmo sob BYPASSRLS.
    const msg = await erroDe(t, INSERT_MODAL, [
      c.lojaA,
      "Segundo modal ativo",
      true,
      INICIO,
      FIM,
    ]);
    expect(msg.toLowerCase()).toContain("modais_sazonais_um_ativo_por_loja");
  });

  it("[RN-05] dois RASCUNHOS na mesma loja convivem (índice é parcial, só WHERE ativo)", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ id: string }>(INSERT_MODAL, [
        c.lojaA,
        "Outro rascunho A",
        false,
        INICIO,
        FIM,
      ]),
    );
    expect(r.rows[0].id).toBeTruthy();
  });

  // ─────────────────────────────────── RLS · anon (RN-02/RN-03)

  it("[RN-02] anon LÊ o modal ativo de loja ativa", async () => {
    const r = await t.asAnon(async (db) =>
      db.query<{ id: string }>(`select id from public.modais_sazonais where id = $1`, [
        c.modalAtivoA,
      ]),
    );
    expect(r.rows).toHaveLength(1);
  });

  it("[RN-03] anon NÃO lê o modal rascunho (ativo=false) da mesma loja ativa", async () => {
    const r = await t.asAnon(async (db) =>
      db.query<{ id: string }>(`select id from public.modais_sazonais where id = $1`, [
        c.modalRascunhoA,
      ]),
    );
    expect(r.rows).toHaveLength(0);

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.modais_sazonais where id = $1`, [c.modalRascunhoA]),
    );
    expect(real.rows).toHaveLength(1);
  });

  it("[RN-03] anon NÃO faz INSERT em modais_sazonais", async () => {
    let msg = "";
    try {
      await t.asAnon(async (db) => db.query(INSERT_MODAL, [c.lojaA, "Modal do anon", false, INICIO, FIM]));
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/row-level security|permission denied/i);

    const sobrou = await t.asService(async (db) =>
      db.query(`select 1 from public.modais_sazonais where titulo = 'Modal do anon'`),
    );
    expect(sobrou.rows).toHaveLength(0);
  });

  // ─────────────────────────────────── RLS · lojista A vs loja B

  it("[RN-02 dono] lojista A lê os PRÓPRIOS modais, inclusive o rascunho", async () => {
    const r = await t.asUser(DONO_A, async (db) =>
      db.query<{ id: string }>(
        `select id from public.modais_sazonais where loja_id = $1 order by titulo`,
        [c.lojaA],
      ),
    );
    // Ao menos o ativo e o rascunho iniciais (+ os criados nos testes acima).
    const ids = r.rows.map((row) => row.id);
    expect(ids).toContain(c.modalAtivoA);
    expect(ids).toContain(c.modalRascunhoA);
  });

  it("lojista A lê ZERO linhas do modal RASCUNHO da loja B", async () => {
    const r = await t.asUser(DONO_A, async (db) =>
      db.query<{ id: string }>(`select id from public.modais_sazonais where id = $1`, [
        c.modalRascunhoB,
      ]),
    );
    expect(r.rows).toHaveLength(0);

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.modais_sazonais where id = $1`, [c.modalRascunhoB]),
    );
    expect(real.rows).toHaveLength(1);
  });

  it("lojista A NÃO cria modal na loja B", async () => {
    const msg = await erroDoLojista(t, DONO_A, INSERT_MODAL, [
      c.lojaB,
      "Invasao da loja B",
      false,
      INICIO,
      FIM,
    ]);
    expect(msg).toMatch(/row-level security/i);

    const sobrou = await t.asService(async (db) =>
      db.query(`select 1 from public.modais_sazonais where titulo = 'Invasao da loja B'`),
    );
    expect(sobrou.rows).toHaveLength(0);
  });

  it("lojista A NÃO edita nem remove modal da loja B", async () => {
    const r = await t.asUser(DONO_A, async (db) => {
      const up = await db.query(
        `update public.modais_sazonais set titulo = 'sequestrado' where id = $1`,
        [c.modalAtivoB],
      );
      const del = await db.query(`delete from public.modais_sazonais where id = $1`, [
        c.modalRascunhoB,
      ]);
      return { up: up.affectedRows ?? 0, del: del.affectedRows ?? 0 };
    });
    expect(r).toEqual({ up: 0, del: 0 });

    const real = await t.asService(async (db) =>
      db.query<{ titulo: string }>(
        `select titulo from public.modais_sazonais where id = any($1::uuid[]) order by titulo`,
        [[c.modalAtivoB, c.modalRascunhoB]],
      ),
    );
    expect(real.rows.map((l) => l.titulo)).toEqual(["Modal ativo B", "Modal rascunho B"]);
  });

  it("lojista A NÃO move um modal próprio para a loja B (WITH CHECK)", async () => {
    const msg = await erroDoLojista(
      t,
      DONO_A,
      `update public.modais_sazonais set loja_id = $1 where id = $2`,
      [c.lojaB, c.modalRascunhoA],
    );
    expect(msg).toMatch(/row-level security/i);

    const real = await t.asService(async (db) =>
      db.query<{ loja_id: string }>(`select loja_id from public.modais_sazonais where id = $1`, [
        c.modalRascunhoA,
      ]),
    );
    expect(real.rows[0].loja_id).toBe(c.lojaA);
  });

  it("lojista A cria, edita e remove modal da PRÓPRIA loja", async () => {
    const id = await t.asUser(DONO_A, async (db) => {
      const ins = await db.query<{ id: string }>(INSERT_MODAL, [
        c.lojaA,
        "Modal proprio da A",
        false,
        INICIO,
        FIM,
      ]);
      return ins.rows[0].id;
    });
    expect(id).toBeTruthy();

    await t.asUser(DONO_A, async (db) => {
      const up = await db.query(
        `update public.modais_sazonais set titulo = 'renomeado' where id = $1`,
        [id],
      );
      expect(up.affectedRows).toBe(1);
      const del = await db.query(`delete from public.modais_sazonais where id = $1`, [id]);
      expect(del.affectedRows).toBe(1);
    });

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.modais_sazonais where id = $1`, [id]),
    );
    expect(real.rows).toHaveLength(0);
  });

  it("modal de loja INATIVA não é lido por anon nem quando ativo = true", async () => {
    const modal = await t.asService(async (db) => {
      const l = await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, 'loja-desligada-300', 'Loja desligada', false) returning id`,
        [DONO_C],
      );
      const m = await db.query<{ id: string }>(INSERT_MODAL, [
        l.rows[0].id,
        "Modal da loja desligada",
        true,
        INICIO,
        FIM,
      ]);
      return m.rows[0].id;
    });

    const r = await t.asAnon(async (db) =>
      db.query(`select 1 from public.modais_sazonais where id = $1`, [modal]),
    );
    expect(r.rows).toHaveLength(0);
  });

  // ─────────────────────────────────── FK composta cross-tenant (RN-11)

  it("[RN-11] modal_sazonal_categorias: categoria de OUTRA loja viola a FK composta (23503)", async () => {
    // Modal da loja A + categoria da loja B, declarando loja_id = A. A FK composta
    // (categoria_id, loja_id) → categorias(id, loja_id) não acha o par (categoriaB, A).
    const msg = await erroDe(
      t,
      `insert into public.modal_sazonal_categorias (loja_id, modal_sazonal_id, categoria_id)
       values ($1, $2, $3)`,
      [c.lojaA, c.modalAtivoA, c.categoriaB],
    );
    expect(msg).toMatch(/foreign key|violates foreign key|23503|msc_categoria_fk/i);
  });

  it("[RN-11] modal_sazonal_categorias aceita categoria da MESMA loja", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ id: string }>(
        `insert into public.modal_sazonal_categorias (loja_id, modal_sazonal_id, categoria_id)
         values ($1, $2, $3) returning id`,
        [c.lojaA, c.modalAtivoA, c.categoriaA],
      ),
    );
    expect(r.rows[0].id).toBeTruthy();
  });

  it("[RN-11] modal_sazonal_cardapios: cardápio de OUTRA loja viola a FK composta (23503)", async () => {
    const msg = await erroDe(
      t,
      `insert into public.modal_sazonal_cardapios (loja_id, modal_sazonal_id, cardapio_id)
       values ($1, $2, $3)`,
      [c.lojaA, c.modalAtivoA, c.cardapioB],
    );
    expect(msg).toMatch(/foreign key|violates foreign key|23503|mscard_cardapio_fk/i);
  });

  it("[RN-11] modal_sazonal_cardapios aceita cardápio da MESMA loja", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ id: string }>(
        `insert into public.modal_sazonal_cardapios (loja_id, modal_sazonal_id, cardapio_id)
         values ($1, $2, $3) returning id`,
        [c.lojaA, c.modalAtivoA, c.cardapioA],
      ),
    );
    expect(r.rows[0].id).toBeTruthy();
  });

  it("ON DELETE CASCADE: remover o modal derruba os vínculos das junções", async () => {
    const modal = await t.asService(async (db) => {
      const m = await db.query<{ id: string }>(INSERT_MODAL, [
        c.lojaA,
        "Modal para cascatear",
        false,
        INICIO,
        FIM,
      ]);
      const id = m.rows[0].id;
      await db.query(
        `insert into public.modal_sazonal_categorias (loja_id, modal_sazonal_id, categoria_id)
         values ($1, $2, $3)`,
        [c.lojaA, id, c.categoriaA],
      );
      await db.query(`delete from public.modais_sazonais where id = $1`, [id]);
      return id;
    });

    const sobrou = await t.asService(async (db) =>
      db.query(`select 1 from public.modal_sazonal_categorias where modal_sazonal_id = $1`, [modal]),
    );
    expect(sobrou.rows).toHaveLength(0);
  });

  // ─────────────────────────────────── RLS das junções · anon

  it("anon lê o vínculo de junção de loja ativa; NÃO lê o de loja inativa", async () => {
    // Vínculo da loja A (ativa) já inserido nos testes acima é legível por anon.
    const legivel = await t.asAnon(async (db) =>
      db.query(
        `select 1 from public.modal_sazonal_categorias where loja_id = $1 and categoria_id = $2`,
        [c.lojaA, c.categoriaA],
      ),
    );
    expect(legivel.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("anon NÃO escreve nas junções", async () => {
    let msg = "";
    try {
      await t.asAnon(async (db) =>
        db.query(
          `insert into public.modal_sazonal_categorias (loja_id, modal_sazonal_id, categoria_id)
           values ($1, $2, $3)`,
          [c.lojaA, c.modalAtivoA, c.categoriaA],
        ),
      );
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/row-level security|permission denied/i);
  });
});
