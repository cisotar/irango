import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

import {
  buscarCardapiosComProdutos,
  COLUNAS_CARDAPIO_VIGENCIA,
} from "./cardapios";

/**
 * [247] Fase RED — `buscarCardapiosComProdutos`, a 5ª query do SSR da vitrine.
 * Contrato TS com client mockado (camada 2, mesmo padrão de `produtos.test.ts`).
 *
 * O que este arquivo prova:
 *  1. select NOMEADO com o embed, 1 round trip (D5), nunca `select("*")`;
 *  2. `.eq("loja_id", …)` EXPLÍCITO — é o que torna a função segura sob
 *     `service_role` (BYPASSRLS) para 249/252 reusarem sem uma 2ª query;
 *  3. SEM `.eq("ativo", true)`: RN-03 é decidida na função pura, e filtrar no
 *     SQL criaria a segunda casa da regra;
 *  4. `modo` fora do domínio ⇒ linha DESCARTADA (fail-closed, D6);
 *  5. o `Map` produto_id → cardápios montado no mesmo passo;
 *  6. erro PROPAGADO (§14) — fail-closed por omissão é proibido: engolir o erro
 *     e seguir com `[]` faria a vitrine vender a temporada inteira em silêncio.
 */

type Client = SupabaseClient<Database>;
type Terminal = { data: unknown; error: unknown };

function makeClient(terminal: Terminal) {
  const calls = { from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn() };
  const builder: Record<string, unknown> = {};
  builder.select = (...args: unknown[]) => {
    calls.select(...args);
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    calls.eq(...args);
    return builder;
  };
  builder.order = (...args: unknown[]) => {
    calls.order(...args);
    return builder;
  };
  builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);

  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
  } as unknown as Client;

  return { client, calls };
}

const linha = (over: Record<string, unknown> = {}) => ({
  id: "c0000000-0000-4000-8000-000000000001",
  nome: "Fim de semana",
  ativo: true,
  ordem: 3,
  modo: "recorrente",
  dias_semana: [6, 0],
  dias_mes: null,
  hora_inicio: "11:00:00",
  hora_fim: "15:00:00",
  prazo_inicio: null,
  prazo_fim: null,
  cardapio_produtos: [{ produto_id: "p1" }, { produto_id: "p2" }],
  ...over,
});

describe("247 — buscarCardapiosComProdutos: forma da query (D5)", () => {
  it("lê `cardapios` com select NOMEADO e o embed, escopado por loja_id", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCardapiosComProdutos(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("cardapios");
    expect(calls.select).toHaveBeenCalledWith(COLUNAS_CARDAPIO_VIGENCIA);
    // Nunca `select("*")`: a view/tabela pode ganhar coluna sem revisão do contrato.
    expect(calls.select).not.toHaveBeenCalledWith("*");
    // Escopo EXPLÍCITO, não herdado da RLS: 249/252 rodam sob service_role.
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
  });

  it("NÃO filtra `ativo` no SQL — RN-03 é da função pura, não da query", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await buscarCardapiosComProdutos(client, "loja-1");

    expect(calls.eq).not.toHaveBeenCalledWith("ativo", true);
  });

  it("propaga o erro (§14) em vez de devolver lista vazia", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    await expect(buscarCardapiosComProdutos(client, "loja-1")).rejects.toMatchObject({
      message: "boom",
    });
  });
});

describe("247 — buscarCardapiosComProdutos: montagem do Map", () => {
  it("indexa cada cardápio sob TODOS os produtos vinculados, preservando `ordem`", async () => {
    const { client } = makeClient({ data: [linha()], error: null });

    const { cardapios, cardapiosPorProduto } = await buscarCardapiosComProdutos(
      client,
      "loja-1",
    );

    expect(cardapios).toHaveLength(1);
    expect(cardapios[0].ordem).toBe(3);
    expect(cardapiosPorProduto.get("p1")?.map((c) => c.id)).toEqual([cardapios[0].id]);
    expect(cardapiosPorProduto.get("p2")?.map((c) => c.id)).toEqual([cardapios[0].id]);
    // O embed NÃO vaza para o objeto de vigência.
    expect(Object.keys(cardapios[0])).not.toContain("cardapio_produtos");
  });

  it("dois cardápios no mesmo produto ⇒ os DOIS na lista (a união de RN-05)", async () => {
    const outro = linha({
      id: "c0000000-0000-4000-8000-000000000002",
      nome: "Inverno",
      ordem: 1,
      modo: "prazo_fixo",
      cardapio_produtos: [{ produto_id: "p1" }],
    });
    const { client } = makeClient({ data: [linha(), outro], error: null });

    const { cardapiosPorProduto } = await buscarCardapiosComProdutos(client, "loja-1");

    expect(cardapiosPorProduto.get("p1")?.map((c) => c.id).sort()).toEqual(
      [
        "c0000000-0000-4000-8000-000000000001",
        "c0000000-0000-4000-8000-000000000002",
      ].sort(),
    );
  });

  it("FAIL-CLOSED (D6): linha com `modo` fora do domínio é DESCARTADA", async () => {
    // Todos os eixos NULL: se a linha sobrevivesse com um `modo` normalizado por
    // fallback, ela seria um cardápio SEMPRE ABERTO.
    const invalida = linha({
      id: "c0000000-0000-4000-8000-000000000009",
      modo: "modo_que_nao_existe",
      dias_semana: null,
      hora_inicio: null,
      hora_fim: null,
      cardapio_produtos: [{ produto_id: "p9" }],
    });
    const { client } = makeClient({ data: [linha(), invalida], error: null });

    const { cardapios, cardapiosPorProduto } = await buscarCardapiosComProdutos(
      client,
      "loja-1",
    );

    expect(cardapios.map((c) => c.id)).toEqual(["c0000000-0000-4000-8000-000000000001"]);
    // E não sobra vínculo órfão apontando para a linha descartada.
    expect(cardapiosPorProduto.has("p9")).toBe(false);
  });

  it("cardápio sem vínculo nenhum entra em `cardapios`, mas não no Map", async () => {
    const { client } = makeClient({
      data: [linha({ cardapio_produtos: [] })],
      error: null,
    });

    const { cardapios, cardapiosPorProduto } = await buscarCardapiosComProdutos(
      client,
      "loja-1",
    );

    expect(cardapios).toHaveLength(1);
    expect(cardapiosPorProduto.size).toBe(0);
  });

  it("loja SEM cardápio ⇒ lista vazia e Map vazio (100% da produção hoje)", async () => {
    const { client } = makeClient({ data: [], error: null });

    const r = await buscarCardapiosComProdutos(client, "loja-1");

    expect(r.cardapios).toEqual([]);
    expect(r.cardapiosPorProduto.size).toBe(0);
  });
});

describe("247 — nenhum `as CardapioVigencia` no projeto (R3)", () => {
  it("o estreitamento vive em `vigenciaCardapio.ts`, não em cast no call-site", async () => {
    const { execSync } = await import("node:child_process");
    const saida = execSync(
      // Só código de PRODUÇÃO: um `as` dentro de um teste é andaime, não o
      // estreitamento divergente que R3 proíbe.
      'grep -rn "as CardapioVigencia" src/ --include=*.ts --include=*.tsx | grep -v "\\.test\\." || true',
      { encoding: "utf8" },
    ).trim();
    expect(saida).toBe("");
  });
});
