import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  buscarLojaPorSlug,
  buscarLojaDoDono,
  slugExiste,
  contarLojasDoDono,
  buscarCoordsLoja,
  resolverDonoPorEmail,
  resolverEmailDoDono,
  buscarLojaAdminPorId,
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

  // ───────────────────────── buscarLojaAdminPorId (096)
  it("buscarLojaAdminPorId lê a TABELA base lojas (NÃO a view), filtra por id e usa maybeSingle", async () => {
    // Loja em onboarding: ativo=false. A view vitrine_lojas (WHERE ativo=true) a
    // esconderia; o painel admin DEVE enxergá-la pela tabela base.
    const row = { id: "loja-1", slug: "loja-1", ativo: false };
    const { client, calls } = makeClient({ data: row, error: null });

    const out = await buscarLojaAdminPorId(client, "loja-1");

    expect(calls.from).toHaveBeenCalledWith("lojas");
    expect(calls.from).not.toHaveBeenCalledWith("vitrine_lojas");
    expect(calls.eq).toHaveBeenCalledWith("id", "loja-1");
    expect(calls.maybeSingle).toHaveBeenCalled();
    expect(out).toEqual(row);
  });

  it("buscarLojaAdminPorId retorna null quando a loja não existe (sem lançar)", async () => {
    const { client } = makeClient({ data: null, error: null });
    const out = await buscarLojaAdminPorId(client, "inexistente");
    expect(out).toBeNull();
  });

  it("buscarLojaAdminPorId PROPAGA o error do PostgREST (não mascara como null)", async () => {
    const { client } = makeClient({ data: null, error: { message: "db down" } });
    await expect(buscarLojaAdminPorId(client, "x")).rejects.toBeTruthy();
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

/**
 * Fase RED (TDD) da issue 085 — `resolverDonoPorEmail(svc, email)`.
 *
 * A função AINDA NÃO EXISTE de verdade: `./lojas.ts` tem só um STUB MÍNIMO de
 * assinatura (`throw new Error('TODO: GREEN')`) para o RED cair na ASSERÇÃO e
 * não num erro de type-check por símbolo inexistente. A implementação é GREEN.
 *
 * Contrato que a GREEN precisa satisfazer (plano da issue 085):
 *  - resolve o dono_id (auth.users.id) via Admin API, REUSANDO o mecanismo de
 *    `mapearEmailsDosDonos` em adminAssinatura.ts: `svc.auth.admin.listUsers`
 *    paginado ({ page, perPage }), casando por e-mail;
 *  - e-mail existente → retorna o id do usuário com esse e-mail;
 *  - e-mail inexistente → null;
 *  - normaliza trim + lowercase antes do match (caixa/espaços não importam);
 *  - NUNCA loga o e-mail cru (PII, scrubbing §21) — borda assertada.
 *
 * Mock: `svc.auth.admin.listUsers` no MESMO estilo do mapearEmailsDosDonos —
 * resolve `{ data: { users }, error }`. Uma página só (users.length < perPage
 * encerra a paginação). Captura os argumentos para provar o uso paginado.
 */
describe("085 resolverDonoPorEmail — contrato TS (camada 2, mock Admin API)", () => {
  type AdminUser = { id: string; email: string | null };

  /**
   * Client mínimo só com `auth.admin.listUsers`. `users` é a página única
   * devolvida; `chamadas` registra os argumentos de cada chamada (prova de
   * paginação no mesmo estilo de mapearEmailsDosDonos).
   */
  function makeAdminClient(users: AdminUser[]) {
    const chamadas: Array<{ page?: number; perPage?: number }> = [];
    const listUsers = vi.fn(async (args?: { page?: number; perPage?: number }) => {
      chamadas.push(args ?? {});
      return { data: { users }, error: null };
    });
    const client = {
      auth: { admin: { listUsers } },
    } as unknown as SupabaseClient<Database>;
    return { client, listUsers, chamadas };
  }

  it("e-mail existente → resolve o dono_id (auth.users.id) correto", async () => {
    const { client, listUsers } = makeAdminClient([
      { id: "user-aaa", email: "outra@x.com" },
      { id: "user-bbb", email: "loja@x.com" },
    ]);

    const out = await resolverDonoPorEmail(client, "loja@x.com");

    expect(out).toBe("user-bbb");
    expect(listUsers).toHaveBeenCalled(); // reusa o Admin API paginado
  });

  it("e-mail inexistente → null", async () => {
    const { client } = makeAdminClient([
      { id: "user-aaa", email: "outra@x.com" },
    ]);

    const out = await resolverDonoPorEmail(client, "ninguem@x.com");

    expect(out).toBeNull();
  });

  it("normaliza trim + lowercase antes do match (caixa/espaços diferentes ainda casa)", async () => {
    const { client } = makeAdminClient([
      { id: "user-bbb", email: "loja@x.com" },
    ]);

    const out = await resolverDonoPorEmail(client, "  LOJA@X.COM ");

    expect(out).toBe("user-bbb");
  });

  it("NÃO loga o e-mail cru (PII — scrubbing §21)", async () => {
    const { client } = makeAdminClient([{ id: "user-bbb", email: "loja@x.com" }]);
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
    ];

    await resolverDonoPorEmail(client, "  LOJA@X.COM ");

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const linha = call.map((a) => String(a)).join(" ").toLowerCase();
        expect(linha).not.toContain("loja@x.com");
      }
      spy.mockRestore();
    }
  });

  it("paginação: resolve e-mail presente SOMENTE na 2ª página (primeira retorna 1000 usuários sem o alvo)", async () => {
    // Simula o cenário real: primeira página tem exatamente 1000 registros (sinal
    // de que há mais páginas) e não contém o alvo. Segunda página tem < 1000
    // registros e o alvo está lá. A função SÓ encontra o alvo se iterar além da
    // primeira página — qualquer bug que pare no break prematuro retorna null.
    const POR_PAGINA = 1000;
    const pagina1: AdminUser[] = Array.from({ length: POR_PAGINA }, (_, i) => ({
      id: `user-p1-${i}`,
      email: `usuario${i}@pagina1.com`,
    }));
    const pagina2: AdminUser[] = [
      { id: "user-segunda-pagina", email: "alvo@segunda.com" },
      { id: "user-outro", email: "outro@segunda.com" },
    ];

    const paginas = [pagina1, pagina2];
    let indiceChamada = 0;
    const chamadas: Array<{ page?: number; perPage?: number }> = [];
    const listUsers = vi.fn(async (args?: { page?: number; perPage?: number }) => {
      chamadas.push(args ?? {});
      const usuarios = paginas[indiceChamada] ?? [];
      indiceChamada += 1;
      return { data: { users: usuarios }, error: null };
    });

    const client = {
      auth: { admin: { listUsers } },
    } as unknown as SupabaseClient<Database>;

    const out = await resolverDonoPorEmail(client, "alvo@segunda.com");

    // Prova que o alvo foi encontrado na segunda página
    expect(out).toBe("user-segunda-pagina");
    // Prova que listUsers foi chamado DUAS vezes (paginação real)
    expect(listUsers).toHaveBeenCalledTimes(2);
    // Prova que a segunda chamada pediu a página 2
    expect(chamadas[1]).toMatchObject({ page: 2 });
  });
});

/**
 * Fase RED (TDD) da issue 151 — `resolverEmailDoDono(svc, donoId)`.
 *
 * Direção INVERSA de `resolverDonoPorEmail`: o `dono_id` já é conhecido, então usa
 * `auth.admin.getUserById` (GET direto O(1)) em vez de varrer a base paginada.
 *
 * Contrato que a GREEN precisa satisfazer (plano da issue 151):
 *  - resolve o e-mail via `svc.auth.admin.getUserById(donoId)`, passando o id cru;
 *  - dono existente com e-mail → retorna o e-mail;
 *  - dono sem e-mail / `data.user` null → null;
 *  - erro do Admin API PROPAGA (fail-loud, seguranca.md §14) — NÃO mascara como null;
 *  - NUNCA loga o e-mail cru (PII, scrubbing §21) — borda assertada.
 *
 * Mock: client mínimo só com `auth.admin.getUserById`, resolvendo
 * `{ data: { user }, error }` no formato de `UserResponse` do supabase-js.
 */
describe("151 resolverEmailDoDono — contrato TS (camada 2, mock Admin API)", () => {
  type AdminUser = { id: string; email: string | null } | null;

  /**
   * Client mínimo só com `auth.admin.getUserById`. `user` é o usuário devolvido
   * (ou null); `error` simula falha do Admin API. `chamadas` registra os ids.
   */
  function makeAdminClient(user: AdminUser, error: unknown = null) {
    const chamadas: string[] = [];
    const getUserById = vi.fn(async (uid: string) => {
      chamadas.push(uid);
      return { data: { user }, error };
    });
    const client = {
      auth: { admin: { getUserById } },
    } as unknown as SupabaseClient<Database>;
    return { client, getUserById, chamadas };
  }

  it("dono existente → resolve o e-mail via getUserById(donoId) com o id cru", async () => {
    const { client, getUserById } = makeAdminClient({ id: "dono-1", email: "dono@x.com" });

    const out = await resolverEmailDoDono(client, "dono-1");

    expect(out).toBe("dono@x.com");
    // GET direto O(1): passa o id conhecido, sem varrer a base (sem listUsers).
    expect(getUserById).toHaveBeenCalledWith("dono-1");
  });

  it("dono sem e-mail → null (defensivo)", async () => {
    const { client } = makeAdminClient({ id: "dono-1", email: null });
    const out = await resolverEmailDoDono(client, "dono-1");
    expect(out).toBeNull();
  });

  it("dono inexistente (data.user null) → null", async () => {
    const { client } = makeAdminClient(null);
    const out = await resolverEmailDoDono(client, "dono-inexistente");
    expect(out).toBeNull();
  });

  it("PROPAGA o error do Admin API (fail-loud — não mascara como null)", async () => {
    const { client } = makeAdminClient(null, { message: "admin api down" });
    await expect(resolverEmailDoDono(client, "dono-1")).rejects.toBeTruthy();
  });

  it("NÃO loga o e-mail cru (PII — scrubbing §21)", async () => {
    const { client } = makeAdminClient({ id: "dono-1", email: "dono@x.com" });
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
    ];

    await resolverEmailDoDono(client, "dono-1");

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        const linha = call.map((a) => String(a)).join(" ").toLowerCase();
        expect(linha).not.toContain("dono@x.com");
      }
      spy.mockRestore();
    }
  });
});
