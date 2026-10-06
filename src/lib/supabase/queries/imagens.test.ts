import { describe, it, expect, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — queries da galeria (`src/lib/supabase/queries/imagens.ts`).
 *
 * RED hoje: o módulo ainda não existe; o import falha na coleta.
 *
 * Regras (spec §"Server Actions, queries e módulos", RN-G2, RN-G12):
 *  - a grade mostra SÓ originais (`origem_id is null`) SEM remoção pendente
 *    (`remocao_pendente_em is null`), keyset `(criado_em desc, id desc)`;
 *  - TODA query filtra `.eq("loja_id", lojaId)` explicitamente — na variante
 *    admin (service_role, BYPASSRLS) é a única amarra de tenant; na do lojista é
 *    cinto e suspensório sobre a RLS;
 *  - a contagem do teto conta só originais não pendentes, e erro de contagem
 *    PROPAGA (contar 0 num erro furaria o teto).
 *
 * O builder abaixo grava toda chamada da cadeia PostgREST (qualquer método) e
 * resolve no `await` com a resposta configurada — não presume a ordem exata dos
 * filtros, só a presença deles.
 */

import {
  listarImagensDaLoja,
  listarImagensDaLojaAdmin,
  buscarOriginalDaLoja,
  contarOriginaisDaLoja,
} from "./imagens";

const LOJA = "11111111-1111-1111-1111-111111111111";
const ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type Chamada = { metodo: string; args: unknown[] };
type Op = { tabela: string; chamadas: Chamada[] };
type Resposta = { data: unknown; error: unknown; count?: number | null };

let ops: Op[];
let resposta: Resposta;

function criarClient() {
  const client = {
    from(tabela: string) {
      const op: Op = { tabela, chamadas: [] };
      ops.push(op);
      const proxy: unknown = new Proxy(
        {},
        {
          get(_alvo, prop) {
            if (prop === "then") {
              return (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
                Promise.resolve(resposta).then(ok, falha);
            }
            return (...args: unknown[]) => {
              op.chamadas.push({ metodo: String(prop), args });
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (caminho: string) => ({
          data: { publicUrl: `https://projeto-teste.supabase.co/storage/v1/object/public/${bucket}/${caminho}` },
        }),
      }),
    },
  };
  return client;
}

function opDe(tabela: string): Op {
  const op = ops.find((o) => o.tabela === tabela);
  if (!op) throw new Error(`nenhuma query em ${tabela}`);
  return op;
}

function temEq(op: Op, coluna: string, valor: unknown): boolean {
  return op.chamadas.some(
    (c) => c.metodo === "eq" && c.args[0] === coluna && c.args[1] === valor,
  );
}

/** `.is(col, null)` ou `.filter(col, "is", null)` — as duas formas do PostgREST. */
function temFiltroNulo(op: Op, coluna: string): boolean {
  return op.chamadas.some(
    (c) =>
      (c.metodo === "is" && c.args[0] === coluna && c.args[1] === null) ||
      (c.metodo === "filter" && c.args[0] === coluna && c.args[1] === "is" && c.args[2] === null),
  );
}

function ordensDesc(op: Op): string[] {
  return op.chamadas
    .filter(
      (c) =>
        c.metodo === "order" &&
        (c.args[1] as { ascending?: boolean } | undefined)?.ascending === false,
    )
    .map((c) => String(c.args[0]));
}

// `never`: o mock não reproduz o tipo do supabase-js; o que importa é a cadeia.
const client = () => criarClient() as never;

beforeEach(() => {
  ops = [];
  resposta = { data: [], error: null, count: 0 };
});

describe.each([
  ["listarImagensDaLoja (lojista)", listarImagensDaLoja],
  ["listarImagensDaLojaAdmin (service_role)", listarImagensDaLojaAdmin],
])("%s", (_rotulo, listar) => {
  it("lê imagens_loja com escopo explícito loja_id, só originais não pendentes", async () => {
    await listar(client(), LOJA);
    const op = opDe("imagens_loja");
    expect(temEq(op, "loja_id", LOJA)).toBe(true);
    expect(temFiltroNulo(op, "origem_id")).toBe(true);
    expect(temFiltroNulo(op, "remocao_pendente_em")).toBe(true);
  });

  it("ordena por criado_em desc e depois id desc (keyset estável)", async () => {
    await listar(client(), LOJA);
    expect(ordensDesc(opDe("imagens_loja"))).toEqual(["criado_em", "id"]);
  });

  it("limita a página a 40 (ou 41 para saber se há mais)", async () => {
    await listar(client(), LOJA);
    const limite = opDe("imagens_loja").chamadas.find((c) => c.metodo === "limit");
    expect(limite).toBeDefined();
    expect([40, 41]).toContain(limite?.args[0]);
  });

  it("com cursor, aplica um filtro que usa criado_em E id do cursor", async () => {
    const cursor = { criado_em: "2026-10-06T12:00:00.000Z", id: ID };
    await listar(client(), LOJA, cursor);
    const op = opDe("imagens_loja");
    const texto = JSON.stringify(
      op.chamadas.filter((c) => !["select", "order", "limit", "range"].includes(c.metodo)),
    );
    expect(texto).toContain(cursor.criado_em);
    expect(texto).toContain(cursor.id);
    // o cursor nunca troca o escopo
    expect(temEq(op, "loja_id", LOJA)).toBe(true);
  });

  it("erro do banco propaga (não vira página vazia silenciosa)", async () => {
    resposta = { data: null, error: { message: "falha", code: "XX000" } };
    await expect(listar(client(), LOJA)).rejects.toBeDefined();
  });
});

describe("buscarOriginalDaLoja — origem do recorte (RN-G3)", () => {
  it("filtra loja_id + id + original + não pendente, e devolve a linha", async () => {
    resposta = { data: { id: ID, loja_id: LOJA, caminho: `${LOJA}/galeria/${ID}.webp` }, error: null };
    const r = await buscarOriginalDaLoja(client(), LOJA, ID);
    const op = opDe("imagens_loja");
    expect(temEq(op, "loja_id", LOJA)).toBe(true);
    expect(temEq(op, "id", ID)).toBe(true);
    expect(temFiltroNulo(op, "origem_id")).toBe(true);
    expect(temFiltroNulo(op, "remocao_pendente_em")).toBe(true);
    expect(r).toMatchObject({ id: ID });
  });

  it("nenhuma linha → null", async () => {
    resposta = { data: null, error: null };
    expect(await buscarOriginalDaLoja(client(), LOJA, ID)).toBeNull();
  });

  it("erro do banco propaga", async () => {
    resposta = { data: null, error: { message: "falha", code: "XX000" } };
    await expect(buscarOriginalDaLoja(client(), LOJA, ID)).rejects.toBeDefined();
  });
});

describe("contarOriginaisDaLoja — base do teto (RN-G12)", () => {
  it("conta só originais não pendentes da loja e devolve o número", async () => {
    resposta = { data: null, error: null, count: 37 };
    const n = await contarOriginaisDaLoja(client(), LOJA);
    const op = opDe("imagens_loja");
    expect(temEq(op, "loja_id", LOJA)).toBe(true);
    expect(temFiltroNulo(op, "origem_id")).toBe(true);
    expect(temFiltroNulo(op, "remocao_pendente_em")).toBe(true);
    expect(n).toBe(37);
  });

  it("erro de contagem PROPAGA — contar 0 num erro furaria o teto", async () => {
    resposta = { data: null, error: { message: "falha", code: "XX000" }, count: null };
    await expect(contarOriginaisDaLoja(client(), LOJA)).rejects.toBeDefined();
  });
});
