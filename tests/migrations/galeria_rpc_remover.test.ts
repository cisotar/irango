import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, type TestDb } from "../helpers/pglite";
import {
  comoSessao,
  criarLoja,
  criarProduto,
  definirLogo,
  erroDe,
  esperarErro,
  estadoDa,
  imagem,
  imagensDa,
  logoDa,
  produto,
  registrarImagem,
  urlStorage,
} from "../helpers/galeria";

/**
 * Fase RED (TDD) — galeria de imagens, item 2 do spec:
 *
 *   public.remover_imagens_loja(p_loja_id uuid, p_ids uuid[]) → jsonb
 *     { caminhos: text[], removidas: int, ignoradas: int,
 *       produtos_limpos: int, logo_limpa: bool }
 *
 * Autoridade: specs/galeria-imagens-loja.md §"Ordem das operações na remoção",
 * RN-G7/G8/G9, D1, D8 · plan/loop-galeria-imagens-loja.md DP7.
 *
 * Contrato de erros (DP7):
 *   'remover_imagens_loja: lote inválido'       SQLSTATE 22023 (0, > 50, duplicata, NULL)
 *   'remover_imagens_loja: sem posse da loja'   SQLSTATE 42501 (T2, antes de qualquer escrita)
 *
 * Por que é RED: a tabela `imagens_loja` (M1) e a função (M2) não existem.
 *
 * Anti-falso-verde:
 *  - recusa = SQLSTATE + fragmento (memória sqlstate-nao-basta-em-teste-de-escopo);
 *  - estado da loja B é um SNAPSHOT completo (imagens com timestamps, produtos,
 *    logo) relido pela via de serviço num bloco separado — não basta a contagem;
 *  - a loja B tem caminhos "parecidos" (mesmo nome de arquivo em outra pasta):
 *    um casamento por sufixo ou sem filtro de loja os pegaria.
 */

const DONO_A = "a6a2e000-0000-4000-8000-0000000000a2";
const DONO_B = "b6a2e000-0000-4000-8000-0000000000b2";

let t: TestDb;
let lojaA: string;
let lojaB: string;

beforeAll(async () => {
  t = await createTestDb();
  lojaA = await criarLoja(t, DONO_A, "galeria-rem-a");
  lojaB = await criarLoja(t, DONO_B, "galeria-rem-b");
}, 60_000);

afterAll(async () => {
  await t?.close();
});

type Resultado = {
  caminhos: string[];
  removidas: number;
  ignoradas: number;
  produtos_limpos: number;
  logo_limpa: boolean;
};

type Papel = "donoA" | "service" | "anon";

function chamar(s: PGlite, lojaId: string, ids: string[] | null) {
  return s.query<{ r: Resultado }>(`select public.remover_imagens_loja($1::uuid, $2::uuid[]) as r`, [lojaId, ids]);
}

async function remover(papel: Papel, lojaId: string, ids: string[] | null): Promise<Resultado> {
  const fn = (s: PGlite) => chamar(s, lojaId, ids);
  const r = papel === "donoA" ? await t.asUser(DONO_A, fn) : papel === "anon" ? await t.asAnon(fn) : await t.asService(fn);
  return r.rows[0].r;
}

const ordenado = (xs: string[]) => [...xs].sort();

/**
 * Cenário completo, novo a cada teste (uuids frescos):
 *  A: O1 (original + miniatura), C1 (recorte de O1 na raiz), L1 (recorte de O1
 *     em logo/, é a logo de A), O2 (original + miniatura, controle), O3 (legada,
 *     sem miniatura);
 *     P1 usa O1 (oculto), P2 usa C1 (indisponível), P4 usa O1 (nunca na vitrine),
 *     P3 usa O2 (controle).
 *  B: OB e CB com o MESMO nome de arquivo de O1 e C1 em outra pasta; PB usa CB;
 *     logo de B = OB.
 */
async function cenario() {
  const u1 = randomUUID();
  const u2 = randomUUID();
  const u3 = randomUUID();
  const u4 = randomUUID();
  const u5 = randomUUID();

  const cam = {
    o1: `${lojaA}/galeria/${u1}.webp`,
    o1mini: `${lojaA}/galeria/mini/${u1}.webp`,
    c1: `${lojaA}/${u2}.webp`,
    l1: `${lojaA}/logo/${u3}.webp`,
    o2: `${lojaA}/galeria/${u4}.webp`,
    o2mini: `${lojaA}/galeria/mini/${u4}.webp`,
    o3: `${lojaA}/${u5}.webp`,
    ob: `${lojaB}/galeria/${u1}.webp`,
    obmini: `${lojaB}/galeria/mini/${u1}.webp`,
    cb: `${lojaB}/${u2}.webp`,
  };

  const o1 = await registrarImagem(t, lojaA, cam.o1, { miniatura: cam.o1mini });
  const c1 = await registrarImagem(t, lojaA, cam.c1, { origemId: o1 });
  const l1 = await registrarImagem(t, lojaA, cam.l1, { origemId: o1 });
  const o2 = await registrarImagem(t, lojaA, cam.o2, { miniatura: cam.o2mini });
  const o3 = await registrarImagem(t, lojaA, cam.o3);
  const ob = await registrarImagem(t, lojaB, cam.ob, { miniatura: cam.obmini });
  const cb = await registrarImagem(t, lojaB, cam.cb, { origemId: ob });

  const p1 = await criarProduto(t, lojaA, { nome: "P1 oculto", fotoUrl: urlStorage(cam.o1), oculto: true });
  const p2 = await criarProduto(t, lojaA, { nome: "P2 indisponível", fotoUrl: urlStorage(cam.c1), disponivel: false });
  const p3 = await criarProduto(t, lojaA, { nome: "P3 controle", fotoUrl: urlStorage(cam.o2) });
  const p4 = await criarProduto(t, lojaA, { nome: "P4 nunca", fotoUrl: urlStorage(cam.o1), nuncaNaVitrine: true });
  const pb = await criarProduto(t, lojaB, { nome: "PB", fotoUrl: urlStorage(cam.cb) });

  await definirLogo(t, lojaA, urlStorage(cam.l1));
  await definirLogo(t, lojaB, urlStorage(cam.ob));

  return { cam, o1, c1, l1, o2, o3, ob, cb, p1, p2, p3, p4, pb };
}

// ═══════════════════════════════════════════════ via de serviço, caminho feliz
describe("[galeria/2] remover_imagens_loja — via de serviço com p_loja_id correto", () => {
  it("remove O1: limpa produtos (oculto, indisponível, nunca na vitrine) e logo que usam original OU cópia; marca família pendente; devolve caminhos com miniatura", async () => {
    const c = await cenario();
    const bAntes = await estadoDa(t, lojaB);

    const r = await remover("service", lojaA, [c.o1]);

    expect(r.removidas).toBe(1);
    expect(r.ignoradas).toBe(0);
    expect(r.produtos_limpos).toBe(3);
    expect(r.logo_limpa).toBe(true);
    expect(ordenado(r.caminhos)).toEqual(ordenado([c.cam.o1, c.cam.o1mini, c.cam.c1, c.cam.l1]));

    // produtos de A: foto zerada, demais colunas preservadas
    expect(await produto(t, c.p1)).toMatchObject({ foto_url: null, oculto: true });
    expect(await produto(t, c.p2)).toMatchObject({ foto_url: null, disponivel: false });
    expect(await produto(t, c.p4)).toMatchObject({ foto_url: null });
    expect((await produto(t, c.p3))?.foto_url).toBe(urlStorage(c.cam.o2));
    expect(await logoDa(t, lojaA)).toBeNull();

    // família de O1 pendente; controle intacto
    for (const id of [c.o1, c.c1, c.l1]) {
      expect((await imagem(t, id))?.remocao_pendente_em, `pendente: ${id}`).not.toBeNull();
    }
    expect((await imagem(t, c.o2))?.remocao_pendente_em).toBeNull();
    expect((await imagem(t, c.o3))?.remocao_pendente_em).toBeNull();

    // B intacta, inclusive OB/CB com o mesmo nome de arquivo
    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });

  it("caminhos devolvidos começam todos com '<loja A>/' (nenhum caminho de B)", async () => {
    const c = await cenario();
    const r = await remover("service", lojaA, [c.o1, c.o2]);
    expect(r.caminhos.length).toBeGreaterThan(0);
    expect(r.caminhos.every((x) => x.startsWith(`${lojaA}/`))).toBe(true);
  });

  it("original sem uso (legada, sem miniatura) ⇒ removidas 1, nada limpo, caminho único devolvido", async () => {
    const c = await cenario();
    const r = await remover("service", lojaA, [c.o3]);
    expect(r).toEqual({ caminhos: [c.cam.o3], removidas: 1, ignoradas: 0, produtos_limpos: 0, logo_limpa: false });
    expect((await imagem(t, c.o3))?.remocao_pendente_em).not.toBeNull();
    expect((await produto(t, c.p1))?.foto_url).toBe(urlStorage(c.cam.o1));
    expect(await logoDa(t, lojaA)).toBe(urlStorage(c.cam.l1));
  });
});

// ═══════════════════════════════════════════════════════ lote misto (D8, RN-G9)
describe("[galeria/2] lote misto — id de B no lote do dono A", () => {
  it("[O1 de A, OB de B] ⇒ remove só O1, ignoradas = 1; linha, produtos e logo de B INTACTOS", async () => {
    const c = await cenario();
    const bAntes = await estadoDa(t, lojaB);

    const r = await remover("donoA", lojaA, [c.o1, c.ob]);

    expect(r.removidas).toBe(1);
    expect(r.ignoradas).toBe(1);
    expect(r.caminhos.every((x) => x.startsWith(`${lojaA}/`))).toBe(true);

    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
    expect((await imagem(t, c.ob))?.remocao_pendente_em).toBeNull();
    expect((await imagem(t, c.cb))?.remocao_pendente_em).toBeNull();
    expect((await produto(t, c.pb))?.foto_url).toBe(urlStorage(c.cam.cb));
    expect(await logoDa(t, lojaB)).toBe(urlStorage(c.cam.ob));

    expect((await imagem(t, c.o1))?.remocao_pendente_em).not.toBeNull();
  });

  it("via de serviço com p_loja_id = A e lote [OB] ⇒ removidas 0, ignoradas 1; B intacta (filtro vale sem RLS)", async () => {
    const c = await cenario();
    const bAntes = await estadoDa(t, lojaB);

    const r = await remover("service", lojaA, [c.ob]);

    expect(r).toEqual({ caminhos: [], removidas: 0, ignoradas: 1, produtos_limpos: 0, logo_limpa: false });
    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });

  it("id de CÓPIA (C1) e id PENDENTE no lote contam como ignorados; a cópia e quem a usa ficam intactos", async () => {
    const c = await cenario();
    const pendente = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`, { pendente: true });
    const pendenteAntes = await imagem(t, pendente);

    const r = await remover("donoA", lojaA, [c.c1, pendente, c.o3]);

    expect(r.removidas).toBe(1);
    expect(r.ignoradas).toBe(2);
    expect(r.caminhos).toEqual([c.cam.o3]);
    expect((await imagem(t, c.c1))?.remocao_pendente_em).toBeNull();
    expect((await produto(t, c.p2))?.foto_url).toBe(urlStorage(c.cam.c1));
    expect(await imagem(t, pendente)).toEqual(pendenteAntes);
  });

  it("id inexistente no lote conta como ignorado", async () => {
    const c = await cenario();
    const r = await remover("donoA", lojaA, [c.o3, randomUUID()]);
    expect(r.removidas).toBe(1);
    expect(r.ignoradas).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════ idempotência (2ª chamada)
describe("[galeria/2] segunda chamada com os mesmos ids", () => {
  it("⇒ removidas 0, ignoradas N, caminhos [], nada limpo e NENHUMA escrita (timestamps idênticos)", async () => {
    const c = await cenario();
    await remover("donoA", lojaA, [c.o1, c.o2]);
    const aDepois1 = await estadoDa(t, lojaA);

    const r = await remover("donoA", lojaA, [c.o1, c.o2]);

    expect(r).toEqual({ caminhos: [], removidas: 0, ignoradas: 2, produtos_limpos: 0, logo_limpa: false });
    expect(await estadoDa(t, lojaA)).toEqual(aDepois1);
  });
});

// ═══════════════════════════════════════════════════════ posse (T2) e forja
describe("[galeria/2] posse — T2 antes de qualquer escrita", () => {
  it.each([
    ["ids de B", true],
    ["ids inexistentes (sob RLS seria '0 linhas', indistinguível de sucesso)", false],
  ])("dono A com p_loja_id de B e %s ⇒ 42501 'sem posse da loja'; B intacta", async (_n, idsDeB) => {
    const c = await cenario();
    const bAntes = await estadoDa(t, lojaB);
    const ids = idsDeB ? [c.ob] : [randomUUID()];

    esperarErro(
      await erroDe(remover("donoA", lojaB, ids)),
      "42501",
      "remover_imagens_loja: sem posse da loja",
    );

    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });

  it("sessão authenticated com claim role FORJADO 'service_role' ⇒ 'sem posse da loja'; B intacta", async () => {
    const c = await cenario();
    const bAntes = await estadoDa(t, lojaB);

    esperarErro(
      await erroDe(
        comoSessao(t, "authenticated", { sub: DONO_A, role: "service_role" }, (s) => chamar(s, lojaB, [c.ob])),
      ),
      "42501",
      "remover_imagens_loja: sem posse da loja",
    );

    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });

  it("role SQL service_role com claim 'authenticated' de A (sinais divergentes) ⇒ 'sem posse da loja'; B intacta", async () => {
    const c = await cenario();
    const bAntes = await estadoDa(t, lojaB);

    esperarErro(
      await erroDe(
        comoSessao(t, "service_role", { sub: DONO_A, role: "authenticated" }, (s) => chamar(s, lojaB, [c.ob])),
      ),
      "42501",
      "remover_imagens_loja: sem posse da loja",
    );

    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });

  it("anon ⇒ 42501 nomeando a função (sem EXECUTE); A intacta", async () => {
    const c = await cenario();
    const aAntes = await estadoDa(t, lojaA);

    esperarErro(await erroDe(remover("anon", lojaA, [c.o1])), "42501", "remover_imagens_loja");

    expect(await estadoDa(t, lojaA)).toEqual(aAntes);
  });
});

// ═══════════════════════════════════════════════════════ forma do lote (T1)
describe("[galeria/2] forma do lote — 1 a 50 ids distintos", () => {
  const casos: Array<[string, (o1: string) => string[] | null]> = [
    ["lote vazio", () => []],
    ["lote NULL", () => null],
    ["51 ids", (o1) => [o1, ...Array.from({ length: 50 }, () => randomUUID())]],
    ["id duplicado", (o1) => [o1, o1]],
  ];

  it.each(casos)("%s ⇒ 22023 'lote inválido'; A intacta", async (_n, montar) => {
    const c = await cenario();
    const aAntes = await estadoDa(t, lojaA);

    esperarErro(
      await erroDe(remover("donoA", lojaA, montar(c.o1))),
      "22023",
      "remover_imagens_loja: lote inválido",
    );

    expect(await estadoDa(t, lojaA)).toEqual(aAntes);
  });

  it("50 ids (teto) ⇒ aceito: 1 removida, 49 ignoradas", async () => {
    const c = await cenario();
    const ids = [c.o3, ...Array.from({ length: 49 }, () => randomUUID())];
    const r = await remover("donoA", lojaA, ids);
    expect(r.removidas).toBe(1);
    expect(r.ignoradas).toBe(49);
  });
});

// ═══════════════════════════════════════════════════════════════ catálogo
describe("[galeria/M2] catálogo de remover_imagens_loja", () => {
  const ASSINATURA = "public.remover_imagens_loja(uuid, uuid[])";

  it("SECURITY INVOKER, search_path fixado, retorna jsonb", async () => {
    const r = await t.db.query<{ prosecdef: boolean; proconfig: string[] | null; ret: string }>(
      `select prosecdef, proconfig, prorettype::regtype::text as ret from pg_proc where oid = $1::regprocedure`,
      [ASSINATURA],
    );
    expect(r.rows[0].prosecdef).toBe(false);
    expect((r.rows[0].proconfig ?? []).some((x) => x.startsWith("search_path="))).toBe(true);
    expect(r.rows[0].ret).toBe("jsonb");
  });

  it("EXECUTE: anon não; authenticated e service_role sim", async () => {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
      [ASSINATURA],
    );
    expect(r.rows[0]).toEqual({ anon: false, auth: true, svc: true });
  });
});

// Garantia de que o snapshot da loja não é vazio (o "intacto" compara algo real).
describe("[galeria/2] sanidade do cenário", () => {
  it("cenário monta imagens, produtos e logo em B", async () => {
    await cenario();
    const b = await estadoDa(t, lojaB);
    expect(b.imagens.length).toBeGreaterThan(0);
    expect(b.produtos.length).toBeGreaterThan(0);
    expect(b.logo).not.toBeNull();
    expect((await imagensDa(t, lojaA)).length).toBeGreaterThan(0);
  });
});
