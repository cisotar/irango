import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Server Actions ADMIN de entrega (src/app/admin/assinantes/actions/admin-entrega.ts).
 *
 * Histórico: este arquivo cobria o CRUD por zona da issue 093 e a gravação em
 * lote de km da 326 (assinatura de 3 argumentos). A issue 327 removeu esses
 * caminhos de escrita: as zonas só são gravadas pela RPC
 * `salvar_zonas_entrega` (conjunto inteiro, uma forma, versão otimista), via
 * `salvarZonasEntregaAdmin` — blocos [328] abaixo. A ausência dos exports
 * antigos é travada pelo bloco [327/F4].
 *
 * Invariantes provadas (plan/arquivo/tecnico-formas-de-frete.md §5, §8 itens 40–45, 51):
 *  - lojaId não-UUID e payload inválido (zod `.strict()`) recusados ANTES de
 *    elevar privilégio (prepararContextoAdmin nunca chamado);
 *  - admin NÃO provado → exceção PROPAGA, service nunca criado, ZERO rpc;
 *  - a RPC recebe `p_loja_id` = lojaId do parâmetro (nunca do payload) e args
 *    literais; nenhuma escrita solta em zonas/taxas/bairros;
 *  - conflito de versão → { ok:false, conflito:true } sem auditoria;
 *  - sucesso → registrarAcessoAdmin('salvar_zonas_entrega', { forma, itens }).
 */

const LOJA_ALVO = "11111111-1111-1111-1111-111111111111";
const LOJA_OUTRA = "22222222-2222-2222-2222-222222222222";
const ZONA_ID = "33333333-3333-3333-3333-333333333333";

// ── Captura de TODAS as operações por tabela (insert/update/delete + filtros). ──
type Op = {
  tabela: string;
  acao: "insert" | "update" | "delete" | "select";
  payload?: unknown;
  filtros: Array<[string, unknown]>;
};
let ops: Op[];

// Resposta de leitura terminal (.single()/.maybeSingle()) do client de serviço.
let respostaPosseZona: { data: unknown; error: unknown };
// Resposta genérica de escrita (insert/update/delete) — default sucesso.
let respostaEscrita: { data: unknown; error: unknown };

// ── next/cache: revalidatePath fora de request scope → mock. ──────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

// ── verificarAdminSaaS: prova de admin. Default passa; negação via mockReject. ──
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock encadeável. ───────────────────────
// CRÍTICO: o client raiz NÃO é thenável (só expõe `.from`). Apenas os nós
// retornados por `.from(...).select()/.eq()/...` terminam numa Promise — senão
// `await` assimilaria o thenable. Espelha actions.test.ts / entregaPagamento.test.ts.
function makeChain() {
  let tabela = "";
  let acao: Op["acao"] = "select";
  const filtros: Array<[string, unknown]> = [];
  let payload: unknown;
  const node: Record<string, unknown> = {};

  const registrar = () =>
    ops.push({ tabela, acao, payload, filtros: [...filtros] });

  node.select = () => node;
  node.single = () => {
    registrar();
    return Promise.resolve(respostaPosseZona);
  };
  node.maybeSingle = () => {
    registrar();
    return Promise.resolve(respostaPosseZona);
  };
  node.eq = (col: string, val: unknown) => {
    filtros.push([col, val]);
    return node;
  };
  node.insert = (row: unknown) => {
    acao = "insert";
    payload = row;
    return node;
  };
  node.update = (row: unknown) => {
    acao = "update";
    payload = row;
    return node;
  };
  node.upsert = (row: unknown) => {
    acao = "update";
    payload = row;
    return node;
  };
  node.delete = () => {
    acao = "delete";
    return node;
  };
  // Resolução terminal de escrita (insert/update/delete sem .single()).
  node.then = (onF: (v: unknown) => unknown) => {
    registrar();
    return Promise.resolve(respostaEscrita).then(onF);
  };

  return (t: string) => {
    tabela = t;
    return node;
  };
}

// RPC capturada (salvarZonasEntregaAdmin).
type ChamadaRpc = { nome: string; args: Record<string, unknown> };
let chamadasRpc: ChamadaRpc[] = [];
let respostaRpc: { data: unknown; error: unknown } = { data: 1, error: null };

const clientServico = {
  from: (t: string) => fromImpl(t),
  rpc: (nome: string, args: Record<string, unknown>) => {
    chamadasRpc.push({ nome, args });
    return Promise.resolve(respostaRpc);
  },
};
let fromImpl: (t: string) => unknown;
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// Espião TRANSPARENTE em `prepararContextoAdmin` (delega ao original):
// prova de ordem "lojaId e zod ANTES da elevação".
const prepararContextoAdminSpy = vi.fn();
// [328] Espião TRANSPARENTE em `registrarAcessoAdmin` (delega ao original):
// prova "conflito NÃO registra acesso; sucesso registra com { forma, itens }".
const registrarAcessoAdminSpy = vi.fn();
vi.mock("@/lib/actions/admin-loja", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/actions/admin-loja")>();
  return {
    ...orig,
    prepararContextoAdmin: (lojaId: string) => {
      prepararContextoAdminSpy(lojaId);
      return orig.prepararContextoAdmin(lojaId);
    },
    registrarAcessoAdmin: (...a: Parameters<typeof orig.registrarAcessoAdmin>) => {
      registrarAcessoAdminSpy(...a);
      return orig.registrarAcessoAdmin(...a);
    },
  };
});

// `salvarZonasEntregaAdmin` resolvida pelo NAMESPACE (precedente 326): export
// ausente vira falha de asserção, não import quebrado.
import * as adminEntrega from "./admin-entrega";

beforeEach(() => {
  vi.clearAllMocks();
  ops = [];
  chamadasRpc = [];
  respostaRpc = { data: 1, error: null };
  respostaPosseZona = { data: { id: ZONA_ID, loja_id: LOJA_ALVO }, error: null };
  respostaEscrita = { data: { id: ZONA_ID }, error: null };
  verificarAdminSaaS.mockResolvedValue(undefined);
  // Cada chamada de action reconstrói a cadeia (estado de op por nó).
  fromImpl = (t: string) => makeChain()(t);
});

// ═════════════════════════════════════════════════════════════════════════════
// [328/F3] salvarZonasEntregaAdmin — RED (plan/arquivo/tecnico-formas-de-frete.md §5, §8 itens 40–45)
//
// CONTRATO (src/app/admin/assinantes/actions/admin-entrega.ts, 'use server'):
//   salvarZonasEntregaAdmin(lojaId: string, payload: unknown): Promise<ResultadoZonas>
//   (ResultadoZonas = { ok:true; versao:number } | { ok:false; erro:string; conflito?:true },
//   importado com `import type` de @/lib/actions/entrega)
// Ordem fail-closed: validarLojaIdAdmin → schemaZonasEntrega.safeParse →
// prepararContextoAdmin FORA do try (propaga) → svc.rpc("salvar_zonas_entrega",
// { p_loja_id: lojaId validado, p_versao, p_forma, p_dados }) → conflito ⇒
// { ok:false, conflito:true, erro: MENSAGEM_CONFLITO_ZONAS } SEM registrarAcessoAdmin
// → sucesso ⇒ registrarAcessoAdmin(svc, { lojaId, acao:"salvar_zonas_entrega",
// metadados:{ forma, itens } }) + revalidarLojaAdmin + { ok:true, versao }.
// Cobre também o que os testes [089]/[093] de isolamento-admin.test.ts
// provavam para o CRUD por zona (removidos no P3).
// ═════════════════════════════════════════════════════════════════════════════
type ResultadoZonasAdmin = { ok: true; versao: number } | { ok: false; erro: string; conflito?: true };

const MENSAGEM_CONFLITO_ZONAS_ESPERADA =
  "Recarregue a página para ver as entregas atuais: elas foram alteradas em outra aba ou por outra pessoa, e esta mudança não foi salva.";

function salvarZonasEntregaAdmin(lojaId: unknown, payload: unknown): Promise<ResultadoZonasAdmin> {
  const fn = (
    adminEntrega as unknown as {
      salvarZonasEntregaAdmin?: (l: unknown, p: unknown) => Promise<ResultadoZonasAdmin>;
    }
  ).salvarZonasEntregaAdmin;
  if (typeof fn !== "function") {
    throw new Error(
      "[RED 328] `admin-entrega.ts` ainda não exporta `salvarZonasEntregaAdmin` (F3, P3 do plano).",
    );
  }
  return fn(lojaId, payload);
}

const ZONAS_CEP_VALIDAS = {
  forma: "faixa_cep",
  versao: 7,
  faixas: [
    { cep_inicio: 1000000, cep_fim: 1999999, taxa: 5, pedido_minimo_gratis: null, ativo: true },
    { cep_inicio: 2000000, cep_fim: 2999999, taxa: 7.5, pedido_minimo_gratis: 60, ativo: false },
  ],
};
const ZONAS_BAIRRO_VALIDAS = {
  forma: "bairro",
  versao: 0,
  grupos: [
    { bairros: ["Centro", "Vila Nova"], taxa: 6, pedido_minimo_gratis: null, ativo: true },
    { bairros: ["Sé"], taxa: 4, pedido_minimo_gratis: 80, ativo: true },
    { bairros: ["Luz"], taxa: 9, pedido_minimo_gratis: null, ativo: false },
  ],
};

describe("[328/F3] salvarZonasEntregaAdmin — lojaId validado ANTES de elevar", () => {
  it.each([["nao-e-uuid"], [""], [null], [123]])(
    "[328/F3] salvarZonasEntregaAdmin — lojaId %j não-UUID ⇒ { ok:false } sem prepararContextoAdmin",
    async (lojaId) => {
      const r = await salvarZonasEntregaAdmin(lojaId, ZONAS_CEP_VALIDAS);

      expect(r).toEqual({ ok: false, erro: expect.any(String) });
      expect(prepararContextoAdminSpy).not.toHaveBeenCalled();
      expect(verificarAdminSaaS).not.toHaveBeenCalled();
      expect(createServiceClient).not.toHaveBeenCalled();
      expect(chamadasRpc).toEqual([]);
    },
  );
});

describe("[328/F3] salvarZonasEntregaAdmin — zod roda ANTES da elevação de privilégio", () => {
  it.each<[string, unknown]>([
    ["loja_id forjado na raiz", { ...ZONAS_CEP_VALIDAS, loja_id: LOJA_OUTRA }],
    [
      "tipo extra na faixa de CEP",
      { ...ZONAS_CEP_VALIDAS, faixas: [{ ...ZONAS_CEP_VALIDAS.faixas[0], tipo: "bairro" }] },
    ],
    [
      "loja_id extra no grupo de bairro",
      { ...ZONAS_BAIRRO_VALIDAS, grupos: [{ ...ZONAS_BAIRRO_VALIDAS.grupos[0], loja_id: LOJA_OUTRA }] },
    ],
    [
      "nome extra no grupo de bairro",
      { ...ZONAS_BAIRRO_VALIDAS, grupos: [{ ...ZONAS_BAIRRO_VALIDAS.grupos[0], nome: "Grátis" }] },
    ],
    ["versao ausente", { forma: "faixa_cep", faixas: [] }],
    ["forma fora do enum", { ...ZONAS_CEP_VALIDAS, forma: "cidade" }],
    [
      "CEP sobreposto",
      {
        ...ZONAS_CEP_VALIDAS,
        faixas: [
          { cep_inicio: 1000000, cep_fim: 1999999, taxa: 5, pedido_minimo_gratis: null, ativo: true },
          { cep_inicio: 1500000, cep_fim: 2500000, taxa: 5, pedido_minimo_gratis: null, ativo: true },
        ],
      },
    ],
    [
      "bairro repetido por acento",
      {
        ...ZONAS_BAIRRO_VALIDAS,
        grupos: [
          { bairros: ["Centro"], taxa: 6, pedido_minimo_gratis: null, ativo: true },
          { bairros: ["cêntro"], taxa: 4, pedido_minimo_gratis: null, ativo: true },
        ],
      },
    ],
  ])(
    "[328/F3] salvarZonasEntregaAdmin — payload com %s ⇒ recusa ANTES de elevar (prepararContextoAdmin não chamado)",
    async (_n, payload) => {
      const r = await salvarZonasEntregaAdmin(LOJA_ALVO, payload);

      expect(r).toEqual({ ok: false, erro: expect.any(String) });
      expect(prepararContextoAdminSpy).not.toHaveBeenCalled();
      expect(verificarAdminSaaS).not.toHaveBeenCalled();
      expect(createServiceClient).not.toHaveBeenCalled();
      expect(chamadasRpc).toEqual([]);
    },
  );
});

describe("[328/F3] salvarZonasEntregaAdmin — elevação, escopo, conflito e auditoria", () => {
  it("[328/F3] salvarZonasEntregaAdmin — admin reprovado ⇒ exceção propaga, service nunca criado, ZERO chamada de rpc", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(salvarZonasEntregaAdmin(LOJA_ALVO, ZONAS_CEP_VALIDAS)).rejects.toThrow("acesso negado");

    expect(createServiceClient).not.toHaveBeenCalled();
    expect(chamadasRpc).toEqual([]);
    expect(registrarAcessoAdminSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("[328/F3] salvarZonasEntregaAdmin — rpc recebe p_loja_id = lojaId do parâmetro e args literais, nunca loja_id do payload", async () => {
    respostaRpc = { data: 8, error: null };

    await salvarZonasEntregaAdmin(LOJA_ALVO, ZONAS_CEP_VALIDAS);

    expect(prepararContextoAdminSpy).toHaveBeenCalledWith(LOJA_ALVO);
    expect(chamadasRpc).toEqual([
      {
        nome: "salvar_zonas_entrega",
        args: {
          p_loja_id: LOJA_ALVO,
          p_versao: 7,
          p_forma: "faixa_cep",
          p_dados: {
            faixas: [
              { cep_inicio: 1000000, cep_fim: 1999999, taxa: 5, pedido_minimo_gratis: null, ativo: true },
              { cep_inicio: 2000000, cep_fim: 2999999, taxa: 7.5, pedido_minimo_gratis: 60, ativo: false },
            ],
          },
        },
      },
    ]);
    const escritasDeZona = ops.filter(
      (o) => ["zonas_entrega", "taxas_entrega", "bairros_zona"].includes(o.tabela) && o.acao !== "select",
    );
    expect(escritasDeZona).toEqual([]);
  });

  it("[328/F3] salvarZonasEntregaAdmin — conflito ⇒ { ok:false, conflito:true } genérico; registrarAcessoAdmin NÃO chamado", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    respostaRpc = {
      data: null,
      error: { code: "P0001", message: "salvar_zonas_entrega: versao desatualizada" },
    };

    const r = await salvarZonasEntregaAdmin(LOJA_ALVO, ZONAS_CEP_VALIDAS);

    expect(r).toEqual({ ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS_ESPERADA });
    expect(registrarAcessoAdminSpy).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("[328/F3] salvarZonasEntregaAdmin — outro erro do banco ⇒ { ok:false } genérico SEM conflito, sem auditoria", async () => {
    const spyErro = vi.spyOn(console, "error").mockImplementation(() => {});
    respostaRpc = { data: null, error: { code: "P0001", message: "salvar_zonas_entrega: sem posse" } };

    const r = await salvarZonasEntregaAdmin(LOJA_ALVO, ZONAS_CEP_VALIDAS);

    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("conflito");
    expect((r as { erro: string }).erro).not.toMatch(/salvar_zonas_entrega|P0001|posse/);
    expect(registrarAcessoAdminSpy).not.toHaveBeenCalled();
    expect(spyErro).toHaveBeenCalled();
    spyErro.mockRestore();
  });

  it("[328/F3] salvarZonasEntregaAdmin — sucesso ⇒ registrarAcessoAdmin('salvar_zonas_entrega', { forma, itens }) e { ok:true, versao }", async () => {
    respostaRpc = { data: 1, error: null };

    const r = await salvarZonasEntregaAdmin(LOJA_ALVO, ZONAS_BAIRRO_VALIDAS);

    expect(r).toEqual({ ok: true, versao: 1 });
    expect(registrarAcessoAdminSpy).toHaveBeenCalledTimes(1);
    expect(registrarAcessoAdminSpy).toHaveBeenCalledWith(clientServico, {
      lojaId: LOJA_ALVO,
      acao: "salvar_zonas_entrega",
      metadados: { forma: "bairro", itens: 3 },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/assinantes/${LOJA_ALVO}`);
    expect(revalidatePath).toHaveBeenCalledWith("/loja/[slug]", "page");
  });
});

// ═════════════════════════════════════════════════════════════════ F4 · 327
describe("[327/F4] remoção dos caminhos de escrita por zona (admin)", () => {
  it("[327/F4] módulo admin não exporta criarZonaAdmin, atualizarZonaAdmin, removerZonaAdmin, alternarZonaAtivaAdmin nem salvarFaixasEntregaAdmin", async () => {
    const exportados = Object.keys(await import("./admin-entrega"));

    for (const nome of [
      "criarZonaAdmin",
      "atualizarZonaAdmin",
      "removerZonaAdmin",
      "alternarZonaAtivaAdmin",
      "salvarFaixasEntregaAdmin",
    ]) {
      expect(exportados, `ainda exporta ${nome}`).not.toContain(nome);
    }
    expect(exportados).toContain("salvarModalidadesEntregaAdmin");
  });
});
