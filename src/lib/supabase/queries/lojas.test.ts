import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buscarLojaPorSlug,
  buscarLojaDoDono,
  slugExiste,
  contarLojasDoDono,
  buscarCoordsLoja,
} from "./lojas";

/**
 * Fase RED (TDD) da issue 023 — Queries de `lojas` (camada 2: contrato TS).
 *
 * Importa de `./lojas`, que AINDA NÃO EXISTE — a suite cai vermelha no import.
 * Para que o RED caia na ASSERÇÃO e não num erro de type-check que mascara tudo,
 * a fase RED criou um STUB MÍNIMO de assinatura em `./lojas.ts` (cada função
 * `throw new Error('TODO: GREEN')`). A implementação real é da fase GREEN.
 *
 * O que estes testes provam (contrato que a GREEN precisa satisfazer):
 *  - cada função consulta a FONTE certa: buscarLojaPorSlug → from('vitrine_lojas');
 *    buscarLojaDoDono/slugExiste/contarLojasDoDono → from('lojas');
 *  - usa maybeSingle nas leituras de 1 linha;
 *  - aplica os filtros certos (eq slug, eq dono_id, neq id quando `exceto`);
 *  - retorna null em "sem linha" (NÃO lança);
 *  - PROPAGA o error do PostgREST (seguranca.md §14) — NÃO mascara como null.
 *
 * Mock: um SupabaseClient<Database> mínimo com a cadeia encadeável
 * from().select().eq().neq().maybeSingle(). Cada terminal devolve { data, error }.
 */

type Client = SupabaseClient<Database>;

type Terminal = { data: unknown; error: unknown; count?: number | null };

/**
 * Constrói um mock da query builder do supabase-js. `terminal` é o { data, error }
 * (e opcionalmente count) que o builder resolve. O builder é `thenable` (resolve
 * no await direto, como `slugExiste`/`contarLojasDoDono` que não chamam maybeSingle).
 * Registra todas as chamadas em `calls` para asserção de fonte/filtros.
 */
function makeClient(terminal: Terminal) {
  const calls = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
    maybeSingle: vi.fn(),
  };

  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  builder.select = (...args: unknown[]) => {
    calls.select(...args);
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    calls.eq(...args);
    return builder;
  };
  builder.neq = (...args: unknown[]) => {
    calls.neq(...args);
    return builder;
  };
  builder.maybeSingle = (...args: unknown[]) => {
    calls.maybeSingle(...args);
    return Promise.resolve(terminal);
  };
  // thenable: permite `await from().select().eq()` sem maybeSingle (count/head).
  builder.then = (resolve: (v: Terminal) => unknown) => resolve(terminal);
  void chain;

  const client = {
    from: (rel: string) => {
      calls.from(rel);
      return builder as never;
    },
  } as unknown as Client;

  return { client, calls };
}

describe("023 queries de lojas — contrato TS (camada 2, mock)", () => {
  // ───────────────────────── buscarLojaPorSlug
  it("buscarLojaPorSlug consulta a VIEW vitrine_lojas, filtra por slug e usa maybeSingle", async () => {
    const row = { id: "loja-1", slug: "minha-loja", nome: "Minha Loja" };
    const { client, calls } = makeClient({ data: row, error: null });

    const out = await buscarLojaPorSlug(client, "minha-loja");

    expect(calls.from).toHaveBeenCalledWith("vitrine_lojas");
    expect(calls.from).not.toHaveBeenCalledWith("lojas");
    expect(calls.eq).toHaveBeenCalledWith("slug", "minha-loja");
    expect(calls.maybeSingle).toHaveBeenCalled();
    expect(out).toEqual(row);
  });

  it("buscarLojaPorSlug retorna null quando a view não tem a linha (sem lançar)", async () => {
    const { client } = makeClient({ data: null, error: null });
    const out = await buscarLojaPorSlug(client, "inexistente");
    expect(out).toBeNull();
  });

  it("buscarLojaPorSlug PROPAGA o error do PostgREST (não mascara como null)", async () => {
    const { client } = makeClient({ data: null, error: { message: "db down" } });
    await expect(buscarLojaPorSlug(client, "x")).rejects.toBeTruthy();
  });

  // ───────────────────────── buscarLojaDoDono
  it("buscarLojaDoDono consulta a TABELA lojas (não a view) e usa maybeSingle", async () => {
    const row = { id: "loja-1", dono_id: "dono-1", assinatura_status: "ativa" };
    const { client, calls } = makeClient({ data: row, error: null });

    const out = await buscarLojaDoDono(client);

    expect(calls.from).toHaveBeenCalledWith("lojas");
    expect(calls.from).not.toHaveBeenCalledWith("vitrine_lojas");
    expect(calls.maybeSingle).toHaveBeenCalled();
    expect(out).toEqual(row);
  });

  it("buscarLojaDoDono retorna null quando o dono não tem loja (sem lançar)", async () => {
    const { client } = makeClient({ data: null, error: null });
    const out = await buscarLojaDoDono(client);
    expect(out).toBeNull();
  });

  it("buscarLojaDoDono PROPAGA o error do PostgREST", async () => {
    const { client } = makeClient({ data: null, error: { message: "rls denied" } });
    await expect(buscarLojaDoDono(client)).rejects.toBeTruthy();
  });

  // ───────────────────────── slugExiste
  it("slugExiste consulta a TABELA lojas filtrando por slug e retorna true quando há linha", async () => {
    const { client, calls } = makeClient({ data: [{ id: "loja-1" }], error: null, count: 1 });

    const out = await slugExiste(client, "ocupado");

    expect(calls.from).toHaveBeenCalledWith("lojas");
    expect(calls.eq).toHaveBeenCalledWith("slug", "ocupado");
    expect(out).toBe(true);
  });

  it("slugExiste retorna false quando o slug está livre", async () => {
    const { client } = makeClient({ data: [], error: null, count: 0 });
    const out = await slugExiste(client, "livre");
    expect(out).toBe(false);
  });

  it("slugExiste com `exceto` aplica neq('id', exceto) para ignorar a própria loja", async () => {
    const { client, calls } = makeClient({ data: [], error: null, count: 0 });

    const out = await slugExiste(client, "meu-slug", "loja-1");

    expect(calls.eq).toHaveBeenCalledWith("slug", "meu-slug");
    expect(calls.neq).toHaveBeenCalledWith("id", "loja-1");
    expect(out).toBe(false);
  });

  it("slugExiste SEM `exceto` não chama neq", async () => {
    const { client, calls } = makeClient({ data: [], error: null, count: 0 });
    await slugExiste(client, "meu-slug");
    expect(calls.neq).not.toHaveBeenCalled();
  });

  it("slugExiste PROPAGA o error do PostgREST (não retorna false mascarando erro)", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" }, count: null });
    await expect(slugExiste(client, "x")).rejects.toBeTruthy();
  });

  // ───────────────────────── contarLojasDoDono
  it("contarLojasDoDono consulta a TABELA lojas filtrando por dono_id e retorna a contagem", async () => {
    const { client, calls } = makeClient({ data: [], error: null, count: 2 });

    const out = await contarLojasDoDono(client, "dono-1");

    expect(calls.from).toHaveBeenCalledWith("lojas");
    expect(calls.eq).toHaveBeenCalledWith("dono_id", "dono-1");
    expect(out).toBe(2);
  });

  it("contarLojasDoDono retorna 0 quando o dono não tem loja", async () => {
    const { client } = makeClient({ data: [], error: null, count: 0 });
    const out = await contarLojasDoDono(client, "dono-sem-loja");
    expect(out).toBe(0);
  });

  it("contarLojasDoDono PROPAGA o error do PostgREST", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" }, count: null });
    await expect(contarLojasDoDono(client, "dono-1")).rejects.toBeTruthy();
  });
});

/**
 * Fase RED (TDD) da issue 005 — `buscarCoordsLoja(svc, lojaId)` (camada 2: contrato TS).
 *
 * A função AINDA NÃO EXISTE. Para que o RED caia na ASSERÇÃO e não num erro de
 * type-check (que mascararia tudo), a fase RED criou um STUB MÍNIMO de assinatura
 * em `./lojas.ts` (`throw new Error('TODO: GREEN')`). A implementação real é GREEN.
 *
 * Contrato que a GREEN precisa satisfazer (plano da issue 005, D1–D4):
 *  - lê da TABELA base `lojas` (NÃO da view `vitrine_lojas` — coords são server-only);
 *  - projeta SÓ "latitude, longitude" (minimização, seguranca.md §7);
 *  - filtra eq('id', lojaId) e usa maybeSingle;
 *  - retorna { latitude, longitude } quando ambos não-null;
 *  - retorna null quando coords NULL, loja inexistente, ou só uma coord não-null;
 *  - PROPAGA o error do PostgREST — NÃO mascara como null.
 *
 * Reusa o `makeClient` deste arquivo (mock encadeável from().select().eq().maybeSingle()).
 */
describe("005 buscarCoordsLoja — contrato TS (camada 2, mock)", () => {
  it("consulta a TABELA lojas (não a view), projeta SÓ latitude/longitude, filtra eq('id') e usa maybeSingle", async () => {
    const row = { latitude: -23.55052, longitude: -46.633308 };
    const { client, calls } = makeClient({ data: row, error: null });

    await buscarCoordsLoja(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("lojas");
    expect(calls.from).not.toHaveBeenCalledWith("vitrine_lojas");
    expect(calls.select).toHaveBeenCalledWith("latitude, longitude");
    expect(calls.eq).toHaveBeenCalledWith("id", "loja-1");
    expect(calls.maybeSingle).toHaveBeenCalled();
  });

  it("retorna { latitude, longitude } quando a loja tem coords (ambos não-null)", async () => {
    const { client } = makeClient({
      data: { latitude: -23.55052, longitude: -46.633308 },
      error: null,
    });

    const out = await buscarCoordsLoja(client, "loja-1");

    expect(out).toEqual({ latitude: -23.55052, longitude: -46.633308 });
  });

  it("retorna null quando as coords são NULL (loja nunca geocodificada — RN-3)", async () => {
    const { client } = makeClient({
      data: { latitude: null, longitude: null },
      error: null,
    });

    const out = await buscarCoordsLoja(client, "loja-sem-coords");

    expect(out).toBeNull();
  });

  it("retorna null quando a loja não existe (maybeSingle → data: null)", async () => {
    const { client } = makeClient({ data: null, error: null });

    const out = await buscarCoordsLoja(client, "loja-inexistente");

    expect(out).toBeNull();
  });

  it("retorna null (defensivo) quando só uma coord é não-null", async () => {
    const { client } = makeClient({
      data: { latitude: -23.55052, longitude: null },
      error: null,
    });

    const out = await buscarCoordsLoja(client, "loja-meia-coord");

    expect(out).toBeNull();
  });

  it("PROPAGA o error do PostgREST (não mascara como null)", async () => {
    const { client } = makeClient({ data: null, error: { message: "db down" } });
    await expect(buscarCoordsLoja(client, "x")).rejects.toBeTruthy();
  });
});
