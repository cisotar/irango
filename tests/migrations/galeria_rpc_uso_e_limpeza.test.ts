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
  registrarImagem,
  urlStorage,
} from "../helpers/galeria";

/**
 * Fase RED (TDD) — galeria de imagens, RPCs de leitura de uso e varredura (M2):
 *
 *   public.uso_imagens_loja(p_loja_id uuid, p_ids uuid[])
 *     RETURNS TABLE (imagem_id uuid, produtos_total int, produtos jsonb, na_logo boolean)
 *     — uma linha por ORIGINAL da loja entre p_ids (inclusive sem uso: 0/[]/false);
 *       `produtos` = jsonb array de até 5 objetos {id, nome, oculto}.
 *     (formato de retorno é PREMISSA deste RED — o spec fixa o conteúdo, não as colunas)
 *
 *   public.limpar_recortes_sem_uso(p_loja_id uuid) → text[]
 *     — marca pendentes os RECORTES da loja sem referência e com criado_em < now() - 24 h
 *       (P12) e devolve, com teto de 50, os caminhos de TODAS as linhas pendentes da loja.
 *
 * Autoridade: specs/galeria-imagens-loja.md §"Funções e triggers", RN-G21, P12,
 * §Segurança item 6 · plan/loop-galeria-imagens-loja.md DP7
 * ('<funcao>: sem posse da loja', 42501).
 *
 * Por que é RED: `imagens_loja` (M1) e as funções (M2) não existem.
 */

const DONO_A = "a6a3e000-0000-4000-8000-0000000000a3";
const DONO_B = "b6a3e000-0000-4000-8000-0000000000b3";
const DONO_C = "c6a3e000-0000-4000-8000-0000000000c3";

let t: TestDb;
let lojaA: string;
let lojaB: string;
let lojaC: string;

beforeAll(async () => {
  t = await createTestDb();
  lojaA = await criarLoja(t, DONO_A, "galeria-uso-a");
  lojaB = await criarLoja(t, DONO_B, "galeria-uso-b");
  lojaC = await criarLoja(t, DONO_C, "galeria-uso-c");
}, 60_000);

afterAll(async () => {
  await t?.close();
});

type Papel = "donoA" | "service" | "anon";
function como<T>(papel: Papel, fn: (s: PGlite) => Promise<T>): Promise<T> {
  if (papel === "donoA") return t.asUser(DONO_A, fn);
  if (papel === "anon") return t.asAnon(fn);
  return t.asService(fn);
}

type ProdutoUso = { id: string; nome: string; oculto: boolean };
type LinhaUso = { imagem_id: string; produtos_total: number; produtos: ProdutoUso[]; na_logo: boolean };

function chamarUso(s: PGlite, lojaId: string, ids: string[]) {
  return s.query<LinhaUso>(
    `select imagem_id, produtos_total, produtos, na_logo from public.uso_imagens_loja($1::uuid, $2::uuid[])`,
    [lojaId, ids],
  );
}
async function uso(papel: Papel, lojaId: string, ids: string[]): Promise<LinhaUso[]> {
  return (await como(papel, (s) => chamarUso(s, lojaId, ids))).rows;
}

function chamarLimpar(s: PGlite, lojaId: string) {
  return s.query<{ c: string[] }>(`select public.limpar_recortes_sem_uso($1::uuid) as c`, [lojaId]);
}
async function limpar(papel: Papel, lojaId: string): Promise<string[]> {
  return (await como(papel, (s) => chamarLimpar(s, lojaId))).rows[0].c;
}

const H25 = () => new Date(Date.now() - 25 * 3600_000).toISOString();
const H1 = () => new Date(Date.now() - 1 * 3600_000).toISOString();

const porId = (ps: ProdutoUso[]) => [...ps].sort((a, b) => a.id.localeCompare(b.id));

// ═══════════════════════════════════════════════════════════ uso_imagens_loja
describe("[galeria/M2] uso_imagens_loja — uso da original OU de qualquer cópia", () => {
  async function cenarioUso() {
    const u1 = randomUUID();
    const u2 = randomUUID();
    const o1 = await registrarImagem(t, lojaA, `${lojaA}/galeria/${u1}.webp`);
    const c1 = `${lojaA}/${u2}.webp`;
    await registrarImagem(t, lojaA, c1, { origemId: o1 });
    const l1 = `${lojaA}/logo/${randomUUID()}.webp`;
    await registrarImagem(t, lojaA, l1, { origemId: o1 });
    const o2 = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);

    // B com nomes de arquivo iguais aos de A
    const ob = await registrarImagem(t, lojaB, `${lojaB}/galeria/${u1}.webp`);
    const cb = `${lojaB}/${u2}.webp`;
    await registrarImagem(t, lojaB, cb, { origemId: ob });

    const p1 = await criarProduto(t, lojaA, { nome: "Pastel oculto", fotoUrl: urlStorage(`${lojaA}/galeria/${u1}.webp`), oculto: true });
    const p2 = await criarProduto(t, lojaA, { nome: "Coxinha", fotoUrl: urlStorage(c1), disponivel: false });
    await criarProduto(t, lojaB, { nome: "Produto de B", fotoUrl: urlStorage(cb) });
    await criarProduto(t, lojaB, { nome: "Outro de B", fotoUrl: urlStorage(cb) });
    await definirLogo(t, lojaA, urlStorage(l1));

    return { o1, o2, ob, p1, p2 };
  }

  it("O1 usada por 1 produto pela original, 1 pela cópia e pela logo (via cópia) ⇒ total 2, nomes+oculto, na_logo true", async () => {
    const c = await cenarioUso();
    const linhas = await uso("donoA", lojaA, [c.o1]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].imagem_id).toBe(c.o1);
    expect(linhas[0].produtos_total).toBe(2);
    expect(linhas[0].na_logo).toBe(true);
    expect(porId(linhas[0].produtos)).toEqual(
      porId([
        { id: c.p1, nome: "Pastel oculto", oculto: true },
        { id: c.p2, nome: "Coxinha", oculto: false },
      ]),
    );
  });

  it("original sem uso ⇒ linha com 0, [] e na_logo false", async () => {
    const c = await cenarioUso();
    const linhas = await uso("donoA", lojaA, [c.o2]);
    expect(linhas).toEqual([{ imagem_id: c.o2, produtos_total: 0, produtos: [], na_logo: false }]);
  });

  it("id de B no lote não devolve linha e os produtos de B (mesmo nome de arquivo) não somam em A", async () => {
    const c = await cenarioUso();
    const linhas = await uso("donoA", lojaA, [c.o1, c.ob]);

    expect(linhas.map((l) => l.imagem_id)).toEqual([c.o1]);
    expect(linhas[0].produtos_total).toBe(2);
    expect(linhas[0].produtos.map((p) => p.nome)).not.toContain("Produto de B");
  });

  it("via de serviço com p_loja_id de A também não enxerga B (filtro explícito, sem RLS)", async () => {
    const c = await cenarioUso();
    const linhas = await uso("service", lojaA, [c.o1, c.ob]);
    expect(linhas.map((l) => l.imagem_id)).toEqual([c.o1]);
    expect(linhas[0].produtos_total).toBe(2);
  });

  it("6 produtos usando a família ⇒ total 6, no máximo 5 itens em `produtos`", async () => {
    const o = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const rec = `${lojaA}/${randomUUID()}.webp`;
    await registrarImagem(t, lojaA, rec, { origemId: o });
    for (let i = 0; i < 6; i++) await criarProduto(t, lojaA, { nome: `Item ${i}`, fotoUrl: urlStorage(rec) });

    const [linha] = await uso("donoA", lojaA, [o]);
    expect(linha.produtos_total).toBe(6);
    expect(linha.produtos).toHaveLength(5);
  });

  it("dono A com p_loja_id de B ⇒ 42501 'uso_imagens_loja: sem posse da loja'", async () => {
    const c = await cenarioUso();
    esperarErro(await erroDe(uso("donoA", lojaB, [c.ob])), "42501", "uso_imagens_loja: sem posse da loja");
  });

  it("claim role FORJADO 'service_role' em sessão authenticated ⇒ 'uso_imagens_loja: sem posse da loja'", async () => {
    const c = await cenarioUso();
    esperarErro(
      await erroDe(comoSessao(t, "authenticated", { sub: DONO_A, role: "service_role" }, (s) => chamarUso(s, lojaB, [c.ob]))),
      "42501",
      "uso_imagens_loja: sem posse da loja",
    );
  });

  it("anon ⇒ 42501 nomeando a função", async () => {
    const c = await cenarioUso();
    esperarErro(await erroDe(uso("anon", lojaA, [c.o1])), "42501", "uso_imagens_loja");
  });
});

// ═══════════════════════════════════════════════════ limpar_recortes_sem_uso (item 6)
describe("[galeria/6] limpar_recortes_sem_uso — varredura de garantia (RN-G21, P12)", () => {
  it("recorte sem uso há 25 h ⇒ marcado pendente e caminho devolvido", async () => {
    const o = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const cam = `${lojaA}/${randomUUID()}.webp`;
    const r = await registrarImagem(t, lojaA, cam, { origemId: o, criadoEm: H25() });

    const caminhos = await limpar("donoA", lojaA);

    expect((await imagem(t, r))?.remocao_pendente_em).not.toBeNull();
    expect(caminhos).toContain(cam);
  });

  it("recorte sem uso há 1 h ⇒ intacto (carência de 24 h) e não devolvido", async () => {
    const o = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const cam = `${lojaA}/${randomUUID()}.webp`;
    const r = await registrarImagem(t, lojaA, cam, { origemId: o, criadoEm: H1() });
    const antes = await imagem(t, r);

    const caminhos = await limpar("donoA", lojaA);

    expect(await imagem(t, r)).toEqual(antes);
    expect(caminhos).not.toContain(cam);
  });

  it("recorte de 25 h em uso por produto (mesmo oculto) ⇒ intacto", async () => {
    const o = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const cam = `${lojaA}/${randomUUID()}.webp`;
    const r = await registrarImagem(t, lojaA, cam, { origemId: o, criadoEm: H25() });
    await criarProduto(t, lojaA, { fotoUrl: urlStorage(cam), oculto: true });
    const antes = await imagem(t, r);

    const caminhos = await limpar("donoA", lojaA);

    expect(await imagem(t, r)).toEqual(antes);
    expect(caminhos).not.toContain(cam);
  });

  it("recorte de 25 h em uso pela logo ⇒ intacto", async () => {
    const o = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const cam = `${lojaA}/logo/${randomUUID()}.webp`;
    const r = await registrarImagem(t, lojaA, cam, { origemId: o, criadoEm: H25() });
    await definirLogo(t, lojaA, urlStorage(cam));
    const antes = await imagem(t, r);

    const caminhos = await limpar("donoA", lojaA);

    expect(await imagem(t, r)).toEqual(antes);
    expect(caminhos).not.toContain(cam);
  });

  it("ORIGINAL sem uso há 25 h ⇒ intacta (a varredura só toca recortes)", async () => {
    const cam = `${lojaA}/galeria/${randomUUID()}.webp`;
    const o = await registrarImagem(t, lojaA, cam, { criadoEm: H25() });
    const antes = await imagem(t, o);

    const caminhos = await limpar("donoA", lojaA);

    expect(await imagem(t, o)).toEqual(antes);
    expect(caminhos).not.toContain(cam);
  });

  it("loja B com recorte sem uso de 25 h ⇒ intacta e fora da lista quando A varre", async () => {
    const ob = await registrarImagem(t, lojaB, `${lojaB}/galeria/${randomUUID()}.webp`);
    const camB = `${lojaB}/${randomUUID()}.webp`;
    await registrarImagem(t, lojaB, camB, { origemId: ob, criadoEm: H25() });
    const pendenteB = `${lojaB}/${randomUUID()}.webp`;
    await registrarImagem(t, lojaB, pendenteB, { origemId: ob, pendente: true });
    const bAntes = await estadoDa(t, lojaB);

    const caminhos = await limpar("donoA", lojaA);

    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
    expect(caminhos.every((c) => c.startsWith(`${lojaA}/`))).toBe(true);
    expect(caminhos).not.toContain(camB);
    expect(caminhos).not.toContain(pendenteB);
  });

  it("devolve também pendentes que sobraram de falha anterior (original pendente e recorte pendente)", async () => {
    const o = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const camRecPend = `${lojaA}/${randomUUID()}.webp`;
    await registrarImagem(t, lojaA, camRecPend, { origemId: o, pendente: true });
    const camOrigPend = `${lojaA}/galeria/${randomUUID()}.webp`;
    await registrarImagem(t, lojaA, camOrigPend, { pendente: true });

    const caminhos = await limpar("donoA", lojaA);

    expect(caminhos).toContain(camRecPend);
    expect(caminhos).toContain(camOrigPend);
  });

  it("teto de 50 caminhos por chamada (60 pendentes na loja C)", async () => {
    const o = await registrarImagem(t, lojaC, `${lojaC}/galeria/${randomUUID()}.webp`);
    for (let i = 0; i < 60; i++) {
      await registrarImagem(t, lojaC, `${lojaC}/${randomUUID()}.webp`, { origemId: o, pendente: true });
    }

    const caminhos = await t.asService((s) => chamarLimpar(s, lojaC));
    const lista = caminhos.rows[0].c;

    expect(lista).toHaveLength(50);
    expect(new Set(lista).size).toBe(50);
    expect(lista.every((c) => c.startsWith(`${lojaC}/`))).toBe(true);
  });

  it("via de serviço com p_loja_id de A ⇒ varre A (mesmo resultado do dono)", async () => {
    const o = await registrarImagem(t, lojaA, `${lojaA}/galeria/${randomUUID()}.webp`);
    const cam = `${lojaA}/${randomUUID()}.webp`;
    const r = await registrarImagem(t, lojaA, cam, { origemId: o, criadoEm: H25() });

    const caminhos = await limpar("service", lojaA);

    expect((await imagem(t, r))?.remocao_pendente_em).not.toBeNull();
    expect(caminhos).toContain(cam);
  });

  it("dono A com p_loja_id de B ⇒ 42501 'limpar_recortes_sem_uso: sem posse da loja'; B intacta", async () => {
    const ob = await registrarImagem(t, lojaB, `${lojaB}/galeria/${randomUUID()}.webp`);
    await registrarImagem(t, lojaB, `${lojaB}/${randomUUID()}.webp`, { origemId: ob, criadoEm: H25() });
    const bAntes = await estadoDa(t, lojaB);

    esperarErro(await erroDe(limpar("donoA", lojaB)), "42501", "limpar_recortes_sem_uso: sem posse da loja");

    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });

  it("claim role FORJADO 'service_role' em sessão authenticated ⇒ 'sem posse da loja'; B intacta", async () => {
    const ob = await registrarImagem(t, lojaB, `${lojaB}/galeria/${randomUUID()}.webp`);
    await registrarImagem(t, lojaB, `${lojaB}/${randomUUID()}.webp`, { origemId: ob, criadoEm: H25() });
    const bAntes = await estadoDa(t, lojaB);

    esperarErro(
      await erroDe(comoSessao(t, "authenticated", { sub: DONO_A, role: "service_role" }, (s) => chamarLimpar(s, lojaB))),
      "42501",
      "limpar_recortes_sem_uso: sem posse da loja",
    );

    expect(await estadoDa(t, lojaB)).toEqual(bAntes);
  });

  it("anon ⇒ 42501 nomeando a função", async () => {
    esperarErro(await erroDe(limpar("anon", lojaA)), "42501", "limpar_recortes_sem_uso");
  });

  it("sanidade: a loja B do teste de isolamento tem linhas (o 'intacta' compara algo real)", async () => {
    await registrarImagem(t, lojaB, `${lojaB}/galeria/${randomUUID()}.webp`);
    expect((await imagensDa(t, lojaB)).length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════ catálogo
describe("[galeria/M2] catálogo das funções de uso e varredura", () => {
  const FUNCOES: Array<[string, string]> = [
    ["public.uso_imagens_loja(uuid, uuid[])", "s"],
    ["public.limpar_recortes_sem_uso(uuid)", "v"],
    ["public.remover_imagens_loja(uuid, uuid[])", "v"],
  ];

  it.each(FUNCOES)("%s: SECURITY INVOKER, volatilidade '%s', search_path fixado", async (assinatura, vol) => {
    const r = await t.db.query<{ prosecdef: boolean; provolatile: string; proconfig: string[] | null }>(
      `select prosecdef, provolatile, proconfig from pg_proc where oid = $1::regprocedure`,
      [assinatura],
    );
    expect(r.rows[0].prosecdef).toBe(false);
    expect(r.rows[0].provolatile).toBe(vol);
    expect((r.rows[0].proconfig ?? []).some((x) => x.startsWith("search_path="))).toBe(true);
  });

  it.each(FUNCOES)("%s: EXECUTE anon não; authenticated e service_role sim", async (assinatura) => {
    const r = await t.db.query<Record<string, boolean>>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('public', $1, 'EXECUTE') as publico,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as svc`,
      [assinatura],
    );
    expect(r.rows[0]).toEqual({ anon: false, publico: false, auth: true, svc: true });
  });

  it("limpar_recortes_sem_uso retorna text[]", async () => {
    const r = await t.db.query<{ ret: string }>(
      `select prorettype::regtype::text as ret from pg_proc where oid = 'public.limpar_recortes_sem_uso(uuid)'::regprocedure`,
    );
    expect(r.rows[0].ret).toBe("text[]");
  });
});
