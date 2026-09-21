import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 083 (crítica: SIM). Helper neutro compartilhado
 * `src/lib/actions/admin-loja.ts` (sem `'use server'`) que padroniza o início de
 * TODA Server Action admin desta feature.
 *
 * Por que é RED de verdade HOJE: o módulo `./admin-loja` AINDA NÃO EXISTE
 * (a fase GREEN/`executar` o cria). O `import` abaixo aponta para um arquivo
 * inexistente → o módulo não resolve → todo o suite quebra a importar
 * `validarLojaIdAdmin`, `prepararContextoAdmin`, `registrarAcessoAdmin`.
 *
 * Invariantes provadas (issue 083, specs/admin-onboarding-assistido.md):
 *  - validarLojaIdAdmin: safeParse de `lojaIdSchema` (z.guid()). Não-UUID →
 *    { ok:false }. UUID válido → { ok:true, lojaId }.
 *  - prepararContextoAdmin: prova `verificarAdminSaaS()` ANTES de elevar a
 *    service_role. Se a prova lança, a exceção PROPAGA (fail-closed, D-4) e
 *    `createServiceClient` NUNCA é chamado — nunca vira `{ ok:false }` amigável.
 *    Ordem: verificarAdminSaaS antes de createServiceClient.
 *  - registrarAcessoAdmin (issue 147): INSERT best-effort fire-and-forget em
 *    `admin_acessos` via `svc`. Resolve admin_user_id = adminId ?? obterAdminUserId(),
 *    dispara o insert SEM await, nunca lança e retorna void. RED em describe dedicado
 *    abaixo (contra o no-op atual, `capturas` fica vazio → payload/adminId/null falham).
 *
 * CONTRATO que o GREEN deve satisfazer (arquivo: src/lib/actions/admin-loja.ts):
 *   validarLojaIdAdmin(lojaId: unknown): { ok:true; lojaId:string } | { ok:false }
 *   prepararContextoAdmin(lojaId: string): Promise<{ svc: <service client> }>
 *     (ou retorno equivalente que exponha o service client; o teste só exige que
 *      verificarAdminSaaS rode ANTES, e que a falha de admin propague)
 *   registrarAcessoAdmin(svc: Svc, { adminId?, lojaId, acao, entidadeId?, metadados? }):
 *     void  (INSERT best-effort fire-and-forget em admin_acessos — issue 147)
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
// Id autoritativo do dono do SaaS que `obterAdminUserId()` resolve no servidor
// (env server-only). Usado como `admin_user_id` esperado no payload do audit.
const ADMIN_USER_ID = "99999999-9999-9999-9999-999999999999";

// ── verificarAdminSaaS: prova de admin. Default passa; teste de negação faz
//    mockRejectedValueOnce. Ordem capturada via array `ordemChamadas`. ──────────
const ordemChamadas: string[] = [];
const verificarAdminSaaS = vi.fn(async () => {
  ordemChamadas.push("verificarAdminSaaS");
});
// ── obterAdminUserId: fonte ÚNICA do id do dono do SaaS (no real é fail-closed —
//    lança se SAAS_ADMIN_USER_ID ausente). Default devolve id fixo; o teste de
//    env-ausente usa mockImplementationOnce(throw). SEM este mock o novo corpo veria
//    `undefined` → o happy path falharia pelo motivo errado (plan §"Padrão de teste").
const obterAdminUserId = vi.fn(() => ADMIN_USER_ID);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
  obterAdminUserId: () => obterAdminUserId(),
}));

// ── createServiceClient: server-only → mock. Registra ordem ao ser chamado. ────
// Builder-espião: captura tabela/op/payload/eqs das escritas feitas pelo wrapper
// `escopo` (usado só nos testes do wrapper; os demais não tocam `.from`).
type OpEspia = {
  tabela: string;
  tipo: string;
  payload?: unknown;
  /** [269] Só preenchido quando `tipo === "upsert"` — o array de linhas do `inserirVarios`. */
  linhas?: unknown[];
  opts?: unknown;
  eqs: { c: string; v: unknown }[];
};
let opsEspia: OpEspia[] = [];
function builderEspia(tabela: string) {
  const op: OpEspia = { tabela, tipo: "select", eqs: [] };
  opsEspia.push(op);
  const b: Record<string, unknown> = {
    insert(p: unknown) { op.tipo = "insert"; op.payload = p; return b; },
    // [269] `upsert` de N linhas (`escopo.inserirVarios`) — captura o ARRAY
    // inteiro em `op.linhas`, distinto de `op.payload` (que é sempre 1 objeto).
    upsert(p: unknown[], opts?: unknown) { op.tipo = "upsert"; op.linhas = p; op.opts = opts; return b; },
    // [274 · R2] O 2º argumento do `update` é capturado: sem ele, "o helper
    // pede `count: "exact"`" é indistinguível de "o mock devolveu count: 1 por
    // default" — e a recusa por `count === 0` seria decorativa.
    update(p: unknown, opts?: unknown) { op.tipo = "update"; op.payload = p; op.opts = opts; return b; },
    delete(opts?: unknown) { op.tipo = "delete"; op.opts = opts; return b; },
    select() { return b; },
    maybeSingle() { return b; },
    eq(c: string, v: unknown) { op.eqs.push({ c, v }); return b; },
    then(res: (v: { data: null; error: null; count: number }) => unknown) {
      return Promise.resolve({ data: null, error: null, count: 1 }).then(res);
    },
  };
  return b;
}
const clientServico = { marker: "svc-fake", from: (t: string) => builderEspia(t) };
const createServiceClient = vi.fn(() => {
  ordemChamadas.push("createServiceClient");
  return clientServico;
});
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// Módulo alvo AINDA NÃO EXISTE → import quebra o suite inteiro (RED).
import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  registrarAcessoAdmin,
} from "./admin-loja";

beforeEach(() => {
  vi.clearAllMocks();
  ordemChamadas.length = 0;
  verificarAdminSaaS.mockImplementation(async () => {
    ordemChamadas.push("verificarAdminSaaS");
  });
  // Reset da fila `once` + impl default: o teste de env-ausente usa
  // mockImplementationOnce, que `clearAllMocks` NÃO limpa (só zera calls).
  obterAdminUserId.mockReset();
  obterAdminUserId.mockReturnValue(ADMIN_USER_ID);
});

// ─────────────────── validarLojaIdAdmin (validação UUID) ─────────────────────
describe("validarLojaIdAdmin", () => {
  it("string não-UUID → { ok:false }", () => {
    expect(validarLojaIdAdmin("nao-e-uuid")).toEqual({ ok: false });
  });

  it("valores não-string também rejeitados → { ok:false }", () => {
    expect(validarLojaIdAdmin(undefined)).toEqual({ ok: false });
    expect(validarLojaIdAdmin(123)).toEqual({ ok: false });
    expect(validarLojaIdAdmin(null)).toEqual({ ok: false });
  });

  it("UUID válido → { ok:true, lojaId }", () => {
    expect(validarLojaIdAdmin(LOJA_ID)).toEqual({ ok: true, lojaId: LOJA_ID });
  });
});

// ─────────────── prepararContextoAdmin (prova de admin + escopo) ─────────────
describe("prepararContextoAdmin — prova admin antes de elevar (fail-closed D-4)", () => {
  it("admin ok → chama verificarAdminSaaS ANTES de createServiceClient", async () => {
    await prepararContextoAdmin(LOJA_ID);

    expect(verificarAdminSaaS).toHaveBeenCalledTimes(1);
    expect(createServiceClient).toHaveBeenCalledTimes(1);
    // Ordem importa: prova antes de elevar.
    expect(ordemChamadas).toEqual(["verificarAdminSaaS", "createServiceClient"]);
  });

  it("verificarAdminSaaS lança → PROPAGA (rejeita) e NÃO chama createServiceClient", async () => {
    verificarAdminSaaS.mockRejectedValueOnce(new Error("acesso negado"));

    await expect(prepararContextoAdmin(LOJA_ID)).rejects.toThrow("acesso negado");

    // Fail-closed: nunca elevou para service_role após a prova falhar.
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(ordemChamadas).not.toContain("createServiceClient");
  });
});

// ─────────────── escopo (wrapper camada 1: amarra o tenant por construção) ───
describe("prepararContextoAdmin → escopo — injeta o tenant em TODA escrita", () => {
  const ID_RECURSO = "33333333-3333-3333-3333-333333333333";

  it("inserir injeta loja_id do PARÂMETRO por último — payload hostil não sobrescreve", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.inserir("categorias", { nome: "x", ordem: 0, loja_id: "hostil" } as never);
    const op = opsEspia.find((o) => o.tipo === "insert")!;
    expect((op.payload as Record<string, unknown>).loja_id).toBe(LOJA_ID);
  });

  it("atualizar escopa por loja_id E id", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.atualizar("categorias", ID_RECURSO, { nome: "y" });
    const op = opsEspia.find((o) => o.tipo === "update")!;
    expect(op.eqs).toContainEqual({ c: "loja_id", v: LOJA_ID });
    expect(op.eqs).toContainEqual({ c: "id", v: ID_RECURSO });
  });

  it("remover escopa por loja_id E id", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.remover("categorias", ID_RECURSO);
    const op = opsEspia.find((o) => o.tipo === "delete")!;
    expect(op.eqs).toContainEqual({ c: "loja_id", v: LOJA_ID });
    expect(op.eqs).toContainEqual({ c: "id", v: ID_RECURSO });
  });

  // [269] `inserirVarios` — INSERT de N linhas em uma instrução (upsert), para o
  // lote de `cardapio_produtos` do hub admin. A garantia que importa é a MESMA
  // de `inserir`, aplicada a CADA linha do array: um `loja_id` hostil dentro de
  // uma linha do payload não sobrevive — o wrapper sobrescreve por último, por
  // linha, não só na primeira.
  it("inserirVarios injeta loja_id do PARÂMETRO em CADA linha — loja_id hostil por linha não sobrevive", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.inserirVarios("cardapio_produtos", [
      { produto_id: "p1", cardapio_id: "c1", loja_id: "hostil-1" } as never,
      { produto_id: "p2", cardapio_id: "c1", loja_id: "hostil-2" } as never,
      { produto_id: "p3", cardapio_id: "c1" } as never,
    ]);
    const op = opsEspia.find((o) => o.tipo === "upsert")!;
    expect(op.linhas).toHaveLength(3);
    // TODA linha carrega o loja_id do parâmetro — nenhuma escapa pela hostil.
    for (const linha of op.linhas as Record<string, unknown>[]) {
      expect(linha.loja_id).toBe(LOJA_ID);
    }
    expect((op.linhas as Record<string, unknown>[]).map((l) => l.loja_id)).not.toContain(
      "hostil-1",
    );
    expect((op.linhas as Record<string, unknown>[]).map((l) => l.loja_id)).not.toContain(
      "hostil-2",
    );
    // Os demais campos de cada linha são preservados (não é um objeto só com loja_id).
    expect((op.linhas as Record<string, unknown>[]).map((l) => l.produto_id)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  it("inserirVarios com array VAZIO: chama upsert([]) — não lança, não vira insert de 1 linha vazia", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.inserirVarios("cardapio_produtos", []);
    const op = opsEspia.find((o) => o.tipo === "upsert")!;
    expect(op.linhas).toEqual([]);
  });

  it("inserirVarios repassa `opcoes` (onConflict/ignoreDuplicates) intactas, sem injetar escopo nelas", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    const opcoes = { onConflict: "loja_id,cardapio_id,produto_id", ignoreDuplicates: true };
    await escopo.inserirVarios("cardapio_produtos", [{ produto_id: "p1", cardapio_id: "c1" } as never], opcoes);
    const op = opsEspia.find((o) => o.tipo === "upsert")!;
    expect(op.opts).toEqual(opcoes);
  });

  it("atualizarLoja escopa a tabela lojas por id", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.atualizarLoja({ nome: "Nova" });
    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    expect(op.tipo).toBe("update");
    expect(op.eqs).toContainEqual({ c: "id", v: LOJA_ID });
  });

  // Letalidade do filtro de runtime (issue 115): o `Omit` protege só chamadores que
  // passam object-literal; `as`/width-subtyping o derrotam, e `service_role` BYPASSA o
  // trigger lojas_protege_billing_v2. O filtro é o backstop real — descarta as chaves
  // somente-servidor mesmo quando o tipo é burlado por `as never`.
  it("atualizarLoja descarta chaves somente-servidor mesmo sob cast (backstop de runtime)", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.atualizarLoja({ dono_id: "atacante", nome: "ok" } as never);
    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    const payload = op.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("dono_id");
    expect(payload.nome).toBe("ok");
  });

  // Issue 129 (crítica) — RN-M3: flags de módulo pago (`modulo_impressao_*`) só o
  // servidor de billing liga. `svc` roda como service_role e BYPASSA o trigger 128,
  // então o filtro de runtime de `atualizarLoja` é a AUTORIDADE real. Sem a entrada
  // na constante, um patch admin castado por `as never` (o vetor real: admin-perfil
  // casta para TablesUpdate) ligaria o módulo pago → burla de billing.
  it("atualizarLoja descarta modulo_impressao_a4 sob cast — não liga módulo pago (RN-M3)", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.atualizarLoja({ nome: "ok", modulo_impressao_a4: true } as never);
    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    const payload = op.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("modulo_impressao_a4");
    expect(payload.nome).toBe("ok");
  });

  it("atualizarLoja descarta modulo_impressao_termica sob cast — não liga módulo pago (RN-M3)", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    await escopo.atualizarLoja({ nome: "ok", modulo_impressao_termica: true } as never);
    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    const payload = op.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("modulo_impressao_termica");
    expect(payload.nome).toBe("ok");
  });

  // Issue 115 + 129 — completude do filtro: a blocklist tem 15 colunas (espelhando o
  // trigger lojas_protege_billing_v2 + id + consentimento_* + módulos de impressão),
  // não só `dono_id`. Lista hardcoded AQUI (não importada de admin-loja.ts): se alguém
  // remover uma entrada de CAMPOS_LOJA_SOMENTE_SERVIDOR por engano, este teste pega —
  // importar a mesma constante do módulo sob teste esconderia a regressão (drift entre
  // a constante e o esperado).
  it("atualizarLoja descarta TODAS as colunas da blocklist, não só dono_id (letalidade completa)", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    const colunasBloqueadas = [
      "id",
      "dono_id",
      "assinatura_status",
      "assinatura_inicio",
      "assinatura_fim_periodo",
      "assinatura_atualizada_em",
      "hotmart_subscriber_code",
      "hotmart_plano",
      "billing_provider",
      "provider_subscription_id",
      "plano_id",
      "consentimento_versao",
      "consentimento_em",
      "modulo_impressao_a4",
      "modulo_impressao_termica",
    ];
    const payloadHostil = {
      ...Object.fromEntries(colunasBloqueadas.map((c) => [c, `forjado-${c}`])),
      nome: "ok",
    } as never;

    await escopo.atualizarLoja(payloadHostil);

    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    const payload = op.payload as Record<string, unknown>;
    for (const col of colunasBloqueadas) {
      expect(payload, `coluna '${col}' deveria ter sido descartada`).not.toHaveProperty(col);
    }
    expect(payload.nome).toBe("ok");
  });

  // Issue 115 — payload SÓ com chaves bloqueadas (nenhuma legítima sobra). O
  // filtro deve produzir um UPDATE com objeto vazio, não lançar nem enviar
  // undefined/null que quebre o builder do PostgREST.
  it("atualizarLoja com payload SÓ de chaves bloqueadas → UPDATE vazio, não explode", async () => {
    opsEspia = [];
    const { escopo } = await prepararContextoAdmin(LOJA_ID);
    const somenteBloqueadas = {
      dono_id: "atacante",
      plano_id: "premium-forjado",
      consentimento_versao: "v999",
    } as never;

    const resultado = await escopo.atualizarLoja(somenteBloqueadas);

    expect(resultado.error).toBeNull();
    const op = opsEspia.find((o) => o.tabela === "lojas")!;
    expect(op.tipo).toBe("update");
    expect(op.payload).toEqual({});
  });
});

// ─────────── registrarAcessoAdmin (INSERT best-effort fire-and-forget) ────────
// Fase RED — issue 147 (crítica). O corpo ATUAL é no-op: `svc.from` nunca é chamado,
// então `capturas` fica vazio. Os 3 primeiros testes (payload/adminId/normalização)
// FALHAM agora — é o RED que conta. Os de robustez (não-lança / não-insere) passam
// trivialmente contra o no-op, mas TRAVAM um GREEN ingênuo que propague o erro do log
// para a action de billing/PII que chamou (invariante crítica desta issue).
describe("registrarAcessoAdmin — INSERT best-effort fire-and-forget", () => {
  // svc-espião: `.from("admin_acessos").insert(payload)` captura o payload SÍNCRONO
  // (antes do 1º await do IIFE) e devolve um thenable que resolve/rejeita por cenário.
  // `then` recebe (res, rej) → a rejeição é tratada (sem unhandled-rejection).
  function svcComInsert(cenario: "ok" | "erroPg" | "rejeita") {
    const capturas: { t: string; payload: unknown }[] = [];
    const svc = {
      from: (t: string) => ({
        insert: (payload: unknown) => {
          capturas.push({ t, payload });
          return {
            then: (
              res: (v: { error: unknown }) => unknown,
              rej: (e: unknown) => unknown,
            ) =>
              cenario === "rejeita"
                ? Promise.reject(new Error("network")).then(res, rej)
                : Promise.resolve({
                    error: cenario === "erroPg" ? { message: "dup" } : null,
                  }).then(res, rej),
          };
        },
      }),
    };
    return { svc, capturas };
  }

  it("happy path: dispara .from('admin_acessos').insert com admin_user_id resolvido + campos", async () => {
    const { svc, capturas } = svcComInsert("ok");
    registrarAcessoAdmin(svc as never, {
      lojaId: LOJA_ID,
      acao: "alternar_modulo",
      entidadeId: "prod-1",
      metadados: { modulo: "a4", ativo: true },
    });
    expect(capturas).toEqual([
      {
        t: "admin_acessos",
        payload: {
          admin_user_id: ADMIN_USER_ID,
          loja_id: LOJA_ID,
          acao: "alternar_modulo",
          entidade_id: "prod-1",
          metadados: { modulo: "a4", ativo: true },
        },
      },
    ]);
    await Promise.resolve(); // drena o microtask do insert entre testes
  });

  it("adminId explícito no acesso → usado no lugar de obterAdminUserId()", async () => {
    const { svc, capturas } = svcComInsert("ok");
    registrarAcessoAdmin(svc as never, {
      adminId: "admin-explicito",
      lojaId: LOJA_ID,
      acao: "edicao",
    });
    const payload = capturas[0]?.payload as Record<string, unknown> | undefined;
    expect(payload?.admin_user_id).toBe("admin-explicito");
    expect(obterAdminUserId).not.toHaveBeenCalled();
    await Promise.resolve();
  });

  it("entidadeId/metadados ausentes → payload normaliza para null", async () => {
    const { svc, capturas } = svcComInsert("ok");
    registrarAcessoAdmin(svc as never, { lojaId: LOJA_ID, acao: "criar_categoria" });
    const payload = capturas[0]?.payload as Record<string, unknown> | undefined;
    expect(payload?.entidade_id).toBeNull();
    expect(payload?.metadados).toBeNull();
    await Promise.resolve();
  });

  // Regressão (issue 147, MÉDIA da auditoria): as actions de Storage (salvar_logo,
  // upload_foto_produto, comprovante Pix) registram o `path` do bucket, que NÃO é
  // uuid. A coluna `entidade_id` é `uuid` — enfiar um path lá quebra o INSERT (ou,
  // pior, aceita lixo). O contrato é: caller passa `path` em `metadados`, NUNCA em
  // `entidadeId`. Este teste trava a regressão no ponto de contrato do helper: dado
  // `metadados: { path }` e SEM `entidadeId`, o payload sai com `entidade_id: null`
  // e o `path` preservado em `metadados`.
  it("Storage: path (não-uuid) vai em metadados, NUNCA em entidade_id", async () => {
    const { svc, capturas } = svcComInsert("ok");
    registrarAcessoAdmin(svc as never, {
      lojaId: LOJA_ID,
      acao: "salvar_logo",
      metadados: { path: "loja-x/logo/uuid.png" },
    });
    const payload = capturas[0]?.payload as Record<string, unknown> | undefined;
    expect(payload?.entidade_id).toBeNull();
    expect(payload?.metadados).toEqual({ path: "loja-x/logo/uuid.png" });
    await Promise.resolve();
  });

  it("INSERT rejeita (rede) → NÃO lança, caller segue, sem unhandled-rejection", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { svc } = svcComInsert("rejeita");
    expect(() =>
      registrarAcessoAdmin(svc as never, { lojaId: LOJA_ID, acao: "x" }),
    ).not.toThrow();
    // A rejeição do insert é engolida no catch do IIFE — se escapasse, o
    // unhandled-rejection derrubaria o teste. Flush por macrotask (não um número
    // fixo de microtasks): o thenable de teste encadeia Promise.reject().then(),
    // que soma mais ticks do que um await nativo — contar "dois flushes" é frágil
    // e mascarava esta asserção (achado de mutação: 0 chamadas com 2 ticks fixos).
    await new Promise((r) => setTimeout(r, 0));
    // Não basta "não lançar": um catch mudo (sem log) também não lançaria e
    // esconderia a falha do log de auditoria. Prova que o erro foi de fato
    // registrado — não só engolido silenciosamente.
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[registrarAcessoAdmin]"),
      expect.any(Error),
    );
    spy.mockRestore();
  });

  it("INSERT retorna { error } (erro PostgREST) → NÃO lança", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { svc } = svcComInsert("erroPg");
    expect(() =>
      registrarAcessoAdmin(svc as never, { lojaId: LOJA_ID, acao: "x" }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    // Mesma prova: o ramo `if (error)` precisa logar, não só evitar o throw.
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[registrarAcessoAdmin]"),
      "dup",
    );
    spy.mockRestore();
  });

  it("SAAS_ADMIN_USER_ID ausente (obterAdminUserId lança) → NÃO lança e NÃO insere", async () => {
    obterAdminUserId.mockImplementationOnce(() => {
      throw new Error("SAAS_ADMIN_USER_ID não configurado");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { svc, capturas } = svcComInsert("ok");
    expect(() =>
      registrarAcessoAdmin(svc as never, { lojaId: LOJA_ID, acao: "x" }),
    ).not.toThrow();
    expect(capturas).toHaveLength(0); // a resolução do admin falhou ANTES do insert
    await Promise.resolve();
    // Prova que o throw síncrono de obterAdminUserId também é logado, não só
    // engolido — mesmo padrão de prova dos outros dois canais de erro.
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[registrarAcessoAdmin]"),
      expect.any(Error),
    );
    spy.mockRestore();
  });

  it("ainda retorna void síncrono (o caller nunca dá await)", () => {
    const { svc } = svcComInsert("ok");
    expect(
      registrarAcessoAdmin(svc as never, { lojaId: LOJA_ID, acao: "x" }),
    ).toBeUndefined();
  });
});

// ══════════════ [274 · C] `EscopoLoja.atualizarPorChave` — UPDATE por CHAVE ══
//
// Fase RED da issue 274 (D4). O método ainda não existe: o `escopo` de hoje só
// sabe atualizar por `id`, e o cliente de `cardapio_produtos` conhece o par
// `(cardapio_id, produto_id)`, não o `id` da junção. Resolver o `id` por SELECT
// prévio seria um round trip a mais, uma janela TOCTOU e um oráculo de
// existência; o UPDATE pela chave natural prova a posse NA PRÓPRIA ESCRITA —
// `count === 0` É a recusa.
//
// R1 (o footgun NOVO desta issue): chave vazia degradaria para um UPDATE da
// LOJA INTEIRA sob `service_role` (BYPASSRLS). Tem de LANÇAR, e a mensagem é
// afirmada por fragmento — um `TypeError` de método inexistente também "lança",
// e passaria vacuamente. Por isso todo caso começa exigindo a função.
//
// E4 (tipo, fora do runtime — verificado por `npx tsc --noEmit`): o `patch` é
// `Omit<Update, "loja_id" | "id" | K>`, então `atualizarPorChave("cardapio_produtos",
// { cardapio_id, produto_id }, { loja_id: X })` e `{ cardapio_id: Y }` NÃO
// COMPILAM. O `.eq` escopa QUAL linha; nunca O QUE se grava. Não há caso de
// runtime para isso de propósito: um `as never` aqui provaria o contrário do
// que se quer (que o compilador barra), e a barreira de runtime dessa classe já
// é o `.strict()` do zod na fronteira.

type EscopoComChave = {
  atualizarPorChave(
    tabela: string,
    chave: Record<string, string>,
    patch: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown; count: number | null }>;
};

async function escopoPorChave(): Promise<EscopoComChave> {
  const { escopo } = await prepararContextoAdmin(LOJA_ID);
  const candidato = escopo as unknown as Partial<EscopoComChave>;
  if (typeof candidato.atualizarPorChave !== "function") {
    throw new Error(
      "[RED 274] `EscopoLoja.atualizarPorChave` ainda não existe em " +
        "`src/lib/actions/admin-loja.ts` — é a fase GREEN (D4 do plano).",
    );
  }
  return candidato as EscopoComChave;
}

describe("[274] escopo.atualizarPorChave — escopo duplo `loja_id` + chave natural", () => {
  const CARDAPIO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const PRODUTO = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

  it("E2: escopa por `loja_id` PRIMEIRO e depois por TODAS as colunas da chave", async () => {
    opsEspia = [];
    const escopo = await escopoPorChave();
    await escopo.atualizarPorChave(
      "cardapio_produtos",
      { cardapio_id: CARDAPIO, produto_id: PRODUTO },
      { dias_semana: [1, 3] },
    );

    const op = opsEspia.find((o) => o.tipo === "update")!;
    expect(op.tabela).toBe("cardapio_produtos");
    expect(op.payload).toEqual({ dias_semana: [1, 3] });
    // Os TRÊS filtros, nomeando a coluna — e o `loja_id` é o do wrapper.
    expect(op.eqs).toEqual([
      { c: "loja_id", v: LOJA_ID },
      { c: "cardapio_id", v: CARDAPIO },
      { c: "produto_id", v: PRODUTO },
    ]);
  });

  it("E3: pede `count: \"exact\"` — sem ele, `count === 0` nunca chega à action", async () => {
    opsEspia = [];
    const escopo = await escopoPorChave();
    await escopo.atualizarPorChave("cardapio_produtos", { cardapio_id: CARDAPIO }, {
      dias_semana: null,
    });
    const op = opsEspia.find((o) => o.tipo === "update")!;
    expect(op.opts).toEqual({ count: "exact" });
  });

  it("E1 (R1): chave VAZIA LANÇA — e nenhuma op chega ao banco", async () => {
    opsEspia = [];
    const escopo = await escopoPorChave();
    expect(() => escopo.atualizarPorChave("cardapio_produtos", {}, { dias_semana: null })).toThrow(
      // Fragmento afirmado: um `TypeError` de método ausente também lançaria.
      /chave vazia/i,
    );
    expect(
      opsEspia,
      "chave vazia degradaria para UPDATE da loja inteira: nada pode ter sido emitido",
    ).toHaveLength(0);
  });

  it("o `loja_id` do wrapper NÃO é substituível por uma coluna homônima na chave", async () => {
    opsEspia = [];
    const escopo = await escopoPorChave();
    await escopo.atualizarPorChave(
      "cardapio_produtos",
      { cardapio_id: CARDAPIO, produto_id: PRODUTO },
      { dias_semana: [0] },
    );
    const op = opsEspia.find((o) => o.tipo === "update")!;
    const lojas = op.eqs.filter((e) => e.c === "loja_id");
    expect(lojas).toEqual([{ c: "loja_id", v: LOJA_ID }]);
    expect(JSON.stringify(op.payload)).not.toContain("loja_id");
  });
});
