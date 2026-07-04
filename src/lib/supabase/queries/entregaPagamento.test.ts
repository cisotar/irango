import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  listarZonasComTaxas,
  listarFormasPagamento,
  buscarCupomDoDono,
  listarCuponsDoDono,
  buscarCupomPorCodigo,
  // Fase RED issue 131 — ainda NÃO existe em ./entregaPagamento: binding
  // undefined → cada chamada lança "is not a function" (RED por ausência real
  // de implementação, não por erro de import que mascararia a asserção).
  listarCuponsDaLoja,
} from "./entregaPagamento";

/**
 * Fase RED (TDD) da issue 025 — Queries de entrega, pagamento e cupom
 * (camada 2: contrato TS).
 *
 * Importa de `./entregaPagamento`, cuja implementação real ainda não existe.
 * Para o RED cair na ASSERÇÃO (e não num erro de import que mascara tudo), a
 * fase RED criou um STUB MÍNIMO de assinatura em `./entregaPagamento.ts` (cada
 * função `throw new Error('TODO: GREEN')`). A implementação real é da GREEN.
 *
 * O que estes testes provam (contrato que a GREEN precisa satisfazer):
 *  - listarZonasComTaxas → fonte `zonas_entrega`, escopo eq('loja_id'), e devolve
 *    o shape que `calcularFrete` consome (ZonaComTaxa: id/tipo/ativo + taxa + bairros);
 *  - listarFormasPagamento → fonte `formas_pagamento`, escopo eq('loja_id');
 *  - buscarCupomDoDono → fonte `cupons` (RLS própria), filtra por codigo, maybeSingle, null em vazio;
 *  - listarCuponsDoDono → fonte `cupons` (RLS própria), lista do dono;
 *  - buscarCupomPorCodigo → fonte `cupons`, escopo eq('loja_id') + eq('codigo'),
 *    maybeSingle (UM registro — NUNCA lista ao cliente);
 *  - todas PROPAGAM o error do PostgREST (seguranca.md §14) — NÃO mascaram como null/[].
 *
 * REGRA CRÍTICA cupom-só-service_role (seguranca.md §2): não há leitura pública
 * de cupom. `buscarCupomPorCodigo` retorna UM cupom escopado por loja — a fase
 * GREEN deve documentar que o caller injeta um client service_role (a Server
 * Action 013 valida; anon NUNCA lê cupom). Aqui o mock não tem auth — o teste
 * prova FONTE/FILTRO/forma-singular; o isolamento real está na camada 1 (pglite).
 *
 * Mock: SupabaseClient<Database> mínimo com cadeia encadeável
 * from().select().eq().order().maybeSingle(). Terminal resolve { data, error }.
 */

type Client = SupabaseClient<Database>;

type Terminal = { data: unknown; error: unknown };

function makeClient(terminal: Terminal) {
  const calls = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
  };

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
  builder.maybeSingle = (...args: unknown[]) => {
    calls.maybeSingle(...args);
    return Promise.resolve(terminal);
  };
  // thenable: permite `await from().select().eq()` (listas, sem maybeSingle).
  builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);

  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
  } as unknown as Client;

  return { client, calls };
}

describe("025 queries entrega/pagamento/cupom — contrato TS (camada 2, mock)", () => {
  // ───────────────────────── listarZonasComTaxas (leitura PÚBLICA)
  it("listarZonasComTaxas consulta `zonas_entrega`, escopa por loja_id e devolve o shape de calcularFrete (ZonaComTaxa)", async () => {
    // shape consumido por calcularFrete: id, tipo, ativo, taxa{...}, bairros[].
    const linhas = [
      {
        id: "zona-1",
        tipo: "bairro",
        ativo: true,
        taxa: { taxa: 5, pedido_minimo_gratis: null, raio_max_km: null },
        bairros: [{ nome: "Centro" }],
      },
    ];
    const { client, calls } = makeClient({ data: linhas, error: null });

    const out = await listarZonasComTaxas(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("zonas_entrega");
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
    // contrato com calcularFrete: cada item precisa expor id/tipo/ativo/taxa/bairros.
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]).toMatchObject({
      id: "zona-1",
      tipo: "bairro",
      ativo: true,
    });
    expect(out[0]).toHaveProperty("taxa");
    expect(out[0]).toHaveProperty("bairros");
  });

  it("listarZonasComTaxas retorna [] quando a loja não tem zonas (sem lançar)", async () => {
    const { client } = makeClient({ data: [], error: null });
    const out = await listarZonasComTaxas(client, "loja-sem-zona");
    expect(out).toEqual([]);
  });

  it("listarZonasComTaxas PROPAGA o error do PostgREST (não mascara como [])", async () => {
    const { client } = makeClient({ data: null, error: { message: "db down" } });
    await expect(listarZonasComTaxas(client, "loja-1")).rejects.toBeTruthy();
  });

  // ───────────────────────── listarFormasPagamento (leitura PÚBLICA)
  it("listarFormasPagamento consulta `formas_pagamento` e escopa por loja_id", async () => {
    const linhas = [{ id: "fp-1", tipo: "pix", config: { chave: "x" } }];
    const { client, calls } = makeClient({ data: linhas, error: null });

    const out = await listarFormasPagamento(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("formas_pagamento");
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
    expect(out).toEqual(linhas);
  });

  it("listarFormasPagamento retorna [] quando a loja não tem formas (sem lançar)", async () => {
    const { client } = makeClient({ data: [], error: null });
    const out = await listarFormasPagamento(client, "loja-sem-forma");
    expect(out).toEqual([]);
  });

  it("listarFormasPagamento PROPAGA o error do PostgREST", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    await expect(listarFormasPagamento(client, "loja-1")).rejects.toBeTruthy();
  });

  // ───────────────────────── buscarCupomDoDono (LOJISTA — RLS própria)
  it("buscarCupomDoDono consulta `cupons`, filtra por codigo e usa maybeSingle (UM registro)", async () => {
    const row = { id: "cup-1", codigo: "PROMO10", tipo: "percentual", valor: 10 };
    const { client, calls } = makeClient({ data: row, error: null });

    const out = await buscarCupomDoDono(client, "PROMO10");

    expect(calls.from).toHaveBeenCalledWith("cupons");
    expect(calls.eq).toHaveBeenCalledWith("codigo", "PROMO10");
    expect(calls.maybeSingle).toHaveBeenCalled();
    expect(out).toEqual(row);
  });

  it("buscarCupomDoDono retorna null quando o dono não tem o cupom (sem lançar)", async () => {
    const { client } = makeClient({ data: null, error: null });
    const out = await buscarCupomDoDono(client, "INEXISTENTE");
    expect(out).toBeNull();
  });

  it("buscarCupomDoDono PROPAGA o error do PostgREST", async () => {
    const { client } = makeClient({ data: null, error: { message: "rls denied" } });
    await expect(buscarCupomDoDono(client, "X")).rejects.toBeTruthy();
  });

  // ───────────────────────── listarCuponsDoDono (LOJISTA — RLS própria)
  it("listarCuponsDoDono consulta `cupons` (RLS própria filtra os do dono)", async () => {
    const linhas = [
      { id: "cup-1", codigo: "PROMO10" },
      { id: "cup-2", codigo: "FRETE0" },
    ];
    const { client, calls } = makeClient({ data: linhas, error: null });

    const out = await listarCuponsDoDono(client);

    expect(calls.from).toHaveBeenCalledWith("cupons");
    expect(out).toEqual(linhas);
  });

  it("listarCuponsDoDono retorna [] quando o dono não tem cupons (sem lançar)", async () => {
    const { client } = makeClient({ data: [], error: null });
    const out = await listarCuponsDoDono(client);
    expect(out).toEqual([]);
  });

  it("listarCuponsDoDono PROPAGA o error do PostgREST", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    await expect(listarCuponsDoDono(client)).rejects.toBeTruthy();
  });

  // ───────────────────────── buscarCupomPorCodigo (SERVICE_ROLE — Server Action 013)
  it("buscarCupomPorCodigo consulta `cupons` escopando por loja_id E codigo, com maybeSingle (UM, nunca lista)", async () => {
    const row = { id: "cup-1", loja_id: "loja-1", codigo: "PROMO10", ativo: true };
    const { client, calls } = makeClient({ data: row, error: null });

    const out = await buscarCupomPorCodigo(client, "loja-1", "PROMO10");

    expect(calls.from).toHaveBeenCalledWith("cupons");
    // escopo DUPLO obrigatório: loja_id (isolamento) + codigo (registro exato).
    expect(calls.eq).toHaveBeenCalledWith("loja_id", "loja-1");
    expect(calls.eq).toHaveBeenCalledWith("codigo", "PROMO10");
    // forma singular: maybeSingle — nunca devolve lista de cupons ao cliente.
    expect(calls.maybeSingle).toHaveBeenCalled();
    expect(out).toEqual(row);
  });

  it("buscarCupomPorCodigo retorna null quando código não existe na loja (sem lançar)", async () => {
    const { client } = makeClient({ data: null, error: null });
    const out = await buscarCupomPorCodigo(client, "loja-1", "NAO-EXISTE");
    expect(out).toBeNull();
  });

  it("buscarCupomPorCodigo PROPAGA o error do PostgREST (não mascara como null)", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    await expect(buscarCupomPorCodigo(client, "loja-1", "X")).rejects.toBeTruthy();
  });
});

/**
 * Fase RED (TDD) da issue 131 — `listarCuponsDaLoja(svc, lojaId)` (camada 2).
 *
 * Espelho `(svc, lojaId)` de `listarCuponsDoDono`: MESMA fonte (`cupons`), MESMA
 * projeção (`select("*")`), MESMA propagação de erro, ACRESCENTANDO o escopo
 * explícito `.eq("loja_id", lojaId)`. Sob service_role a RLS NÃO filtra
 * (BYPASSRLS) — este `.eq` é a ÚNICA barreira de isolamento cross-tenant. Este
 * arquivo prova FONTE/FILTRO/guard/erro; o isolamento em SQL real está na
 * camada 1 (queries_cupons_por_loja.test.ts).
 *
 * A função ainda NÃO existe em ./entregaPagamento → `listarCuponsDaLoja` é
 * `undefined` no import → cada chamada lança "is not a function" (RED real por
 * ausência de implementação, não por asserção trivial). A GREEN (issue) cria a
 * função + o guard `schemaUuid = z.guid()`, e todos estes casos passam a verde.
 */
describe("131 listarCuponsDaLoja — contrato TS escopado por lojaId (camada 2, mock)", () => {
  // UUID válido: passa o guard schemaUuid (z.guid()) e chega ao `.from()`.
  const LOJA_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("[131-2-1] consulta `cupons` e APLICA .eq('loja_id', lojaId) — a barreira de isolamento sob service_role", async () => {
    const linhas = [
      { id: "cup-a1", loja_id: LOJA_A, codigo: "PROMO_A", tipo: "percentual", valor: 10 },
      { id: "cup-a2", loja_id: LOJA_A, codigo: "FRETE_A", tipo: "fixo", valor: 5 },
    ];
    const { client, calls } = makeClient({ data: linhas, error: null });

    const out = await listarCuponsDaLoja(client, LOJA_A);

    expect(calls.from).toHaveBeenCalledWith("cupons");
    // SEM este .eq a isolação vaza sob service_role — este é o teste que prova a barreira.
    expect(calls.eq).toHaveBeenCalledWith("loja_id", LOJA_A);
    expect(out).toEqual(linhas);
  });

  it("[131-2-2] lojaId em formato NÃO-UUID → [] SEM chamar .from() (guard fail-closed, evita 22P02)", async () => {
    const { client, calls } = makeClient({ data: [{ id: "nunca" }], error: null });

    const out = await listarCuponsDaLoja(client, "not-a-uuid");

    expect(out).toEqual([]);
    // não vira query: o guard barra ANTES de tocar o banco.
    expect(calls.from).not.toHaveBeenCalled();
  });

  it("[131-2-3] PROPAGA o error do PostgREST (não mascara como []) — anti-falso-verde vs. stub que engole erro", async () => {
    const err = { message: "db down", code: "PGRST500" };
    const { client } = makeClient({ data: null, error: err });
    await expect(listarCuponsDaLoja(client, LOJA_A)).rejects.toBe(err);
  });

  it("[131-2-4] loja sem cupons → [] (sem lançar)", async () => {
    const { client } = makeClient({ data: [], error: null });
    const out = await listarCuponsDaLoja(client, LOJA_A);
    expect(out).toEqual([]);
  });
});
