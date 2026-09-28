// TDD RED-first — issue 326 (crítica: SIM), fatia F2: Server Action do LOJISTA
// que salva a tabela de faixas de entrega em lote.
//
// Autoridade: tasks/326-tabela-de-faixas-de-entrega.md D1 (RPC atômica
// `salvar_faixas_entrega`), D2 (payload só com incremento + taxa/grátis por
// faixa), "Risco por fatia" F2 · seguranca.md §14 (mensagem de banco não vaza).
//
// CONTRATO que o GREEN deve satisfazer (src/lib/actions/entrega.ts, 'use server'):
//   salvarFaixasEntrega(payload: unknown): Promise<{ ok: true } | { ok: false; erro: string }>
//   - `schemaFaixasEntrega.safeParse` ANTES de qualquer I/O (inválido ⇒ nem
//     `createClient` é chamado);
//   - client AUTENTICADO (nunca service_role); loja = `buscarLojaDoDono`;
//   - UMA chamada `supabase.rpc("salvar_faixas_entrega", { p_loja_id: loja.id,
//     p_incremento, p_faixas })` — `p_loja_id` NUNCA do payload;
//   - erro do banco ⇒ `console.error` no servidor + mensagem genérica;
//   - sucesso ⇒ revalida o painel de entregas e a vitrine.
//
// ITERAÇÃO 2 (C2'): cada faixa carrega `ativo` (boolean obrigatório, ativas em
// PREFIXO); a action repassa `ativo` de cada faixa em `p_faixas`. Payload sem
// `ativo` ou com faixa ativa depois de desligada é recusado pelo zod ANTES de
// qualquer I/O.
//
// A action ainda não existe: resolvida por NAMESPACE (padrão do RED da 322)
// para o RED ser "export ausente", não erro de import que derruba o arquivo.
// Os args esperados da RPC são LITERAIS.

import { describe, it, expect, vi, beforeEach } from "vitest";

const LOJA_DO_DONO = "11111111-1111-4111-8111-111111111111";
const LOJA_OUTRA = "22222222-2222-4222-8222-222222222222";

// ── Captura de I/O ───────────────────────────────────────────────────────────
type ChamadaRpc = { nome: string; args: Record<string, unknown> };
let chamadasRpc: ChamadaRpc[];
let respostaRpc: () => Promise<{ data: unknown; error: unknown }>;
let tabelasTocadas: string[];

function makeClient() {
  return {
    from: (tabela: string) => {
      tabelasTocadas.push(tabela);
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "in", "single", "maybeSingle", "update", "insert", "upsert", "delete"]) {
        q[k] = () => q;
      }
      q.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(onF);
      return q;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ nome, args });
      return respostaRpc();
    },
  };
}

const authClient = makeClient();
const createClient = vi.fn(async () => authClient);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const createServiceClient = vi.fn(() => ({ __fake: "service" }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => createServiceClient() }));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (...a: unknown[]) => buscarLojaDoDono(...a),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
  revalidateTag: vi.fn(),
}));

import * as entregaActions from "./entrega";

type Resultado = { ok: true } | { ok: false; erro: string };

function salvarFaixasEntrega(payload: unknown): Promise<Resultado> {
  const fn = (entregaActions as unknown as { salvarFaixasEntrega?: (p: unknown) => Promise<Resultado> })
    .salvarFaixasEntrega;
  if (typeof fn !== "function") {
    throw new Error(
      "[RED 326] `src/lib/actions/entrega.ts` ainda não exporta `salvarFaixasEntrega` (F2, P3 do plano).",
    );
  }
  return fn(payload);
}

// ── Payloads ─────────────────────────────────────────────────────────────────
const VALIDO = {
  incremento: 1,
  faixas: [
    { taxa: 4, pedido_minimo_gratis: null, ativo: true },
    { taxa: 6, pedido_minimo_gratis: 60, ativo: true },
    { taxa: 5, pedido_minimo_gratis: null, ativo: false },
  ],
};

beforeEach(() => {
  chamadasRpc = [];
  tabelasTocadas = [];
  respostaRpc = () => Promise.resolve({ data: 3, error: null });
  createClient.mockClear();
  createServiceClient.mockClear();
  revalidatePath.mockClear();
  buscarLojaDoDono.mockReset();
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_DO_DONO, slug: "loja-do-dono" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ═════════════════════════════════════════════════════════════════════════════
describe("[326/F2] salvarFaixasEntrega — caminho feliz", () => {
  it("chama a RPC UMA vez com p_loja_id = loja do dono e os args literais do payload validado", async () => {
    const r = await salvarFaixasEntrega(VALIDO);

    expect(r).toEqual({ ok: true });
    expect(chamadasRpc).toEqual([
      {
        nome: "salvar_faixas_entrega",
        args: {
          p_loja_id: LOJA_DO_DONO,
          p_incremento: 1,
          p_faixas: [
            { taxa: 4, pedido_minimo_gratis: null, ativo: true },
            { taxa: 6, pedido_minimo_gratis: 60, ativo: true },
            { taxa: 5, pedido_minimo_gratis: null, ativo: false },
          ],
        },
      },
    ]);
  });

  it("[it.2] todas desligadas ⇒ RPC recebe ativo false em cada faixa (lojista pode desligar tudo)", async () => {
    const r = await salvarFaixasEntrega({
      incremento: 2,
      faixas: [
        { taxa: 4, pedido_minimo_gratis: null, ativo: false },
        { taxa: 6, pedido_minimo_gratis: null, ativo: false },
      ],
    });

    expect(r).toEqual({ ok: true });
    expect(chamadasRpc).toEqual([
      {
        nome: "salvar_faixas_entrega",
        args: {
          p_loja_id: LOJA_DO_DONO,
          p_incremento: 2,
          p_faixas: [
            { taxa: 4, pedido_minimo_gratis: null, ativo: false },
            { taxa: 6, pedido_minimo_gratis: null, ativo: false },
          ],
        },
      },
    ]);
  });

  it("loja vem de buscarLojaDoDono com o client AUTENTICADO — service_role nunca", async () => {
    await salvarFaixasEntrega(VALIDO);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(buscarLojaDoDono).toHaveBeenCalledTimes(1);
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("escrita é SÓ pela RPC atômica — nenhum insert/update/delete solto em zonas/taxas/bairros", async () => {
    await salvarFaixasEntrega(VALIDO);

    expect(tabelasTocadas.filter((t) => ["zonas_entrega", "taxas_entrega", "bairros_zona"].includes(t))).toEqual(
      [],
    );
  });

  it("0 faixas ⇒ RPC com p_faixas [] (remove a área de entrega)", async () => {
    const r = await salvarFaixasEntrega({ incremento: 2, faixas: [] });

    expect(r).toEqual({ ok: true });
    expect(chamadasRpc).toEqual([
      { nome: "salvar_faixas_entrega", args: { p_loja_id: LOJA_DO_DONO, p_incremento: 2, p_faixas: [] } },
    ]);
  });

  it("sucesso revalida o painel de entregas e a vitrine", async () => {
    await salvarFaixasEntrega(VALIDO);

    expect(revalidatePath).toHaveBeenCalledWith("/painel/configuracoes/entregas");
    expect(revalidatePath).toHaveBeenCalledWith("/loja/[slug]", "page");
  });
});

describe("[326/F2] salvarFaixasEntrega — payload inválido é recusado ANTES de qualquer I/O", () => {
  it.each([
    ["incremento 3", { ...VALIDO, incremento: 3 }],
    ["taxa negativa", { ...VALIDO, faixas: [{ taxa: -1, pedido_minimo_gratis: null, ativo: true }] }],
    ["taxa 4.555", { ...VALIDO, faixas: [{ taxa: 4.555, pedido_minimo_gratis: null, ativo: true }] }],
    ["grátis negativo", { ...VALIDO, faixas: [{ taxa: 4, pedido_minimo_gratis: -1, ativo: true }] }],
    [
      "31 faixas",
      {
        incremento: 1,
        faixas: Array.from({ length: 31 }, () => ({ taxa: 4, pedido_minimo_gratis: null, ativo: true })),
      },
    ],
    ["loja_id na raiz", { ...VALIDO, loja_id: LOJA_OUTRA }],
    [
      "raio_max_km na faixa",
      { ...VALIDO, faixas: [{ taxa: 4, pedido_minimo_gratis: null, ativo: true, raio_max_km: 99 }] },
    ],
    ["null", null],
    ["[it.2] faixa SEM ativo", { ...VALIDO, faixas: [{ taxa: 4, pedido_minimo_gratis: null }] }],
    ["[it.2] ativo string 'true'", { ...VALIDO, faixas: [{ taxa: 4, pedido_minimo_gratis: null, ativo: "true" }] }],
    [
      "[it.2] faixa ativa depois de desligada [t,f,t]",
      {
        incremento: 1,
        faixas: [
          { taxa: 4, pedido_minimo_gratis: null, ativo: true },
          { taxa: 6, pedido_minimo_gratis: null, ativo: false },
          { taxa: 8, pedido_minimo_gratis: null, ativo: true },
        ],
      },
    ],
  ])("%s ⇒ { ok:false }, createClient NÃO chamado, RPC NÃO chamada", async (_nome, payload) => {
    const r = await salvarFaixasEntrega(payload);

    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
    expect(buscarLojaDoDono).not.toHaveBeenCalled();
    expect(chamadasRpc).toEqual([]);
  });

  it("loja_id forjado no payload NUNCA chega à RPC", async () => {
    await salvarFaixasEntrega({ ...VALIDO, loja_id: LOJA_OUTRA });

    for (const c of chamadasRpc) {
      expect(c.args.p_loja_id).not.toBe(LOJA_OUTRA);
    }
  });
});

describe("[326/F2] salvarFaixasEntrega — falhas viram mensagem genérica (seguranca.md §14)", () => {
  it("dono sem loja ⇒ { ok:false } e RPC NÃO chamada", async () => {
    buscarLojaDoDono.mockResolvedValue(null);

    const r = await salvarFaixasEntrega(VALIDO);

    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(chamadasRpc).toEqual([]);
  });

  it("erro do banco na RPC ⇒ { ok:false } genérico, detalhe só no log do servidor", async () => {
    respostaRpc = () =>
      Promise.resolve({
        data: null,
        error: { code: "P0001", message: "salvar_faixas_entrega: sem posse", details: null, hint: null },
      });

    const r = await salvarFaixasEntrega(VALIDO);

    expect(r.ok).toBe(false);
    const erro = (r as { erro: string }).erro;
    expect(erro.length).toBeGreaterThan(0);
    expect(erro).not.toMatch(/salvar_faixas_entrega|P0001|posse/);
    expect(console.error).toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("RPC que LANÇA ⇒ { ok:false } genérico (não propaga, não vaza)", async () => {
    respostaRpc = () => Promise.reject(new Error("connection terminated: 10.0.0.3:5432"));

    const r = await salvarFaixasEntrega(VALIDO);

    expect(r.ok).toBe(false);
    expect((r as { erro: string }).erro).not.toMatch(/connection|5432/);
    expect(console.error).toHaveBeenCalled();
  });
});
