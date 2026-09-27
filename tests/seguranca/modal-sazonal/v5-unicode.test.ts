import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createTestDb, type TestDb } from "../../helpers/pglite";
import * as moduloNormalizacao from "@/lib/utils/normalizarObservacao";
import {
  argsEdicaoValidos,
  capturarErro,
  chamarSalvarModal,
  contarDaLoja,
  fotografarModal,
  INICIO,
  FIM,
  semearCenario,
  type CenarioModalSazonal,
} from "./seed";

/**
 * Fase RED — issue 308, VETOR V5 (Trojan Source CVE-2021-42574, bidi, Unicode).
 * Spec `specs/modal-sazonal-mensagem-formatada.md` §Matriz V5, RN-M03, RN-M09,
 * §Esclarecimento sobre emoji; fato conferido F4 do plano do loop.
 *
 * Camadas que o vetor atravessa, numa suíte só:
 *   A6  `removerInvisiveisEControles`; zod do TRECHO (`schemaMensagemModal`);
 *       zod do TÍTULO (`schemaModalSazonal`); CHECK do título no banco, direto
 *       na tabela E via RPC `salvar_modal_sazonal` (asUser do dono);
 *   A26 junção de emoji (`preservarJuncaoDeEmoji`) vs ZWJ entre letras.
 *
 * ORDEM (F4): `normalizarObservacao` passo 2 PRESERVA `\t`/`\n` e passo 3
 * APAGA U+2028/2029. Se a troca de quebra por espaço rodar DEPOIS de
 * `removerInvisiveisEControles`, `\t` sobrevive no título (e o CHECK, que
 * inclui U+0009, recusa o que o zod aceitou) e U+2028 some em vez de virar
 * espaço. Os casos "vira ESPAÇO, não some" e "zod → CHECK sem 23514" travam isso.
 *
 * Todo caractere invisível está escrito como escape `\u....`, nunca literal.
 */

const carregarMensagem = () => import("@/lib/validacoes/mensagemModal");
const carregarModal = () => import("@/lib/validacoes/modalSazonal");

type Opcoes = { preservarJuncaoDeEmoji?: boolean };
/** Acesso tardio: a export ainda não existe na fase RED (falha por teste, não na coleta). */
function remover(texto: string, opcoes?: Opcoes): string {
  const fn = (moduloNormalizacao as Record<string, unknown>).removerInvisiveisEControles as
    | ((t: string, o?: Opcoes) => string)
    | undefined;
  if (typeof fn !== "function") {
    throw new Error("removerInvisiveisEControles não é exportada por @/lib/utils/normalizarObservacao");
  }
  return fn(texto, opcoes);
}

// ── corpus ─────────────────────────────────────────────────────────────────

/** Caracteres que SOMEM (removidos, não viram espaço). */
const REMOVIDOS: [string, string][] = [
  ["U+202E RLO (Trojan Source)", "\u202E"],
  ["U+202A LRE", "\u202A"],
  ["U+202D LRO", "\u202D"],
  ["U+2066 LRI", "\u2066"],
  ["U+2067 RLI", "\u2067"],
  ["U+2068 FSI", "\u2068"],
  ["U+2069 PDI", "\u2069"],
  ["U+200B zero-width space", "\u200B"],
  ["U+200C ZWNJ", "\u200C"],
  ["U+200D ZWJ entre letras", "\u200D"],
  ["U+200E LRM", "\u200E"],
  ["U+200F RLM", "\u200F"],
  ["U+2060 word joiner", "\u2060"],
  ["U+FEFF BOM", "\uFEFF"],
  ["U+061C ALM", "\u061C"],
  ["U+0000 NUL", "\u0000"],
  ["U+0007 BEL", "\u0007"],
  ["U+001B ESC", "\u001B"],
  ["U+007F DEL", "\u007F"],
  ["U+0080 C1", "\u0080"],
  ["U+009F C1", "\u009F"],
  ["substituto alto desemparelhado U+D800", "\uD800"],
  ["substituto baixo desemparelhado U+DC00", "\uDC00"],
];

/** Quebras e tabulação: viram ESPAÇO (não somem), ANTES da remoção de invisíveis (F4). */
const VIRAM_ESPACO: [string, string][] = [
  ["\\t U+0009", "\t"],
  ["\\n U+000A", "\n"],
  ["\\r U+000D", "\r"],
  ["\\v U+000B", "\u000B"],
  ["\\f U+000C", "\u000C"],
  ["NEL U+0085", "\u0085"],
  ["LINE SEPARATOR U+2028", "\u2028"],
  ["PARAGRAPH SEPARATOR U+2029", "\u2029"],
];

/** Conjunto do CHECK `modais_sazonais_titulo_sem_invisiveis` (spec §Coluna nova), em JS. */
const CONJUNTO_CHECK_TITULO =
  /[\u0001-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/;

const FAMILIA = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"; // 👨\u200D👩\u200D👧
const FAMILIA_SEM_ZWJ = "\u{1F468}\u{1F469}\u{1F467}";
const CORACAO_VS16 = "❤️"; // ❤️ com seletor de variação

const bytes = (s: string) => Array.from(Buffer.from(s, "utf8"));

// ── helpers zod ────────────────────────────────────────────────────────────

type Canonico = { versao: 1; paragrafos: { trechos: { texto: string }[] }[] } | null;

async function canonizarTrecho(texto: string): Promise<{ success: boolean; data?: Canonico }> {
  const { schemaMensagemModal } = await carregarMensagem();
  const r = schemaMensagemModal.safeParse({ versao: 1, paragrafos: [{ trechos: [{ texto }] }] });
  return r.success ? { success: true, data: r.data as unknown as Canonico } : { success: false };
}

const textoDoPrimeiroTrecho = (d: Canonico) => d!.paragrafos[0].trechos[0].texto;

/** Payload de modal válido (RN-M02: seleção opcional; `mensagem` sempre presente). */
function payloadModal(titulo: string) {
  return {
    titulo,
    exibicao_inicio: INICIO,
    exibicao_fim: FIM,
    mensagem: null,
    categorias: [],
    cardapios: [],
  };
}

async function tituloCanonico(titulo: string): Promise<{ success: boolean; titulo?: string }> {
  const { schemaModalSazonal } = await carregarModal();
  const r = schemaModalSazonal.safeParse(payloadModal(titulo));
  return r.success ? { success: true, titulo: r.data.titulo } : { success: false };
}

/**
 * Reprova ATRIBUÍDA ao título: falha e TODOS os issues apontam para `titulo`.
 * Sem isso, a recusa podia vir de outro campo (ex.: o `.refine` de RN-06 ainda
 * vivo, ou `mensagem` desconhecida no `.strict()`) e o teste ficaria verde à toa.
 */
async function reprovaSoPeloTitulo(titulo: string): Promise<void> {
  const { schemaModalSazonal } = await carregarModal();
  const r = schemaModalSazonal.safeParse(payloadModal(titulo));
  expect(r.success).toBe(false);
  const caminhos = r.success ? [] : r.error.issues.map((i) => String(i.path[0] ?? "(raiz)"));
  expect(caminhos.length).toBeGreaterThan(0);
  expect(caminhos.every((c) => c === "titulo")).toBe(true);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ══════════════════════════════════════════════════════════════════════════
// A6 · removerInvisiveisEControles (a função extraída)
// ══════════════════════════════════════════════════════════════════════════

describe("V5 · A6 · removerInvisiveisEControles", () => {
  for (const [nome, ch] of REMOVIDOS) {
    it(`remove ${nome}`, () => {
      expect(remover(`A${ch}B`)).toBe("AB");
    });
  }

  it("preserva texto comum, acento e emoji astral válido (par substituto íntegro)", () => {
    expect(remover("Ação de Natal 🍔🎉")).toBe("Ação de Natal 🍔🎉");
  });

  it("não expande: saída nunca é mais longa que a entrada", () => {
    const hostil = "a\u202Eb\u2066c\u200Bd\uD800e\u0000f";
    expect(remover(hostil).length).toBeLessThanOrEqual(hostil.length);
  });

  it("GUARDA da refatoração: normalizarObservacao segue com o comportamento atual", () => {
    // Verde por desenho HOJE: trava que a extração (313) não muda a composição.
    // passo 2 preserva \t; passo 3 apaga U+202E e U+2028; passo 4 \t→espaço; trim.
    expect(moduloNormalizacao.normalizarObservacao("  a\u202E\tb\u2028c\uD800  ")).toBe("a bc");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A6 · zod do TRECHO (schemaMensagemModal)
// ══════════════════════════════════════════════════════════════════════════

describe("V5 · A6 · zod do trecho remove invisíveis/bidi/controles", () => {
  for (const [nome, ch] of REMOVIDOS) {
    it(`trecho: ${nome} é removido`, async () => {
      const r = await canonizarTrecho(`A${ch}B`);
      expect(r.success).toBe(true);
      expect(textoDoPrimeiroTrecho(r.data!)).toBe("AB");
    });
  }

  for (const [nome, ch] of VIRAM_ESPACO) {
    it(`trecho: ${nome} vira ESPAÇO (não some)`, async () => {
      const r = await canonizarTrecho(`A${ch}B`);
      expect(r.success).toBe(true);
      expect(textoDoPrimeiroTrecho(r.data!)).toBe("A B");
    });
  }

  it("trecho não sofre trim: espaço de borda entre trechos sobrevive (\"Olá \" + negrito)", async () => {
    const { schemaMensagemModal } = await carregarMensagem();
    const r = schemaMensagemModal.safeParse({
      versao: 1,
      paragrafos: [{ trechos: [{ texto: "Olá\u2028" }, { texto: "mundo", negrito: true }] }],
    });
    expect(r.success).toBe(true);
    const d = r.data as unknown as Canonico;
    expect(d!.paragrafos[0].trechos).toEqual([{ texto: "Olá " }, { texto: "mundo", negrito: true }]);
  });

  it("800 visíveis + 50 invisíveis passa (invisíveis removidos ANTES de medir) e conta 800", async () => {
    const { contarCaracteresMensagem } = await carregarMensagem();
    const invisiveis = ["\u202E", "\u2066", "\u2069", "\u200B", "\uFEFF"];
    let texto = "";
    for (let i = 0; i < 800; i++) {
      texto += "a";
      if (i % 16 === 0) texto += invisiveis[(i / 16) % invisiveis.length];
    }
    expect(texto.length).toBe(850);
    const r = await canonizarTrecho(texto);
    expect(r.success).toBe(true);
    expect(textoDoPrimeiroTrecho(r.data!)).toBe("a".repeat(800));
    expect(contarCaracteresMensagem(r.data as never)).toBe(800);
  });

  it("controle: 801 visíveis + invisíveis reprova (a remoção não afrouxa o teto)", async () => {
    const r = await canonizarTrecho("a".repeat(801) + "\u200B".repeat(10));
    expect(r.success).toBe(false);
  });

  it("trecho só de invisíveis some; documento sem nada visível vira null", async () => {
    const r = await canonizarTrecho("\u202E\u200B\u2066\uFEFF");
    expect(r.success).toBe(true);
    expect(r.data).toBeNull();
  });

  it("lerMensagemModal aplica a mesma normalização a um documento gravado direto no banco", async () => {
    const { lerMensagemModal } = await carregarMensagem();
    const doBanco = JSON.parse(
      JSON.stringify({ versao: 1, paragrafos: [{ trechos: [{ texto: "pague\u202Eatnoc" }] }] }),
    );
    const lido = lerMensagemModal(doBanco, { lojaId: "l", modalId: "m" }) as unknown as Canonico;
    expect(lido).not.toBeNull();
    expect(textoDoPrimeiroTrecho(lido)).toBe("pagueatnoc");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A6 · zod do TÍTULO (schemaModalSazonal, RN-M09)
// ══════════════════════════════════════════════════════════════════════════

describe("V5 · A6 · zod do título endurecido (RN-M09)", () => {
  for (const [nome, ch] of REMOVIDOS) {
    it(`título: ${nome} é removido`, async () => {
      const r = await tituloCanonico(`Promo${ch}Natal`);
      expect(r.success).toBe(true);
      expect(r.titulo).toBe("PromoNatal");
    });
  }

  for (const [nome, ch] of VIRAM_ESPACO) {
    it(`título: ${nome} no meio vira ESPAÇO (não some)`, async () => {
      const r = await tituloCanonico(`A${ch}B`);
      expect(r.success).toBe(true);
      expect(r.titulo).toBe("A B");
    });
  }

  it('"\\tPromo" vira "Promo" (espaço + trim)', async () => {
    expect(await tituloCanonico("\tPromo")).toEqual({ success: true, titulo: "Promo" });
  });

  it('"A\\u0085B" vira "A B"', async () => {
    expect(await tituloCanonico("A\u0085B")).toEqual({ success: true, titulo: "A B" });
  });

  it("ORDEM: título canônico não contém NENHUM caractere do conjunto do CHECK (inclui U+0009)", async () => {
    const hostil = `\t${VIRAM_ESPACO.map(([, c]) => c).join("x")}${REMOVIDOS.map(([, c]) => c).join("y")}\u2028fim\t`;
    const r = await tituloCanonico(hostil);
    expect(r.success).toBe(true);
    expect(r.titulo).not.toMatch(CONJUNTO_CHECK_TITULO);
    expect(r.titulo!.length).toBeGreaterThan(0);
  });

  it("título só de invisíveis reprova (min 1 medido depois da remoção)", async () => {
    await reprovaSoPeloTitulo("\u202E\u200B\u2066\uFEFF");
  });

  it("120 visíveis + 5 invisíveis passa (teto medido depois da remoção)", async () => {
    const r = await tituloCanonico("\u202E" + "a".repeat(60) + "\u200B\u2066\u2069" + "a".repeat(60) + "\uFEFF");
    expect(r.success).toBe(true);
    expect(r.titulo).toBe("a".repeat(120));
  });

  it("controle: 121 visíveis reprova", async () => {
    await reprovaSoPeloTitulo("a".repeat(121));
  });

  it("título NÃO preserva junção de emoji: ZWJ da família é removido (o CHECK recusa U+200D)", async () => {
    const r = await tituloCanonico(`Família ${FAMILIA}`);
    expect(r.success).toBe(true);
    expect(r.titulo).toBe(`Família ${FAMILIA_SEM_ZWJ}`);
    expect(r.titulo).not.toMatch(CONJUNTO_CHECK_TITULO);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A26 · junção de emoji
// ══════════════════════════════════════════════════════════════════════════

describe("V5 · A26 · emoji: ZWJ só entre pictogramas", () => {
  it("removerInvisiveisEControles com preservarJuncaoDeEmoji: família preservada byte a byte", () => {
    const saida = remover(FAMILIA, { preservarJuncaoDeEmoji: true });
    expect(saida).toBe(FAMILIA);
    expect(bytes(saida)).toEqual(bytes(FAMILIA));
  });

  it("removerInvisiveisEControles com opção padrão remove o ZWJ também entre emojis", () => {
    expect(remover(FAMILIA)).toBe(FAMILIA_SEM_ZWJ);
  });

  it('com preservarJuncaoDeEmoji, "a\\u200Db" vira "ab" (ZWJ entre letras é invisível hostil)', () => {
    expect(remover("a\u200Db", { preservarJuncaoDeEmoji: true })).toBe("ab");
  });

  it("com preservarJuncaoDeEmoji, ZWJ entre emoji e letra é removido", () => {
    expect(remover("\u{1F468}\u200Da", { preservarJuncaoDeEmoji: true })).toBe("\u{1F468}a");
    expect(remover("a\u200D\u{1F468}", { preservarJuncaoDeEmoji: true })).toBe("a\u{1F468}");
  });

  it("U+FE0F (seletor de variação) é preservado nas duas opções", () => {
    expect(remover(CORACAO_VS16)).toBe(CORACAO_VS16);
    expect(remover(CORACAO_VS16, { preservarJuncaoDeEmoji: true })).toBe(CORACAO_VS16);
  });

  it("zod do trecho preserva a família byte a byte", async () => {
    const r = await canonizarTrecho(`Oi ${FAMILIA}!`);
    expect(r.success).toBe(true);
    expect(bytes(textoDoPrimeiroTrecho(r.data!))).toEqual(bytes(`Oi ${FAMILIA}!`));
  });

  it('zod do trecho: "a\\u200Db" vira "ab"', async () => {
    const r = await canonizarTrecho("a\u200Db");
    expect(r.success).toBe(true);
    expect(textoDoPrimeiroTrecho(r.data!)).toBe("ab");
  });

  it("zod do trecho preserva U+FE0F", async () => {
    const r = await canonizarTrecho(`Amo ${CORACAO_VS16}`);
    expect(r.success).toBe(true);
    expect(textoDoPrimeiroTrecho(r.data!)).toBe(`Amo ${CORACAO_VS16}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A6 · CHECK do título no banco (pglite, asUser do dono)
// ══════════════════════════════════════════════════════════════════════════

describe("V5 · A6 · CHECK do título (pglite)", () => {
  let t: TestDb;
  let c: CenarioModalSazonal;

  beforeAll(async () => {
    t = await createTestDb();
    c = await semearCenario(t);
  });

  afterAll(async () => {
    await t?.close();
  });

  async function estadoA() {
    return { modal: await fotografarModal(t, c.a.modalId), contagem: await contarDaLoja(t, c.a.id) };
  }

  const updateTitulo = (titulo: string) =>
    t.asUser(c.a.donoId, (db) =>
      db.query(`update public.modais_sazonais set titulo = $1 where id = $2`, [titulo, c.a.modalId]),
    );

  it("UPDATE direto com U+202E no título: 23514 modais_sazonais_titulo_sem_invisiveis e nada muda", async () => {
    const antes = await estadoA();
    const e = await capturarErro(() => updateTitulo("Promo\u202Elatan"));
    expect(e.code).toBe("23514");
    expect(e.message).toContain("modais_sazonais_titulo_sem_invisiveis");
    expect(await estadoA()).toEqual(antes);
  });

  it("UPDATE direto com U+2066 (isolate) no título: 23514 modais_sazonais_titulo_sem_invisiveis", async () => {
    const e = await capturarErro(() => updateTitulo("Promo\u2066x\u2069"));
    expect(e.code).toBe("23514");
    expect(e.message).toContain("modais_sazonais_titulo_sem_invisiveis");
  });

  it("UPDATE direto com \\t CRU no título: 23514 modais_sazonais_titulo_sem_invisiveis (o CHECK inclui U+0009)", async () => {
    const antes = await estadoA();
    const e = await capturarErro(() => updateTitulo("Promo\tNatal"));
    expect(e.code).toBe("23514");
    expect(e.message).toContain("modais_sazonais_titulo_sem_invisiveis");
    expect(await estadoA()).toEqual(antes);
  });

  it("INSERT direto com U+202E no título: 23514 modais_sazonais_titulo_sem_invisiveis e zero linha nova", async () => {
    const antes = await estadoA();
    const e = await capturarErro(() =>
      t.asUser(c.a.donoId, (db) =>
        db.query(
          `insert into public.modais_sazonais (loja_id, titulo, exibicao_inicio, exibicao_fim)
           values ($1, $2, $3, $4)`,
          [c.a.id, "Novo\u202Eodom", INICIO, FIM],
        ),
      ),
    );
    expect(e.code).toBe("23514");
    expect(e.message).toContain("modais_sazonais_titulo_sem_invisiveis");
    expect(await estadoA()).toEqual(antes);
  });

  it("UPDATE direto com título de 121 caracteres: 23514 modais_sazonais_titulo_tamanho e nada muda", async () => {
    const antes = await estadoA();
    const e = await capturarErro(() => updateTitulo("a".repeat(121)));
    expect(e.code).toBe("23514");
    expect(e.message).toContain("modais_sazonais_titulo_tamanho");
    expect(await estadoA()).toEqual(antes);
  });

  it("UPDATE direto com título vazio: 23514 modais_sazonais_titulo_tamanho", async () => {
    const e = await capturarErro(() => updateTitulo(""));
    expect(e.code).toBe("23514");
    expect(e.message).toContain("modais_sazonais_titulo_tamanho");
  });

  it("RPC salvar_modal_sazonal (edição) com U+202E no título: 23514 modais_sazonais_titulo_sem_invisiveis e nada muda", async () => {
    const antes = await estadoA();
    const e = await capturarErro(() =>
      t.asUser(c.a.donoId, (db) =>
        chamarSalvarModal(db, { ...argsEdicaoValidos(c.a), p_titulo: "Promo\u202Elatan" }),
      ),
    );
    expect(e.code).toBe("23514");
    expect(e.message).toContain("modais_sazonais_titulo_sem_invisiveis");
    expect(await estadoA()).toEqual(antes);
  });

  it("RPC salvar_modal_sazonal (criação) com U+202E no título: 23514 e ZERO modal novo", async () => {
    const antes = await estadoA();
    const e = await capturarErro(() =>
      t.asUser(c.a.donoId, (db) =>
        chamarSalvarModal(db, {
          ...argsEdicaoValidos(c.a),
          p_modal_id: null,
          p_titulo: "Novo\u202Eodom",
        }),
      ),
    );
    expect(e.code).toBe("23514");
    expect(e.message).toContain("modais_sazonais_titulo_sem_invisiveis");
    expect(await estadoA()).toEqual(antes);
  });

  it("título com \\t, \\n, U+2028 e U+202E passa no zod e o canônico é aceito pelo CHECK (tabela e RPC) sem 23514", async () => {
    const r = await tituloCanonico("\tPromo\nde\u2028Natal\u202E\t");
    expect(r).toEqual({ success: true, titulo: "Promo de Natal" });

    // Tabela direto
    const up = await updateTitulo(r.titulo!);
    expect(up.affectedRows).toBe(1);

    // Via RPC
    const id = await t.asUser(c.a.donoId, (db) =>
      chamarSalvarModal(db, { ...argsEdicaoValidos(c.a), p_titulo: r.titulo! }),
    );
    expect(id).toBe(c.a.modalId);
    const gravado = await fotografarModal(t, c.a.modalId);
    expect(gravado.linha?.titulo).toBe("Promo de Natal");
  });

  it("controle: os dois CHECKs do título existem e 120 caracteres visíveis são aceitos (fronteira 120/121)", async () => {
    const r = await t.asService((db) =>
      db.query<{ conname: string }>(
        `select conname from pg_constraint
          where conrelid = 'public.modais_sazonais'::regclass and contype = 'c'
            and conname in ('modais_sazonais_titulo_tamanho', 'modais_sazonais_titulo_sem_invisiveis')
          order by conname`,
      ),
    );
    expect(r.rows.map((x) => x.conname)).toEqual([
      "modais_sazonais_titulo_sem_invisiveis",
      "modais_sazonais_titulo_tamanho",
    ]);
    const up = await updateTitulo("b".repeat(120));
    expect(up.affectedRows).toBe(1);
  });
});
