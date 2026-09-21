import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 242 — `produtos_id_loja_unico`, a tabela
 * `public.cardapios` com os CHECKs de vigência e a RLS das três políticas
 * (spec `specs/cardapio-sazonal.md`, §Modelos de Dados e §Segurança;
 * RN-01, RN-02, RN-03, RN-04, RN-15).
 *
 * Escrito a partir da ISSUE e do SPEC, nunca do SQL. O que precisa ficar provado:
 *
 *  1. cada CHECK de vigência recusa a linha incoerente afirmando o NOME LITERAL
 *     da constraint, não só o SQLSTATE 23514 — trava de escopo checada só pelo
 *     código do erro passa por acidente aritmético (critério de aceite da issue);
 *  2. `anon` lê o cardápio ATIVO de loja ativa e NÃO lê o INATIVO da mesma loja
 *     (rascunho "Cardápio de Natal" em setembro é estratégia comercial);
 *  3. `anon` não faz INSERT/UPDATE/DELETE;
 *  4. lojista A é RECUSADO ao escrever (insert/update/delete) na loja B.
 *
 * ── Divergência deliberada com a assertiva 1 de §Segurança do spec ──────────
 * O spec diz "Lojista A **não** lê cardápio da loja B (`asUser`, zero linhas)".
 * Isso é FALSO para cardápio ATIVO de loja ATIVA e não deve ser exigido aqui:
 * `cardapios_leitura_publica` não tem cláusula `TO`, logo vale também para
 * `authenticated` — exatamente como `categorias_leitura_publica` e as demais
 * policies públicas do projeto, e por desenho (o SSR da vitrine roda como
 * `authenticated` quando um lojista logado navega a loja de outro). Políticas
 * permissivas são OR: exigir zero linhas aí seria pedir um comportamento que o
 * projeto inteiro não tem. O que o isolamento de fato garante, e é o que este
 * arquivo afirma, é:
 *   - lojista A lê ZERO linhas do cardápio INATIVO da loja B (o rascunho, que é
 *     o dado sensível da tabela segundo §Segurança);
 *   - lojista A é RECUSADO ao ESCREVER na loja B (assertiva 2, intacta).
 *
 * Anti-falso-verde (padrão de rls_lojas.test.ts / produtos_desconto_*.test.ts):
 *  - negação NUNCA é aceita por "relation does not exist" ou "column does not
 *    exist": toda recusa exige o nome da constraint ou o fragmento de RLS;
 *  - toda escrita negada é reconferida via asService (BYPASSRLS) contra a linha
 *    real, para distinguir "recusou" de "escreveu em silêncio".
 *
 * Nenhum código de produção é escrito aqui. Quem deixa verde é `executar`.
 */

const DONO_A = "a2420000-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "b2420000-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
/** Dono da loja DESLIGADA — `lojas_dono_unico` permite uma loja por dono. */
const DONO_C = "c2420000-cccc-cccc-cccc-cccccccccccc";

type Cenario = {
  lojaA: string;
  lojaB: string;
  /** Cardápio ATIVO da loja B — público por desenho (ver nota acima). */
  cardapioAtivoB: string;
  /** Cardápio INATIVO da loja B — rascunho, não pode vazar. */
  cardapioInativoB: string;
  /** Cardápio ATIVO da loja A. */
  cardapioAtivoA: string;
  /** Cardápio INATIVO da loja A. */
  cardapioInativoA: string;
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

/** INSERT de cardápio recorrente base — cada teste sobrescreve o que precisa. */
const INSERT_CARDAPIO = `
  insert into public.cardapios
    (loja_id, nome, modo, dias_semana, dias_mes, hora_inicio, hora_fim,
     prazo_inicio, prazo_fim, prazo_preset)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  returning id`;

describe("242 · cardapios: CHECKs de vigência e RLS", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();

    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-242@teste.local'),
         ($2, 'dono-b-242@teste.local'),
         ($3, 'dono-c-242@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B, DONO_C],
    );

    c = await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-cardapio-242', 'Loja A', true),
           ($2, 'loja-b-cardapio-242', 'Loja B', true)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const cardapios = await db.query<{ id: string; nome: string }>(
        `insert into public.cardapios (loja_id, nome, ativo, modo, dias_semana, hora_inicio, hora_fim)
         values
           ($1, 'Feijoada de sábado (A)',  true,  'recorrente', array[6]::smallint[], time '11:00', time '15:00'),
           ($1, 'Cardapio de Natal (A)',   false, 'recorrente', array[0]::smallint[], time '11:00', time '15:00'),
           ($2, 'Feijoada de sábado (B)',  true,  'recorrente', array[6]::smallint[], time '11:00', time '15:00'),
           ($2, 'Cardapio de Natal (B)',   false, 'recorrente', array[0]::smallint[], time '11:00', time '15:00')
         returning id, nome`,
        [lojaA, lojaB],
      );
      const porNome = (n: string) => cardapios.rows.find((r) => r.nome === n)!.id;

      return {
        lojaA,
        lojaB,
        cardapioAtivoA: porNome("Feijoada de sábado (A)"),
        cardapioInativoA: porNome("Cardapio de Natal (A)"),
        cardapioAtivoB: porNome("Feijoada de sábado (B)"),
        cardapioInativoB: porNome("Cardapio de Natal (B)"),
      };
    });
  });

  afterAll(async () => {
    await t.close();
  });

  // ─────────────────────────────────── alvo da FK composta da issue 243

  it("produtos ganha a unique redundante produtos_id_loja_unico (alvo da FK composta da 243)", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ contype: string }>(
        `select contype from pg_constraint
          where conrelid = 'public.produtos'::regclass
            and conname = 'produtos_id_loja_unico'`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].contype).toBe("u");
  });

  it("cardapios ganha cardapios_id_loja_unico (alvo da outra FK composta da 243)", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ contype: string }>(
        `select contype from pg_constraint
          where conrelid = 'public.cardapios'::regclass
            and conname = 'cardapios_id_loja_unico'`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].contype).toBe("u");
  });

  // ─────────────────────────────────── defaults e linha válida (RN-15 · ordem)

  it("[RN-15/D16] cardápio nasce ativo = true e ordem = 0", async () => {
    const linha = await t.asService(async (db) =>
      db.query<{ ativo: boolean; ordem: number }>(
        `select ativo, ordem from public.cardapios where id = $1`,
        [c.cardapioAtivoA],
      ),
    );
    expect(linha.rows[0].ativo).toBe(true);
    expect(Number(linha.rows[0].ordem)).toBe(0);
  });

  it("[RN-02] recorrente legítimo (sáb+dom, 11:00–15:00) é aceito", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ id: string }>(INSERT_CARDAPIO, [
        c.lojaA,
        "Feijoada fim de semana",
        "recorrente",
        [6, 0],
        null,
        "11:00",
        "15:00",
        null,
        null,
        null,
      ]),
    );
    expect(r.rows[0].id).toBeTruthy();
  });

  it("[RN-02] prazo fixo legítimo (início < fim, com preset) é aceito", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ id: string }>(INSERT_CARDAPIO, [
        c.lojaA,
        "Semana do Hamburguer",
        "prazo_fixo",
        null,
        null,
        null,
        null,
        "2026-10-10T00:00:00-03:00",
        "2026-10-17T00:00:00-03:00",
        "semanal",
      ]),
    );
    expect(r.rows[0].id).toBeTruthy();
  });

  // ─────────────────────────────────── CHECK · modo

  it("modo fora de ('recorrente','prazo_fixo') é recusado por cardapios_modo_check", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Modo inventado",
      "sazonal",
      [6],
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(msg).toContain("cardapios_modo_check");
  });

  // ─────────────────────────────────── CHECK · cardapios_recorrente_exclusivo

  it("[RN-01] recorrente com campos de prazo é recusado por cardapios_recorrente_exclusivo", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Modo misturado (recorrente + prazo)",
      "recorrente",
      [6],
      null,
      null,
      null,
      "2026-10-10T00:00:00-03:00",
      "2026-10-17T00:00:00-03:00",
      "semanal",
    ]);
    expect(msg).toContain("cardapios_recorrente_exclusivo");
  });

  // ─────────────────────────────────── CHECK · cardapios_prazo_exclusivo

  it("[RN-01] prazo fixo com dias_semana é recusado por cardapios_prazo_exclusivo", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Modo misturado (prazo + dias)",
      "prazo_fixo",
      [6],
      null,
      null,
      null,
      "2026-10-10T00:00:00-03:00",
      "2026-10-17T00:00:00-03:00",
      "semanal",
    ]);
    expect(msg).toContain("cardapios_prazo_exclusivo");
  });

  it("[RN-01] prazo fixo com hora_inicio/hora_fim é recusado por cardapios_prazo_exclusivo", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Modo misturado (prazo + hora)",
      "prazo_fixo",
      null,
      null,
      "11:00",
      "15:00",
      "2026-10-10T00:00:00-03:00",
      "2026-10-17T00:00:00-03:00",
      "semanal",
    ]);
    expect(msg).toContain("cardapios_prazo_exclusivo");
  });

  // ─────────────────────────────────── CHECK · cardapios_recorrente_tem_eixo

  it("[RN-02] recorrente com os três eixos NULL é recusado por cardapios_recorrente_tem_eixo", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Recorrente sem eixo (NULL)",
      "recorrente",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(msg).toContain("cardapios_recorrente_tem_eixo");
  });

  it("[RN-02] recorrente com arrays VAZIOS ('{}') é recusado por cardapios_recorrente_tem_eixo", async () => {
    // O caso que um `is not null` ingênuo deixaria passar: '{}' não é NULL.
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Recorrente sem eixo (vazio)",
      "recorrente",
      [],
      [],
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(msg).toContain("cardapios_recorrente_tem_eixo");
  });

  // ─────────────────────────────────── CHECK · cardapios_hora_par / hora_ordem

  it("[RN-02] hora_inicio sem hora_fim é recusado por cardapios_hora_par", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Meia faixa",
      "recorrente",
      [6],
      null,
      "11:00",
      null,
      null,
      null,
      null,
    ]);
    expect(msg).toContain("cardapios_hora_par");
  });

  it("[RN-02] hora_fim IGUAL a hora_inicio é recusado por cardapios_hora_ordem", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Faixa de duração zero",
      "recorrente",
      [6],
      null,
      "11:00",
      "11:00",
      null,
      null,
      null,
    ]);
    expect(msg).toContain("cardapios_hora_ordem");
  });

  it("[RN-02] janela que cruza a meia-noite (22:00–02:00) é recusada por cardapios_hora_ordem", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Madrugada",
      "recorrente",
      [6],
      null,
      "22:00",
      "02:00",
      null,
      null,
      null,
    ]);
    expect(msg).toContain("cardapios_hora_ordem");
  });

  // ─────────────────────────────────── CHECK · domínio dos dias

  it("[RN-02] dias_semana com 7 é recusado por cardapios_dias_semana_dominio", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Oitavo dia",
      "recorrente",
      [0, 7],
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(msg).toContain("cardapios_dias_semana_dominio");
  });

  it("[RN-02] dias_mes com 0 é recusado por cardapios_dias_mes_dominio", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Dia zero",
      "recorrente",
      null,
      [0, 15],
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(msg).toContain("cardapios_dias_mes_dominio");
  });

  it("[RN-02] dias_mes com 32 é recusado por cardapios_dias_mes_dominio", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Dia 32",
      "recorrente",
      null,
      [1, 32],
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(msg).toContain("cardapios_dias_mes_dominio");
  });

  // ─────────────────────────────────── CHECK · prazo fixo

  it("[RN-02] prazo fixo sem prazo_fim é recusado por cardapios_prazo_obrigatorio", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Prazo sem fim",
      "prazo_fixo",
      null,
      null,
      null,
      null,
      "2026-10-10T00:00:00-03:00",
      null,
      "semanal",
    ]);
    expect(msg).toContain("cardapios_prazo_obrigatorio");
  });

  it("[RN-02] prazo fixo sem prazo_preset é recusado por cardapios_prazo_obrigatorio", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Prazo sem preset",
      "prazo_fixo",
      null,
      null,
      null,
      null,
      "2026-10-10T00:00:00-03:00",
      "2026-10-17T00:00:00-03:00",
      null,
    ]);
    expect(msg).toContain("cardapios_prazo_obrigatorio");
  });

  it("[RN-02] prazo_fim IGUAL a prazo_inicio é recusado por cardapios_prazo_ordem", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Prazo de duração zero",
      "prazo_fixo",
      null,
      null,
      null,
      null,
      "2026-10-10T00:00:00-03:00",
      "2026-10-10T00:00:00-03:00",
      "customizado",
    ]);
    expect(msg).toContain("cardapios_prazo_ordem");
  });

  it("prazo_preset fora do domínio é recusado por cardapios_prazo_preset_check", async () => {
    const msg = await erroDe(t, INSERT_CARDAPIO, [
      c.lojaA,
      "Preset inventado",
      "prazo_fixo",
      null,
      null,
      null,
      null,
      "2026-10-10T00:00:00-03:00",
      "2026-10-17T00:00:00-03:00",
      "quinzenal",
    ]);
    expect(msg).toContain("cardapios_prazo_preset_check");
  });

  // ─────────────────────────────────── RLS · anon (assertiva 5 e 6 de §Segurança)

  it("[§Seg 5] anon LÊ o cardápio ativo de loja ativa", async () => {
    const r = await t.asAnon(async (db) =>
      db.query<{ id: string }>(`select id from public.cardapios where id = $1`, [c.cardapioAtivoA]),
    );
    expect(r.rows).toHaveLength(1);
  });

  it("[§Seg 5] anon NÃO lê o cardápio inativo da MESMA loja ativa (rascunho de Natal)", async () => {
    const r = await t.asAnon(async (db) =>
      db.query<{ id: string }>(`select id from public.cardapios where id = $1`, [
        c.cardapioInativoA,
      ]),
    );
    expect(r.rows).toHaveLength(0);

    // Anti-falso-verde: a linha EXISTE — o zero acima é a policy, não um banco vazio.
    const real = await t.asService(async (db) =>
      db.query<{ id: string }>(`select id from public.cardapios where id = $1`, [
        c.cardapioInativoA,
      ]),
    );
    expect(real.rows).toHaveLength(1);
  });

  it("[§Seg 6] anon NÃO faz INSERT em cardapios", async () => {
    let msg = "";
    try {
      await t.asAnon(async (db) =>
        db.query(
          `insert into public.cardapios (loja_id, nome, modo, dias_semana)
           values ($1, 'Cardapio do anon', 'recorrente', array[6]::smallint[])`,
          [c.lojaA],
        ),
      );
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/row-level security/i);

    const sobrou = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapios where nome = 'Cardapio do anon'`),
    );
    expect(sobrou.rows).toHaveLength(0);
  });

  it("[§Seg 6] anon NÃO faz UPDATE nem DELETE em cardapios", async () => {
    const r = await t.asAnon(async (db) => {
      const up = await db.query(`update public.cardapios set nome = 'hackeado' where id = $1`, [
        c.cardapioAtivoA,
      ]);
      const del = await db.query(`delete from public.cardapios where id = $1`, [c.cardapioAtivoA]);
      return { up: up.affectedRows ?? 0, del: del.affectedRows ?? 0 };
    });
    expect(r).toEqual({ up: 0, del: 0 });

    const real = await t.asService(async (db) =>
      db.query<{ nome: string }>(`select nome from public.cardapios where id = $1`, [
        c.cardapioAtivoA,
      ]),
    );
    expect(real.rows).toHaveLength(1);
    expect(real.rows[0].nome).toBe("Feijoada de sábado (A)");
  });

  // ─────────────────────────────────── RLS · lojista A vs loja B

  it("[§Seg 1 corrigida] lojista A lê ZERO linhas do cardápio INATIVO da loja B", async () => {
    // O rascunho é o dado sensível da tabela (§Segurança). O cardápio ATIVO de
    // loja ativa é público por desenho — `cardapios_leitura_publica` não tem
    // cláusula `TO` e vale para `authenticated`, igual a
    // `categorias_leitura_publica`. Ver o cabeçalho deste arquivo.
    const r = await t.asUser(DONO_A, async (db) =>
      db.query<{ id: string }>(`select id from public.cardapios where loja_id = $1 and ativo = false`, [
        c.lojaB,
      ]),
    );
    expect(r.rows).toHaveLength(0);

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapios where loja_id = $1 and ativo = false`, [c.lojaB]),
    );
    expect(real.rows).toHaveLength(1);
  });

  it("[§Seg 2] lojista A NÃO cria cardápio na loja B", async () => {
    const msg = await erroDoLojista(
      t,
      DONO_A,
      `insert into public.cardapios (loja_id, nome, modo, dias_semana)
       values ($1, 'Invasao da loja B', 'recorrente', array[6]::smallint[])`,
      [c.lojaB],
    );
    expect(msg).toMatch(/row-level security/i);

    const sobrou = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapios where nome = 'Invasao da loja B'`),
    );
    expect(sobrou.rows).toHaveLength(0);
  });

  it("[§Seg 2] lojista A NÃO edita nem remove cardápio da loja B", async () => {
    const r = await t.asUser(DONO_A, async (db) => {
      const up = await db.query(
        `update public.cardapios set nome = 'sequestrado', ativo = false where id = $1`,
        [c.cardapioAtivoB],
      );
      const del = await db.query(`delete from public.cardapios where id = $1`, [c.cardapioInativoB]);
      return { up: up.affectedRows ?? 0, del: del.affectedRows ?? 0 };
    });
    expect(r).toEqual({ up: 0, del: 0 });

    const real = await t.asService(async (db) =>
      db.query<{ id: string; nome: string; ativo: boolean }>(
        `select id, nome, ativo from public.cardapios where id = any($1::uuid[]) order by nome`,
        [[c.cardapioAtivoB, c.cardapioInativoB]],
      ),
    );
    expect(real.rows).toHaveLength(2);
    expect(real.rows.map((l) => l.nome)).toEqual([
      "Cardapio de Natal (B)",
      "Feijoada de sábado (B)",
    ]);
    expect(real.rows.find((l) => l.id === c.cardapioAtivoB)!.ativo).toBe(true);
  });

  it("[§Seg 2] lojista A NÃO move um cardápio próprio para a loja B (WITH CHECK)", async () => {
    const msg = await erroDoLojista(
      t,
      DONO_A,
      `update public.cardapios set loja_id = $1 where id = $2`,
      [c.lojaB, c.cardapioAtivoA],
    );
    expect(msg).toMatch(/row-level security/i);

    const real = await t.asService(async (db) =>
      db.query<{ loja_id: string }>(`select loja_id from public.cardapios where id = $1`, [
        c.cardapioAtivoA,
      ]),
    );
    expect(real.rows[0].loja_id).toBe(c.lojaA);
  });

  it("lojista A escreve, edita e remove cardápio da PRÓPRIA loja", async () => {
    const id = await t.asUser(DONO_A, async (db) => {
      const ins = await db.query<{ id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_mes)
         values ($1, 'Dia 15 da loja A', 'recorrente', array[15]::smallint[])
         returning id`,
        [c.lojaA],
      );
      return ins.rows[0].id;
    });
    expect(id).toBeTruthy();

    await t.asUser(DONO_A, async (db) => {
      const up = await db.query(`update public.cardapios set ativo = false where id = $1`, [id]);
      expect(up.affectedRows).toBe(1);
      const del = await db.query(`delete from public.cardapios where id = $1`, [id]);
      expect(del.affectedRows).toBe(1);
    });

    const real = await t.asService(async (db) =>
      db.query(`select 1 from public.cardapios where id = $1`, [id]),
    );
    expect(real.rows).toHaveLength(0);
  });

  it("cardápio de loja INATIVA não é lido por anon nem quando ativo = true", async () => {
    const { loja, cardapio } = await t.asService(async (db) => {
      const l = await db.query<{ id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo)
         values ($1, 'loja-desligada-242', 'Loja desligada', false) returning id`,
        [DONO_C],
      );
      const cd = await db.query<{ id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana)
         values ($1, 'Feijoada da loja desligada', 'recorrente', array[6]::smallint[])
         returning id`,
        [l.rows[0].id],
      );
      return { loja: l.rows[0].id, cardapio: cd.rows[0].id };
    });
    expect(loja).toBeTruthy();

    const r = await t.asAnon(async (db) =>
      db.query(`select 1 from public.cardapios where id = $1`, [cardapio]),
    );
    expect(r.rows).toHaveLength(0);
  });
});
