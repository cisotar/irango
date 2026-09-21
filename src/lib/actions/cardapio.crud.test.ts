import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * [255] As Server Actions de CRUD do cardápio (`src/lib/actions/cardapio.ts`).
 *
 * Divisão de trabalho: `cardapio.test.ts` cobre as actions de LOTE (issue 251);
 * este arquivo cobre criar / atualizar / ligar-desligar / remover / converter.
 * O que ele prova é o CONTRATO DA FRONTEIRA:
 *  - `loja_id` e `timezone` vêm de `buscarLojaDoDono`, nunca do payload;
 *  - `prazo_fim` de preset é RECALCULADO no servidor e o do cliente descartado
 *    (RN-04), com a travessia hora local → instante no fuso da LOJA;
 *  - `ordem = max(ordem) + 1` (RN-15);
 *  - desligar mexe SÓ em `ativo` (RN-03);
 *  - remover é recusado com mensagem legível enquanto houver exclusivo que
 *    ficaria órfão (RN-14), e o `23000` do trigger nunca vira texto cru na UI;
 *  - `revalidatePath` nos três caminhos reais, só no sucesso (RN-11).
 *
 * Padrão de mocks: cada `from(...)` consome a PRÓXIMA resposta da fila, porque
 * a remoção faz três leituras na mesma tabela com dados diferentes.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const LOJA_SLUG = "lanches-base";
const TZ = "America/Sao_Paulo";

const CARDAPIO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OUTRO_CARDAPIO = "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd";
const P1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const P2 = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";

type Op = {
  tabela: string;
  selected?: boolean;
  colunas?: string;
  insert?: unknown;
  update?: unknown;
  deleted?: boolean;
  filtros: Array<[string, unknown]>;
};

let ops: Op[];
let fila: Array<{ data: unknown; error: unknown }>;

function makeChain() {
  return {
    from: (tabela: string) => {
      const op: Op = { tabela, filtros: [] };
      ops.push(op);
      const chain: Record<string, unknown> = {};
      const passthrough = (k: string) => {
        chain[k] = (...args: unknown[]) => {
          if (k === "eq" || k === "in") op.filtros.push([args[0] as string, args[1]]);
          if (k === "select") {
            op.selected = true;
            op.colunas = args[0] as string | undefined;
          }
          return chain;
        };
      };
      ["select", "eq", "in", "order", "limit", "single", "maybeSingle", "is"].forEach(
        passthrough,
      );
      chain.insert = (linhas: unknown) => {
        op.insert = linhas;
        return chain;
      };
      chain.update = (valores: unknown) => {
        op.update = valores;
        return chain;
      };
      chain.delete = () => {
        op.deleted = true;
        return chain;
      };
      chain.then = (onF: (v: unknown) => unknown) =>
        Promise.resolve(fila.shift() ?? { data: null, error: null }).then(onF);
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

const authClient = makeChain();
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

import {
  criarCardapio,
  atualizarCardapio,
  ligarDesligarCardapio,
  removerCardapio,
  converterExclusivosParaMenu,
} from "./cardapio";
import { MSG_SEM_EIXO } from "@/lib/validacoes/cardapio";

function escritas(): Op[] {
  return ops.filter((o) => o.insert || o.update || o.deleted);
}

function semRuido<T>(fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  return fn().finally(() => spy.mockRestore());
}

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  fila = [];
  buscarLojaDoDono.mockResolvedValue({
    id: LOJA_ID,
    slug: LOJA_SLUG,
    timezone: TZ,
  });
});

// ══════════════════════════════════════════════════════ criarCardapio ═══════

describe("criarCardapio", () => {
  const recorrente = {
    nome: "Fim de semana",
    modo: "recorrente",
    dias_semana: [6, 0],
    dias_mes: [],
    hora_inicio: "11:00",
    hora_fim: "15:00",
  };

  it("[RN-15] grava ordem = max(ordem) + 1 e loja_id derivado — nunca do payload", async () => {
    fila = [
      { data: { ordem: 4 }, error: null },
      { data: null, error: null },
    ];
    const r = await criarCardapio({ ...recorrente, loja_id: "outra" });
    // `.strict()` do zod: o `loja_id` pendurado derruba o payload inteiro.
    expect(r).toEqual({ ok: false, erro: "Cardápio inválido." });

    ops = [];
    fila = [
      { data: { ordem: 4 }, error: null },
      { data: null, error: null },
    ];
    expect(await criarCardapio(recorrente)).toEqual({ ok: true });
    expect(escritas()).toHaveLength(1);
    expect(escritas()[0].insert).toEqual({
      nome: "Fim de semana",
      modo: "recorrente",
      dias_semana: [0, 6],
      dias_mes: null, // RN-02: array vazio vira NULL
      hora_inicio: "11:00",
      hora_fim: "15:00",
      prazo_inicio: null,
      prazo_fim: null,
      prazo_preset: null,
      loja_id: LOJA_ID,
      ordem: 5,
    });
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("primeiro cardápio da loja nasce com ordem 0", async () => {
    fila = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    await criarCardapio(recorrente);
    expect((escritas()[0].insert as { ordem: number }).ordem).toBe(0);
  });

  it("[RN-04] preset mensal: 31/01 grava fim em 28/02, DESCARTANDO o fim do cliente", async () => {
    fila = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    const r = await criarCardapio({
      nome: "Mês da feijoada",
      modo: "prazo_fixo",
      prazo_inicio: "2026-01-31T11:00",
      // O cliente tenta esticar o prazo por quatro anos.
      prazo_fim: "2030-01-01T00:00",
      prazo_preset: "mensal",
    });
    expect(r).toEqual({ ok: true });

    const linha = escritas()[0].insert as Record<string, string>;
    // Hora local da LOJA → instante, com o fuso lido do banco (UTC-3).
    expect(linha.prazo_inicio).toBe("2026-01-31T14:00:00.000Z");
    // Clamp de fim de mês: 31/01 + 1 mês = 28/02, nunca 03/03.
    expect(linha.prazo_fim).toBe("2026-02-28T14:00:00.000Z");
  });

  it("[RN-04] customizado é o único preset em que o fim digitado é aceito", async () => {
    fila = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    await criarCardapio({
      nome: "Temporada",
      modo: "prazo_fixo",
      prazo_inicio: "2026-01-31T11:00",
      prazo_fim: "2026-02-10T23:00",
      prazo_preset: "customizado",
    });
    const linha = escritas()[0].insert as Record<string, string>;
    expect(linha.prazo_fim).toBe("2026-02-11T02:00:00.000Z");
  });

  it("[RN-02] recorrente sem eixo é recusado com a frase literal, ANTES de qualquer I/O", async () => {
    const r = await criarCardapio({ nome: "Sempre", modo: "recorrente" });
    expect(r).toEqual({ ok: false, erro: MSG_SEM_EIXO });
    expect(createClient).not.toHaveBeenCalled();
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("[§14] 23514 do CHECK vira mensagem genérica; o texto cru fica no log", async () => {
    fila = [
      { data: null, error: null },
      {
        data: null,
        error: {
          code: "23514",
          message:
            'new row for relation "cardapios" violates check constraint "cardapios_recorrente_tem_eixo"',
        },
      },
    ];
    const r = await semRuido(() => criarCardapio(recorrente));
    expect(r).toEqual({
      ok: false,
      erro: "Não foi possível salvar o cardápio.",
    });
    expect(JSON.stringify(r)).not.toContain("23514");
    expect(JSON.stringify(r)).not.toContain("cardapios_recorrente_tem_eixo");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("[RN-11] revalida os três caminhos reais, pelo slug da PRÓPRIA loja", async () => {
    fila = [
      { data: null, error: null },
      { data: null, error: null },
    ];
    await criarCardapio(recorrente);
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      "/painel/cardapios",
      "/painel/produtos",
      `/loja/${LOJA_SLUG}`,
    ]);
    expect(revalidatePath).not.toHaveBeenCalledWith("/loja/[slug]", "page");
  });
});

// ═══════════════════════════════════════════════════ atualizarCardapio ══════

describe("atualizarCardapio", () => {
  it("[RN-01] trocar de modo apaga a configuração do modo anterior, e o escopo é id + loja_id", async () => {
    fila = [{ data: null, error: null }];
    const r = await atualizarCardapio(CARDAPIO, {
      nome: "Agora é prazo",
      modo: "prazo_fixo",
      prazo_inicio: "2026-09-21T11:00",
      prazo_preset: "diario",
    });
    expect(r).toEqual({ ok: true });

    const w = escritas()[0];
    expect(w.update).toEqual({
      nome: "Agora é prazo",
      modo: "prazo_fixo",
      dias_semana: null,
      dias_mes: null,
      hora_inicio: null,
      hora_fim: null,
      prazo_inicio: "2026-09-21T14:00:00.000Z",
      prazo_fim: "2026-09-22T14:00:00.000Z",
      prazo_preset: "diario",
    });
    expect(w.filtros).toEqual([
      ["id", CARDAPIO],
      ["loja_id", LOJA_ID],
    ]);
    // `ativo` é de `ligarDesligarCardapio` e de mais ninguém.
    expect(w.update).not.toHaveProperty("ativo");
    expect(w.update).not.toHaveProperty("loja_id");
  });
});

// ═════════════════════════════════════════════ ligarDesligarCardapio ════════

describe("ligarDesligarCardapio (RN-03)", () => {
  it("mexe SÓ em ativo — dias, horários e prazo continuam salvos", async () => {
    fila = [{ data: null, error: null }];
    const r = await ligarDesligarCardapio(CARDAPIO, false);
    expect(r).toEqual({ ok: true });

    const w = escritas()[0];
    expect(w.tabela).toBe("cardapios");
    expect(w.update).toEqual({ ativo: false });
    expect(w.filtros).toEqual([
      ["id", CARDAPIO],
      ["loja_id", LOJA_ID],
    ]);
  });
});

// ═════════════════════════════════════════════════════ removerCardapio ═════

describe("removerCardapio (RN-14)", () => {
  it("recusa com mensagem legível e o NÚMERO quando há exclusivo que ficaria órfão", async () => {
    fila = [
      // vínculos deste cardápio
      { data: [{ produto_id: P1 }, { produto_id: P2 }], error: null },
      // quais deles são exclusivos
      { data: [{ id: P1 }], error: null },
      // todos os vínculos desses exclusivos: só este cardápio
      { data: [{ produto_id: P1, cardapio_id: CARDAPIO }], error: null },
    ];
    const r = await removerCardapio(CARDAPIO);
    expect(r).toEqual({
      ok: false,
      erro:
        "1 produto só aparece por causa deste cardápio e sumiria da vitrine. Converta esse produto para o menu antes de remover o cardápio.",
      exclusivos: 1,
    });
    expect(escritas()).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("NÃO recusa quando o exclusivo também está em outro cardápio — ele não ficaria órfão", async () => {
    fila = [
      { data: [{ produto_id: P1 }], error: null },
      { data: [{ id: P1 }], error: null },
      {
        data: [
          { produto_id: P1, cardapio_id: CARDAPIO },
          { produto_id: P1, cardapio_id: OUTRO_CARDAPIO },
        ],
        error: null,
      },
      { data: null, error: null }, // o delete
    ];
    expect(await removerCardapio(CARDAPIO)).toEqual({ ok: true });
    const w = escritas()[0];
    expect(w.deleted).toBe(true);
    expect(w.filtros).toEqual([
      ["id", CARDAPIO],
      ["loja_id", LOJA_ID],
    ]);
  });

  it("remove normalmente o cardápio sem vínculos, e revalida", async () => {
    fila = [
      { data: [], error: null },
      { data: null, error: null },
    ];
    expect(await removerCardapio(CARDAPIO)).toEqual({ ok: true });
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
      "/painel/cardapios",
      "/painel/produtos",
      `/loja/${LOJA_SLUG}`,
    ]);
  });

  it("[backstop] o 23000 do trigger vira a frase acionável, nunca o texto cru do Postgres", async () => {
    fila = [
      { data: [{ produto_id: P1 }], error: null },
      { data: [], error: null },
      {
        data: null,
        error: {
          code: "23000",
          message: `produto exclusivo sem cardapio: ${P1}`,
        },
      },
    ];
    const r = await semRuido(() => removerCardapio(CARDAPIO));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("23000");
    expect(JSON.stringify(r)).not.toContain("produto exclusivo sem cardapio:");
    // Sem NÚMERO: o backstop só dispara numa corrida no COMMIT, depois de a
    // leitura ter devolvido zero órfãos — ali o servidor não tem contagem
    // confiável, e o literal `1` de antes era ficção (o lojista lia "1
    // produto" mesmo com três orfanados). `exclusivos: 0` ⇒ o diálogo não
    // oferece um botão "converter os N" com N inventado.
    expect(r).toMatchObject({ exclusivos: 0 });
    const erro = String((r as { erro: string }).erro);
    expect(erro).toContain("Converta esses produtos para o menu");
    expect(erro).not.toMatch(/\d/);
  });
});

// ═══════════════════════════════════════ converterExclusivosParaMenu ════════

describe("converterExclusivosParaMenu", () => {
  /** As três leituras de `produtosQueFicariamOrfaos`, nesta ordem. */
  function leiturasDeOrfaos(
    vinculados: string[],
    exclusivos: string[],
    vinculos: Array<{ produto_id: string; cardapio_id: string }>,
  ): Array<{ data: unknown; error: unknown }> {
    return [
      { data: vinculados.map((id) => ({ produto_id: id })), error: null },
      { data: exclusivos.map((id) => ({ id })), error: null },
      { data: vinculos, error: null },
    ];
  }

  it("escreve só visibilidade = 'menu', escopado por loja e pelos que ficariam órfãos", async () => {
    fila = [
      ...leiturasDeOrfaos([P1, P2], [P1, P2], [
        { produto_id: P1, cardapio_id: CARDAPIO },
        { produto_id: P2, cardapio_id: CARDAPIO },
      ]),
      { data: null, error: null },
    ];
    expect(await converterExclusivosParaMenu(CARDAPIO)).toEqual({ ok: true });

    const w = escritas()[0];
    expect(w.tabela).toBe("produtos");
    expect(w.update).toEqual({ visibilidade: "menu" });
    expect(w.filtros).toEqual([
      ["loja_id", LOJA_ID],
      ["visibilidade", "cardapio"],
      ["id", [P1, P2]],
    ]);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  /**
   * O bug da issue: o UPDATE usava TODOS os vinculados, então o exclusivo que
   * também está em OUTRO cardápio (P1) virava `menu` e passava a aparecer o
   * ano inteiro — sem estar em cardápio sazonal nenhum, e sem o lojista ter
   * pedido. O escopo agora é o MESMO da recusa: só quem ficaria órfão.
   */
  it("NÃO converte o exclusivo que também está em outro cardápio", async () => {
    fila = [
      ...leiturasDeOrfaos([P1, P2], [P1, P2], [
        { produto_id: P1, cardapio_id: CARDAPIO },
        { produto_id: P1, cardapio_id: OUTRO_CARDAPIO },
        { produto_id: P2, cardapio_id: CARDAPIO },
      ]),
      { data: null, error: null },
    ];
    expect(await converterExclusivosParaMenu(CARDAPIO)).toEqual({ ok: true });

    const w = escritas()[0];
    expect(w.filtros).toEqual([
      ["loja_id", LOJA_ID],
      ["visibilidade", "cardapio"],
      ["id", [P2]],
    ]);
  });

  /**
   * A prova de ponta a ponta do número: o mesmo estado de banco visto pelas
   * duas actions. A recusa anuncia "1 produto", o botão repete esse 1 — e a
   * conversão escreve em exatamente 1 id, o mesmo.
   */
  it("converte exatamente o que a recusa da remoção anunciou", async () => {
    const vinculos = [
      { produto_id: P1, cardapio_id: CARDAPIO },
      { produto_id: P1, cardapio_id: OUTRO_CARDAPIO },
      { produto_id: P2, cardapio_id: CARDAPIO },
    ];

    fila = leiturasDeOrfaos([P1, P2], [P1, P2], vinculos);
    const recusa = await removerCardapio(CARDAPIO);
    expect(recusa).toMatchObject({ ok: false, exclusivos: 1 });
    expect(String((recusa as { erro: string }).erro)).toContain("1 produto só");
    expect(escritas()).toHaveLength(0);

    ops = [];
    fila = [...leiturasDeOrfaos([P1, P2], [P1, P2], vinculos), {
      data: null,
      error: null,
    }];
    expect(await converterExclusivosParaMenu(CARDAPIO)).toEqual({ ok: true });

    const w = escritas()[0];
    expect(w.filtros.at(-1)).toEqual(["id", [P2]]);
  });

  it("cardápio sem vínculo nenhum não escreve nada", async () => {
    fila = [{ data: [], error: null }];
    expect(await converterExclusivosParaMenu(CARDAPIO)).toEqual({ ok: true });
    expect(escritas()).toHaveLength(0);
  });

  it("cardápio só com produtos do menu (nenhum exclusivo) não escreve nada", async () => {
    fila = [
      { data: [{ produto_id: P1 }], error: null },
      { data: [], error: null },
    ];
    expect(await converterExclusivosParaMenu(CARDAPIO)).toEqual({ ok: true });
    expect(escritas()).toHaveLength(0);
  });
});

// ══════════════════════════════════════════ id fora de forma (zod guid) ════

/**
 * As quatro actions de ENTIDADE recebem o `id` como escalar e iam direto ao
 * `.eq()`. O contrato declarado no cabeçalho do módulo — e já cumprido pelas
 * actions de LOTE — é parse ANTES de qualquer I/O: lixo não vira ida ao banco.
 */
describe("id fora de forma não chega ao banco", () => {
  const LIXO = "nao-e-um-guid";

  it("nenhuma das quatro actions abre client, lê a loja ou escreve", async () => {
    const resultados = [
      await atualizarCardapio(LIXO, {
        nome: "X",
        modo: "recorrente",
        dias_semana: [0],
      }),
      await ligarDesligarCardapio(LIXO, true),
      await removerCardapio(LIXO),
      await converterExclusivosParaMenu(LIXO),
    ];

    expect(resultados.every((r) => r.ok === false)).toBe(true);
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════ loja ausente (todas) ═════

describe("sem loja do dono", () => {
  it("nenhuma das actions escreve nada", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    await criarCardapio({
      nome: "X",
      modo: "recorrente",
      dias_semana: [0],
    });
    await ligarDesligarCardapio(CARDAPIO, true);
    await removerCardapio(CARDAPIO);
    await converterExclusivosParaMenu(CARDAPIO);
    expect(escritas()).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
