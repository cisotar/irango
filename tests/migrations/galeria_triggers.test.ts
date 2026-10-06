import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";
import {
  criarLoja,
  criarProduto,
  definirLogo,
  erroDe,
  esperarErro,
  estadoDa,
  gravarLegado,
  imagem,
  logoDa,
  produto,
  registrarImagem,
  urlStorage,
} from "../helpers/galeria";

/**
 * Fase RED (TDD) — galeria de imagens, item 3 do spec: triggers de M4
 * (`20261006123000_fotos_exigem_galeria.sql`).
 *
 * BEFORE (DP1, estrito):
 *   produtos_foto_na_galeria_trg  BEFORE INSERT OR UPDATE OF foto_url ON produtos
 *   lojas_logo_na_galeria_trg     BEFORE UPDATE OF logo_url ON lojas
 *   Toda URL nova e não nula (INSERT; UPDATE com valor DISTINTO do antigo) cujo
 *   `caminho_storage_produtos(url)` seja NULL ou não case linha de `imagens_loja`
 *   da MESMA loja com `remocao_pendente_em IS NULL` ⇒ raise 'imagem_fora_da_galeria',
 *   SQLSTATE P0001. NULL passa; reenviar a mesma URL legada passa (WHEN).
 *   Vale para a via de serviço (service_role ignora RLS, não trigger).
 *
 * AFTER (D5, RN-G20):
 *   produtos_recorte_sem_uso_trg  AFTER UPDATE OF foto_url OR DELETE ON produtos
 *   lojas_recorte_sem_uso_trg     AFTER UPDATE OF logo_url ON lojas
 *   Se o valor antigo é um RECORTE da mesma loja sem outra referência (produto ou
 *   logo), marca `remocao_pendente_em`. Nunca toca original. Nunca toca outra loja.
 *
 * Por que é RED: M1 (tabela), M2 (RPC usada na corrida) e M4 (triggers) não
 * existem. Casos que são "passa" chamam `exigirTriggers()` primeiro: sem isso um
 * "NULL passa" seria verde hoje, sem nenhum trigger.
 */

const DONO_A = "a6a5e000-0000-4000-8000-0000000000a5";
const DONO_B = "b6a5e000-0000-4000-8000-0000000000b5";
const MSG = "imagem_fora_da_galeria";

let t: TestDb;
let lojaA: string;
let lojaB: string;

beforeAll(async () => {
  t = await createTestDb();
  lojaA = await criarLoja(t, DONO_A, "galeria-trg-a");
  lojaB = await criarLoja(t, DONO_B, "galeria-trg-b");
}, 60_000);

afterAll(async () => {
  await t?.close();
});

const TRIGGERS = [
  ["produtos", "produtos_foto_na_galeria_trg"],
  ["lojas", "lojas_logo_na_galeria_trg"],
  ["produtos", "produtos_recorte_sem_uso_trg"],
  ["lojas", "lojas_recorte_sem_uso_trg"],
] as const;

async function exigirTriggers(): Promise<void> {
  const r = await t.db.query<{ tabela: string; tgname: string }>(
    `select c.relname as tabela, tg.tgname from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      where not tg.tgisinternal and tg.tgname = any($1::text[])`,
    [TRIGGERS.map(([, n]) => n)],
  );
  const achados = r.rows.map((x) => `${x.tabela}.${x.tgname}`).sort();
  expect(achados, "triggers de M4 ausentes").toEqual(TRIGGERS.map(([tb, n]) => `${tb}.${n}`).sort());
}

type Papel = "donoA" | "service";
function como<T>(papel: Papel, fn: (s: PGlite) => Promise<T>): Promise<T> {
  return papel === "donoA" ? t.asUser(DONO_A, fn) : t.asService(fn);
}

function inserirProduto(papel: Papel, lojaId: string, nome: string, fotoUrl: string | null) {
  return como(papel, (s) =>
    s.query<{ id: string }>(
      `insert into public.produtos (loja_id, nome, preco, foto_url) values ($1, $2, 10.00, $3) returning id`,
      [lojaId, nome, fotoUrl],
    ),
  );
}

function atualizarFoto(papel: Papel, produtoId: string, fotoUrl: string | null) {
  return como(papel, (s) => s.query(`update public.produtos set foto_url = $2 where id = $1`, [produtoId, fotoUrl]));
}

function atualizarLogo(papel: Papel, lojaId: string, url: string | null) {
  return como(papel, (s) => s.query(`update public.lojas set logo_url = $2 where id = $1`, [lojaId, url]));
}

async function contarPorNome(nome: string): Promise<number> {
  const r = await t.asService((s) =>
    s.query<{ n: number }>(`select count(*)::int as n from public.produtos where nome = $1`, [nome]),
  );
  return r.rows[0].n;
}

/** Original + recorte registrados na loja; devolve ids e caminhos. */
async function familia(lojaId: string, pastaRecorte?: "logo") {
  const camO = `${lojaId}/galeria/${randomUUID()}.webp`;
  const camR = pastaRecorte ? `${lojaId}/logo/${randomUUID()}.webp` : `${lojaId}/${randomUUID()}.webp`;
  const o = await registrarImagem(t, lojaId, camO);
  const r = await registrarImagem(t, lojaId, camR, { origemId: o });
  return { o, r, camO, camR };
}

// ═══════════════════════════════════════════════ BEFORE — produtos.foto_url
describe("[galeria/3] BEFORE produtos_foto_na_galeria_trg — recusas", () => {
  const recusas: Array<[string, () => Promise<string>]> = [
    ["caminho da loja NÃO registrado", async () => urlStorage(`${lojaA}/${randomUUID()}.webp`)],
    [
      "imagem registrada da loja B",
      async () => {
        const cam = `${lojaB}/${randomUUID()}.webp`;
        await registrarImagem(t, lojaB, cam);
        return urlStorage(cam);
      },
    ],
    [
      "imagem da loja com remoção pendente",
      async () => {
        const cam = `${lojaA}/${randomUUID()}.webp`;
        await registrarImagem(t, lojaA, cam, { pendente: true });
        return urlStorage(cam);
      },
    ],
    ["URL https fora do Storage", async () => "https://exemplo.com/foto.webp"],
    [
      "URL de outro bucket (pix-qr) com caminho da loja",
      async () => `https://exemplo.supabase.co/storage/v1/object/public/pix-qr/${lojaA}/qr.png`,
    ],
  ];

  for (const papel of ["donoA", "service"] as const) {
    it.each(recusas)(`INSERT (${papel}) com %s ⇒ P0001 '${MSG}'; nada gravado`, async (_n, montar) => {
      const url = await montar();
      const nome = `recusa-${randomUUID()}`;

      esperarErro(await erroDe(inserirProduto(papel, lojaA, nome, url)), "P0001", MSG);

      expect(await contarPorNome(nome)).toBe(0);
    });

    it.each(recusas)(`UPDATE (${papel}) para %s ⇒ P0001 '${MSG}'; produto intacto`, async (_n, montar) => {
      const { camO } = await familia(lojaA);
      const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(camO) });
      const antes = await produto(t, p);
      const url = await montar();

      esperarErro(await erroDe(atualizarFoto(papel, p, url)), "P0001", MSG);

      expect(await produto(t, p)).toEqual(antes);
    });
  }
});

describe("[galeria/3] BEFORE produtos_foto_na_galeria_trg — o que passa", () => {
  it("INSERT com foto_url NULL ⇒ aceito", async () => {
    await exigirTriggers();
    const r = await inserirProduto("donoA", lojaA, `sem-foto-${randomUUID()}`, null);
    expect((await produto(t, r.rows[0].id))?.foto_url).toBeNull();
  });

  it("INSERT com original e com recorte registrados da loja ⇒ aceitos (dono e serviço)", async () => {
    await exigirTriggers();
    const { camO, camR } = await familia(lojaA);
    const r1 = await inserirProduto("donoA", lojaA, `orig-${randomUUID()}`, urlStorage(camO));
    const r2 = await inserirProduto("service", lojaA, `rec-${randomUUID()}`, urlStorage(camR));
    expect((await produto(t, r1.rows[0].id))?.foto_url).toBe(urlStorage(camO));
    expect((await produto(t, r2.rows[0].id))?.foto_url).toBe(urlStorage(camR));
  });

  it("UPDATE que reenvia a MESMA foto_url legada não registrada (payload inteiro) ⇒ aceito", async () => {
    await exigirTriggers();
    const legada = urlStorage(`${lojaA}/${randomUUID()}.webp`);
    const r = await gravarLegado(
      t,
      `insert into public.produtos (loja_id, nome, preco, foto_url) values ($1, 'Legado', 10.00, $2) returning id`,
      [lojaA, legada],
    );
    const id = r.rows[0].id as string;

    await t.asUser(DONO_A, (s) =>
      s.query(`update public.produtos set nome = 'Legado editado', preco = 12.00, foto_url = $2 where id = $1`, [
        id,
        legada,
      ]),
    );

    expect(await produto(t, id)).toMatchObject({ nome: "Legado editado", foto_url: legada });
  });

  it("UPDATE de produto legado zerando a foto (NULL) ⇒ aceito", async () => {
    await exigirTriggers();
    const legada = urlStorage(`${lojaA}/${randomUUID()}.webp`);
    const r = await gravarLegado(
      t,
      `insert into public.produtos (loja_id, nome, preco, foto_url) values ($1, 'Legado 2', 10.00, $2) returning id`,
      [lojaA, legada],
    );
    const id = r.rows[0].id as string;

    await atualizarFoto("donoA", id, null);

    expect((await produto(t, id))?.foto_url).toBeNull();
  });

  it("UPDATE de produto legado para imagem registrada ⇒ aceito (AFTER tolera valor antigo sem registro)", async () => {
    await exigirTriggers();
    const legada = urlStorage(`${lojaA}/${randomUUID()}.webp`);
    const r = await gravarLegado(
      t,
      `insert into public.produtos (loja_id, nome, preco, foto_url) values ($1, 'Legado 3', 10.00, $2) returning id`,
      [lojaA, legada],
    );
    const id = r.rows[0].id as string;
    const { camR } = await familia(lojaA);

    await atualizarFoto("donoA", id, urlStorage(camR));

    expect((await produto(t, id))?.foto_url).toBe(urlStorage(camR));
  });
});

// ═══════════════════════════════════════════════ BEFORE — lojas.logo_url
describe("[galeria/3] BEFORE lojas_logo_na_galeria_trg", () => {
  const recusas: Array<[string, () => Promise<string>]> = [
    ["caminho da loja NÃO registrado", async () => urlStorage(`${lojaA}/logo/${randomUUID()}.webp`)],
    [
      "imagem registrada da loja B",
      async () => {
        const cam = `${lojaB}/logo/${randomUUID()}.webp`;
        await registrarImagem(t, lojaB, cam);
        return urlStorage(cam);
      },
    ],
    [
      "imagem da loja com remoção pendente",
      async () => {
        const cam = `${lojaA}/logo/${randomUUID()}.webp`;
        await registrarImagem(t, lojaA, cam, { pendente: true });
        return urlStorage(cam);
      },
    ],
    ["URL https fora do Storage", async () => "https://exemplo.com/logo.webp"],
  ];

  for (const papel of ["donoA", "service"] as const) {
    it.each(recusas)(`UPDATE (${papel}) para %s ⇒ P0001 '${MSG}'; logo intacta`, async (_n, montar) => {
      const { camR } = await familia(lojaA, "logo");
      await definirLogo(t, lojaA, urlStorage(camR));
      const url = await montar();

      esperarErro(await erroDe(atualizarLogo(papel, lojaA, url)), "P0001", MSG);

      expect(await logoDa(t, lojaA)).toBe(urlStorage(camR));
    });
  }

  it("logo NULL ⇒ aceito", async () => {
    await exigirTriggers();
    await atualizarLogo("donoA", lojaA, null);
    expect(await logoDa(t, lojaA)).toBeNull();
  });

  it("logo com recorte registrado da loja ⇒ aceito (dono e serviço)", async () => {
    await exigirTriggers();
    const f1 = await familia(lojaA, "logo");
    await atualizarLogo("donoA", lojaA, urlStorage(f1.camR));
    expect(await logoDa(t, lojaA)).toBe(urlStorage(f1.camR));
    const f2 = await familia(lojaA, "logo");
    await atualizarLogo("service", lojaA, urlStorage(f2.camR));
    expect(await logoDa(t, lojaA)).toBe(urlStorage(f2.camR));
  });

  it("UPDATE da loja que reenvia a MESMA logo legada não registrada ⇒ aceito", async () => {
    await exigirTriggers();
    const legada = urlStorage(`${lojaA}/logo/${randomUUID()}.webp`);
    await gravarLegado(t, `update public.lojas set logo_url = $2 where id = $1`, [lojaA, legada]);

    await t.asUser(DONO_A, (s) =>
      s.query(`update public.lojas set nome = 'Loja A renomeada', logo_url = $2 where id = $1`, [lojaA, legada]),
    );

    expect(await logoDa(t, lojaA)).toBe(legada);
  });
});

// ═══════════════════════════════════════════════ AFTER — recorte sem uso (D5)
describe("[galeria/3] AFTER produtos_recorte_sem_uso_trg (D5)", () => {
  it("trocar a foto de um recorte usado SÓ por aquele produto ⇒ recorte pendente; o novo não", async () => {
    const f = await familia(lojaA);
    const novo = await familia(lojaA);
    const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(f.camR) });

    await atualizarFoto("donoA", p, urlStorage(novo.camR));

    expect((await imagem(t, f.r))?.remocao_pendente_em).not.toBeNull();
    expect((await imagem(t, f.o))?.remocao_pendente_em).toBeNull();
    expect((await imagem(t, novo.r))?.remocao_pendente_em).toBeNull();
  });

  it("remover a foto (NULL) de um recorte usado só por aquele produto ⇒ recorte pendente", async () => {
    const f = await familia(lojaA);
    const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(f.camR) });

    await atualizarFoto("donoA", p, null);

    expect((await imagem(t, f.r))?.remocao_pendente_em).not.toBeNull();
  });

  it("recorte também usado por OUTRO produto ⇒ intacto", async () => {
    const f = await familia(lojaA);
    const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(f.camR) });
    await criarProduto(t, lojaA, { fotoUrl: urlStorage(f.camR) });
    const antes = await imagem(t, f.r);

    await atualizarFoto("donoA", p, null);

    expect(await imagem(t, f.r)).toEqual(antes);
  });

  it("recorte também usado pela LOGO ⇒ intacto", async () => {
    const f = await familia(lojaA);
    const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(f.camR) });
    await definirLogo(t, lojaA, urlStorage(f.camR));
    const antes = await imagem(t, f.r);

    await atualizarFoto("donoA", p, null);

    expect(await imagem(t, f.r)).toEqual(antes);
  });

  it("valor antigo é ORIGINAL ⇒ original intacta", async () => {
    await exigirTriggers();
    const f = await familia(lojaA);
    const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(f.camO) });
    const antes = await imagem(t, f.o);

    await atualizarFoto("donoA", p, null);

    expect(await imagem(t, f.o)).toEqual(antes);
  });

  it("excluir o produto (único uso do recorte) ⇒ recorte pendente; original intacta (RN-G11)", async () => {
    const f = await familia(lojaA);
    const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(f.camR) });

    await t.asUser(DONO_A, (s) => s.query(`delete from public.produtos where id = $1`, [p]));

    expect((await imagem(t, f.r))?.remocao_pendente_em).not.toBeNull();
    expect((await imagem(t, f.o))?.remocao_pendente_em).toBeNull();
  });

  it("UPDATE de outra coluna (foto igual) ⇒ recorte intacto (WHEN IS DISTINCT FROM)", async () => {
    await exigirTriggers();
    const f = await familia(lojaA);
    const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(f.camR) });
    const antes = await imagem(t, f.r);

    await t.asUser(DONO_A, (s) =>
      s.query(`update public.produtos set nome = 'Renomeado', foto_url = $2 where id = $1`, [p, urlStorage(f.camR)]),
    );

    expect(await imagem(t, f.r)).toEqual(antes);
  });

  it("recorte de B com o MESMO nome de arquivo ⇒ intacto quando A troca a foto", async () => {
    const nome = `${randomUUID()}.webp`;
    const oA = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const rA = await registrarImagem(t, lojaA, `${lojaA}/${nome}`, { origemId: oA });
    const oB = await registrarImagem(t, lojaB, `${lojaB}/galeria/${randomUUID()}.webp`);
    const rB = await registrarImagem(t, lojaB, `${lojaB}/${nome}`, { origemId: oB });
    const p = await criarProduto(t, lojaA, { fotoUrl: urlStorage(`${lojaA}/${nome}`) });
    const bAntes = await estadoDa(t, lojaB);

    await atualizarFoto("donoA", p, null);

    expect((await imagem(t, rA))?.remocao_pendente_em).not.toBeNull();
    expect((await imagem(t, rB))?.remocao_pendente_em).toBeNull();
    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });
});

describe("[galeria/3] AFTER lojas_recorte_sem_uso_trg (D5)", () => {
  it("trocar a logo com recorte ⇒ recorte antigo pendente; remover a logo ⇒ o seguinte pendente", async () => {
    const f1 = await familia(lojaA, "logo");
    const f2 = await familia(lojaA, "logo");
    await definirLogo(t, lojaA, urlStorage(f1.camR));

    await atualizarLogo("donoA", lojaA, urlStorage(f2.camR));
    expect((await imagem(t, f1.r))?.remocao_pendente_em).not.toBeNull();
    expect((await imagem(t, f2.r))?.remocao_pendente_em).toBeNull();

    await atualizarLogo("donoA", lojaA, null);
    expect((await imagem(t, f2.r))?.remocao_pendente_em).not.toBeNull();
    expect((await imagem(t, f1.o))?.remocao_pendente_em).toBeNull();
    expect((await imagem(t, f2.o))?.remocao_pendente_em).toBeNull();
  });

  it("recorte da logo também usado por produto ⇒ intacto ao trocar a logo", async () => {
    const f = await familia(lojaA, "logo");
    await definirLogo(t, lojaA, urlStorage(f.camR));
    await criarProduto(t, lojaA, { fotoUrl: urlStorage(f.camR) });
    const antes = await imagem(t, f.r);

    await atualizarLogo("donoA", lojaA, null);

    expect(await imagem(t, f.r)).toEqual(antes);
  });

  it("logo antiga ORIGINAL ⇒ intacta", async () => {
    await exigirTriggers();
    const f = await familia(lojaA, "logo");
    await definirLogo(t, lojaA, urlStorage(f.camO));
    const antes = await imagem(t, f.o);

    await atualizarLogo("donoA", lojaA, null);

    expect(await imagem(t, f.o)).toEqual(antes);
  });

  it("recorte de logo de B com o mesmo nome de arquivo ⇒ intacto", async () => {
    const nome = `${randomUUID()}.webp`;
    const oA = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const rA = await registrarImagem(t, lojaA, `${lojaA}/logo/${nome}`, { origemId: oA });
    const oB = await registrarImagem(t, lojaB, `${lojaB}/galeria/${randomUUID()}.webp`);
    const rB = await registrarImagem(t, lojaB, `${lojaB}/logo/${nome}`, { origemId: oB });
    await definirLogo(t, lojaA, urlStorage(`${lojaA}/logo/${nome}`));

    await atualizarLogo("donoA", lojaA, null);

    expect((await imagem(t, rA))?.remocao_pendente_em).not.toBeNull();
    expect((await imagem(t, rB))?.remocao_pendente_em).toBeNull();
  });
});

// ═══════════════════════════════════════════════ regressão: DELETE da loja
describe("[galeria/3] regressão — excluir a loja com produtos e imagens", () => {
  it("DELETE da loja funciona com recortes em produtos e na logo; tudo cai em cascata; B intacta", async () => {
    await exigirTriggers();
    const DONO_C = "c6a5e000-0000-4000-8000-0000000000c5";
    const lojaC = await criarLoja(t, DONO_C, "galeria-trg-c");
    const f = await familia(lojaC);
    const fl = await familia(lojaC, "logo");
    await criarProduto(t, lojaC, { fotoUrl: urlStorage(f.camR) });
    await criarProduto(t, lojaC, { fotoUrl: urlStorage(f.camO) });
    await definirLogo(t, lojaC, urlStorage(fl.camR));
    const bAntes = await estadoDa(t, lojaB);

    await t.asService((s) => s.query(`delete from public.lojas where id = $1`, [lojaC]));

    const r = await t.asService((s) =>
      s.query<{ imagens: number; produtos: number; lojas: number }>(
        `select (select count(*)::int from public.imagens_loja where loja_id = $1) as imagens,
                (select count(*)::int from public.produtos where loja_id = $1) as produtos,
                (select count(*)::int from public.lojas where id = $1) as lojas`,
        [lojaC],
      ),
    );
    expect(r.rows[0]).toEqual({ imagens: 0, produtos: 0, lojas: 0 });
    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });
});

// ═══════════════════════════════════════════════ corrida remoção × save (em sequência)
describe("[galeria/3] corrida remoção × save — os dois resultados em sequência (pglite = 1 conexão)", () => {
  async function removerComoDono(ids: string[]) {
    const r = await t.asUser(DONO_A, (s) =>
      s.query<{ r: { produtos_limpos: number; removidas: number } }>(
        `select public.remover_imagens_loja($1::uuid, $2::uuid[]) as r`,
        [lojaA, ids],
      ),
    );
    return r.rows[0].r;
  }

  it("remoção PRIMEIRO ⇒ o save posterior com o recorte da original removida é recusado", async () => {
    const f = await familia(lojaA);
    const p = await criarProduto(t, lojaA, { fotoUrl: null });

    await removerComoDono([f.o]);

    esperarErro(await erroDe(atualizarFoto("donoA", p, urlStorage(f.camR))), "P0001", MSG);
    expect((await produto(t, p))?.foto_url).toBeNull();
  });

  it("save PRIMEIRO ⇒ a remoção limpa o produto recém-salvo", async () => {
    const f = await familia(lojaA);
    const p = await criarProduto(t, lojaA, { fotoUrl: null });

    await atualizarFoto("donoA", p, urlStorage(f.camR));
    const r = await removerComoDono([f.o]);

    expect(r.removidas).toBe(1);
    expect(r.produtos_limpos).toBe(1);
    expect((await produto(t, p))?.foto_url).toBeNull();
  });
});
