// TDD RED-first — issues 325 + 328 (crítica: SIM), fatia F3: Server Action do
// LOJISTA que grava as zonas de entrega de UMA forma, com versão otimista; e
// F4 (327): o módulo deixa de exportar os caminhos de escrita por zona.
//
// Autoridade: plan/arquivo/tecnico-formas-de-frete.md §1 (RPC `salvar_zonas_entrega`,
// mensagens estáveis), §4 (regras de valor por forma), §5 (contrato da action,
// zod `schemaZonasEntrega`, `MENSAGEM_CONFLITO_ZONAS`), §8 itens 30–39 e 50 ·
// seguranca.md §14 (mensagem de banco não vaza).
//
// CONTRATO que o GREEN deve satisfazer (src/lib/actions/entrega.ts, 'use server'):
//   export type ResultadoZonas =
//     | { ok: true; versao: number }
//     | { ok: false; erro: string; conflito?: true };
//   export async function salvarZonasEntrega(payload: unknown): Promise<ResultadoZonas>
//   1. schemaZonasEntrega.safeParse ANTES de qualquer I/O; falha ⇒ { ok:false,
//      erro: primeira issue custom ?? "Confira as zonas de entrega." };
//   2. createClient() AUTENTICADO → buscarLojaDoDono → null ⇒ { ok:false };
//   3. UMA rpc("salvar_zonas_entrega", { p_loja_id: loja.id, p_versao, p_forma, p_dados });
//   4. P0001 + 'versao desatualizada' ⇒ { ok:false, conflito:true, erro:
//      MENSAGEM_CONFLITO_ZONAS }, sem revalidatePath;
//   5. outro erro ⇒ console.error + genérica; 6. data não inteiro seguro ⇒ como 5;
//   7. sucesso ⇒ revalidatePath(painel) + revalidatePath("/loja/[slug]", "page");
//      { ok:true, versao: data }; 8. catch ⇒ genérica.
//
// Escrito na fase RED, quando a action não existia: resolvida por NAMESPACE
// (precedente 326) para o RED ser "export ausente". Args da RPC LITERAIS.

import { describe, it, expect, vi, beforeEach } from "vitest";

const LOJA_DO_DONO = "11111111-1111-4111-8111-111111111111";
const LOJA_OUTRA = "22222222-2222-4222-8222-222222222222";

const MENSAGEM_CONFLITO =
  "Recarregue a página para ver as entregas atuais: elas foram alteradas em outra aba ou por outra pessoa, e esta mudança não foi salva.";

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
import * as validacoesEntrega from "@/lib/validacoes/entrega";

type ResultadoZonas = { ok: true; versao: number } | { ok: false; erro: string; conflito?: true };

function salvarZonasEntrega(payload: unknown): Promise<ResultadoZonas> {
  const fn = (entregaActions as unknown as { salvarZonasEntrega?: (p: unknown) => Promise<ResultadoZonas> })
    .salvarZonasEntrega;
  if (typeof fn !== "function") {
    throw new Error(
      "[RED 328] `src/lib/actions/entrega.ts` ainda não exporta `salvarZonasEntrega` (F3, P3 do plano).",
    );
  }
  return fn(payload);
}

// ── Payloads válidos por forma ───────────────────────────────────────────────
const KM = {
  forma: "raio_km",
  versao: 3,
  incremento: 2,
  faixas: [
    { taxa: 4, pedido_minimo_gratis: null, ativo: true },
    { taxa: 6.5, pedido_minimo_gratis: 80, ativo: false },
  ],
};
const faixaCep = (ini: number, fim: number, over: Record<string, unknown> = {}) => ({
  cep_inicio: ini,
  cep_fim: fim,
  taxa: 5,
  pedido_minimo_gratis: null,
  ativo: true,
  ...over,
});
const CEP = {
  forma: "faixa_cep",
  versao: 0,
  faixas: [faixaCep(1000000, 1999999), faixaCep(2000000, 2999999, { taxa: 7, pedido_minimo_gratis: 50 })],
};
const grupo = (bairros: unknown[], over: Record<string, unknown> = {}) => ({
  bairros,
  taxa: 6,
  pedido_minimo_gratis: null,
  ativo: true,
  ...over,
});
const BAIRRO = {
  forma: "bairro",
  versao: 12,
  grupos: [grupo(["Centro", "Vila Nova"]), grupo(["Sé"], { taxa: 4, ativo: false })],
};

beforeEach(() => {
  chamadasRpc = [];
  tabelasTocadas = [];
  respostaRpc = () => Promise.resolve({ data: 4, error: null });
  createClient.mockClear();
  createServiceClient.mockClear();
  revalidatePath.mockClear();
  buscarLojaDoDono.mockReset();
  buscarLojaDoDono.mockResolvedValue({ id: LOJA_DO_DONO, slug: "loja-do-dono" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function esperarSemIO() {
  expect(createClient).not.toHaveBeenCalled();
  expect(buscarLojaDoDono).not.toHaveBeenCalled();
  expect(chamadasRpc).toEqual([]);
}

// ═════════════════════════════════════════════════════════════════════════════
describe("[328/F3] salvarZonasEntrega — payload recusado ANTES de qualquer I/O", () => {
  it.each<[string, unknown]>([
    ["raio_km com loja_id na raiz", { ...KM, loja_id: LOJA_OUTRA }],
    ["faixa_cep com loja_id na raiz", { ...CEP, loja_id: LOJA_OUTRA }],
    ["bairro com loja_id na raiz", { ...BAIRRO, loja_id: LOJA_OUTRA }],
    ["faixa km com tipo extra", { ...KM, faixas: [{ ...KM.faixas[0], tipo: "bairro" }] }],
    ["faixa de CEP com nome extra", { ...CEP, faixas: [faixaCep(1000000, 1999999, { nome: "Grátis" })] }],
    ["faixa de CEP com loja_id extra", { ...CEP, faixas: [faixaCep(1000000, 1999999, { loja_id: LOJA_OUTRA })] }],
    ["grupo de bairro com tipo extra", { ...BAIRRO, grupos: [grupo(["Centro"], { tipo: "raio_km" })] }],
    ["grupo de bairro com loja_id extra", { ...BAIRRO, grupos: [grupo(["Centro"], { loja_id: LOJA_OUTRA })] }],
    ["raio_km com chave `grupos` extra (formas misturadas)", { ...KM, grupos: [] }],
  ])("[328/F3] %s ⇒ { ok:false } e createClient NÃO chamado (.strict())", async (_n, payload) => {
    const r = await salvarZonasEntrega(payload);

    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    esperarSemIO();
  });

  it.each<[string, unknown]>([
    ["forma 'cidade'", { ...CEP, forma: "cidade" }],
    ["forma ausente", { versao: 0, faixas: [] }],
    ["versao ausente", { forma: "faixa_cep", faixas: [] }],
    ["versao negativa", { ...CEP, versao: -1 }],
    ["versao string '3'", { ...CEP, versao: "3" }],
    ["versao fracionária 1.5", { ...CEP, versao: 1.5 }],
    ["versao null", { ...BAIRRO, versao: null }],
    ["payload null", null],
    ["payload array", [CEP]],
  ])("[328/F3] %s ⇒ recusa sem I/O", async (_n, payload) => {
    const r = await salvarZonasEntrega(payload);

    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    esperarSemIO();
  });

  it("[325/F3] CEP invertido ⇒ recusa sem I/O com a mensagem custom do zod", async () => {
    const r = await salvarZonasEntrega({ ...CEP, faixas: [faixaCep(1999999, 1000000)] });

    expect(r).toEqual({ ok: false, erro: "O CEP final deve ser maior ou igual ao CEP inicial." });
    esperarSemIO();
  });

  it.each<[string, unknown[]]>([
    ["01000000–01999999 e 01500000–02000000", [faixaCep(1000000, 1999999), faixaCep(1500000, 2000000)]],
    ["fim de uma = início da outra", [faixaCep(1000000, 1999999), faixaCep(1999999, 2500000)]],
  ])("[325/F3] CEP sobreposto (%s) ⇒ recusa sem I/O com a mensagem custom do zod", async (_n, faixas) => {
    const r = await salvarZonasEntrega({ ...CEP, faixas });

    expect(r.ok).toBe(false);
    expect((r as { erro: string }).erro).toMatch(/^A faixa de .+ a .+ cruza com a de .+ a .+\. Ajuste uma delas\.$/);
    esperarSemIO();
  });

  it.each<[string, unknown[]]>([
    ["acento e espaço no mesmo grupo: 'Centro' / ' cêntro '", [grupo(["Centro", " cêntro "])]],
    ["caixa em grupos diferentes: 'Vila Nova' / 'VILA NOVA'", [grupo(["Vila Nova"]), grupo(["VILA NOVA"])]],
    ["espaço interno: 'Jardim São José' / 'jardim   sao  jose'", [grupo(["Jardim São José"]), grupo(["jardim   sao  jose"])]],
  ])("[325/F3] bairro repetido por acento/caixa/espaço (%s) ⇒ recusa sem I/O", async (_n, grupos) => {
    const r = await salvarZonasEntrega({ ...BAIRRO, grupos });

    expect(r.ok).toBe(false);
    expect((r as { erro: string }).erro).toMatch(/ já está em outro preço\.$/);
    esperarSemIO();
  });
});

describe("[328/F3] salvarZonasEntrega — UMA RPC com args literais; p_loja_id = loja do dono", () => {
  it("[328/F3] raio_km válido ⇒ UMA rpc('salvar_zonas_entrega', { p_loja_id: loja do dono, p_versao, p_forma:'raio_km', p_dados:{ incremento, faixas } }) com args literais", async () => {
    await salvarZonasEntrega(KM);

    expect(chamadasRpc).toEqual([
      {
        nome: "salvar_zonas_entrega",
        args: {
          p_loja_id: LOJA_DO_DONO,
          p_versao: 3,
          p_forma: "raio_km",
          p_dados: {
            incremento: 2,
            faixas: [
              { taxa: 4, pedido_minimo_gratis: null, ativo: true },
              { taxa: 6.5, pedido_minimo_gratis: 80, ativo: false },
            ],
          },
        },
      },
    ]);
  });

  it("[325/F3] faixa_cep válido ⇒ p_dados = { faixas } literal; p_loja_id nunca do payload", async () => {
    await salvarZonasEntrega(CEP);

    expect(chamadasRpc).toEqual([
      {
        nome: "salvar_zonas_entrega",
        args: {
          p_loja_id: LOJA_DO_DONO,
          p_versao: 0,
          p_forma: "faixa_cep",
          p_dados: {
            faixas: [
              { cep_inicio: 1000000, cep_fim: 1999999, taxa: 5, pedido_minimo_gratis: null, ativo: true },
              { cep_inicio: 2000000, cep_fim: 2999999, taxa: 7, pedido_minimo_gratis: 50, ativo: true },
            ],
          },
        },
      },
    ]);
  });

  it("[325/F3] bairro válido ⇒ p_dados = { grupos } literal; p_loja_id nunca do payload", async () => {
    await salvarZonasEntrega(BAIRRO);

    expect(chamadasRpc).toEqual([
      {
        nome: "salvar_zonas_entrega",
        args: {
          p_loja_id: LOJA_DO_DONO,
          p_versao: 12,
          p_forma: "bairro",
          p_dados: {
            grupos: [
              { bairros: ["Centro", "Vila Nova"], taxa: 6, pedido_minimo_gratis: null, ativo: true },
              { bairros: ["Sé"], taxa: 4, pedido_minimo_gratis: null, ativo: false },
            ],
          },
        },
      },
    ]);
  });

  it("[325/F3] lista vazia na forma ⇒ RPC com p_dados vazio (remove a área de entrega)", async () => {
    await salvarZonasEntrega({ forma: "faixa_cep", versao: 5, faixas: [] });

    expect(chamadasRpc).toEqual([
      { nome: "salvar_zonas_entrega", args: { p_loja_id: LOJA_DO_DONO, p_versao: 5, p_forma: "faixa_cep", p_dados: { faixas: [] } } },
    ]);
  });

  it("[328/F3] sucesso ⇒ { ok:true, versao: <data da rpc> } e revalida painel de entregas e vitrine", async () => {
    respostaRpc = () => Promise.resolve({ data: 13, error: null });

    const r = await salvarZonasEntrega(BAIRRO);

    expect(r).toEqual({ ok: true, versao: 13 });
    expect(revalidatePath).toHaveBeenCalledWith("/painel/configuracoes/entregas");
    expect(revalidatePath).toHaveBeenCalledWith("/loja/[slug]", "page");
  });
});

describe("[328/F3] salvarZonasEntrega — conflito de versão e falhas", () => {
  it("[328/F3] erro P0001 'salvar_zonas_entrega: versao desatualizada' ⇒ { ok:false, conflito:true, erro: MENSAGEM_CONFLITO_ZONAS }, sem texto do banco e sem revalidatePath", async () => {
    respostaRpc = () =>
      Promise.resolve({
        data: null,
        error: { code: "P0001", message: "salvar_zonas_entrega: versao desatualizada", details: null, hint: null },
      });

    const r = await salvarZonasEntrega(CEP);

    expect(r).toEqual({ ok: false, conflito: true, erro: MENSAGEM_CONFLITO });
    expect((validacoesEntrega as unknown as { MENSAGEM_CONFLITO_ZONAS?: unknown }).MENSAGEM_CONFLITO_ZONAS).toBe(
      MENSAGEM_CONFLITO,
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each<[string, () => Promise<{ data: unknown; error: unknown }>]>([
    [
      "P0001 'sem posse'",
      () => Promise.resolve({ data: null, error: { code: "P0001", message: "salvar_zonas_entrega: sem posse" } }),
    ],
    [
      "P0001 'faixas de cep sobrepostas'",
      () =>
        Promise.resolve({ data: null, error: { code: "P0001", message: "salvar_zonas_entrega: faixas de cep sobrepostas" } }),
    ],
    [
      "código diferente com 'versao desatualizada' no texto (não é o contrato)",
      () => Promise.resolve({ data: null, error: { code: "42501", message: "versao desatualizada" } }),
    ],
    ["RPC que lança", () => Promise.reject(new Error("connection terminated: 10.0.0.3:5432"))],
    ["data não inteiro (string '4')", () => Promise.resolve({ data: "4", error: null })],
    ["data null sem erro", () => Promise.resolve({ data: null, error: null })],
  ])("[328/F3] %s ⇒ { ok:false } genérico SEM conflito; detalhe só no console.error", async (_n, resposta) => {
    respostaRpc = resposta;

    const r = await salvarZonasEntrega(CEP);

    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("conflito");
    const erro = (r as { erro: string }).erro;
    expect(erro.length).toBeGreaterThan(0);
    expect(erro).not.toBe(MENSAGEM_CONFLITO);
    expect(erro).not.toMatch(/salvar_zonas_entrega|P0001|posse|sobrepostas|connection|5432/);
    expect(console.error).toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("[328/F3] client autenticado (createServiceClient nunca); loja de buscarLojaDoDono; nenhum from() em zonas/taxas/bairros", async () => {
    await salvarZonasEntrega(KM);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toHaveLength(1);
    expect(tabelasTocadas.filter((t) => ["zonas_entrega", "taxas_entrega", "bairros_zona"].includes(t))).toEqual([]);
  });

  it("[328/F3] dono sem loja ⇒ { ok:false } e rpc não chamada", async () => {
    buscarLojaDoDono.mockResolvedValue(null);

    const r = await salvarZonasEntrega(KM);

    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(chamadasRpc).toEqual([]);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════ F4 · 327
describe("[327/F4] remoção dos caminhos de escrita por zona", () => {
  it("[327/F4] módulo de entrega não exporta salvarZona, criarZona, atualizarZona, alternarZonaAtiva, removerZona nem salvarFaixasEntrega", async () => {
    const exportados = Object.keys(await import("./entrega"));

    for (const nome of [
      "salvarZona",
      "criarZona",
      "atualizarZona",
      "alternarZonaAtiva",
      "removerZona",
      "salvarFaixasEntrega",
    ]) {
      expect(exportados, `ainda exporta ${nome}`).not.toContain(nome);
    }
    // O que fica (não remover por engano).
    expect(exportados).toContain("salvarModalidadesEntrega");
  });
});

// ═════════════════════════════════════════════════════ 325 · ativação explícita
// CONTRATO (plan/arquivo/loop-ativar-forma-frete.md D3): src/lib/actions/entrega.ts
//   export async function definirFormaFrete(payload: unknown): Promise<ResultadoZonas>
//   1. schemaDefinirFormaFrete.safeParse ANTES de qualquer I/O (.strict(): loja_id recusado);
//   2. createClient() AUTENTICADO → buscarLojaDoDono → null ⇒ { ok:false };
//   3. UMA rpc("definir_forma_frete", { p_forma, p_versao, p_loja_id: loja.id }) (tenant por último);
//   4. resultadoDaRpcFormaFrete: conflito ⇒ conflito:true; forma sem zona ⇒ MENSAGEM_FORMA_SEM_ZONA;
//   5. sucesso ⇒ revalidatePath(painel) + revalidatePath("/loja/[slug]", "page"); só no ok.
function definirFormaFrete(payload: unknown): Promise<ResultadoZonas> {
  const fn = (entregaActions as unknown as { definirFormaFrete?: (p: unknown) => Promise<ResultadoZonas> })
    .definirFormaFrete;
  if (typeof fn !== "function") {
    throw new Error("[RED 325/F3] `src/lib/actions/entrega.ts` ainda não exporta `definirFormaFrete` (D3).");
  }
  return fn(payload);
}

describe("[325/F3] definirFormaFrete — payload recusado ANTES de qualquer I/O", () => {
  it.each<[string, unknown]>([
    ["loja_id na raiz (.strict())", { forma: "bairro", versao: 3, loja_id: LOJA_OUTRA }],
    ["p_loja_id na raiz", { forma: "bairro", versao: 3, p_loja_id: LOJA_OUTRA }],
    ["forma 'cidade'", { forma: "cidade", versao: 3 }],
    ["versao ausente", { forma: "bairro" }],
    ["versao negativa", { forma: "bairro", versao: -1 }],
    ["payload null", null],
  ])("[325/F3] %s ⇒ { ok:false } e createClient/rpc NÃO chamados", async (_n, payload) => {
    const r = await definirFormaFrete(payload);

    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    esperarSemIO();
  });
});

describe("[325/F3] definirFormaFrete — UMA RPC; p_loja_id = loja do dono", () => {
  it("[325/F3] válido ⇒ UMA rpc('definir_forma_frete', { p_forma, p_versao, p_loja_id: loja do dono }) com args literais", async () => {
    await definirFormaFrete({ forma: "bairro", versao: 12 });

    expect(chamadasRpc).toEqual([
      { nome: "definir_forma_frete", args: { p_forma: "bairro", p_versao: 12, p_loja_id: LOJA_DO_DONO } },
    ]);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(buscarLojaDoDono).toHaveBeenCalledWith(authClient);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("[325/F3] sucesso ⇒ { ok:true, versao } e revalida painel de entregas e vitrine", async () => {
    respostaRpc = () => Promise.resolve({ data: 13, error: null });

    const r = await definirFormaFrete({ forma: "raio_km", versao: 12 });

    expect(r).toEqual({ ok: true, versao: 13 });
    expect(revalidatePath).toHaveBeenCalledWith("/painel/configuracoes/entregas");
    expect(revalidatePath).toHaveBeenCalledWith("/loja/[slug]", "page");
  });

  it("[325/F3] dono sem loja ⇒ { ok:false } e rpc não chamada", async () => {
    buscarLojaDoDono.mockResolvedValue(null);

    const r = await definirFormaFrete({ forma: "bairro", versao: 1 });

    expect(r).toEqual({ ok: false, erro: expect.any(String) });
    expect(chamadasRpc).toEqual([]);
  });
});

describe("[325/F3] definirFormaFrete — conflito, forma sem zona e falhas", () => {
  it("[325/F3] P0001 'definir_forma_frete: versao desatualizada' ⇒ { ok:false, conflito:true, erro: MENSAGEM_CONFLITO_ZONAS } e sem revalidatePath", async () => {
    respostaRpc = () =>
      Promise.resolve({ data: null, error: { code: "P0001", message: "definir_forma_frete: versao desatualizada" } });

    const r = await definirFormaFrete({ forma: "bairro", versao: 3 });

    expect(r).toEqual({ ok: false, conflito: true, erro: MENSAGEM_CONFLITO });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("[325/F3] P0001 'definir_forma_frete: forma sem zona ativa' ⇒ { ok:false, erro: MENSAGEM_FORMA_SEM_ZONA } sem conflito", async () => {
    respostaRpc = () =>
      Promise.resolve({ data: null, error: { code: "P0001", message: "definir_forma_frete: forma sem zona ativa" } });

    const r = await definirFormaFrete({ forma: "faixa_cep", versao: 3 });

    const esperada = (validacoesEntrega as unknown as { MENSAGEM_FORMA_SEM_ZONA?: unknown }).MENSAGEM_FORMA_SEM_ZONA;
    expect(typeof esperada).toBe("string");
    expect(r).toEqual({ ok: false, erro: esperada });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each<[string, () => Promise<{ data: unknown; error: unknown }>]>([
    ["P0001 'sem posse'", () => Promise.resolve({ data: null, error: { code: "P0001", message: "definir_forma_frete: sem posse" } })],
    ["RPC que lança", () => Promise.reject(new Error("connection terminated: 10.0.0.3:5432"))],
    ["data não inteiro", () => Promise.resolve({ data: "4", error: null })],
  ])("[325/F3] %s ⇒ { ok:false } genérico sem conflito e sem texto do banco", async (_n, resposta) => {
    respostaRpc = resposta;

    const r = await definirFormaFrete({ forma: "bairro", versao: 3 });

    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("conflito");
    expect((r as { erro: string }).erro).not.toMatch(/definir_forma_frete|P0001|posse|connection|5432/);
    expect(console.error).toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
