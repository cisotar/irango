import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
// [328/F1] `listarZonasParaEdicao` ainda não existe: resolvida pelo NAMESPACE
// para o RED ser "export ausente", não import quebrado (precedente 326,
// src/lib/actions/entrega.faixas.test.ts).
import * as queries from "./entregaPagamento";

/**
 * Fase RED (TDD) da issue 328 — fatia F1: leitura ATÔMICA de versão + zonas.
 *
 * Autoridade: plan/arquivo/tecnico-formas-de-frete.md §2 ("Leitura atômica de versão +
 * zonas") e §8 itens 10–11.
 *
 * CONTRATO (src/lib/supabase/queries/entregaPagamento.ts):
 *   export type ZonasEdicao = { versao: number; zonas: ZonaVitrine[] };
 *   export async function listarZonasParaEdicao(client: Client, lojaId: string): Promise<ZonasEdicao>
 *   - UM select em `lojas` com embed de `zonas_entrega` (um statement SQL = um
 *     snapshot): versão e zonas nunca vêm de leituras separadas;
 *   - `.eq("id", lojaId).maybeSingle()`;
 *   - hidratação igual à de `listarZonasComTaxas`: `taxa` array → objeto/null,
 *     `bairros ?? []`;
 *   - erro do PostgREST ⇒ lança; loja ausente (data null) ⇒ lança.
 */

type Client = SupabaseClient<Database>;
type Terminal = { data: unknown; error: unknown };
type ZonasEdicao = { versao: number; forma: string; zonas: unknown[] };

function listarZonasParaEdicao(client: Client, lojaId: string): Promise<ZonasEdicao> {
  const fn = (queries as unknown as {
    listarZonasParaEdicao?: (c: Client, l: string) => Promise<ZonasEdicao>;
  }).listarZonasParaEdicao;
  if (typeof fn !== "function") {
    throw new Error(
      "[RED 328] `src/lib/supabase/queries/entregaPagamento.ts` ainda não exporta `listarZonasParaEdicao` (§2, P3 do plano).",
    );
  }
  return fn(client, lojaId);
}

function makeClient(terminal: Terminal) {
  const calls = { from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), maybeSingle: vi.fn(), single: vi.fn() };
  const builder: Record<string, unknown> = {};
  builder.select = (...a: unknown[]) => {
    calls.select(...a);
    return builder;
  };
  builder.eq = (...a: unknown[]) => {
    calls.eq(...a);
    return builder;
  };
  builder.order = (...a: unknown[]) => {
    calls.order(...a);
    return builder;
  };
  builder.maybeSingle = (...a: unknown[]) => {
    calls.maybeSingle(...a);
    return Promise.resolve(terminal);
  };
  builder.single = (...a: unknown[]) => {
    calls.single(...a);
    return Promise.resolve(terminal);
  };
  builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);
  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
    rpc: vi.fn(),
  } as unknown as Client;
  return { client, calls };
}

const LOJA = "11111111-1111-4111-8111-111111111111";

describe("[328/F1] listarZonasParaEdicao — versão e zonas no MESMO snapshot", () => {
  it("[328/F1] listarZonasParaEdicao lê versão e zonas num ÚNICO select em lojas com embed de zonas_entrega; devolve { versao, zonas hidratadas }", async () => {
    const { client, calls } = makeClient({
      data: {
        versao_zonas_entrega: 4,
        forma_frete: "bairro",
        zonas: [
          {
            id: "z1",
            nome: "CEP 01000-000 a 01999-999",
            tipo: "faixa_cep",
            ativo: true,
            taxa: [{ taxa: 5, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: 1000000, cep_fim: 1999999 }],
            bairros: [],
          },
          {
            id: "z2",
            nome: "Centro e mais 1",
            tipo: "bairro",
            ativo: false,
            taxa: [],
            bairros: null,
          },
          {
            id: "z3",
            nome: "Sé",
            tipo: "bairro",
            ativo: true,
            taxa: { taxa: 4, pedido_minimo_gratis: 80, raio_max_km: null, cep_inicio: null, cep_fim: null },
            bairros: [{ nome: "Sé" }],
          },
        ],
      },
      error: null,
    });

    const out = await listarZonasParaEdicao(client, LOJA);

    // UM select, na tabela lojas, com a versão e o embed das zonas.
    expect(calls.from).toHaveBeenCalledTimes(1);
    expect(calls.from).toHaveBeenCalledWith("lojas");
    expect(calls.select).toHaveBeenCalledTimes(1);
    const colunas = String(calls.select.mock.calls[0][0]).replace(/\s+/g, "");
    expect(colunas).toContain("versao_zonas_entrega");
    // [325/F3] a forma ATIVA vem do MESMO select (mesmo snapshot da versão).
    expect(colunas).toMatch(/(^|,)forma_frete(,|$)/);
    expect(colunas).toMatch(/zonas:zonas_entrega\(/);
    expect(colunas).toMatch(/taxa:taxas_entrega\(taxa,pedido_minimo_gratis,raio_max_km,cep_inicio,cep_fim\)/);
    expect(colunas).toMatch(/bairros:bairros_zona\(nome\)/);
    expect(calls.eq).toHaveBeenCalledWith("id", LOJA);
    expect(calls.maybeSingle).toHaveBeenCalledTimes(1);
    expect((client as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled();

    expect(out).toEqual({
      versao: 4,
      forma: "bairro",
      zonas: [
        {
          id: "z1",
          nome: "CEP 01000-000 a 01999-999",
          tipo: "faixa_cep",
          ativo: true,
          taxa: { taxa: 5, pedido_minimo_gratis: null, raio_max_km: null, cep_inicio: 1000000, cep_fim: 1999999 },
          bairros: [],
        },
        { id: "z2", nome: "Centro e mais 1", tipo: "bairro", ativo: false, taxa: null, bairros: [] },
        {
          id: "z3",
          nome: "Sé",
          tipo: "bairro",
          ativo: true,
          taxa: { taxa: 4, pedido_minimo_gratis: 80, raio_max_km: null, cep_inicio: null, cep_fim: null },
          bairros: [{ nome: "Sé" }],
        },
      ],
    });
  });

  it("[328/F1] loja sem zonas ⇒ { versao, zonas: [] } (zonas null no embed vira [])", async () => {
    const { client } = makeClient({ data: { versao_zonas_entrega: 0, forma_frete: "raio_km", zonas: null }, error: null });
    expect(await listarZonasParaEdicao(client, LOJA)).toEqual({ versao: 0, forma: "raio_km", zonas: [] });
  });

  it("[325/F3] listarZonasParaEdicao devolve forma = lojas.forma_frete e TODAS as zonas guardadas (o filtro da tela é zonasDaForma)", async () => {
    const km = {
      id: "k1",
      nome: "0–1 km",
      tipo: "raio_km",
      ativo: true,
      taxa: [{ taxa: 8, pedido_minimo_gratis: null, raio_max_km: 1, cep_inicio: null, cep_fim: null }],
      bairros: [],
    };
    const { client, calls } = makeClient({
      data: { versao_zonas_entrega: 2, forma_frete: "faixa_cep", zonas: [km] },
      error: null,
    });

    const out = await listarZonasParaEdicao(client, LOJA);

    expect(out.forma).toBe("faixa_cep");
    expect(out.zonas).toHaveLength(1); // km guardado volta para o painel, mesmo com forma CEP ativa
    expect(calls.eq).not.toHaveBeenCalledWith("zonas.tipo", expect.anything());
  });

  it("[325/F3] forma_frete fora do enum / ausente ⇒ forma raio_km (formaAtivaDaLoja)", async () => {
    for (const forma_frete of ["cidade", null, undefined]) {
      const { client } = makeClient({ data: { versao_zonas_entrega: 1, forma_frete, zonas: [] }, error: null });
      expect((await listarZonasParaEdicao(client, LOJA)).forma).toBe("raio_km");
    }
  });

  it("[328/F1] listarZonasParaEdicao com erro do PostgREST ⇒ lança", async () => {
    const { client } = makeClient({ data: null, error: { code: "42703", message: "db down" } });
    await expect(listarZonasParaEdicao(client, LOJA)).rejects.toMatchObject({ message: "db down" });
  });

  it("[328/F1] listarZonasParaEdicao com loja ausente ⇒ lança (não devolve versão inventada)", async () => {
    const { client } = makeClient({ data: null, error: null });
    await expect(listarZonasParaEdicao(client, LOJA)).rejects.toThrow(/loja não encontrada/i);
  });
});
