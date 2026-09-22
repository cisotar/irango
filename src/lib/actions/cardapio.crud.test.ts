import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
// [284] `count` na fila: `removerCardapio` lê `count === 0` desde a 274 · D8, e
// RN-10 exige que o `manter` continue lendo. Opcional — nenhuma fila existente
// muda.
let fila: Array<{ data: unknown; error: unknown; count?: number }>;

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

// ── [284] `buscarProdutosQueFicariamOrfaos` OBSERVÁVEL, sem trocar a query ───
//
// Por default DELEGA à implementação REAL (que lê a mesma `fila`): nenhum caso
// de 255/274 muda de comportamento. Os casos de RN-02 a sobrescrevem para fixar
// o conjunto que o SERVIDOR derivou e afirmar que o `in(...)` recebeu
// EXATAMENTE ele — e `orfaosChamadas` prova com que `loja_id` a leitura rodou,
// que é o que RN-04 protege.
type LeituraDeOrfaos = (
  client: unknown,
  lojaId: string,
  cardapioId: string,
) => Promise<string[]>;
let orfaosFake: LeituraDeOrfaos | null = null;
const orfaosChamadas: Array<[unknown, string, string]> = [];

vi.mock("@/lib/supabase/queries/cardapios", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/supabase/queries/cardapios")>();
  type ClientDaQuery = Parameters<typeof real.buscarProdutosQueFicariamOrfaos>[0];
  return {
    ...real,
    buscarProdutosQueFicariamOrfaos: async (
      client: unknown,
      lojaId: string,
      cardapioId: string,
    ): Promise<string[]> => {
      orfaosChamadas.push([client, lojaId, cardapioId]);
      return orfaosFake
        ? orfaosFake(client, lojaId, cardapioId)
        : real.buscarProdutosQueFicariamOrfaos(
            client as ClientDaQuery,
            lojaId,
            cardapioId,
          );
    },
  };
});

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

// [284] Sem override e sem histórico entre casos: o default continua sendo a
// query REAL lendo a `fila`.
beforeEach(() => {
  orfaosFake = null;
  orfaosChamadas.length = 0;
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

  // [Auditoria 260/261] O reconhecedor exige o PAR `23000` + fragmento. Só o
  // fragmento faria um erro de outra origem que o contivesse (o nome de um
  // produto num `permission denied`, por exemplo) virar a recusa de RN-14 e
  // mandar o lojista converter produtos que não travam nada.
  it("[backstop] fragmento SEM o 23000 continua genérico", async () => {
    fila = [
      { data: [{ produto_id: P1 }], error: null },
      { data: [], error: null },
      {
        data: null,
        error: {
          code: "42501",
          message: `permission denied: produto exclusivo sem cardapio: ${P1}`,
        },
      },
    ];
    const r = await semRuido(() => removerCardapio(CARDAPIO));
    expect(r).toEqual({
      ok: false,
      erro: "Não foi possível remover o cardápio.",
      exclusivos: 0,
    });
  });
});

// ═══════════════════════════════════════ converterExclusivosParaMenu ════════

describe("converterExclusivosParaMenu", () => {
  /**
   * [274 · D8] A leitura de POSSE (`cardapioPertenceALoja`) que passou a vir
   * ANTES das três de órfãos: sem ela, um `cardapioId` alheio faria a conversão
   * ler vínculos de outra loja e responder `{ ok: true }` por uma escrita que
   * não aconteceu. Aqui a fila é posicional, então o caminho feliz precisa
   * declarar a posse como a PRIMEIRA resposta.
   */
  const POSSE = { data: { id: CARDAPIO }, error: null };

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
      POSSE,
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
      POSSE,
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
    fila = [POSSE, ...leiturasDeOrfaos([P1, P2], [P1, P2], vinculos), {
      data: null,
      error: null,
    }];
    expect(await converterExclusivosParaMenu(CARDAPIO)).toEqual({ ok: true });

    const w = escritas()[0];
    expect(w.filtros.at(-1)).toEqual(["id", [P2]]);
  });

  it("cardápio sem vínculo nenhum não escreve nada", async () => {
    fila = [POSSE, { data: [], error: null }];
    expect(await converterExclusivosParaMenu(CARDAPIO)).toEqual({ ok: true });
    expect(escritas()).toHaveLength(0);
  });

  it("cardápio só com produtos do menu (nenhum exclusivo) não escreve nada", async () => {
    fila = [
      POSSE,
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

// ═══════════ [284] RED — remoção com escolha: manter · arquivar · cascata ════
//
// Spec: `specs/remocao-cardapio-exclusivos.md` (RN-01 a RN-13, §Contrato das
// actions). Os 12 critérios mecânicos, lado LOJISTA. O gêmeo admin está em
// `src/app/admin/assinantes/actions/admin-cardapios.paridade.test.ts`.
//
// ── Por que `removerCardapio` é alcançada por import DINÂMICO aqui ──────────
// A assinatura de hoje é `(id: string)`. Chamar `removerCardapio(id, "arquivar")`
// pelo símbolo importado ESTATICAMENTE no topo deste arquivo quebraria
// `npx tsc --noEmit` (2 argumentos para 1 parâmetro) e derrubaria o arquivo
// inteiro — inclusive os casos de regressão de RN-10, que são a linha de base
// que esta issue não pode mover. O caminho em VARIÁVEL mantém a suíte tipável
// e faz cada caso novo falhar com a SUA asserção.
//
// NENHUMA asserção existente de `removerCardapio` foi tocada (RN-10).

const MODULO_CARDAPIO = "./cardapio";

/** O tipo que a fase GREEN tem de publicar em `cardapio-contrato.ts` (RN-01). */
type ModoRemocaoExclusivos = "manter" | "arquivar" | "cascata";
type ResultadoRemocao284 =
  | { ok: true }
  | { ok: false; erro: string; exclusivos: number };

type CardapioComModo = {
  removerCardapio(
    id: string,
    modo?: ModoRemocaoExclusivos,
  ): Promise<ResultadoRemocao284>;
};

async function comModo(): Promise<CardapioComModo> {
  return (await import(/* @vite-ignore */ MODULO_CARDAPIO)) as unknown as CardapioComModo;
}

/** A posse do cardápio (`cardapioPertenceALoja`): 1 select, 1 linha (RN-04). */
const POSSE_284 = { data: { id: CARDAPIO }, error: null };
const SEM_POSSE_284 = { data: null, error: null };

const MSG_REMOVER_284 = "Não foi possível remover o cardápio.";
const MSG_INVALIDO_284 = "Cardápio inválido.";
const MSG_EXCLUSIVOS_SEM_NUMERO_284 =
  "Alguns produtos só aparecem por causa deste cardápio e sumiriam da vitrine. Converta esses produtos para o menu antes de remover o cardápio.";
const MSG_EXCLUSIVOS_1_284 =
  "1 produto só aparece por causa deste cardápio e sumiria da vitrine. Converta esse produto para o menu antes de remover o cardápio.";

const ERRO_TRIGGER_284 = {
  code: "23000",
  message: `produto exclusivo sem cardapio: ${P1}`,
};

/** A forma comparável de uma op — é ela que prova "a MESMA sequência" (RN-10). */
function sequencia(): Array<Record<string, unknown>> {
  return ops.map((o) => ({
    tabela: o.tabela,
    colunas: o.colunas,
    insert: o.insert,
    update: o.update,
    deleted: o.deleted,
    filtros: o.filtros,
  }));
}

describe("[284] removerCardapio(id, modo) — os três modos", () => {
  // ════════════════════════════════ critério 7 · modo inválido, ZERO I/O ════
  //
  // O `default` do switch é `MSG_INVALIDO`, nunca um dos modos: um valor
  // desconhecido NÃO pode cair num ramo destrutivo (RN-01). E o parse é
  // ANTES de qualquer I/O — nem `buscarLojaDoDono` roda.
  describe("critério 7 — modo fora do domínio não vira I/O nem ramo destrutivo", () => {
    const LIXO: unknown[] = ["apagar", "", "cascade", "MANTER", null, 0, { modo: "cascata" }, []];

    it.each(LIXO.map((m) => [JSON.stringify(m) ?? String(m), m] as const))(
      "modo %s ⇒ MSG_INVALIDO, sem abrir client, sem ler a loja, sem escrever",
      async (_rotulo, modo) => {
        const { removerCardapio: remover } = await comModo();
        const r = await remover(CARDAPIO, modo as ModoRemocaoExclusivos);
        expect(r).toEqual({ ok: false, erro: MSG_INVALIDO_284, exclusivos: 0 });
        expect(buscarLojaDoDono).not.toHaveBeenCalled();
        expect(ops).toHaveLength(0);
        expect(revalidatePath).not.toHaveBeenCalled();
      },
    );

    it("`schemaModoRemocao` existe em `lib/validacoes/cardapio` e é isomórfico (RN-01)", async () => {
      const mod = (await import(
        /* @vite-ignore */ "@/lib/validacoes/cardapio"
      )) as Record<string, unknown>;
      const schema = mod.schemaModoRemocao as
        | { safeParse(v: unknown): { success: boolean } }
        | undefined;
      expect(
        typeof schema?.safeParse,
        "`schemaModoRemocao` ainda não existe em `src/lib/validacoes/cardapio.ts` (RN-01)",
      ).toBe("function");
      for (const bom of ["manter", "arquivar", "cascata"]) {
        expect(schema!.safeParse(bom).success, `${bom} devia passar`).toBe(true);
      }
      for (const ruim of ["apagar", "", "MANTER", null, 0, {}, []]) {
        expect(
          schema!.safeParse(ruim).success,
          `${JSON.stringify(ruim)} NÃO podia passar`,
        ).toBe(false);
      }
    });

    it("o tipo `ModoRemocaoExclusivos` mora no módulo NEUTRO, não no `'use server'`", () => {
      const contrato = readFileSync(
        join(import.meta.dirname, "cardapio-contrato.ts"),
        "utf8",
      );
      expect(
        contrato,
        "arquivo `'use server'` só exporta função async — o tipo é do contrato neutro",
      ).toMatch(/export type ModoRemocaoExclusivos\s*=/);
      for (const literal of ['"manter"', '"arquivar"', '"cascata"']) {
        expect(contrato).toContain(literal);
      }
    });
  });

  // ══════════════════ critério 1 · RN-10 — `manter` é a linha de base intacta ═
  describe("critério 1 (RN-10) — `manter` e a ausência do parâmetro são byte a byte o de hoje", () => {
    /** O estado de banco da recusa: 1 exclusivo pendurado só neste cardápio. */
    function filaDaRecusa() {
      return [
        { data: [{ produto_id: P1 }, { produto_id: P2 }], error: null },
        { data: [{ id: P1 }], error: null },
        { data: [{ produto_id: P1, cardapio_id: CARDAPIO }], error: null },
      ];
    }

    it("mesma resposta E mesma sequência de chamadas, sem nenhuma escrita em produtos", async () => {
      const { removerCardapio: remover } = await comModo();

      fila = filaDaRecusa();
      const semModo = await remover(CARDAPIO);
      const opsSemModo = sequencia();

      ops = [];
      fila = filaDaRecusa();
      const comManter = await remover(CARDAPIO, "manter");
      const opsComManter = sequencia();

      expect(semModo).toEqual({
        ok: false,
        erro: MSG_EXCLUSIVOS_1_284,
        exclusivos: 1,
      });
      expect(comManter).toEqual(semModo);
      expect(opsComManter).toEqual(opsSemModo);
      expect(escritas()).toHaveLength(0);
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    /**
     * RN-04 diz, com todas as letras, que o gate de posse NÃO entra no
     * `manter`: uma leitura a mais mudaria a sequência e quebraria a
     * preservação byte a byte. A prova é posicional — a PRIMEIRA ida ao banco
     * do `manter` continua sendo a dos vínculos, não um `select("id")` em
     * `cardapios`.
     */
    it("`manter` NÃO ganha o gate de posse — a 1ª leitura continua a dos vínculos", async () => {
      const { removerCardapio: remover } = await comModo();
      fila = [{ data: [], error: null }, { data: null, error: null }];
      expect(await remover(CARDAPIO, "manter")).toEqual({ ok: true });
      expect(ops[0].tabela).toBe("cardapio_produtos");
      expect(
        ops.filter((o) => o.tabela === "cardapios" && o.selected),
        "um select de posse aqui mudaria a sequência de hoje (RN-10)",
      ).toHaveLength(0);
    });

    it("`manter` preserva o backstop do 23000 SEM número", async () => {
      const { removerCardapio: remover } = await comModo();
      fila = [
        { data: [{ produto_id: P1 }], error: null },
        { data: [], error: null },
        { data: null, error: ERRO_TRIGGER_284 },
      ];
      const r = await semRuido(() => remover(CARDAPIO, "manter"));
      expect(r).toEqual({
        ok: false,
        erro: MSG_EXCLUSIVOS_SEM_NUMERO_284,
        exclusivos: 0,
      });
    });

    it("`manter` preserva `count === 0` ⇒ MSG_REMOVER", async () => {
      const { removerCardapio: remover } = await comModo();
      fila = [
        { data: [], error: null },
        { data: null, error: null, count: 0 },
      ];
      const r = await semRuido(() => remover(CARDAPIO, "manter"));
      expect(r).toEqual({ ok: false, erro: MSG_REMOVER_284, exclusivos: 0 });
    });
  });

  // ═══════════════════════════════════ critérios 2, 5, 6 · `arquivar` ════════
  describe("critério 2 — `arquivar` grava oculto + visibilidade, e SÓ isso", () => {
    it("UM update com o objeto INTEIRO { oculto: true, visibilidade: 'menu' }, depois o DELETE", async () => {
      const { removerCardapio: remover } = await comModo();
      orfaosFake = async () => [P1, P2];
      fila = [POSSE_284, { data: null, error: null }, { data: null, error: null }];

      expect(await remover(CARDAPIO, "arquivar")).toEqual({ ok: true });

      const w = escritas();
      expect(w).toHaveLength(2);

      // — RN-05: o objeto INTEIRO. `toEqual` sobre o literal é o que prova que
      // `disponivel` NÃO está lá: "arquivado" é `oculto`, e `disponivel: false`
      // é "esgotado", que CONTINUA VISÍVEL na vitrine (§Ressalva de vocabulário).
      expect(w[0].tabela).toBe("produtos");
      expect(w[0].update).toEqual({ oculto: true, visibilidade: "menu" });
      expect(w[0].update).not.toHaveProperty("disponivel");
      expect(w[0].update).not.toHaveProperty("loja_id");
      expect(w[0].update).not.toHaveProperty("preco");
      expect(w[0].update).not.toHaveProperty("categoria_id");

      // — critério 5: escopo literal, `loja_id` da SESSÃO + 2º cinto de
      // `visibilidade = 'cardapio'`. Produto de outra loja com nome parecido
      // não entra em nenhum dos três filtros.
      expect(w[0].filtros).toEqual([
        ["loja_id", LOJA_ID],
        ["visibilidade", "cardapio"],
        ["id", [P1, P2]],
      ]);

      // — RN-06: produtos PRIMEIRO, cardápio DEPOIS. A ordem inversa derruba a
      // transação com 23000 (trigger deferido).
      expect(w[1].tabela).toBe("cardapios");
      expect(w[1].deleted).toBe(true);
      expect(w[1].filtros).toEqual([
        ["id", CARDAPIO],
        ["loja_id", LOJA_ID],
      ]);
      expect(ops.indexOf(w[0])).toBeLessThan(ops.indexOf(w[1]));

      expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([
        "/painel/cardapios",
        "/painel/produtos",
        `/loja/${LOJA_SLUG}`,
      ]);
    });

    it("sem nenhum órfão, `arquivar` não escreve em produtos e remove normalmente", async () => {
      const { removerCardapio: remover } = await comModo();
      orfaosFake = async () => [];
      fila = [POSSE_284, { data: null, error: null }];
      expect(await remover(CARDAPIO, "arquivar")).toEqual({ ok: true });
      const w = escritas();
      expect(w).toHaveLength(1);
      expect(w[0].tabela).toBe("cardapios");
    });
  });

  // ══════════════════════════════════════════════════ critério 3 · `cascata` ═
  describe("critério 3 — `cascata` apaga os órfãos e SÓ depois o cardápio", () => {
    it("um DELETE em produtos escopado por loja + visibilidade + in(órfãos), depois o cardápio", async () => {
      const { removerCardapio: remover } = await comModo();
      orfaosFake = async () => [P1, P2];
      fila = [POSSE_284, { data: null, error: null }, { data: null, error: null }];

      expect(await remover(CARDAPIO, "cascata")).toEqual({ ok: true });

      const w = escritas();
      expect(w).toHaveLength(2);
      expect(w[0].tabela).toBe("produtos");
      expect(w[0].deleted).toBe(true);
      expect(w[0].update).toBeUndefined();
      expect(w[0].filtros).toEqual([
        ["loja_id", LOJA_ID],
        ["visibilidade", "cardapio"],
        ["id", [P1, P2]],
      ]);
      expect(w[1].tabela).toBe("cardapios");
      expect(w[1].deleted).toBe(true);
      expect(ops.indexOf(w[0])).toBeLessThan(ops.indexOf(w[1]));
    });
  });

  // ══════════════ critério 4 · a lista é do SERVIDOR, nunca do cliente (RN-02)
  describe("critério 4 (RN-02) — o `in(...)` é o retorno de buscarProdutosQueFicariamOrfaos", () => {
    /**
     * O conjunto é DIFERENTE do "esperado ingênuo": P1 é exclusivo e está
     * vinculado a este cardápio, mas TAMBÉM a outro — não ficaria órfão. Uma
     * implementação que arquivasse/apagasse "todos os exclusivos vinculados"
     * (o que um cliente mandaria) o incluiria, e o prato passaria a sumir da
     * vitrine de um cardápio que continua vivo.
     */
    it("ponta a ponta com a query REAL: o exclusivo com OUTRO vínculo NÃO entra no in()", async () => {
      const { removerCardapio: remover } = await comModo();
      orfaosFake = null; // a query de verdade, lendo o mesmo banco falso
      fila = [
        POSSE_284,
        { data: [{ produto_id: P1 }, { produto_id: P2 }], error: null },
        { data: [{ id: P1 }, { id: P2 }], error: null },
        {
          data: [
            { produto_id: P1, cardapio_id: CARDAPIO },
            { produto_id: P1, cardapio_id: OUTRO_CARDAPIO },
            { produto_id: P2, cardapio_id: CARDAPIO },
          ],
          error: null,
        },
        { data: null, error: null },
        { data: null, error: null },
      ];

      expect(await remover(CARDAPIO, "cascata")).toEqual({ ok: true });

      const w = escritas();
      expect(w[0].tabela).toBe("produtos");
      expect(w[0].filtros.at(-1)).toEqual(["id", [P2]]);
      expect(JSON.stringify(w[0].filtros)).not.toContain(P1);
    });

    it("o `in()` recebe EXATAMENTE o que a query devolveu, e a query é chamada com a loja da sessão", async () => {
      const { removerCardapio: remover } = await comModo();
      // Um conjunto que NÃO é derivável de nada que o caller conheça: se o
      // `in()` casar com ele, a lista veio da query e de lugar nenhum mais.
      const DO_SERVIDOR = [P2];
      orfaosFake = async () => DO_SERVIDOR;
      fila = [POSSE_284, { data: null, error: null }, { data: null, error: null }];

      expect(await remover(CARDAPIO, "arquivar")).toEqual({ ok: true });

      expect(orfaosChamadas).toHaveLength(1);
      expect(orfaosChamadas[0].slice(1)).toEqual([LOJA_ID, CARDAPIO]);
      expect(escritas()[0].filtros.at(-1)).toEqual(["id", DO_SERVIDOR]);
    });

    /**
     * O IDOR de lote desta fatia: um caller hostil (a Server Action é um
     * endpoint) pendura uma lista de ids no 3º argumento. A assinatura é
     * `(id, modo?)` e mais nada — o argumento extra é ignorado, e o `in()`
     * continua sendo o conjunto derivado no servidor. Vazar aqui seria
     * IRREVERSÍVEL no modo `cascata`.
     */
    it("um 3º argumento com ids do cliente é ignorado — o in() continua o do servidor", async () => {
      const { removerCardapio: remover } = await comModo();
      const DO_SERVIDOR = [P2];
      orfaosFake = async () => DO_SERVIDOR;
      fila = [POSSE_284, { data: null, error: null }, { data: null, error: null }];

      const hostil = remover as unknown as (...a: unknown[]) => Promise<unknown>;
      expect(await hostil(CARDAPIO, "cascata", [P1, OUTRO_CARDAPIO])).toEqual({
        ok: true,
      });

      const w = escritas();
      expect(w[0].tabela).toBe("produtos");
      expect(w[0].filtros.at(-1)).toEqual(["id", DO_SERVIDOR]);
      expect(JSON.stringify(w[0].filtros)).not.toContain(P1);
      expect(
        (remover as (...a: unknown[]) => unknown).length,
        "removerCardapio(id, modo?) — nenhum parâmetro obrigatório de lista",
      ).toBeLessThanOrEqual(2);
    });
  });

  // ═══════════════════════════════ critério 6 · posse do cardápio (RN-04) ════
  describe("critério 6 (RN-04) — cardápio alheio/inexistente nos modos novos", () => {
    it.each(["arquivar", "cascata"] as const)(
      "%s sem posse ⇒ MSG_REMOVER, zero leitura de órfãos e zero escrita",
      async (modo) => {
        const { removerCardapio: remover } = await comModo();
        orfaosFake = null;
        fila = [SEM_POSSE_284];

        const r = await semRuido(() => remover(CARDAPIO, modo));
        expect(r).toEqual({ ok: false, erro: MSG_REMOVER_284, exclusivos: 0 });
        expect(
          orfaosChamadas,
          "ler os órfãos sem posse provada roda a query sobre outro tenant (RN-04)",
        ).toHaveLength(0);
        expect(escritas()).toHaveLength(0);
        expect(revalidatePath).not.toHaveBeenCalled();
      },
    );

    it("a recusa de alheio é byte a byte a de inexistente — nenhum oráculo (§14)", async () => {
      const { removerCardapio: remover } = await comModo();
      orfaosFake = null;

      fila = [SEM_POSSE_284];
      const alheio = await semRuido(() => remover(OUTRO_CARDAPIO, "cascata"));
      ops = [];
      fila = [SEM_POSSE_284];
      const inexistente = await semRuido(() => remover(CARDAPIO, "cascata"));

      expect(alheio).toEqual({
        ok: false,
        erro: MSG_REMOVER_284,
        exclusivos: 0,
      });
      expect(inexistente).toEqual(alheio);
      expect(JSON.stringify(alheio)).not.toContain(OUTRO_CARDAPIO);
    });
  });

  // ═══════════ critério 8 · falha no request 1 NÃO segue para o request 2 ════
  describe("critério 8 (RN-06) — erro na escrita dos produtos aborta antes do DELETE", () => {
    it.each(["arquivar", "cascata"] as const)(
      "%s: erro no request 1 ⇒ MSG_REMOVER e NENHUM delete em cardapios",
      async (modo) => {
        const { removerCardapio: remover } = await comModo();
        orfaosFake = async () => [P1, P2];
        fila = [
          POSSE_284,
          { data: null, error: { code: "42501", message: "permission denied" } },
        ];

        const r = await semRuido(() => remover(CARDAPIO, modo));
        expect(r).toEqual({ ok: false, erro: MSG_REMOVER_284, exclusivos: 0 });
        expect(
          ops.some((o) => o.tabela === "cardapios" && o.deleted),
          "o cardápio tem de continuar existindo — estado reconciliável, não corrompido",
        ).toBe(false);
        expect(revalidatePath).not.toHaveBeenCalled();
        // O texto cru do Postgres fica no log, nunca na tela (§14).
        expect(JSON.stringify(r)).not.toContain("42501");
        expect(JSON.stringify(r)).not.toContain("permission denied");
      },
    );
  });

  // ══════════════════════════ critério 9 · backstop da corrida nos três modos ═
  describe("critério 9 (RN-09) — o 23000 do trigger vira a frase SEM número nos três modos", () => {
    it.each(["arquivar", "cascata"] as const)(
      "%s: DELETE do cardápio com 23000 + fragmento ⇒ MSG_EXCLUSIVOS_SEM_NUMERO",
      async (modo) => {
        const { removerCardapio: remover } = await comModo();
        orfaosFake = async () => [P1];
        fila = [
          POSSE_284,
          { data: null, error: null },
          { data: null, error: ERRO_TRIGGER_284 },
        ];

        const r = await semRuido(() => remover(CARDAPIO, modo));
        expect(r).toEqual({
          ok: false,
          erro: MSG_EXCLUSIVOS_SEM_NUMERO_284,
          exclusivos: 0,
        });
        expect(JSON.stringify(r)).not.toContain("23000");
        expect(JSON.stringify(r)).not.toContain("produto exclusivo sem cardapio");
      },
    );

    it("fragmento SEM o 23000 continua genérico também nos modos novos", async () => {
      const { removerCardapio: remover } = await comModo();
      orfaosFake = async () => [P1];
      fila = [
        POSSE_284,
        { data: null, error: null },
        {
          data: null,
          error: {
            code: "42501",
            message: `permission denied: produto exclusivo sem cardapio: ${P1}`,
          },
        },
      ];
      const r = await semRuido(() => remover(CARDAPIO, "arquivar"));
      expect(r).toEqual({ ok: false, erro: MSG_REMOVER_284, exclusivos: 0 });
    });
  });

  // ═════════════════════════════════════ sem loja da sessão, nos modos novos ══
  describe("sem loja do dono, nenhum modo escreve", () => {
    it.each(["arquivar", "cascata"] as const)("%s não toca no banco", async (modo) => {
      buscarLojaDoDono.mockResolvedValue(null);
      const { removerCardapio: remover } = await comModo();
      orfaosFake = async () => [P1];
      const r = await semRuido(() => remover(CARDAPIO, modo));
      expect(r).toEqual({ ok: false, erro: "Loja não encontrada.", exclusivos: 0 });
      expect(escritas()).toHaveLength(0);
      expect(orfaosChamadas).toHaveLength(0);
    });
  });
});
