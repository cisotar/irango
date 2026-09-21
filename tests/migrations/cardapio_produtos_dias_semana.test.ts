import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 272 — coluna `cardapio_produtos.dias_semana`
 * (`smallint[]`, NULLABLE, sem default) + CHECK de domínio
 * `cardapio_produtos_dias_semana_dominio`.
 *
 * Spec: `specs/vigencia-por-item-do-cardapio.md` (§Modelos de Dados, RN-01,
 * RN-11, RN-13). Escrito a partir da ISSUE e do SPEC.
 *
 * O que este arquivo prova, e por quê:
 *
 *  1. **Default preservado.** Inserir o vínculo SEM nomear a coluna deixa
 *     `dias_semana` NULL — "todos os dias do cardápio" (RN-01). É a prova de que
 *     a migration é aditiva: todo vínculo que já existe no cloud continua com o
 *     comportamento de hoje, byte a byte.
 *  2. **Domínio.** `{}`, `{0,6}` e `{1,2,3,4,5}` entram; `{7}`, `{-1}` e `{0,7}`
 *     são recusados. A asserção afirma o SQLSTATE `23514` **e** o nome literal
 *     `cardapio_produtos_dias_semana_dominio` dentro da mensagem: `23514`
 *     sozinho não distingue "caiu pelo CHECK certo" de "caiu por outro
 *     qualquer" (precedente: as FKs compostas da 243). O vazio passa de
 *     propósito — vazio e NULL são semanticamente idênticos aqui, e a
 *     normalização `[] → NULL` é do servidor (RN-11), não do CHECK.
 *  3. **A coluna nova nasce coberta pela RLS existente.** A policy de
 *     `cardapio_produtos` é por LINHA, não por coluna: o dono escreve a agenda
 *     do próprio vínculo, o outro dono não escreve (0 linhas, silenciosamente,
 *     como todo UPDATE barrado por `USING`), e `anon` lê a coluna do vínculo de
 *     loja ATIVA pela `cardapio_produtos_leitura_publica` e não lê a da loja
 *     inativa. Se alguém "resolver" a coluna com GRANT de coluna ou policy nova,
 *     estes casos são o que reprova.
 *
 * Anti-falso-verde: toda escrita barrada é reconferida via `asService` contra a
 * linha real — 0 linhas afetadas só vale se o valor gravado continuar o antigo.
 *
 * Nenhum código de produção é escrito aqui. Quem deixa verde é `executar`.
 */

const DONO_A = "a2720000-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "b2720000-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  /** Loja ATIVA — é a que `anon` enxerga. */
  lojaA: string;
  /** Loja INATIVA — o vínculo dela não pode vazar para `anon`. */
  lojaB: string;
  produtoA: string;
  produtoB: string;
  cardapioA: string;
  cardapioB: string;
};

const INSERT_COM_DIAS = `
  insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id, dias_semana)
  values ($1, $2, $3, $4::smallint[]) returning id, dias_semana`;

type LinhaVinculo = { id: string; dias_semana: number[] | null };

describe("272 · cardapio_produtos.dias_semana: domínio e cobertura pela RLS existente", () => {
  let t: TestDb;
  let c: Cenario;

  beforeAll(async () => {
    t = await createTestDb();

    await t.db.query(
      `insert into auth.users (id, email) values
         ($1, 'dono-a-272@teste.local'),
         ($2, 'dono-b-272@teste.local')
       on conflict (id) do nothing`,
      [DONO_A, DONO_B],
    );

    c = await t.asService(async (db) => {
      const lojas = await db.query<{ id: string; dono_id: string }>(
        `insert into public.lojas (dono_id, slug, nome, ativo) values
           ($1, 'loja-a-dias-item-272', 'Loja A 272', true),
           ($2, 'loja-b-dias-item-272', 'Loja B 272', false)
         returning id, dono_id`,
        [DONO_A, DONO_B],
      );
      const lojaA = lojas.rows.find((l) => l.dono_id === DONO_A)!.id;
      const lojaB = lojas.rows.find((l) => l.dono_id === DONO_B)!.id;

      const produtos = await db.query<{ id: string; loja_id: string }>(
        `insert into public.produtos (loja_id, nome, preco) values
           ($1, 'Feijoada A 272', 100.00),
           ($2, 'Feijoada B 272', 100.00)
         returning id, loja_id`,
        [lojaA, lojaB],
      );
      const cardapios = await db.query<{ id: string; loja_id: string }>(
        `insert into public.cardapios (loja_id, nome, modo, dias_semana, hora_inicio, hora_fim, ativo)
         values
           ($1, 'Semana A 272', 'recorrente', array[1,2,3,4,5]::smallint[], time '11:00', time '15:00', true),
           ($2, 'Semana B 272', 'recorrente', array[1,2,3,4,5]::smallint[], time '11:00', time '15:00', true)
         returning id, loja_id`,
        [lojaA, lojaB],
      );

      return {
        lojaA,
        lojaB,
        produtoA: produtos.rows.find((p) => p.loja_id === lojaA)!.id,
        produtoB: produtos.rows.find((p) => p.loja_id === lojaB)!.id,
        cardapioA: cardapios.rows.find((r) => r.loja_id === lojaA)!.id,
        cardapioB: cardapios.rows.find((r) => r.loja_id === lojaB)!.id,
      };
    });
  });

  afterAll(async () => {
    await t.close();
  });

  /** Cria um produto novo na loja A e devolve seu id (par único por vínculo). */
  async function produtoNovoA(nome: string): Promise<string> {
    return t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco) values ($1, $2, 10.00) returning id`,
        [c.lojaA, nome],
      );
      return r.rows[0].id;
    });
  }

  /** Recusa esperada do banco sob `service_role`; devolve `{ code, message }`. */
  async function recusaDoService(
    sql: string,
    params: unknown[],
  ): Promise<{ code: string; message: string }> {
    try {
      await t.asService(async (db) => db.query(sql, params));
    } catch (err) {
      const e = err as Error & { code?: string };
      return { code: e.code ?? "", message: e.message };
    }
    throw new Error(`Esperava recusa do CHECK, mas a escrita PASSOU sob service_role: ${sql}`);
  }

  // ───────────────────────────── 1) coluna aditiva: NULL é o default preservado

  it("[RN-01] vínculo inserido SEM nomear a coluna nasce com dias_semana NULL", async () => {
    const produto = await produtoNovoA("Sem agenda 272");
    const linha = await t.asUser(DONO_A, async (db) => {
      const r = await db.query<LinhaVinculo>(
        `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
         values ($1, $2, $3) returning id, dias_semana`,
        [c.lojaA, c.cardapioA, produto],
      );
      return r.rows[0];
    });
    expect(linha.dias_semana).toBeNull();

    // Reconferido na linha real: nenhum default escondido no schema.
    const real = await t.asService(async (db) =>
      db.query<LinhaVinculo>(`select dias_semana from public.cardapio_produtos where id = $1`, [
        linha.id,
      ]),
    );
    expect(real.rows[0].dias_semana).toBeNull();
  });

  it("a coluna é smallint[] e NULLABLE, sem default", async () => {
    const r = await t.asService(async (db) =>
      db.query<{ data_type: string; udt_name: string; is_nullable: string; column_default: string | null }>(
        `select data_type, udt_name, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'cardapio_produtos'
            and column_name = 'dias_semana'`,
      ),
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].data_type).toBe("ARRAY");
    expect(r.rows[0].udt_name).toBe("_int2");
    expect(r.rows[0].is_nullable).toBe("YES");
    expect(r.rows[0].column_default).toBeNull();
  });

  // ───────────────────────────── 2) domínio: o que ENTRA

  const aceitos: Array<[string, number[]]> = [
    ["array vazio (vazio ≡ NULL: sem restrição por este eixo — RN-11)", []],
    ["{0,6} (domingo e sábado, as bordas do domínio)", [0, 6]],
    ["{1,2,3,4,5} (a semana útil inteira)", [1, 2, 3, 4, 5]],
  ];

  for (const [rotulo, dias] of aceitos) {
    it(`[domínio] aceita ${rotulo}`, async () => {
      const produto = await produtoNovoA(`Aceito ${JSON.stringify(dias)} 272`);
      const gravado = await t.asUser(DONO_A, async (db) => {
        const r = await db.query<LinhaVinculo>(INSERT_COM_DIAS, [
          c.lojaA,
          c.cardapioA,
          produto,
          dias,
        ]);
        return r.rows[0];
      });
      expect(gravado.dias_semana).toEqual(dias);

      const real = await t.asService(async (db) =>
        db.query<LinhaVinculo>(`select dias_semana from public.cardapio_produtos where id = $1`, [
          gravado.id,
        ]),
      );
      expect(real.rows[0].dias_semana).toEqual(dias);
    });
  }

  // ───────────────────────────── 3) domínio: o que é RECUSADO

  const recusados: Array<[string, number[]]> = [
    ["{7} (não existe o oitavo dia)", [7]],
    ["{-1} (índice negativo)", [-1]],
    ["{0,7} (um valor válido não legitima o inválido ao lado)", [0, 7]],
  ];

  for (const [rotulo, dias] of recusados) {
    it(`[domínio] recusa ${rotulo} com 23514 + o nome da constraint`, async () => {
      const produto = await produtoNovoA(`Recusado ${JSON.stringify(dias)} 272`);
      const erro = await recusaDoService(INSERT_COM_DIAS, [c.lojaA, c.cardapioA, produto, dias]);

      expect(erro.code).toBe("23514");
      // O SQLSTATE sozinho não diz QUAL check caiu — o nome literal, sim.
      expect(erro.message).toContain("cardapio_produtos_dias_semana_dominio");

      const real = await t.asService(async (db) =>
        db.query(`select 1 from public.cardapio_produtos where produto_id = $1`, [produto]),
      );
      expect(real.rows).toHaveLength(0);
    });
  }

  it("[domínio] o CHECK também vale no UPDATE, não só no INSERT", async () => {
    const produto = await produtoNovoA("Update invalido 272");
    const id = await t.asUser(DONO_A, async (db) => {
      const r = await db.query<LinhaVinculo>(INSERT_COM_DIAS, [
        c.lojaA,
        c.cardapioA,
        produto,
        [2, 4],
      ]);
      return r.rows[0].id;
    });

    const erro = await recusaDoService(
      `update public.cardapio_produtos set dias_semana = $1::smallint[] where id = $2`,
      [[9], id],
    );
    expect(erro.code).toBe("23514");
    expect(erro.message).toContain("cardapio_produtos_dias_semana_dominio");

    const real = await t.asService(async (db) =>
      db.query<LinhaVinculo>(`select dias_semana from public.cardapio_produtos where id = $1`, [id]),
    );
    expect(real.rows[0].dias_semana).toEqual([2, 4]);
  });

  // ───────────── 4) RLS de ESCRITA cobre a coluna nova (policy é por LINHA)

  it("[RLS] o DONO grava a agenda do próprio vínculo e a apaga de volta para NULL", async () => {
    const produto = await produtoNovoA("Agenda do dono 272");
    const id = await t.asUser(DONO_A, async (db) => {
      const r = await db.query<LinhaVinculo>(
        `insert into public.cardapio_produtos (loja_id, cardapio_id, produto_id)
         values ($1, $2, $3) returning id, dias_semana`,
        [c.lojaA, c.cardapioA, produto],
      );
      return r.rows[0].id;
    });

    const marcou = await t.asUser(DONO_A, async (db) => {
      const up = await db.query(
        `update public.cardapio_produtos set dias_semana = $1::smallint[] where id = $2`,
        [[3, 6], id],
      );
      return up.affectedRows ?? 0;
    });
    expect(marcou).toBe(1);

    const depoisDeMarcar = await t.asService(async (db) =>
      db.query<LinhaVinculo>(`select dias_semana from public.cardapio_produtos where id = $1`, [id]),
    );
    expect(depoisDeMarcar.rows[0].dias_semana).toEqual([3, 6]);

    // RN-11: a volta para "todos os dias" é NULL, não `{}` — e o dono pode fazê-la.
    const limpou = await t.asUser(DONO_A, async (db) => {
      const up = await db.query(
        `update public.cardapio_produtos set dias_semana = null where id = $1`,
        [id],
      );
      return up.affectedRows ?? 0;
    });
    expect(limpou).toBe(1);

    const depoisDeLimpar = await t.asService(async (db) =>
      db.query<LinhaVinculo>(`select dias_semana from public.cardapio_produtos where id = $1`, [id]),
    );
    expect(depoisDeLimpar.rows[0].dias_semana).toBeNull();
  });

  it("[RLS] o OUTRO dono NÃO grava a agenda de um vínculo alheio (0 linhas, valor intacto)", async () => {
    const produto = await produtoNovoA("Agenda alheia 272");
    const id = await t.asUser(DONO_A, async (db) => {
      const r = await db.query<LinhaVinculo>(INSERT_COM_DIAS, [
        c.lojaA,
        c.cardapioA,
        produto,
        [1],
      ]);
      return r.rows[0].id;
    });

    // O UPDATE barrado por `USING` não levanta erro: simplesmente não acha a
    // linha. Por isso a prova é a CONTAGEM mais o valor reconferido — nunca a
    // ausência de exceção.
    const afetadas = await t.asUser(DONO_B, async (db) => {
      const up = await db.query(
        `update public.cardapio_produtos set dias_semana = $1::smallint[] where id = $2`,
        [[0, 6], id],
      );
      return up.affectedRows ?? 0;
    });
    expect(afetadas).toBe(0);

    const real = await t.asService(async (db) =>
      db.query<LinhaVinculo>(`select dias_semana from public.cardapio_produtos where id = $1`, [id]),
    );
    expect(real.rows[0].dias_semana).toEqual([1]);
  });

  it("[RLS] o OUTRO dono NÃO limpa a agenda alheia para NULL", async () => {
    const produto = await produtoNovoA("Limpeza alheia 272");
    const id = await t.asUser(DONO_A, async (db) => {
      const r = await db.query<LinhaVinculo>(INSERT_COM_DIAS, [
        c.lojaA,
        c.cardapioA,
        produto,
        [2, 5],
      ]);
      return r.rows[0].id;
    });

    const afetadas = await t.asUser(DONO_B, async (db) => {
      const up = await db.query(
        `update public.cardapio_produtos set dias_semana = null where id = $1`,
        [id],
      );
      return up.affectedRows ?? 0;
    });
    expect(afetadas).toBe(0);

    const real = await t.asService(async (db) =>
      db.query<LinhaVinculo>(`select dias_semana from public.cardapio_produtos where id = $1`, [id]),
    );
    expect(real.rows[0].dias_semana).toEqual([2, 5]);
  });

  // ───────────── 5) RLS de LEITURA cobre a coluna nova (policy é por LINHA)

  it("[RLS] anon LÊ dias_semana do vínculo de loja ATIVA (cardapio_produtos_leitura_publica)", async () => {
    const produto = await produtoNovoA("Visivel na vitrine 272");
    await t.asUser(DONO_A, async (db) =>
      db.query(INSERT_COM_DIAS, [c.lojaA, c.cardapioA, produto, [3, 6]]),
    );

    const vistos = await t.asAnon(async (db) =>
      db.query<LinhaVinculo>(
        `select dias_semana from public.cardapio_produtos where produto_id = $1`,
        [produto],
      ),
    );
    expect(vistos.rows).toHaveLength(1);
    expect(vistos.rows[0].dias_semana).toEqual([3, 6]);
  });

  it("[RLS] anon NÃO lê o vínculo de loja INATIVA — nem a coluna nova", async () => {
    const id = await t.asService(async (db) => {
      const r = await db.query<LinhaVinculo>(INSERT_COM_DIAS, [
        c.lojaB,
        c.cardapioB,
        c.produtoB,
        [0, 6],
      ]);
      return r.rows[0].id;
    });

    const vistos = await t.asAnon(async (db) =>
      db.query(`select dias_semana from public.cardapio_produtos where id = $1`, [id]),
    );
    expect(vistos.rows).toHaveLength(0);

    // A linha existe: o que muda é quem enxerga.
    const real = await t.asService(async (db) =>
      db.query<LinhaVinculo>(`select dias_semana from public.cardapio_produtos where id = $1`, [id]),
    );
    expect(real.rows[0].dias_semana).toEqual([0, 6]);
  });
});
