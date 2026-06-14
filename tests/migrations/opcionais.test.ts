import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 080 — migration de OPCIONAIS (4 tabelas + RLS + helper).
 *
 * As tabelas `opcionais_categorias`, `opcionais`, `categoria_produto_opcionais`,
 * `itens_pedido_opcionais` e o helper `public.item_pedido_aceita_opcionais(uuid)`
 * AINDA NÃO EXISTEM — a migration `..._opcionais.sql` é da fase GREEN (executar).
 *
 * Consequência (o RED esperado): toda query que referencia essas relações falha
 * hoje com `relation "..." does not exist` (ou função inexistente). Os testes
 * abaixo provam que:
 *  - os CHECKs de valor (preco >= 0, preco_snapshot >= 0, quantidade > 0) ainda
 *    não protegem nada (a tabela nem existe) → FALHAM agora;
 *  - as policies de RLS (leitura pública só ativo+loja ativa, isolamento de
 *    escrita entre lojas, leitura própria do dono inclui inativos) não existem
 *    → FALHAM agora;
 *  - a UNIQUE (categoria_id, categoria_opcional_id) não existe → FALHA agora.
 *
 * Quem deixa verde é a fase GREEN (`executar`), criando a migration com as 4
 * tabelas, índices, RLS e o helper (ver CONTRATO no fim do arquivo). Nenhum
 * código de produção (migration) é escrito aqui.
 *
 * Padrão anti-falso-verde (herdado de rls_cupons_pedidos.test.ts):
 *  - leitura "permitida" confirmada por NÚMERO DE LINHAS visíveis;
 *  - escrita "permitida"/"negada" confirmada por affectedRows + reconferência via
 *    asService (BYPASSRLS) de que a linha realmente persistiu / não persistiu;
 *  - CHECK violado = a query LANÇA (rejeitou === true);
 *  - negação de RLS NUNCA aceita por "relation does not exist": a tabela existe
 *    após o GREEN; a negação é 0 linhas / 0 afetadas, reconferida via service.
 */

const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DONO_OFF = "ffffffff-ffff-ffff-ffff-ffffffffffff";

type Cenario = {
  lojaA: string; // dono A, ativa
  lojaB: string; // dono B, ativa
  lojaOff: string; // dono OFF, INATIVA
  catProdA: string; // categoria de PRODUTO da loja A (Pães)
  opcCatA: string; // categoria de OPCIONAL da loja A (Laticínios)
  opcCatOff: string; // categoria de OPCIONAL da loja INATIVA
  opcAtivoA: string; // opcional ativo da loja A
  opcInativoA: string; // opcional INATIVO da loja A
  capA: string; // linha categoria_produto_opcionais existente (loja A)
};

/** Cria os donos em auth.users via superuser (service_role não tem grant em auth). */
async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local'),
       ($3, 'dono-off@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B, DONO_OFF],
  );
}

/** Monta o cenário base via asService (bypass RLS) e retorna todos os ids. */
async function criarCenario(t: TestDb): Promise<Cenario> {
  await garantirDonos(t);
  return t.asService(async (db) => {
    const ins = async (sql: string, params: unknown[]) => {
      const r = await db.query<{ id: string }>(sql, params);
      return r.rows[0].id;
    };

    // lojas — cada dono distinto (índice lojas_dono_unico); off = inativa
    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );
    const lojaOff = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-off','Loja Off',false) returning id`,
      [DONO_OFF],
    );

    // categoria de PRODUTO (já existe no schema) da loja A
    const catProdA = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Pães') returning id`,
      [lojaA],
    );

    // categorias de OPCIONAL (tabela nova — só existe após o GREEN)
    const opcCatA = await ins(
      `insert into public.opcionais_categorias (loja_id, nome) values ($1,'Laticínios') returning id`,
      [lojaA],
    );
    const opcCatOff = await ins(
      `insert into public.opcionais_categorias (loja_id, nome) values ($1,'Embalagens') returning id`,
      [lojaOff],
    );

    // opcionais (tabela nova)
    const opcAtivoA = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo)
         values ($1,$2,'Brie extra',8.00,true) returning id`,
      [lojaA, opcCatA],
    );
    const opcInativoA = await ins(
      `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco, ativo)
         values ($1,$2,'Geleia (off)',6.00,false) returning id`,
      [lojaA, opcCatA],
    );

    // associação categoria de produto ⋈ categoria de opcional (tabela nova)
    const capA = await ins(
      `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
         values ($1,$2,$3) returning id`,
      [lojaA, catProdA, opcCatA],
    );

    return {
      lojaA,
      lojaB,
      lojaOff,
      catProdA,
      opcCatA,
      opcCatOff,
      opcAtivoA,
      opcInativoA,
      capA,
    };
  });
}

async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

async function existePorMarcador(
  t: TestDb,
  tabela: string,
  coluna: string,
  valor: string,
): Promise<number> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where ${coluna} = $1`, [valor]),
  );
  return r.rows.length;
}

describe("080 opcionais — CHECKs de valor, UNIQUE e RLS por loja", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ═══════════════════════════ CHECKs de valor (schema)
  it("[1] INSERT opcionais.preco = -1 viola CHECK (rejeitado; nada persiste)", async () => {
    const MARCADOR = "Opcional Negativo";
    let rejeitou = false;
    try {
      await t.asService((db) =>
        db.query(
          `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco)
             values ($1,$2,$3,-1)`,
          [ids.lojaA, ids.opcCatA, MARCADOR],
        ),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorMarcador(t, "opcionais", "nome", MARCADOR)).toBe(0);
  });

  it("[2] INSERT itens_pedido_opcionais.quantidade = 0 viola CHECK (rejeitado)", async () => {
    const MARCADOR = "Qtd Zero";
    // item_pedido válido via service (pedido pendente + item)
    const itemPedidoId = await t.asService(async (db) => {
      const ped = await db.query<{ id: string }>(
        `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
           values ($1,'Cli',10,10) returning id`,
        [ids.lojaA],
      );
      const item = await db.query<{ id: string }>(
        `insert into public.itens_pedido (pedido_id, nome, preco, quantidade)
           values ($1,'Item',10,1) returning id`,
        [ped.rows[0].id],
      );
      return item.rows[0].id;
    });
    let rejeitou = false;
    try {
      await t.asService((db) =>
        db.query(
          `insert into public.itens_pedido_opcionais
             (item_pedido_id, opcional_id, nome_snapshot, preco_snapshot, quantidade)
             values ($1,$2,$3,8.00,0)`,
          [itemPedidoId, ids.opcAtivoA, MARCADOR],
        ),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorMarcador(t, "itens_pedido_opcionais", "nome_snapshot", MARCADOR)).toBe(0);
  });

  it("[3] INSERT itens_pedido_opcionais.preco_snapshot = -1 viola CHECK (rejeitado)", async () => {
    const MARCADOR = "Snapshot Negativo";
    const itemPedidoId = await t.asService(async (db) => {
      const ped = await db.query<{ id: string }>(
        `insert into public.pedidos (loja_id, nome_cliente, subtotal, total)
           values ($1,'Cli',10,10) returning id`,
        [ids.lojaA],
      );
      const item = await db.query<{ id: string }>(
        `insert into public.itens_pedido (pedido_id, nome, preco, quantidade)
           values ($1,'Item',10,1) returning id`,
        [ped.rows[0].id],
      );
      return item.rows[0].id;
    });
    let rejeitou = false;
    try {
      await t.asService((db) =>
        db.query(
          `insert into public.itens_pedido_opcionais
             (item_pedido_id, opcional_id, nome_snapshot, preco_snapshot, quantidade)
             values ($1,$2,$3,-1,1)`,
          [itemPedidoId, ids.opcAtivoA, MARCADOR],
        ),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorMarcador(t, "itens_pedido_opcionais", "nome_snapshot", MARCADOR)).toBe(0);
  });

  // ═══════════════════════════ UNIQUE (categoria_id, categoria_opcional_id)
  it("[7] UNIQUE (categoria_id, categoria_opcional_id) rejeita duplicata", async () => {
    let rejeitou = false;
    try {
      await t.asService((db) =>
        db.query(
          `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
             values ($1,$2,$3)`,
          [ids.lojaA, ids.catProdA, ids.opcCatA], // mesma combinação de capA
        ),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    // continua existindo apenas 1 linha com essa combinação
    const r = await t.asService((db) =>
      db.query(
        `select 1 from public.categoria_produto_opcionais
           where categoria_id = $1 and categoria_opcional_id = $2`,
        [ids.catProdA, ids.opcCatA],
      ),
    );
    expect(r.rows.length).toBe(1);
  });

  // ═══════════════════════════ RLS — leitura pública de opcionais
  it("[8] anon LÊ opcional ativo de loja ativa (caminho feliz — 1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.opcionais where id = $1`, [ids.opcAtivoA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.opcAtivoA);
  });

  it("[4] anon NÃO lê opcional com ativo = false (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.opcionais where id = $1`, [ids.opcInativoA]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "opcionais", ids.opcInativoA)).toBe(true);
  });

  it("[5a] anon NÃO lê opcionais_categorias de loja INATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.opcionais_categorias where id = $1`, [ids.opcCatOff]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "opcionais_categorias", ids.opcCatOff)).toBe(true);
  });

  it("[5b] anon LÊ opcionais_categorias de loja ATIVA (1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.opcionais_categorias where id = $1`, [
        ids.opcCatA,
      ]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.opcCatA);
  });

  it("[9] dono A LÊ os próprios opcionais INATIVOS (leitura própria inclui inativos — 1 linha)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.opcionais where id = $1`, [ids.opcInativoA]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.opcInativoA);
  });

  // ═══════════════════════════ RLS — isolamento de escrita entre lojas
  it("[6a] dono B NÃO INSERE opcional na loja A (WITH CHECK; nada persiste)", async () => {
    const MARCADOR = "Injetado por B";
    let rejeitouOuZero = false;
    try {
      const r = await t.asUser(DONO_B, (db) =>
        db.query(
          `insert into public.opcionais (loja_id, categoria_opcional_id, nome, preco)
             values ($1,$2,$3,5.00)`,
          [ids.lojaA, ids.opcCatA, MARCADOR],
        ),
      );
      rejeitouOuZero = r.affectedRows === 0;
    } catch {
      rejeitouOuZero = true;
    }
    expect(rejeitouOuZero).toBe(true);
    expect(await existePorMarcador(t, "opcionais", "nome", MARCADOR)).toBe(0);
  });

  it("[6b] dono B NÃO ATUALIZA opcional da loja A (0 afetadas; intacto)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`update public.opcionais set preco = 0.01 where id = $1`, [ids.opcAtivoA]),
    );
    expect(r.affectedRows).toBe(0);
    const conf = await t.asService((db) =>
      db.query<{ preco: string }>(`select preco from public.opcionais where id = $1`, [
        ids.opcAtivoA,
      ]),
    );
    expect(conf.rows[0].preco).toBe("8.00");
  });

  it("[6c] dono A ATUALIZA o próprio opcional (1 afetada + persistiu) — sanity da escrita própria", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.opcionais set ordem = 5 where id = $1`, [ids.opcAtivoA]),
    );
    expect(r.affectedRows).toBe(1);
    const conf = await t.asService((db) =>
      db.query<{ ordem: number }>(`select ordem from public.opcionais where id = $1`, [
        ids.opcAtivoA,
      ]),
    );
    expect(conf.rows[0].ordem).toBe(5);
  });

  // ═══════════════════════════ associação CROSS-LOJA (finding MÉDIA aud. 080)
  // Dono A é dono da loja A. Tenta associar uma categoria de PRODUTO sua
  // (catProdA) a uma categoria de OPCIONAL de OUTRA loja (opcCatOff, da loja
  // inativa). Sem o fix (FK composta + WITH CHECK reforçado) a policy só checava
  // loja_id ∈ lojas do dono e a inserção passava. Com o fix: NEGADO.
  it("[10a] dono A NÃO associa categoria própria a categoria de opcional de OUTRA loja (cross-loja negado)", async () => {
    let rejeitouOuZero = false;
    try {
      const r = await t.asUser(DONO_A, (db) =>
        db.query(
          `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
             values ($1,$2,$3)`,
          [ids.lojaA, ids.catProdA, ids.opcCatOff], // opcCatOff é da loja inativa, não da A
        ),
      );
      rejeitouOuZero = r.affectedRows === 0;
    } catch {
      // FK composta (mesma-loja) ou WITH CHECK rejeitam — ambos são fix válido
      rejeitouOuZero = true;
    }
    expect(rejeitouOuZero).toBe(true);
    // reconfere via service: NENHUMA linha cross-loja persistiu
    const conf = await t.asService((db) =>
      db.query(
        `select 1 from public.categoria_produto_opcionais
           where categoria_id = $1 and categoria_opcional_id = $2`,
        [ids.catProdA, ids.opcCatOff],
      ),
    );
    expect(conf.rows.length).toBe(0);
  });

  it("[10b] dono A ASSOCIA categoria própria a categoria de opcional da MESMA loja (caminho feliz — 1 afetada + persistiu)", async () => {
    // nova categoria de opcional da loja A (a UNIQUE (catProdA, opcCatA) já está
    // tomada por capA, então usa uma categoria de opcional inédita da loja A)
    const opcCatA2 = await t.asService(async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.opcionais_categorias (loja_id, nome) values ($1,'Molhos') returning id`,
        [ids.lojaA],
      );
      return r.rows[0].id;
    });
    const r = await t.asUser(DONO_A, (db) =>
      db.query(
        `insert into public.categoria_produto_opcionais (loja_id, categoria_id, categoria_opcional_id)
           values ($1,$2,$3)`,
        [ids.lojaA, ids.catProdA, opcCatA2],
      ),
    );
    expect(r.affectedRows).toBe(1);
    const conf = await t.asService((db) =>
      db.query(
        `select 1 from public.categoria_produto_opcionais
           where categoria_id = $1 and categoria_opcional_id = $2`,
        [ids.catProdA, opcCatA2],
      ),
    );
    expect(conf.rows.length).toBe(1);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 080:
 *
 * Criar `supabase/migrations/20260614XXXXXX_opcionais.sql` (timestamp >
 * 20260614007000), com:
 *
 * TABELAS (spec_opcionais.md Deltas 1-4):
 *   opcionais_categorias(id, loja_id FK lojas ON DELETE CASCADE, nome, ordem int
 *     default 0, criado_em) + índice (loja_id, ordem)
 *   opcionais(id, loja_id FK, categoria_opcional_id FK opcionais_categorias ON
 *     DELETE CASCADE, nome, preco numeric(10,2) CHECK (preco >= 0), ativo bool
 *     default true, ordem, criado_em, atualizado_em) + índice
 *     (loja_id, categoria_opcional_id, ativo, ordem)
 *   categoria_produto_opcionais(id, loja_id FK, categoria_id FK categorias ON
 *     DELETE CASCADE, categoria_opcional_id FK opcionais_categorias ON DELETE
 *     CASCADE, UNIQUE (categoria_id, categoria_opcional_id)) + índice
 *     (loja_id, categoria_id)
 *   itens_pedido_opcionais(id, item_pedido_id FK itens_pedido ON DELETE CASCADE,
 *     opcional_id FK opcionais ON DELETE SET NULL, nome_snapshot text NOT NULL,
 *     preco_snapshot numeric(10,2) CHECK (preco_snapshot >= 0), quantidade int
 *     CHECK (quantidade > 0)) + índice (item_pedido_id)
 *
 * RLS (ENABLE em todas + policies de spec_opcionais.md §Segurança):
 *   opcionais_categorias: opc_cat_leitura_publica SELECT USING loja_esta_ativa;
 *                         opc_cat_escrita_propria  FOR ALL (dono via lojas)
 *   categoria_produto_opcionais: cat_prod_opc_leitura_publica SELECT USING
 *                         loja_esta_ativa; cat_prod_opc_escrita_propria FOR ALL (dono)
 *   opcionais: opcionais_leitura_publica SELECT USING (ativo = true AND
 *                         loja_esta_ativa); opcionais_leitura_propria SELECT USING
 *                         (dono via lojas); opcionais_escrita_propria FOR ALL (dono)
 *   itens_pedido_opcionais: ipo_insert_publico INSERT WITH CHECK
 *                         (item_pedido_aceita_opcionais(item_pedido_id));
 *                         ipo_leitura_lojista SELECT USING (item→pedido→loja do dono)
 *
 * HELPER:
 *   public.item_pedido_aceita_opcionais(uuid) RETURNS boolean LANGUAGE sql STABLE
 *   SECURITY DEFINER SET search_path = public — checa item→pedido pendente→loja
 *   ativa; REVOKE ALL FROM public; GRANT EXECUTE a anon, authenticated, service_role.
 *   (Espelha public.pedido_aceita_itens.)
 *
 * Casos que precisam passar após a migration: [1][2][3] (CHECKs), [7] (UNIQUE),
 *  [8][4][5a][5b][9] (RLS leitura), [6a][6b][6c] (RLS escrita/isolamento).
 *  - [4][5a][6a][6b] (negações) NÃO podem ser regredidas: nenhuma policy pode
 *    expor opcional inativo ao anon, categoria de loja inativa ao anon, nem
 *    permitir escrita cross-tenant.
 */
