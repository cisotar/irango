import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 083 — coluna `produtos.oculto` + troca de predicado
 * da policy pública `produtos_leitura_publica` (de `disponivel = true` para
 * `oculto = false`).
 *
 * A migration `20260621099000_produtos_oculto_rls_publica.sql` AINDA NÃO EXISTE.
 * Logo, o RED esperado é:
 *  - a coluna `oculto` não existe → todo INSERT/SELECT que a referencia falha
 *    com `column "oculto" does not exist` (quebra já no criarCenario);
 *  - a policy atual ainda filtra `disponivel = true`, então o cenário-chave
 *    [oculto-2] (anon lê produto `disponivel=false, oculto=false`) retornaria
 *    0 linhas onde deveria retornar 1.
 *
 * Padrão anti-falso-verde (herdado de rls_catalogo.test.ts):
 *  - leitura "permitida" confirmada por NÚMERO DE LINHAS visíveis;
 *  - negação NUNCA aceita por "relation does not exist": a linha existe.
 *    Negação = 0 linhas via anon + reconferência via asService (BYPASSRLS) de
 *    que a linha REALMENTE existe (negada por policy, não por dado ausente).
 *
 * Quem deixa verde é a fase GREEN (`executar`), criando a migration descrita no
 * contrato ao fim deste arquivo. Nenhum código de produção é escrito aqui.
 */

// IDs fixos para asserts determinísticos. RN-01: 1 loja por conta →
// lojaAInativa pertence a DONO_A2 (conta separada).
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  lojaA: string; // dono A, ativa
  lojaAInativa: string; // dono A2, inativa
  lojaB: string; // dono B, ativa
  catA: string;
  // produtos da loja A (ativa)
  prodVisivel: string; // disponivel=true,  oculto=false → anon VÊ
  prodIndispNaoOculto: string; // disponivel=false, oculto=false → anon VÊ (novo!)
  prodOcultoDisp: string; // disponivel=true,  oculto=true  → anon NÃO vê
  prodOcultoIndisp: string; // disponivel=false, oculto=true  → anon NÃO vê
  // produto da loja INATIVA
  prodLojaInativa: string; // disponivel=true,  oculto=false → anon NÃO vê (loja inativa)
  prodOcultoLojaInativa: string; // oculto=true, loja inativa → anon NÃO vê (dupla negação: AND, não OR)
};

/** Cria os donos em auth.users via superuser (service_role não tem grant em auth). */
async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-a2@teste.local'),
       ($3, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_A2, DONO_B],
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

    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaAInativa = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a-inativa','Loja A Inativa',false) returning id`,
      [DONO_A2],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );

    const catA = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Bebidas') returning id`,
      [lojaA],
    );

    // Produtos referenciam a coluna `oculto` de propósito: enquanto a migration
    // não existir, estes INSERTs falham com `column "oculto" does not exist` —
    // este é um dos motivos do RED.
    const prodVisivel = await ins(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel, oculto)
         values ($1,$2,'Coca',10.00,true,false) returning id`,
      [lojaA, catA],
    );
    const prodIndispNaoOculto = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel, oculto)
         values ($1,'Esgotado Visivel',5.00,false,false) returning id`,
      [lojaA],
    );
    const prodOcultoDisp = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel, oculto)
         values ($1,'Oculto Disponivel',7.00,true,true) returning id`,
      [lojaA],
    );
    const prodOcultoIndisp = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel, oculto)
         values ($1,'Oculto Esgotado',8.00,false,true) returning id`,
      [lojaA],
    );
    const prodLojaInativa = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel, oculto)
         values ($1,'De Loja Inativa',9.00,true,false) returning id`,
      [lojaAInativa],
    );
    const prodOcultoLojaInativa = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel, oculto)
         values ($1,'Oculto De Loja Inativa',11.00,true,true) returning id`,
      [lojaAInativa],
    );

    return {
      lojaA,
      lojaAInativa,
      lojaB,
      catA,
      prodVisivel,
      prodIndispNaoOculto,
      prodOcultoDisp,
      prodOcultoIndisp,
      prodLojaInativa,
      prodOcultoLojaInativa,
    };
  });
}

// ───────────────────────────── reconferência (fonte de verdade via service)
async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

async function ocultoAtual(t: TestDb, id: string): Promise<boolean | null> {
  const r = await t.asService((db) =>
    db.query<{ oculto: boolean }>(`select oculto from public.produtos where id = $1`, [id]),
  );
  return r.rows[0]?.oculto ?? null;
}

describe("083 RLS produtos.oculto — leitura pública por oculto = false", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  it("[oculto-1] anon LÊ produto disponivel=true, oculto=false de loja ativa (1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.produtos where id = $1`, [ids.prodVisivel]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.prodVisivel);
  });

  it("[oculto-2] anon LÊ produto disponivel=false, oculto=false de loja ativa (1 linha — NOVO comportamento)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.produtos where id = $1`, [
        ids.prodIndispNaoOculto,
      ]),
    );
    expect(r.rows.length).toBe(1);
    expect(await existeId(t, "produtos", ids.prodIndispNaoOculto)).toBe(true);
  });

  it("[oculto-3] anon NÃO lê produto oculto=true, disponivel=true de loja ativa (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodOcultoDisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodOcultoDisp)).toBe(true);
  });

  it("[oculto-4] anon NÃO lê produto oculto=true, disponivel=false de loja ativa (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodOcultoIndisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodOcultoIndisp)).toBe(true);
  });

  it("[oculto-5] anon NÃO lê produto oculto=false de loja INATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodLojaInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodLojaInativa)).toBe(true);
  });

  it("[oculto-5b] anon NÃO lê produto oculto=true DE LOJA INATIVA (0 linhas; existe via service — prova AND, não OR, entre os dois predicados)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodOcultoLojaInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodOcultoLojaInativa)).toBe(true);
  });

  it("[oculto-6] dono A LÊ os PRÓPRIOS produtos ocultos E indisponível (3 linhas — leitura própria inalterada)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(`select id from public.produtos where id = any($1::uuid[])`, [
        [ids.prodOcultoDisp, ids.prodOcultoIndisp, ids.prodIndispNaoOculto],
      ]),
    );
    expect(r.rows.length).toBe(3);
  });

  it("[oculto-7] dono B NÃO lê produto oculto de A (isolamento — 0 linhas; existe via service)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodOcultoDisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodOcultoDisp)).toBe(true);
  });

  it("[oculto-8] produto inserido pelo dono SEM informar oculto nasce oculto=false e é visível ao anon (RN-7 retrocompat)", async () => {
    const novoId = await t.asUser(DONO_A, async (db) => {
      const r = await db.query<{ id: string }>(
        `insert into public.produtos (loja_id, nome, preco, disponivel)
           values ($1,'Sem Oculto',3.00,true) returning id`,
        [ids.lojaA],
      );
      return r.rows[0].id;
    });
    expect(await ocultoAtual(t, novoId)).toBe(false);
    const anon = await t.asAnon((db) =>
      db.query(`select id from public.produtos where id = $1`, [novoId]),
    );
    expect(anon.rows.length).toBe(1);
  });

  it("[oculto-9] service_role lê produto oculto (bypass RLS — sanity do harness — 1 linha)", async () => {
    const r = await t.asService((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodOcultoDisp]),
    );
    expect(r.rows.length).toBe(1);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 083:
 *
 * Criar `supabase/migrations/20260621099000_produtos_oculto_rls_publica.sql`
 * (timestamp > 20260621098000), com:
 *
 *   alter table public.produtos add column oculto boolean not null default false;
 *
 *   drop policy "produtos_leitura_publica" on public.produtos;
 *   create policy "produtos_leitura_publica"
 *     on public.produtos for select
 *     using (oculto = false and public.loja_esta_ativa(produtos.loja_id));
 *
 * Intocadas: produtos_leitura_propria / produtos_escrita_propria (dono vê tudo
 * por dono_id = auth.uid()). Reusar public.loja_esta_ativa(uuid) — NÃO recriar.
 *
 * Casos que precisam passar após a migration: [oculto-1]..[oculto-9].
 *  - [oculto-2] é o de mudança de comportamento (indisponível não-oculto passa a
 *    ser legível ao anon) — hoje falha por RLS antiga filtrar disponivel=true.
 *  - [oculto-8] e todos os INSERTs de criarCenario com a coluna `oculto` falham
 *    hoje com `column "oculto" does not exist` — provam a ausência da coluna.
 *  - [oculto-3..5,7] são negações que registram o anti-regressão da fase GREEN.
 */
