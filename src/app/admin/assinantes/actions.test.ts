import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fase RED (TDD) — issue 084 (crítica: SIM). Server Action `excluirLoja(lojaId)`
 * em `./actions` (hard delete irreversível de loja, admin do SaaS).
 *
 * Por que é RED de verdade HOJE: a função `excluirLoja` AINDA NÃO existe em
 * `./actions` (a fase GREEN/`executar` a cria, junto de `excluirLojaPermanente`
 * em `@/lib/supabase/queries/adminAssinatura`). O `import { excluirLoja }` abaixo
 * resolve o módulo (o arquivo existe), mas o símbolo é `undefined` → cada teste
 * quebra ao invocar `excluirLoja(...)` (TypeError) ou na asserção. Output real
 * anexado na issue 084.
 *
 * Invariantes provadas (spec admin-hard-delete-loja.md + Plano Técnico §084):
 *  - D-4/fail-closed: `verificarAdminSaaS()` lança ANTES de qualquer efeito → a
 *    exceção PROPAGA (não vira `{ ok:false }` amigável), e NENHUM service client /
 *    DELETE / storage.remove roda. Sem admin = nada apagado.
 *  - RN/validação: `lojaId` não-UUID → `{ ok:false, erro:"Loja inválida." }` SEM
 *    tocar admin/service/storage/delete.
 *  - Loja inexistente (`linhasAfetadas === 0`) → `{ ok:false, erro:"Loja não
 *    encontrada." }`, sem exceção.
 *  - Happy path: admin ok → limpeza best-effort de storage (`pix-qr` + `produtos`,
 *    incluindo subpasta `${lojaId}/logo`) → DELETE escopado por `eq("id", lojaId)`
 *    → `revalidatePath("/admin/assinantes")` → `{ ok:true }`.
 *  - Best-effort: falha de `list`/`remove` NÃO aborta o DELETE; loja é apagada,
 *    retorno `{ ok:true }`, erro logado.
 *
 * CONTRATO que o GREEN deve satisfazer:
 *   excluirLoja(lojaId: string): Promise<{ ok:true } | { ok:false; erro:string }>
 *   excluirLojaPermanente(svc, lojaId): Promise<{ linhasAfetadas:number }>
 *     em @/lib/supabase/queries/adminAssinatura (DELETE com { count:"exact" },
 *     escopado .eq("id", lojaId)).
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// ── next/cache: revalidatePath fora de request scope → mock. ──────────────────
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

// ── verificarAdminSaaS: prova de admin. Default passa; testes de negação fazem
//    mockRejectedValueOnce / mockImplementationOnce(throw). ─────────────────────
const verificarAdminSaaS = vi.fn(async () => undefined);
vi.mock("@/lib/auth/admin", () => ({
  verificarAdminSaaS: () => verificarAdminSaaS(),
}));

// ── createServiceClient: server-only → mock. Retorna um client com storage. ────
//    Captura list/remove por bucket; respostas controláveis por teste.
type ListReturn = { data: { name: string; id: string | null }[] | null; error: unknown };
type RemoveReturn = { data: unknown; error: unknown };

const listCalls: { bucket: string; prefix: string }[] = [];
const removeCalls: { bucket: string; paths: string[] }[] = [];
// Resposta de list por prefixo (chave = `${bucket}:${prefix}`). Default abaixo.
let listResponder: (bucket: string, prefix: string) => ListReturn | Promise<ListReturn>;
let removeResponder: (bucket: string, paths: string[]) => RemoveReturn | Promise<RemoveReturn>;

const clientServico = {
  storage: {
    from: (bucket: string) => ({
      list: async (prefix: string) => {
        listCalls.push({ bucket, prefix });
        return listResponder(bucket, prefix);
      },
      remove: async (paths: string[]) => {
        removeCalls.push({ bucket, paths });
        return removeResponder(bucket, paths);
      },
    }),
  },
};
const createServiceClient = vi.fn(() => clientServico);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

// ── excluirLojaPermanente (query helper): mockado — testamos ORQUESTRAÇÃO. ─────
//    Default retorna 1 linha afetada (loja existia). Demais queries do módulo
//    (aplicarStatusAdmin) também precisam existir no factory do mock.
const excluirLojaPermanente = vi.fn<(...a: unknown[]) => Promise<{ linhasAfetadas: number }>>();
const aplicarStatusAdmin = vi.fn();
vi.mock("@/lib/supabase/queries/adminAssinatura", () => ({
  excluirLojaPermanente: (...a: unknown[]) => excluirLojaPermanente(...a),
  aplicarStatusAdmin: (...a: unknown[]) => aplicarStatusAdmin(...a),
}));

// 'use server' é só diretiva; o módulo é importável no runner node. `excluirLoja`
// ainda NÃO é exportada → undefined → RED ao invocar.
import { excluirLoja } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  listCalls.length = 0;
  removeCalls.length = 0;
  // Defaults do caminho feliz; cada teste sobrescreve o que precisa.
  verificarAdminSaaS.mockResolvedValue(undefined);
  excluirLojaPermanente.mockResolvedValue({ linhasAfetadas: 1 });
  // Por padrão cada listagem devolve um arquivo (entrada com id) compatível com
  // o prefixo pedido — o GREEN deve montar `${prefixo}/${name}` e chamar remove.
  listResponder = (_bucket, prefix) => ({
    data: [{ name: prefix.includes("/logo") ? "logo.webp" : "arquivo.webp", id: "obj-1" }],
    error: null,
  });
  removeResponder = () => ({ data: {}, error: null });
});

// ─────────────────── Caso 1: UUID inválido (sem efeito algum) ────────────────
describe("excluirLoja — validação de lojaId (UUID)", () => {
  it("lojaId não-UUID → { ok:false, erro:'Loja inválida.' } SEM admin/service/storage/delete", async () => {
    const r = await excluirLoja("nao-e-uuid");

    expect(r).toEqual({ ok: false, erro: "Loja inválida." });
    expect(verificarAdminSaaS).not.toHaveBeenCalled();
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(excluirLojaPermanente).not.toHaveBeenCalled();
    expect(removeCalls).toHaveLength(0);
  });
});

// ───── Caso 2: admin negado → exceção PROPAGA, fail-closed, nada deletado ─────
describe("excluirLoja — fail-closed quando admin é negado (D-4)", () => {
  it("verificarAdminSaaS lança → a action REJEITA (propaga) e NÃO toca service/delete/storage", async () => {
    const negado = new Error("Acesso negado.");
    verificarAdminSaaS.mockRejectedValueOnce(negado);

    await expect(excluirLoja(LOJA_ID)).rejects.toThrow("Acesso negado.");

    // Fail-closed: nenhum efeito após a prova de admin falhar.
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(excluirLojaPermanente).not.toHaveBeenCalled();
    expect(removeCalls).toHaveLength(0);
  });
});

// ───────── Caso 3: loja inexistente (delete afeta 0 linhas) ──────────────────
describe("excluirLoja — loja inexistente", () => {
  it("linhasAfetadas === 0 → { ok:false, erro:'Loja não encontrada.' } sem exceção", async () => {
    excluirLojaPermanente.mockResolvedValueOnce({ linhasAfetadas: 0 });

    const r = await excluirLoja(LOJA_ID);

    expect(r).toEqual({ ok: false, erro: "Loja não encontrada." });
    expect(excluirLojaPermanente).toHaveBeenCalledTimes(1);
    // Não revalida quando nada foi apagado.
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

// ─────────────────────── Caso 4: caminho feliz completo ─────────────────────
describe("excluirLoja — caminho feliz (admin ok, loja existente)", () => {
  it("limpa storage (pix-qr + produtos raiz + produtos/logo) → DELETE escopado → revalida → { ok:true }", async () => {
    const r = await excluirLoja(LOJA_ID);

    expect(r).toEqual({ ok: true });

    // Storage cleanup ANTES do delete, via service_role.
    expect(createServiceClient).toHaveBeenCalledTimes(1);

    // Listou o bucket pix-qr no prefixo da loja.
    expect(listCalls).toContainEqual({ bucket: "pix-qr", prefix: LOJA_ID });
    // Listou o bucket produtos na raiz da loja E na subpasta logo (logos ficam em
    // `${lojaId}/logo/` — list da raiz só devolve a pasta, não o conteúdo).
    expect(listCalls).toContainEqual({ bucket: "produtos", prefix: LOJA_ID });
    expect(listCalls).toContainEqual({ bucket: "produtos", prefix: `${LOJA_ID}/logo` });

    // Removeu objetos com path escopado por lojaId em ambos os buckets.
    const pixRemove = removeCalls.find((c) => c.bucket === "pix-qr");
    const prodRemove = removeCalls.find((c) => c.bucket === "produtos");
    expect(pixRemove).toBeDefined();
    expect(prodRemove).toBeDefined();
    for (const p of pixRemove!.paths) expect(p.startsWith(`${LOJA_ID}/`)).toBe(true);
    for (const p of prodRemove!.paths) expect(p.startsWith(`${LOJA_ID}/`)).toBe(true);
    // A logo (em produtos/logo) entrou na remoção do bucket produtos.
    expect(prodRemove!.paths).toContain(`${LOJA_ID}/logo/logo.webp`);

    // DELETE escopado pela loja-alvo, via service client.
    expect(excluirLojaPermanente).toHaveBeenCalledTimes(1);
    const [clientArg, lojaIdArg] = excluirLojaPermanente.mock.calls[0] as [unknown, string];
    expect(clientArg).toBe(clientServico);
    expect(lojaIdArg).toBe(LOJA_ID);

    // Revalida a listagem do admin.
    expect(revalidatePath).toHaveBeenCalledWith("/admin/assinantes");
  });
});

// ─────────── Caso 5: storage cleanup é best-effort (falha não aborta) ────────
describe("excluirLoja — storage cleanup best-effort", () => {
  it("list rejeita → DELETE da loja AINDA roda, retorna { ok:true } (erro logado)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listResponder = () => {
      throw new Error("storage offline");
    };

    const r = await excluirLoja(LOJA_ID);

    expect(r).toEqual({ ok: true });
    // O DELETE da loja ocorreu apesar da falha de storage.
    expect(excluirLojaPermanente).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/assinantes");
    spy.mockRestore();
  });

  it("remove rejeita → DELETE da loja AINDA roda, retorna { ok:true }", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    removeResponder = () => {
      throw new Error("remove failed");
    };

    const r = await excluirLoja(LOJA_ID);

    expect(r).toEqual({ ok: true });
    expect(excluirLojaPermanente).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
