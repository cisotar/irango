import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDb } from "../helpers/pglite";

/**
 * Fase RED (TDD) da issue 005 — RLS de catálogo, entrega e pagamento.
 *
 * Tabelas: produtos, categorias, zonas_entrega, taxas_entrega, bairros_zona,
 * formas_pagamento. Todas já têm RLS habilitada pela 001 (schema_inicial) e
 * ZERO policies → deny-all. A migration de policies
 * (`20260614002000_rls_catalogo.sql`) AINDA NÃO EXISTE.
 *
 * Consequência (o RED esperado): com deny-all, anon/authenticated não leem NEM
 * escrevem NADA dessas 6 tabelas. Logo, os cenários que DEVERIAM SER PERMITIDOS
 * falham hoje:
 *  - anon NÃO lê produto disponível de loja ativa (deveria ler)      → FALHA agora
 *  - anon NÃO lê categoria/zona ativa/taxa/bairro/forma (deveria ler) → FALHA agora
 *  - dono A NÃO lê os próprios produtos (inclusive indisponíveis)     → FALHA agora
 *  - dono A NÃO faz CRUD do próprio catálogo                          → FALHA agora
 *  - os testes de NEGAÇÃO (anon não escreve; B não mexe em A; WITH CHECK)
 *    passam por excesso de deny-all — não provam o RED, mas ficam registrados
 *    para a fase GREEN não regredir.
 *
 * Quem deixa verde é a fase GREEN (`executar`), escrevendo a migration com as
 * 13 policies de seguranca.md §2 (ver CONTRATO no fim do arquivo). Nenhum código
 * de produção é escrito aqui.
 *
 * Padrão anti-falso-verde (herdado de rls_lojas.test.ts):
 *  - leitura "permitida" confirmada por NÚMERO DE LINHAS visíveis.
 *  - escrita "permitida" confirmada por LINHAS AFETADAS + reconferência via
 *    asService (BYPASSRLS) de que o dado REALMENTE mudou/persistiu.
 *  - negação NUNCA aceita por "relation does not exist": a tabela existe.
 *    Negação = 0 linhas / 0 afetadas / rejeição de WITH CHECK, sempre reconferida
 *    via asService.
 */

// IDs fixos para asserts determinísticos.
const DONO_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DONO_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

type Cenario = {
  // lojas
  lojaA: string; // dono A, ativa
  lojaAInativa: string; // dono A, inativa
  lojaB: string; // dono B, ativa
  // categorias
  catA: string; // categoria da loja A
  // produtos
  prodADisp: string; // produto disponível, loja A (ativa) → público vê
  prodAIndisp: string; // produto indisponível, loja A → só dono A vê
  prodInativaDisp: string; // produto disponível mas de loja inativa → ninguém público vê
  prodB: string; // produto disponível, loja B
  // zonas
  zonaAAtiva: string; // zona ativa da loja A → pública
  zonaAInativa: string; // zona inativa da loja A → não pública
  zonaB: string; // zona ativa da loja B
  // taxas
  taxaAAtiva: string; // taxa em zona ativa de A → pública
  taxaAInativa: string; // taxa em zona inativa de A → não pública
  // bairros
  bairroAAtivo: string; // bairro em zona ativa de A → público
  bairroAInativo: string; // bairro em zona inativa de A → não público
  // formas de pagamento
  formaA: string; // forma da loja A
  formaB: string; // forma da loja B
  formaInativa: string; // forma de loja inativa → não pública
};

/** Cria os dois donos em auth.users via superuser (service_role não tem grant em auth). */
async function garantirDonos(t: TestDb): Promise<void> {
  await t.db.query(
    `insert into auth.users (id, email) values
       ($1, 'dono-a@teste.local'),
       ($2, 'dono-b@teste.local')
     on conflict (id) do nothing`,
    [DONO_A, DONO_B],
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

    // lojas
    const lojaA = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a','Loja A',true) returning id`,
      [DONO_A],
    );
    const lojaAInativa = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-a-inativa','Loja A Inativa',false) returning id`,
      [DONO_A],
    );
    const lojaB = await ins(
      `insert into public.lojas (dono_id, slug, nome, ativo) values ($1,'loja-b','Loja B',true) returning id`,
      [DONO_B],
    );

    // categorias
    const catA = await ins(
      `insert into public.categorias (loja_id, nome) values ($1,'Bebidas') returning id`,
      [lojaA],
    );

    // produtos
    const prodADisp = await ins(
      `insert into public.produtos (loja_id, categoria_id, nome, preco, disponivel) values ($1,$2,'Coca',10.00,true) returning id`,
      [lojaA, catA],
    );
    const prodAIndisp = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Esgotado',5.00,false) returning id`,
      [lojaA],
    );
    const prodInativaDisp = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'De Loja Inativa',7.00,true) returning id`,
      [lojaAInativa],
    );
    const prodB = await ins(
      `insert into public.produtos (loja_id, nome, preco, disponivel) values ($1,'Produto B',9.00,true) returning id`,
      [lojaB],
    );

    // zonas
    const zonaAAtiva = await ins(
      `insert into public.zonas_entrega (loja_id, nome, tipo, ativo) values ($1,'Centro','bairro',true) returning id`,
      [lojaA],
    );
    const zonaAInativa = await ins(
      `insert into public.zonas_entrega (loja_id, nome, tipo, ativo) values ($1,'Zona Off','bairro',false) returning id`,
      [lojaA],
    );
    const zonaB = await ins(
      `insert into public.zonas_entrega (loja_id, nome, tipo, ativo) values ($1,'Zona B','bairro',true) returning id`,
      [lojaB],
    );

    // taxas (herdam loja via zona)
    const taxaAAtiva = await ins(
      `insert into public.taxas_entrega (zona_id, taxa) values ($1, 5.00) returning id`,
      [zonaAAtiva],
    );
    const taxaAInativa = await ins(
      `insert into public.taxas_entrega (zona_id, taxa) values ($1, 8.00) returning id`,
      [zonaAInativa],
    );

    // bairros (herdam loja via zona)
    const bairroAAtivo = await ins(
      `insert into public.bairros_zona (zona_id, nome) values ($1,'Bairro Visivel') returning id`,
      [zonaAAtiva],
    );
    const bairroAInativo = await ins(
      `insert into public.bairros_zona (zona_id, nome) values ($1,'Bairro Oculto') returning id`,
      [zonaAInativa],
    );

    // formas de pagamento
    const formaA = await ins(
      `insert into public.formas_pagamento (loja_id, tipo) values ($1,'pix') returning id`,
      [lojaA],
    );
    const formaB = await ins(
      `insert into public.formas_pagamento (loja_id, tipo) values ($1,'dinheiro') returning id`,
      [lojaB],
    );
    // forma de pagamento de loja INATIVA → não pode vazar ao anon (auditoria 005)
    const formaInativa = await ins(
      `insert into public.formas_pagamento (loja_id, tipo, config) values ($1,'pix',$2) returning id`,
      [lojaAInativa, JSON.stringify({ chave: "pix-secreta-inativa" })],
    );

    return {
      formaInativa,
      lojaA,
      lojaAInativa,
      lojaB,
      catA,
      prodADisp,
      prodAIndisp,
      prodInativaDisp,
      prodB,
      zonaAAtiva,
      zonaAInativa,
      zonaB,
      taxaAAtiva,
      taxaAInativa,
      bairroAAtivo,
      bairroAInativo,
      formaA,
      formaB,
    };
  });
}

// ───────────────────────────── reconferências (fonte de verdade via service)
async function existeId(t: TestDb, tabela: string, id: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where id = $1`, [id]),
  );
  return r.rows.length > 0;
}

async function nomeAtual(t: TestDb, tabela: string, id: string): Promise<string | null> {
  const r = await t.asService((db) =>
    db.query<{ nome: string }>(`select nome from public.${tabela} where id = $1`, [id]),
  );
  return r.rows[0]?.nome ?? null;
}

async function existePorNome(t: TestDb, tabela: string, nome: string): Promise<boolean> {
  const r = await t.asService((db) =>
    db.query(`select 1 from public.${tabela} where nome = $1`, [nome]),
  );
  return r.rows.length > 0;
}

describe("005 RLS de catálogo, entrega e pagamento", () => {
  let t: TestDb;
  let ids: Cenario;

  beforeAll(async () => {
    t = await createTestDb();
    ids = await criarCenario(t);
  });
  afterAll(async () => {
    await t.close();
  });

  // ═══════════════════════════ PRODUTOS — leitura pública
  it("[1] anon LÊ produto disponível de loja ativa (1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.produtos where id = $1`, [ids.prodADisp]),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(ids.prodADisp);
  });

  it("[2] anon NÃO lê produto INDISPONÍVEL de loja ativa (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodAIndisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodAIndisp)).toBe(true);
  });

  it("[3] anon NÃO lê produto disponível de loja INATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodInativaDisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodInativaDisp)).toBe(true);
  });

  // ═══════════════════════════ PRODUTOS — leitura própria do dono
  it("[4] dono A LÊ os próprios produtos disponível E indisponível (2 linhas)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query<{ id: string }>(
        `select id from public.produtos where id = any($1::uuid[])`,
        [[ids.prodADisp, ids.prodAIndisp]],
      ),
    );
    expect(r.rows.length).toBe(2);
  });

  it("[5] dono B NÃO lê produto INDISPONÍVEL de A (isolamento — 0 linhas)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodAIndisp]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "produtos", ids.prodAIndisp)).toBe(true);
  });

  // ═══════════════════════════ PRODUTOS — escrita própria
  it("[6] dono A INSERE produto na própria loja (aceito, persistiu)", async () => {
    let inseriu = false;
    try {
      await t.asUser(DONO_A, (db) =>
        db.query(
          `insert into public.produtos (loja_id, nome, preco) values ($1,'Novo A',12.00)`,
          [ids.lojaA],
        ),
      );
      inseriu = true;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(await existePorNome(t, "produtos", "Novo A")).toBe(true);
  });

  it("[7] dono A ATUALIZA o próprio produto (1 linha afetada + persistiu)", async () => {
    const r = await t.asUser(DONO_A, (db) =>
      db.query(`update public.produtos set nome = 'Coca Renomeada' where id = $1`, [
        ids.prodADisp,
      ]),
    );
    expect(r.affectedRows).toBe(1);
    expect(await nomeAtual(t, "produtos", ids.prodADisp)).toBe("Coca Renomeada");
  });

  it("[8] dono B NÃO atualiza produto de A (0 linhas, nome intacto)", async () => {
    const antes = await nomeAtual(t, "produtos", ids.prodB);
    // alvo: produto de A; B não pode tocar.
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`update public.produtos set nome = 'HACK' where id = $1`, [ids.prodAIndisp]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await nomeAtual(t, "produtos", ids.prodAIndisp)).not.toBe("HACK");
    expect(await nomeAtual(t, "produtos", ids.prodB)).toBe(antes); // sanity
  });

  it("[9] dono B NÃO deleta produto de A (0 linhas, produto existe)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`delete from public.produtos where id = $1`, [ids.prodADisp]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await existeId(t, "produtos", ids.prodADisp)).toBe(true);
  });

  it("[10] dono B NÃO insere produto forjando loja_id de A (WITH CHECK, nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asUser(DONO_B, (db) =>
        db.query(`insert into public.produtos (loja_id, nome, preco) values ($1,'Forjado',1.00)`, [
          ids.lojaA, // loja de outro dono
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorNome(t, "produtos", "Forjado")).toBe(false);
  });

  it("[11] anon NÃO insere produto (nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asAnon((db) =>
        db.query(`insert into public.produtos (loja_id, nome, preco) values ($1,'AnonProd',1.00)`, [
          ids.lojaA,
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorNome(t, "produtos", "AnonProd")).toBe(false);
  });

  // ═══════════════════════════ CATEGORIAS
  it("[12] anon LÊ categoria de loja ativa (1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.categorias where id = $1`, [ids.catA]),
    );
    expect(r.rows.length).toBe(1);
  });

  it("[13] dono A INSERE categoria na própria loja (aceito, persistiu)", async () => {
    let inseriu = false;
    try {
      await t.asUser(DONO_A, (db) =>
        db.query(`insert into public.categorias (loja_id, nome) values ($1,'Sobremesas')`, [
          ids.lojaA,
        ]),
      );
      inseriu = true;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(await existePorNome(t, "categorias", "Sobremesas")).toBe(true);
  });

  it("[14] dono B NÃO insere categoria forjando loja_id de A (WITH CHECK, nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asUser(DONO_B, (db) =>
        db.query(`insert into public.categorias (loja_id, nome) values ($1,'CatForjada')`, [
          ids.lojaA,
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorNome(t, "categorias", "CatForjada")).toBe(false);
  });

  it("[15] anon NÃO escreve categoria (nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asAnon((db) =>
        db.query(`insert into public.categorias (loja_id, nome) values ($1,'CatAnon')`, [
          ids.lojaA,
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorNome(t, "categorias", "CatAnon")).toBe(false);
  });

  // ═══════════════════════════ ZONAS_ENTREGA
  it("[16] anon LÊ zona ATIVA (1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.zonas_entrega where id = $1`, [
        ids.zonaAAtiva,
      ]),
    );
    expect(r.rows.length).toBe(1);
  });

  it("[17] anon NÃO lê zona INATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.zonas_entrega where id = $1`, [ids.zonaAInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "zonas_entrega", ids.zonaAInativa)).toBe(true);
  });

  it("[18] dono A INSERE zona na própria loja (aceito, persistiu)", async () => {
    let inseriu = false;
    try {
      await t.asUser(DONO_A, (db) =>
        db.query(
          `insert into public.zonas_entrega (loja_id, nome, tipo, ativo) values ($1,'Zona Nova','bairro',true)`,
          [ids.lojaA],
        ),
      );
      inseriu = true;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(await existePorNome(t, "zonas_entrega", "Zona Nova")).toBe(true);
  });

  it("[19] dono B NÃO atualiza zona de A (0 linhas, nome intacto)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`update public.zonas_entrega set nome = 'HACK' where id = $1`, [ids.zonaAAtiva]),
    );
    expect(r.affectedRows).toBe(0);
    expect(await nomeAtual(t, "zonas_entrega", ids.zonaAAtiva)).not.toBe("HACK");
  });

  it("[20] dono B NÃO insere zona forjando loja_id de A (WITH CHECK, nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asUser(DONO_B, (db) =>
        db.query(
          `insert into public.zonas_entrega (loja_id, nome, tipo) values ($1,'ZonaForjada','bairro')`,
          [ids.lojaA],
        ),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorNome(t, "zonas_entrega", "ZonaForjada")).toBe(false);
  });

  // ═══════════════════════════ TAXAS_ENTREGA (propriedade/visibilidade via zona)
  it("[21] anon LÊ taxa de zona ATIVA (1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.taxas_entrega where id = $1`, [
        ids.taxaAAtiva,
      ]),
    );
    expect(r.rows.length).toBe(1);
  });

  it("[22] anon NÃO lê taxa de zona INATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.taxas_entrega where id = $1`, [ids.taxaAInativa]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "taxas_entrega", ids.taxaAInativa)).toBe(true);
  });

  it("[23] dono A INSERE taxa na PRÓPRIA zona (aceito, persistiu)", async () => {
    let inseriu = false;
    let novoId: string | null = null;
    try {
      novoId = await t.asUser(DONO_A, async (db) => {
        const r = await db.query<{ id: string }>(
          `insert into public.taxas_entrega (zona_id, taxa) values ($1, 3.50) returning id`,
          [ids.zonaAAtiva],
        );
        return r.rows[0].id;
      });
      inseriu = true;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(novoId && (await existeId(t, "taxas_entrega", novoId))).toBe(true);
  });

  it("[24] dono B NÃO insere taxa numa zona de A (herança via zona→loja→dono; nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asUser(DONO_B, (db) =>
        db.query(`insert into public.taxas_entrega (zona_id, taxa) values ($1, 99.00)`, [
          ids.zonaAAtiva, // zona de A
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    // nenhuma taxa de 99.00 deve existir na zona de A
    const r = await t.asService((db) =>
      db.query(`select 1 from public.taxas_entrega where zona_id = $1 and taxa = 99.00`, [
        ids.zonaAAtiva,
      ]),
    );
    expect(r.rows.length).toBe(0);
  });

  it("[25] dono B NÃO atualiza taxa de A (0 linhas afetadas)", async () => {
    const r = await t.asUser(DONO_B, (db) =>
      db.query(`update public.taxas_entrega set taxa = 0.01 where id = $1`, [ids.taxaAAtiva]),
    );
    expect(r.affectedRows).toBe(0);
    const conf = await t.asService((db) =>
      db.query<{ taxa: string }>(`select taxa from public.taxas_entrega where id = $1`, [
        ids.taxaAAtiva,
      ]),
    );
    expect(Number(conf.rows[0].taxa)).toBe(5);
  });

  // ═══════════════════════════ BAIRROS_ZONA (propriedade/visibilidade via zona)
  it("[26] anon LÊ bairro de zona ATIVA (1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.bairros_zona where id = $1`, [
        ids.bairroAAtivo,
      ]),
    );
    expect(r.rows.length).toBe(1);
  });

  it("[27] anon NÃO lê bairro de zona INATIVA (0 linhas; existe via service)", async () => {
    const r = await t.asAnon((db) =>
      db.query(`select id from public.bairros_zona where id = $1`, [ids.bairroAInativo]),
    );
    expect(r.rows.length).toBe(0);
    expect(await existeId(t, "bairros_zona", ids.bairroAInativo)).toBe(true);
  });

  it("[28] dono A INSERE bairro na PRÓPRIA zona (aceito, persistiu)", async () => {
    let inseriu = false;
    try {
      await t.asUser(DONO_A, (db) =>
        db.query(`insert into public.bairros_zona (zona_id, nome) values ($1,'Bairro Novo')`, [
          ids.zonaAAtiva,
        ]),
      );
      inseriu = true;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(await existePorNome(t, "bairros_zona", "Bairro Novo")).toBe(true);
  });

  it("[29] dono B NÃO insere bairro numa zona de A (herança via zona; nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asUser(DONO_B, (db) =>
        db.query(`insert into public.bairros_zona (zona_id, nome) values ($1,'BairroForjado')`, [
          ids.zonaAAtiva,
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    expect(await existePorNome(t, "bairros_zona", "BairroForjado")).toBe(false);
  });

  // ═══════════════════════════ FORMAS_PAGAMENTO
  it("[30] anon LÊ forma de pagamento (1 linha)", async () => {
    const r = await t.asAnon((db) =>
      db.query<{ id: string }>(`select id from public.formas_pagamento where id = $1`, [
        ids.formaA,
      ]),
    );
    expect(r.rows.length).toBe(1);
  });

  it("[30b] anon NÃO lê forma de pagamento de loja INATIVA (0 linhas; existe via service)", async () => {
    const anon = await t.asAnon((db) =>
      db.query(`select id from public.formas_pagamento where id = $1`, [ids.formaInativa]),
    );
    expect(anon.rows.length).toBe(0);
    // Anti-falso-verde: a linha existe (negação é por policy, não por dado ausente).
    expect(await existeId(t, "formas_pagamento", ids.formaInativa)).toBe(true);
  });

  it("[31] dono A INSERE forma de pagamento na própria loja (aceito, persistiu)", async () => {
    let novoId: string | null = null;
    let inseriu = false;
    try {
      novoId = await t.asUser(DONO_A, async (db) => {
        const r = await db.query<{ id: string }>(
          `insert into public.formas_pagamento (loja_id, tipo) values ($1,'cartao') returning id`,
          [ids.lojaA],
        );
        return r.rows[0].id;
      });
      inseriu = true;
    } catch {
      inseriu = false;
    }
    expect(inseriu).toBe(true);
    expect(novoId && (await existeId(t, "formas_pagamento", novoId))).toBe(true);
  });

  it("[32] dono B NÃO atualiza/deleta forma de A (0 linhas, ainda existe)", async () => {
    const upd = await t.asUser(DONO_B, (db) =>
      db.query(`update public.formas_pagamento set tipo = 'link' where id = $1`, [ids.formaA]),
    );
    expect(upd.affectedRows).toBe(0);
    const del = await t.asUser(DONO_B, (db) =>
      db.query(`delete from public.formas_pagamento where id = $1`, [ids.formaA]),
    );
    expect(del.affectedRows).toBe(0);
    expect(await existeId(t, "formas_pagamento", ids.formaA)).toBe(true);
  });

  it("[33] dono B NÃO insere forma forjando loja_id de A (WITH CHECK, nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asUser(DONO_B, (db) =>
        db.query(`insert into public.formas_pagamento (loja_id, tipo, config) values ($1,'pix',$2)`, [
          ids.lojaA,
          JSON.stringify({ marcador: "FORJADA" }),
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    const r = await t.asService((db) =>
      db.query(`select 1 from public.formas_pagamento where config->>'marcador' = 'FORJADA'`),
    );
    expect(r.rows.length).toBe(0);
  });

  it("[34] anon NÃO escreve forma de pagamento (nada persiste)", async () => {
    let rejeitou = false;
    try {
      await t.asAnon((db) =>
        db.query(`insert into public.formas_pagamento (loja_id, tipo, config) values ($1,'pix',$2)`, [
          ids.lojaA,
          JSON.stringify({ marcador: "ANON" }),
        ]),
      );
    } catch {
      rejeitou = true;
    }
    expect(rejeitou).toBe(true);
    const r = await t.asService((db) =>
      db.query(`select 1 from public.formas_pagamento where config->>'marcador' = 'ANON'`),
    );
    expect(r.rows.length).toBe(0);
  });

  // ═══════════════════════════ Sanity do BYPASSRLS
  it("[35] service_role lê produto indisponível e taxa de zona inativa (bypass RLS)", async () => {
    const prod = await t.asService((db) =>
      db.query(`select id from public.produtos where id = $1`, [ids.prodAIndisp]),
    );
    expect(prod.rows.length).toBe(1);
    const taxa = await t.asService((db) =>
      db.query(`select id from public.taxas_entrega where id = $1`, [ids.taxaAInativa]),
    );
    expect(taxa.rows.length).toBe(1);
  });
});

/**
 * CONTRATO PARA A FASE GREEN (executar) — issue 005:
 *
 * Criar `supabase/migrations/20260614002000_rls_catalogo.sql` (timestamp >
 * 20260614001500), puramente aditivo (RLS já habilitada na 001), com as 13
 * policies de seguranca.md §2:
 *
 *   produtos_leitura_publica   SELECT USING (disponivel=true AND EXISTS loja ativa)
 *   produtos_leitura_propria   SELECT USING (EXISTS loja onde dono_id=auth.uid())
 *   produtos_escrita_propria   ALL    USING/WITH CHECK (EXISTS loja do dono)
 *   categorias_leitura_publica SELECT USING (EXISTS loja ativa)
 *   categorias_escrita_propria ALL    USING/WITH CHECK (EXISTS loja do dono)
 *   zonas_leitura_publica      SELECT USING (ativo = true)
 *   zonas_escrita_propria      ALL    USING/WITH CHECK (EXISTS loja do dono)
 *   taxas_leitura_publica      SELECT USING (EXISTS zona ativa)
 *   taxas_escrita_propria      ALL    USING/WITH CHECK (EXISTS zona JOIN loja do dono)
 *   bairros_leitura_publica    SELECT USING (EXISTS zona ativa)
 *   bairros_escrita_propria    ALL    USING/WITH CHECK (EXISTS zona JOIN loja do dono)
 *   pagamentos_leitura_publica SELECT USING (true)
 *   pagamentos_escrita_propria ALL    USING/WITH CHECK (EXISTS loja do dono)
 *
 * Casos que precisam passar após a migration: [1]..[35].
 *  - O WITH CHECK de cada *_escrita_propria é o que faz [10],[14],[20],[33]
 *    rejeitarem INSERT com loja_id alheio.
 *  - taxas/bairros: propriedade herda via zona→loja→dono ([24],[29]).
 *  - filtro de visibilidade: disponivel ([2]), loja ativa ([3]), zona ativa ([17],[22],[27]).
 */
