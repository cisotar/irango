import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

/**
 * Issue 368 (crítica) — retomada do assistente (D6):
 * `primeiros-passos/page.tsx` só redireciona para
 * `rotaDaEtapa(etapaDeRetomada(pendenciasPublicacao(estado)))`, depois do mesmo
 * guard do layout. Regras REAIS (publicacao.ts, primeirosPassos.ts); só o I/O é
 * mockado.
 *
 * Contexto do guard, igual ao do layout — guard do assistente de primeiros passos
 * `src/app/(painel)/painel/primeiros-passos/layout.tsx` + `guard.ts`
 * (`exigirAssistente`).
 *
 * Contrato (plano técnico, "Nomes fixos"):
 *   - leitura única: createClient → getUser → buscarLojaDoDono →
 *     carregarProntidaoPublicacao; qualquer erro, user null ou loja null →
 *     redirect("/login?erro=sessao") (redirect fora do try);
 *   - decidirPrimeirosPassos(loja) === "concluido" → redirect("/painel");
 *   - NÃO aplica decidirAssinatura (D5): loja bloqueada nunca publicada entra.
 *
 * Padrão de `bloqueavel-layout.guard.test.tsx`: chama o default export async sem
 * renderizar; `redirect` mockado LANÇA NEXT_REDIRECT. `decidirPrimeirosPassos`
 * é real (fiação). Só o I/O é mockado. O layout é importado dinamicamente,
 * depois dos mocks.
 */

const NEXT_REDIRECT = "NEXT_REDIRECT";
const redirect = vi.fn((_destino: string) => {
  throw new Error(NEXT_REDIRECT);
});
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => redirect(destino),
  usePathname: () => "/painel/primeiros-passos/perfil",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const userConfirmado = { id: "user-uuid", email: "dono@teste.local", email_confirmed_at: "2026-01-02T00:00:00Z" };
const getUser = vi.fn(async () => ({ data: { user: userConfirmado as unknown } }));
const supabaseFake = { auth: { getUser: () => getUser() } };
const createClient = vi.fn(async () => supabaseFake as unknown);
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClient() }));

const buscarLojaDoDono = vi.fn(async (_c: unknown) => null as unknown);
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (c: unknown) => buscarLojaDoDono(c),
}));

const carregarProntidaoPublicacao = vi.fn(async (_c: unknown, loja: Record<string, unknown>) => ({
  ...loja,
  produtosDisponiveis: 0,
  formasPagamento: 0,
}));
vi.mock("@/lib/supabase/queries/publicacao", () => ({
  carregarProntidaoPublicacao: (c: unknown, l: Record<string, unknown>) => carregarProntidaoPublicacao(c, l),
}));

// UI do assistente: irrelevante para o guard.
vi.mock("./ProgressoAssistente", () => ({ ProgressoAssistente: () => null, default: () => null }));
vi.mock("./NavegacaoEtapas", () => ({ NavegacaoEtapas: () => null, default: () => null }));

function fazerLoja(extra: Record<string, unknown> = {}): LojaCompleta {
  return {
    id: "loja-368",
    nome: "Loja Nova",
    whatsapp: null,
    logo_url: null,
    assinatura_status: "ativa",
    assinatura_fim_periodo: null,
    primeira_publicacao_em: null,
    endereco_cep: null,
    endereco_rua: null,
    endereco_numero: null,
    endereco_bairro: null,
    endereco_cidade: null,
    endereco_estado: null,
    latitude: null,
    longitude: null,
    ...extra,
  } as unknown as LojaCompleta;
}

const ENDERECO_COMPLETO = {
  endereco_cep: "01310-100",
  endereco_rua: "Avenida Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
};
const PERFIL = { nome: "Loja Nova", whatsapp: "11999990000" };
const PAR = { latitude: -23.56, longitude: -46.65 };

function contagens(produtosDisponiveis: number, formasPagamento: number) {
  carregarProntidaoPublicacao.mockImplementation(async (_c: unknown, loja: Record<string, unknown>) => ({
    ...loja,
    produtosDisponiveis,
    formasPagamento,
  }));
}

async function destinoDaPagina(): Promise<string> {
  const mod = (await import("./page")) as { default: () => Promise<unknown> };
  await expect(mod.default()).rejects.toThrow(NEXT_REDIRECT);
  expect(redirect).toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  getUser.mockResolvedValue({ data: { user: userConfirmado } });
  createClient.mockResolvedValue(supabaseFake as unknown);
  contagens(0, 0);
});

describe("primeiros-passos/page — retomada na primeira etapa com pendência (issue 368)", () => {
  it("loja recém-criada → redirect '/painel/primeiros-passos/perfil'", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja());
    expect(await destinoDaPagina()).toBe("/painel/primeiros-passos/perfil");
  });

  it("perfil e endereço completos, sem par, sem pagamento → '/painel/primeiros-passos/pagamentos'", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja({ ...PERFIL, ...ENDERECO_COMPLETO }));
    contagens(0, 0);
    expect(await destinoDaPagina()).toBe("/painel/primeiros-passos/pagamentos");
  });

  it("só falta produto → '/painel/primeiros-passos/produtos'", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja({ ...PERFIL, ...ENDERECO_COMPLETO, ...PAR }));
    contagens(0, 1);
    expect(await destinoDaPagina()).toBe("/painel/primeiros-passos/produtos");
  });

  it("só falta o par → '/painel/primeiros-passos/revisar'", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja({ ...PERFIL, ...ENDERECO_COMPLETO }));
    contagens(1, 1);
    expect(await destinoDaPagina()).toBe("/painel/primeiros-passos/revisar");
  });

  it("nada pendente → '/painel/primeiros-passos/revisar'", async () => {
    buscarLojaDoDono.mockResolvedValue(fazerLoja({ ...PERFIL, ...ENDERECO_COMPLETO, ...PAR }));
    contagens(2, 1);
    expect(await destinoDaPagina()).toBe("/painel/primeiros-passos/revisar");
  });

  it("marcador preenchido → '/painel'", async () => {
    buscarLojaDoDono.mockResolvedValue(
      fazerLoja({ ...PERFIL, primeira_publicacao_em: "2026-01-01T00:00:00Z" }),
    );
    expect(await destinoDaPagina()).toBe("/painel");
  });
});
