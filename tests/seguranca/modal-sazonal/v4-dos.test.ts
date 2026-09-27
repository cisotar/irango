import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createTestDb, type TestDb } from "../../helpers/pglite";
import {
  argsEdicaoValidos,
  capturarErro,
  chamarSalvarModal,
  contarDaLoja,
  fotografarModal,
  literalArray,
  mensagemMinima,
  semearCenario,
  type CenarioModalSazonal,
} from "./seed";

/**
 * Fase RED — issue 307, VETOR V4 (DoS, cardinalidade e padding; CWE-770).
 * Spec `specs/modal-sazonal-mensagem-formatada.md` §Matriz V4, RN-M03, RN-M08, RN-M15 (S3).
 *
 * Uma suíte, o vetor inteiro de ponta a ponta:
 *   A5  zod: tetos BRUTOS antes do transform (reprova sem transformar) e tetos
 *       CANÔNICOS depois (fronteiras exatas);
 *   A7  canonização ANTES de medir (padding não contorna teto);
 *   A22 estrutura plana: profundidade forçada reprova sem RangeError;
 *   A30 RPC `salvar_modal_sazonal` chamada DIRETO (asUser do dono) com arrays hostis;
 *   A8b documento de 70 KB gravado direto na tabela → CHECK de bytes.
 *
 * Escrito a partir do SPEC/ISSUE, nunca da implementação (que não existe).
 * O módulo zod é importado DINAMICAMENTE por teste: enquanto não existe, cada
 * teste falha sozinho (em vez de a suíte inteira cair na coleta), e os testes
 * pglite seguem rodando e falhando na asserção.
 */

// ── espião do transform ────────────────────────────────────────────────────
// "Reprova SEM transformar" (A5): conta as chamadas de `removerInvisiveisEControles`,
// que o `texto` de todo trecho atravessa no transform (RN-M03). Um payload que
// estoura teto BRUTO não pode chegar a transformar nenhum trecho.
const espiao = vi.hoisted(() => ({ chamadas: 0 }));
vi.mock("@/lib/utils/normalizarObservacao", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  const real = original.removerInvisiveisEControles as
    | ((texto: string, opcoes?: { preservarJuncaoDeEmoji?: boolean }) => string)
    | undefined;
  return {
    ...original,
    removerInvisiveisEControles: (texto: string, opcoes?: { preservarJuncaoDeEmoji?: boolean }) => {
      espiao.chamadas++;
      if (!real) throw new Error("removerInvisiveisEControles ainda não existe (fase RED)");
      return real(texto, opcoes);
    },
  };
});

const carregar = () => import("@/lib/validacoes/mensagemModal");

type TrechoBruto = Record<string, unknown>;
type ParagrafoBruto = Record<string, unknown>;

const doc = (paragrafos: ParagrafoBruto[]) => ({ versao: 1, paragrafos });
const par = (trechos: TrechoBruto[], extra: Record<string, unknown> = {}) => ({ ...extra, trechos });
const vazio = () => par([]);

/** N trechos de 1 caractere com atributos ALTERNADOS: nenhum par adjacente funde. */
function trechosQueNaoFundem(n: number): TrechoBruto[] {
  return Array.from({ length: n }, (_, i) =>
    i % 2 === 0 ? { texto: "a", negrito: true } : { texto: "b" },
  );
}

/** Canônico devolvido pelo parse (a forma é a do contrato `versao: 1`). */
type Canonico = {
  versao: 1;
  paragrafos: { tipo?: string; alinhamento?: string; trechos: Record<string, unknown>[] }[];
} | null;

async function parse(raw: unknown): Promise<{ success: boolean; data?: Canonico }> {
  const { schemaMensagemModal } = await carregar();
  const r = schemaMensagemModal.safeParse(raw);
  return r.success ? { success: true, data: r.data as unknown as Canonico } : { success: false };
}

beforeEach(() => {
  espiao.chamadas = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ══════════════════════════════════════════════════════════════════════════
// A5 · tetos de RN-M08
// ══════════════════════════════════════════════════════════════════════════

describe("V4 · A5 · constantes de teto (RN-M08)", () => {
  it("exporta os tetos com os valores do spec", async () => {
    const m = await carregar();
    expect({
      TETO_CARACTERES_MENSAGEM: m.TETO_CARACTERES_MENSAGEM,
      TETO_PARAGRAFOS: m.TETO_PARAGRAFOS,
      TETO_PARAGRAFOS_BRUTO: m.TETO_PARAGRAFOS_BRUTO,
      TETO_TRECHOS_POR_PARAGRAFO_BRUTO: m.TETO_TRECHOS_POR_PARAGRAFO_BRUTO,
      TETO_TRECHOS: m.TETO_TRECHOS,
      TETO_TEXTO_TRECHO_BRUTO: m.TETO_TEXTO_TRECHO_BRUTO,
      TETO_LINKS: m.TETO_LINKS,
      TETO_URL_BRUTA: m.TETO_URL_BRUTA,
      TETO_URL_CANONICA: m.TETO_URL_CANONICA,
    }).toEqual({
      TETO_CARACTERES_MENSAGEM: 800,
      TETO_PARAGRAFOS: 20,
      TETO_PARAGRAFOS_BRUTO: 40,
      TETO_TRECHOS_POR_PARAGRAFO_BRUTO: 200,
      TETO_TRECHOS: 120,
      TETO_TEXTO_TRECHO_BRUTO: 3200,
      TETO_LINKS: 10,
      TETO_URL_BRUTA: 2048,
      TETO_URL_CANONICA: 1000,
    });
  });
});

describe("V4 · A5 · payload gigante reprova SEM transformar (teto bruto antes do transform)", () => {
  it("10 mil trechos num parágrafo: reprova e nenhum trecho é transformado", async () => {
    const raw = doc([par(Array.from({ length: 10_000 }, () => ({ texto: "a" })))]);
    const r = await parse(raw);
    expect(r.success).toBe(false);
    expect(espiao.chamadas).toBe(0);
  });

  it("1 mil parágrafos: reprova e nenhum trecho é transformado", async () => {
    const raw = doc(Array.from({ length: 1_000 }, () => par([{ texto: "a" }])));
    const r = await parse(raw);
    expect(r.success).toBe(false);
    expect(espiao.chamadas).toBe(0);
  });

  it("texto de 1 MB num trecho: reprova e o texto não é transformado", async () => {
    const raw = doc([par([{ texto: "a".repeat(1_000_000) }])]);
    const r = await parse(raw);
    expect(r.success).toBe(false);
    expect(espiao.chamadas).toBe(0);
  });

  it("URL de 1 MB num link: reprova e nenhum trecho é transformado", async () => {
    const raw = doc([par([{ texto: "site", link: "https://exemplo.com/" + "a".repeat(1_000_000) }])]);
    const r = await parse(raw);
    expect(r.success).toBe(false);
    expect(espiao.chamadas).toBe(0);
  });

  it("lerMensagemModal com 10 mil trechos devolve null sem lançar", async () => {
    const { lerMensagemModal } = await carregar();
    const raw = doc([par(Array.from({ length: 10_000 }, () => ({ texto: "a" })))]);
    expect(lerMensagemModal(raw, { lojaId: "l", modalId: "m" })).toBeNull();
  });
});

describe("V4 · A5 · fronteiras dos tetos brutos", () => {
  it("200 trechos brutos idênticos num parágrafo passam (fundem em 1)", async () => {
    const r = await parse(doc([par(Array.from({ length: 200 }, () => ({ texto: "a" })))]));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos[0].trechos).toEqual([{ texto: "a".repeat(200) }]);
  });

  it("201 trechos brutos num parágrafo reprovam MESMO que fundissem em 1", async () => {
    const r = await parse(doc([par(Array.from({ length: 201 }, () => ({ texto: "a" })))]));
    expect(r.success).toBe(false);
    expect(espiao.chamadas).toBe(0);
  });

  it("texto bruto de 3200 unidades passa (3199 são invisíveis; canônico = 'a')", async () => {
    const r = await parse(doc([par([{ texto: "a" + "\u200B".repeat(3199) }])]));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos[0].trechos).toEqual([{ texto: "a" }]);
  });

  it("texto bruto de 3201 unidades reprova MESMO que o canônico fosse 1 caractere", async () => {
    const r = await parse(doc([par([{ texto: "a" + "\u200B".repeat(3200) }])]));
    expect(r.success).toBe(false);
    expect(espiao.chamadas).toBe(0);
  });

  it("40 parágrafos brutos (1 com texto + 39 vazios no fim) passam e viram 1", async () => {
    const r = await parse(doc([par([{ texto: "a" }]), ...Array.from({ length: 39 }, vazio)]));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos).toEqual([{ trechos: [{ texto: "a" }] }]);
  });

  it("41 parágrafos brutos reprovam MESMO que o canônico tivesse 1", async () => {
    const r = await parse(doc([par([{ texto: "a" }]), ...Array.from({ length: 40 }, vazio)]));
    expect(r.success).toBe(false);
    expect(espiao.chamadas).toBe(0);
  });

  it("URL bruta de 2049 caracteres reprova", async () => {
    const url = "https://exemplo.com/" + "a".repeat(2049 - 20);
    expect(url.length).toBe(2049);
    const r = await parse(doc([par([{ texto: "site", link: url }])]));
    expect(r.success).toBe(false);
  });
});

describe("V4 · A5 · fronteiras dos tetos canônicos", () => {
  it("120 trechos canônicos passam", async () => {
    const r = await parse(doc([par(trechosQueNaoFundem(120))]));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos[0].trechos).toHaveLength(120);
  });

  it("121 trechos canônicos reprovam", async () => {
    const r = await parse(doc([par(trechosQueNaoFundem(121))]));
    expect(r.success).toBe(false);
  });

  it("121 trechos espalhados em 2 parágrafos também reprovam (teto é do documento)", async () => {
    const r = await parse(doc([par(trechosQueNaoFundem(60)), par(trechosQueNaoFundem(61))]));
    expect(r.success).toBe(false);
  });

  it("800 caracteres passam e contarCaracteresMensagem devolve 800", async () => {
    const { contarCaracteresMensagem } = await carregar();
    const r = await parse(doc([par([{ texto: "a".repeat(400) }]), par([{ texto: "b".repeat(400) }])]));
    expect(r.success).toBe(true);
    expect(contarCaracteresMensagem(r.data as never)).toBe(800);
  });

  it("801 caracteres reprovam", async () => {
    const r = await parse(doc([par([{ texto: "a".repeat(400) }]), par([{ texto: "b".repeat(401) }])]));
    expect(r.success).toBe(false);
  });

  it("a URL do link NÃO conta caracteres: 800 de texto + link de 900 passa", async () => {
    const { contarCaracteresMensagem } = await carregar();
    const url = "https://exemplo.com/" + "u".repeat(880);
    const r = await parse(doc([par([{ texto: "a".repeat(796) }, { texto: "site", link: url }])]));
    expect(r.success).toBe(true);
    expect(contarCaracteresMensagem(r.data as never)).toBe(800);
  });

  it("10 links canônicos passam", async () => {
    const trechos = Array.from({ length: 10 }, (_, i) => [
      { texto: `L${i}`, link: `https://exemplo.com/${i}` },
      { texto: "x" },
    ]).flat();
    const r = await parse(doc([par(trechos)]));
    expect(r.success).toBe(true);
  });

  it("11 links canônicos reprovam", async () => {
    const trechos = Array.from({ length: 11 }, (_, i) => [
      { texto: `L${i}`, link: `https://exemplo.com/${i}` },
      { texto: "x" },
    ]).flat();
    const r = await parse(doc([par(trechos)]));
    expect(r.success).toBe(false);
  });

  it("links adjacentes idênticos fundem e contam 1: 11 trechos com o MESMO link passam", async () => {
    const trechos = Array.from({ length: 11 }, () => ({ texto: "a", link: "https://exemplo.com/x" }));
    const r = await parse(doc([par(trechos)]));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos[0].trechos).toEqual([
      { texto: "a".repeat(11), link: "https://exemplo.com/x" },
    ]);
  });

  it("URL canônica de 1000 caracteres passa e é gravada canônica", async () => {
    const url = "https://exemplo.com/" + "a".repeat(980);
    expect(new URL(url).href.length).toBe(1000);
    const r = await parse(doc([par([{ texto: "site", link: url }])]));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos[0].trechos[0].link).toBe(url);
  });

  it("URL canônica de 1001 caracteres reprova", async () => {
    const url = "https://exemplo.com/" + "a".repeat(981);
    expect(new URL(url).href.length).toBe(1001);
    const r = await parse(doc([par([{ texto: "site", link: url }])]));
    expect(r.success).toBe(false);
  });

  it("teto de URL é medido no CANÔNICO: bruta ≤ 1000 que vira 1001 em punycode reprova", async () => {
    const base = "https://ção.com/";
    const pad = 1001 - new URL(base).href.length;
    const url = base + "a".repeat(pad);
    expect(url.length).toBeLessThanOrEqual(1000);
    expect(new URL(url).href.length).toBe(1001);
    const r = await parse(doc([par([{ texto: "site", link: url }])]));
    expect(r.success).toBe(false);
  });

  it("20 parágrafos canônicos passam", async () => {
    const r = await parse(doc(Array.from({ length: 20 }, (_, i) => par([{ texto: `p${i}` }]))));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos).toHaveLength(20);
  });

  it("21 parágrafos canônicos reprovam", async () => {
    const r = await parse(doc(Array.from({ length: 21 }, (_, i) => par([{ texto: `p${i}` }]))));
    expect(r.success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A7 · canonização antes de medir (anti-padding)
// ══════════════════════════════════════════════════════════════════════════

describe("V4 · A7 · padding não contorna teto (canoniza, depois mede)", () => {
  it("300 trechos idênticos (150 por parágrafo, 2 parágrafos) passam: cada parágrafo vira 1 trecho", async () => {
    const bloco = () => par(Array.from({ length: 150 }, () => ({ texto: "ab", italico: true })));
    const r = await parse(doc([bloco(), bloco()]));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos).toEqual([
      { trechos: [{ texto: "ab".repeat(150), italico: true }] },
      { trechos: [{ texto: "ab".repeat(150), italico: true }] },
    ]);
  });

  it("trechos de texto vazio somem, e os vizinhos idênticos fundem através deles", async () => {
    const r = await parse(
      doc([par([{ texto: "" }, { texto: "a" }, { texto: "" }, { texto: "b" }, { texto: "" }])]),
    );
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos).toEqual([{ trechos: [{ texto: "ab" }] }]);
  });

  it("38 parágrafos vazios entre dois textos colapsam em 1 (40 brutos → 3 canônicos)", async () => {
    const r = await parse(
      doc([par([{ texto: "inicio" }]), ...Array.from({ length: 38 }, vazio), par([{ texto: "fim" }])]),
    );
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos).toEqual([
      { trechos: [{ texto: "inicio" }] },
      { trechos: [] },
      { trechos: [{ texto: "fim" }] },
    ]);
  });

  it("parágrafos vazios do começo e do fim são removidos", async () => {
    const r = await parse(doc([vazio(), vazio(), par([{ texto: "meio" }]), vazio()]));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos).toEqual([{ trechos: [{ texto: "meio" }] }]);
  });

  it("20 parágrafos com texto + vazios intercalados colapsados cabem se o canônico ≤ 20", async () => {
    // 10 textos separados por 2 vazios cada = 28 brutos; canônico = 10 textos + 9 vazios = 19.
    const paragrafos: ParagrafoBruto[] = [];
    for (let i = 0; i < 10; i++) {
      if (i > 0) paragrafos.push(vazio(), vazio());
      paragrafos.push(par([{ texto: `t${i}` }]));
    }
    const r = await parse(doc(paragrafos));
    expect(r.success).toBe(true);
    expect(r.data!.paragrafos).toHaveLength(19);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A22 · profundidade forçada: estrutura plana, sem recursão
// ══════════════════════════════════════════════════════════════════════════

describe("V4 · A22 · profundidade forçada reprova sem RangeError", () => {
  async function reprovaSemLancar(raw: unknown) {
    const { schemaMensagemModal, lerMensagemModal } = await carregar();
    let r: { success: boolean } | undefined;
    expect(() => {
      r = schemaMensagemModal.safeParse(raw);
    }).not.toThrow();
    expect(r!.success).toBe(false);
    let lido: unknown = "nao-executado";
    expect(() => {
      lido = lerMensagemModal(raw, { lojaId: "l", modalId: "m" });
    }).not.toThrow();
    expect(lido).toBeNull();
  }

  it("parágrafo com `nivel: 5` reprova", async () => {
    await reprovaSemLancar(doc([par([{ texto: "item" }], { tipo: "item-lista", nivel: 5 })]));
  });

  it("trecho com `nivel: 5` reprova", async () => {
    await reprovaSemLancar(doc([par([{ texto: "item", nivel: 5 }])]));
  });

  it("parágrafo com `filhos: [...]` reprova", async () => {
    await reprovaSemLancar(
      doc([par([{ texto: "pai" }], { tipo: "item-lista", filhos: [par([{ texto: "filho" }])] })]),
    );
  });

  it("parágrafo dentro de `trechos` reprova", async () => {
    await reprovaSemLancar(doc([par([par([{ texto: "aninhado" }]) as TrechoBruto])]));
  });

  it("1 mil níveis de `filhos` montados em loop reprovam sem RangeError", async () => {
    let no: Record<string, unknown> = { trechos: [{ texto: "folha" }] };
    for (let i = 0; i < 1_000; i++) no = { trechos: [{ texto: "n" }], filhos: [no] };
    await reprovaSemLancar(doc([no]));
  });

  it("1 mil níveis de parágrafo-dentro-de-trechos (via JSON do banco) reprovam sem RangeError", async () => {
    let no: Record<string, unknown> = { texto: "folha" };
    for (let i = 0; i < 1_000; i++) no = { trechos: [no] };
    const doBanco = JSON.parse(JSON.stringify(doc([no])));
    await reprovaSemLancar(doBanco);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Camada banco (pglite): A30 (RPC direto) e A8b (CHECK de bytes)
// ══════════════════════════════════════════════════════════════════════════

describe("V4 · banco (pglite)", () => {
  let t: TestDb;
  let c: CenarioModalSazonal;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearCenario(t);
  });

  afterAll(async () => {
    await t?.close();
  });

  /** Estado das DUAS lojas: modal + junções + contagens. "Nada muda" = igual antes/depois. */
  async function estado() {
    return {
      modalA: await fotografarModal(t, c.a.modalId),
      modalB: await fotografarModal(t, c.b.modalId),
      contagemA: await contarDaLoja(t, c.a.id),
      contagemB: await contarDaLoja(t, c.b.id),
    };
  }

  /** S3 (RN-M15): raise estável. SQLSTATE + fragmento, nunca um só. */
  function esperarRecusaDeSelecao(e: { code: string | undefined; message: string }) {
    expect(e.code).toBe("P0001");
    expect(e.message).toContain("modal_sazonal: selecao invalida");
  }

  const uuids = (n: number) => Array.from({ length: n }, () => crypto.randomUUID());

  // ── A30 · travas S3 com a RPC chamada direto pela sessão do dono ────────

  describe("A30 · RPC salvar_modal_sazonal chamada direto com arrays hostis (S3)", () => {
    const casos: { nome: string; montar: (cats: string[]) => string[] | string }[] = [
      { nome: "51 ids (um acima do teto de 50)", montar: () => uuids(51) },
      { nome: "10 mil ids", montar: () => uuids(10_000) },
      {
        nome: "array 2D '{{a,b},{c,d}}' (cardinality 4 ≤ 50: só array_ndims pega)",
        montar: (cats) => `{{${cats[0]},${cats[1]}},{${cats[2]},${cats[0]}}}`,
      },
      { nome: "null dentro do array", montar: (cats) => literalArray([cats[0], null]) },
      { nome: "id duplicado", montar: (cats) => [cats[0], cats[0]] },
    ];

    for (const caso of casos) {
      it(`p_categorias com ${caso.nome}: raise de S3 e nada muda (edição)`, async () => {
        const antes = await estado();
        const args = { ...argsEdicaoValidos(c.a), p_categorias: caso.montar(c.a.categorias) };
        const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
        esperarRecusaDeSelecao(e);
        expect(await estado()).toEqual(antes);
      });
    }

    const casosCardapio: { nome: string; montar: (cards: string[]) => string[] | string }[] = [
      { nome: "51 ids", montar: () => uuids(51) },
      { nome: "array 2D", montar: (cards) => `{{${cards[0]}},{${cards[1]}}}` },
      { nome: "null dentro do array", montar: (cards) => literalArray([null, cards[0]]) },
      { nome: "id duplicado", montar: (cards) => [cards[1], cards[1]] },
    ];

    for (const caso of casosCardapio) {
      it(`p_cardapios com ${caso.nome}: raise de S3 e nada muda (edição)`, async () => {
        const antes = await estado();
        const args = { ...argsEdicaoValidos(c.a), p_cardapios: caso.montar(c.a.cardapios) };
        const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
        esperarRecusaDeSelecao(e);
        expect(await estado()).toEqual(antes);
      });
    }

    it("criação (p_modal_id null) com 10 mil ids: raise de S3 e ZERO modal novo", async () => {
      const antes = await estado();
      const args = { ...argsEdicaoValidos(c.a), p_modal_id: null, p_categorias: uuids(10_000) };
      const e = await capturarErro(() => t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, args)));
      esperarRecusaDeSelecao(e);
      expect(await estado()).toEqual(antes);
    });

    it("controle: exatamente 50 categorias próprias passam (fronteira 50/51)", async () => {
      const extras = await t.asService(async (db) => {
        const r = await db.query<{ id: string }>(
          `insert into public.categorias (loja_id, nome)
           select $1, 'Extra ' || g from generate_series(1, 47) g returning id`,
          [c.a.id],
        );
        return r.rows.map((x) => x.id);
      });
      const cinquenta = [...c.a.categorias, ...extras];
      expect(cinquenta).toHaveLength(50);

      const id = await t.asUser(c.a.donoId, (db) =>
        chamarSalvarModal(db, { ...argsEdicaoValidos(c.a), p_categorias: cinquenta }),
      );
      expect(id).toBe(c.a.modalId);
      const depois = await fotografarModal(t, c.a.modalId);
      expect(depois.categorias).toEqual([...cinquenta].sort());

      // restaura o cenário para os casos seguintes
      await t.asUser(c.a.donoId, (db) => chamarSalvarModal(db, argsEdicaoValidos(c.a)));
      await t.asService((db) =>
        db.query(`delete from public.categorias where id = any($1::uuid[])`, [extras]),
      );
    });
  });

  // ── A8b · CHECK de bytes da coluna mensagem ─────────────────────────────

  describe("A8b · documento de 70 KB gravado direto na tabela", () => {
    it("UPDATE direto (asUser dono) com mensagem de 70 KB e topo válido: 23514 modais_sazonais_mensagem_tamanho", async () => {
      const antes = await estado();
      const grande = mensagemMinima("a".repeat(70_000));
      const e = await capturarErro(() =>
        t.asUser(c.a.donoId, (db) =>
          db.query(`update public.modais_sazonais set mensagem = $1::jsonb where id = $2`, [
            JSON.stringify(grande),
            c.a.modalId,
          ]),
        ),
      );
      expect(e.code).toBe("23514");
      expect(e.message).toContain("modais_sazonais_mensagem_tamanho");
      expect(await estado()).toEqual(antes);
    });

    it("INSERT direto (asUser dono) com mensagem de 70 KB: 23514 modais_sazonais_mensagem_tamanho e zero linha nova", async () => {
      const antes = await estado();
      const grande = mensagemMinima("b".repeat(70_000));
      const e = await capturarErro(() =>
        t.asUser(c.a.donoId, (db) =>
          db.query(
            `insert into public.modais_sazonais (loja_id, titulo, exibicao_inicio, exibicao_fim, mensagem)
             values ($1, 'Modal gordo', now(), now() + interval '1 day', $2::jsonb)`,
            [c.a.id, JSON.stringify(grande)],
          ),
        ),
      );
      expect(e.code).toBe("23514");
      expect(e.message).toContain("modais_sazonais_mensagem_tamanho");
      expect(await estado()).toEqual(antes);
    });

    it("controle: documento de ~60 KB (abaixo de 64 KB) é gravado", async () => {
      const medio = mensagemMinima("c".repeat(60_000));
      const r = await t.asUser(c.a.donoId, (db) =>
        db.query(`update public.modais_sazonais set mensagem = $1::jsonb where id = $2`, [
          JSON.stringify(medio),
          c.a.modalId,
        ]),
      );
      expect(r.affectedRows).toBe(1);
      const gravado = await fotografarModal(t, c.a.modalId);
      expect(gravado.linha?.mensagem).toEqual(medio);
      await t.asService((db) =>
        db.query(`update public.modais_sazonais set mensagem = null where id = $1`, [c.a.modalId]),
      );
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Issue 318 · teto de modais sazonais por loja (CWE-770) e `.limit()` na listagem
// ══════════════════════════════════════════════════════════════════════════
//
// CONTRATO FIXADO PARA A FASE GREEN (executar):
//   - Constante `TETO_MODAIS_POR_LOJA = 50` exportada de
//     `src/lib/validacoes/modalSazonal.ts` (ao lado de `TETO_SELECAO`).
//   - Trigger `after insert` em `public.modais_sazonais` (cobre INSERT direto
//     pelo PostgREST e a criação via RPC `salvar_modal_sazonal`): com 50 ou mais
//     modais na MESMA `loja_id`, `raise exception 'modal_sazonal: teto de modais'`
//     (SQLSTATE P0001; mensagem sem id nem número da loja). A contagem é por
//     `new.loja_id`, não global, e não depende do RLS do invocador (função do
//     trigger `security definer` com `search_path` fixo, ou equivalente).
//     Corrida entre dois INSERTs simultâneos: serializar por loja (ex.:
//     `pg_advisory_xact_lock` ou `select ... for update` na linha de `lojas`) —
//     não é observável no pglite (conexão única), fica para revisão.
//   - UPDATE não é afetado (editar com 50 modais funciona).
//   - `listarModaisSazonaisDoDono` aplica `.limit(TETO_MODAIS_POR_LOJA)`.
// Erro afirmado SEMPRE como SQLSTATE + fragmento juntos.

describe("V4 · 318 · teto de modais por loja (pglite)", () => {
  let t: TestDb;
  let c: CenarioModalSazonal;
  const TETO = 50;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearCenario(t);
    // O seed já tem 1 modal por loja: completa A até TETO - 1 (49).
    await t.asService((db) =>
      db.query(
        `insert into public.modais_sazonais (loja_id, titulo, exibicao_inicio, exibicao_fim)
         select $1, 'Enchimento ' || g, now(), now() + interval '1 day'
           from generate_series(1, $2::int) g`,
        [c.a.id, TETO - 2],
      ),
    );
  });

  afterAll(async () => {
    await t?.close();
  });

  async function estado() {
    return { contagemA: await contarDaLoja(t, c.a.id), contagemB: await contarDaLoja(t, c.b.id) };
  }

  function esperarTeto(e: { code: string | undefined; message: string }) {
    expect(e.code).toBe("P0001");
    expect(e.message).toContain("modal_sazonal: teto de modais");
  }

  const insertDireto = (donoId: string, lojaId: string, titulo: string) =>
    t.asUser(donoId, (db) =>
      db.query(
        `insert into public.modais_sazonais (loja_id, titulo, exibicao_inicio, exibicao_fim)
         values ($1, $2, now(), now() + interval '1 day')`,
        [lojaId, titulo],
      ),
    );

  it("constante TETO_MODAIS_POR_LOJA = 50 exportada de validacoes/modalSazonal", async () => {
    const mod = (await import("@/lib/validacoes/modalSazonal")) as Record<string, unknown>;
    expect(mod.TETO_MODAIS_POR_LOJA).toBe(TETO);
  });

  it("pré-condição: A tem 49 modais e B tem 1", async () => {
    expect((await contarDaLoja(t, c.a.id)).modais).toBe(TETO - 1);
    expect((await contarDaLoja(t, c.b.id)).modais).toBe(1);
  });

  it("o 50º modal de A (INSERT direto do dono) PASSA — fronteira 50/51", async () => {
    const r = await insertDireto(c.a.donoId, c.a.id, "Quinquagesimo");
    expect(r.affectedRows).toBe(1);
    expect((await contarDaLoja(t, c.a.id)).modais).toBe(TETO);
  });

  it("o 51º por INSERT direto do dono: P0001 `modal_sazonal: teto de modais` e zero linha nova", async () => {
    const antes = await estado();
    const e = await capturarErro(() => insertDireto(c.a.donoId, c.a.id, "Quinquagesimo primeiro"));
    esperarTeto(e);
    expect(await estado()).toEqual(antes);
  });

  it("o 51º pela RPC salvar_modal_sazonal (criação): P0001 `modal_sazonal: teto de modais`, zero modal e zero junção novos", async () => {
    const antes = await estado();
    const e = await capturarErro(() =>
      t.asUser(c.a.donoId, (db) =>
        chamarSalvarModal(db, { ...argsEdicaoValidos(c.a), p_modal_id: null, p_titulo: "Via RPC acima do teto" }),
      ),
    );
    esperarTeto(e);
    expect(await estado()).toEqual(antes);
  });

  it("com A no teto, dono de B inserindo com loja_id de A recebe a recusa da RLS, não a do teto (sem oráculo de contagem)", async () => {
    const antes = await estado();
    const e = await capturarErro(() => insertDireto(c.b.donoId, c.a.id, "B tentando em A"));
    expect(e.code).toBe("42501");
    expect(e.message).toContain("row-level security");
    expect(e.message).not.toContain("teto de modais");
    expect(await estado()).toEqual(antes);
  });

  it("outra loja NÃO é afetada: B cria por INSERT direto e pela RPC com A no teto (contagem é por loja, não global)", async () => {
    const r = await insertDireto(c.b.donoId, c.b.id, "B livre direto");
    expect(r.affectedRows).toBe(1);
    const id = await t.asUser(c.b.donoId, (db) =>
      chamarSalvarModal(db, {
        ...argsEdicaoValidos(c.b),
        p_modal_id: null,
        p_titulo: "B livre RPC",
        p_categorias: [],
        p_cardapios: [],
      }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await contarDaLoja(t, c.b.id)).modais).toBe(3);
  });

  it("com A no teto, EDITAR pela RPC continua funcionando (o teto é só de INSERT)", async () => {
    const id = await t.asUser(c.a.donoId, (db) =>
      chamarSalvarModal(db, { ...argsEdicaoValidos(c.a), p_titulo: "Editado no teto" }),
    );
    expect(id).toBe(c.a.modalId);
    expect((await fotografarModal(t, c.a.modalId)).linha?.titulo).toBe("Editado no teto");
  });

  it("apagar um modal libera a vaga: o teto conta linhas existentes, não criações acumuladas", async () => {
    await t.asUser(c.a.donoId, (db) =>
      db.query(`delete from public.modais_sazonais where loja_id = $1 and titulo = 'Enchimento 1'`, [c.a.id]),
    );
    expect((await contarDaLoja(t, c.a.id)).modais).toBe(TETO - 1);
    const id = await t.asUser(c.a.donoId, (db) =>
      chamarSalvarModal(db, { ...argsEdicaoValidos(c.a), p_modal_id: null, p_titulo: "Vaga liberada" }),
    );
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const e = await capturarErro(() => insertDireto(c.a.donoId, c.a.id, "De novo acima"));
    esperarTeto(e);
  });
});

describe("V4 · 318 · listarModaisSazonaisDoDono aplica .limit(TETO_MODAIS_POR_LOJA)", () => {
  it("a query encadeia `.limit(50)` além do escopo por loja", async () => {
    const chamadas: [string, unknown[]][] = [];
    const cadeia: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order", "limit", "range"]) {
      cadeia[k] = (...a: unknown[]) => {
        chamadas.push([k, a]);
        return cadeia;
      };
    }
    cadeia.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(onF);
    const client = { from: (tabela: string) => (chamadas.push(["from", [tabela]]), cadeia) };

    const { listarModaisSazonaisDoDono } = await import("@/lib/supabase/queries/modaisSazonais");
    const r = await listarModaisSazonaisDoDono(client as never, "loja-x");
    expect(r).toEqual([]);
    expect(chamadas).toContainEqual(["eq", ["loja_id", "loja-x"]]);
    expect(chamadas).toContainEqual(["limit", [50]]);
  });
});
