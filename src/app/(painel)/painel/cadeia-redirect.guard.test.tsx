import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

/**
 * Issue 368 (crítica) — ENUMERATIVO ANTI-CICLO das rotas do painel.
 *
 * Layout não lê pathname (classe CVE-2025-29927): o gate é posicional. Um
 * redirect para uma rota sob o MESMO layout que redirecionou vira ciclo. Este
 * teste prova, para {marcador} × {assinatura} × {rota de entrada}, que a cadeia
 * de redirects termina em ≤2 saltos sem repetir rota.
 *
 * Modelo (plano técnico): cada rota invoca os layouts/page REAIS que a envolvem
 *   - rotas do grupo `(bloqueavel)/`         → `(bloqueavel)/layout`
 *   - `/painel/primeiros-passos`             → `primeiros-passos/layout` + `primeiros-passos/page`
 *   - `/painel/primeiros-passos/<etapa>`     → `primeiros-passos/layout`
 *   - `/painel/assinatura-bloqueada` e `/painel/configuracoes/assinatura`
 *       → isentas (fora dos dois grupos); com loja presente não redirecionam.
 * O layout pai (`decidirAcessoBase`) devolve "ok" para lojista com loja e não
 * redireciona — fora do modelo (coberto por painel-layout.guard.test.tsx).
 * `redirect` lança; o destino capturado vira a próxima rota.
 */

class Redirecionou extends Error {
  constructor(readonly destino: string) {
    super("NEXT_REDIRECT");
  }
}
const redirect = vi.fn((destino: string) => {
  throw new Redirecionou(destino);
});
vi.mock("next/navigation", () => ({
  redirect: (d: string) => redirect(d),
  usePathname: () => "/painel/primeiros-passos",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const userConfirmado = { id: "user-uuid", email: "dono@teste.local", email_confirmed_at: "2026-01-02T00:00:00Z" };
const supabaseFake = { auth: { getUser: async () => ({ data: { user: userConfirmado } }) } };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => supabaseFake }));

let lojaAtual: LojaCompleta;
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: async () => lojaAtual,
}));
vi.mock("@/lib/supabase/queries/publicacao", () => ({
  carregarProntidaoPublicacao: async (_c: unknown, loja: Record<string, unknown>) => ({
    ...loja,
    produtosDisponiveis: 0,
    formasPagamento: 0,
  }),
}));
vi.mock("./primeiros-passos/ProgressoAssistente", () => ({ ProgressoAssistente: () => null, default: () => null }));
vi.mock("./primeiros-passos/NavegacaoEtapas", () => ({ NavegacaoEtapas: () => null, default: () => null }));

type Gate = () => Promise<unknown>;
const CHILDREN = { __tag: "c" } as unknown as ReactNode;

async function gatesDaRota(rota: string): Promise<Gate[]> {
  if (rota === "/painel/assinatura-bloqueada" || rota === "/painel/configuracoes/assinatura") return [];
  if (rota === "/painel/primeiros-passos" || rota.startsWith("/painel/primeiros-passos/")) {
    const layout = (await import("./primeiros-passos/layout")) as {
      default: (p: { children: ReactNode }) => Promise<unknown>;
    };
    const gates: Gate[] = [() => layout.default({ children: CHILDREN })];
    if (rota === "/painel/primeiros-passos") {
      const page = (await import("./primeiros-passos/page")) as { default: () => Promise<unknown> };
      gates.push(() => page.default());
    }
    return gates;
  }
  const bloqueavel = (await import("./(bloqueavel)/layout")) as {
    default: (p: { children: ReactNode }) => Promise<unknown>;
  };
  return [() => bloqueavel.default({ children: CHILDREN })];
}

/** Segue a cadeia a partir de `entrada`; devolve as rotas visitadas, em ordem. */
async function cadeia(entrada: string): Promise<string[]> {
  const visitadas = [entrada];
  for (let salto = 0; salto < 6; salto++) {
    const atual = visitadas[visitadas.length - 1];
    let destino: string | null = null;
    for (const gate of await gatesDaRota(atual)) {
      try {
        await gate();
      } catch (e) {
        if (e instanceof Redirecionou) {
          destino = e.destino;
          break;
        }
        throw e;
      }
    }
    if (destino === null) return visitadas;
    visitadas.push(destino);
    if (visitadas.indexOf(destino) !== visitadas.length - 1) return visitadas; // ciclo: para e deixa o expect acusar
  }
  return visitadas;
}

function fazerLoja(marcador: string | null, assinatura: string): LojaCompleta {
  return {
    id: "loja-368",
    nome: "Loja Nova",
    whatsapp: null,
    logo_url: null,
    slug: "loja-nova",
    assinatura_status: assinatura,
    assinatura_fim_periodo: null,
    primeira_publicacao_em: marcador,
    endereco_cep: null,
    endereco_rua: null,
    endereco_numero: null,
    endereco_bairro: null,
    endereco_cidade: null,
    endereco_estado: null,
    latitude: null,
    longitude: null,
  } as unknown as LojaCompleta;
}

const MARCADORES = [
  ["nulo", null],
  ["preenchido", "2026-01-01T00:00:00Z"],
] as const;
const ASSINATURAS = ["ativa", "suspensa"] as const;
const ROTAS = [
  "/painel",
  "/painel/pedidos",
  "/painel/configuracoes/perfil",
  "/painel/primeiros-passos",
  "/painel/primeiros-passos/perfil",
  "/painel/primeiros-passos/revisar",
  "/painel/assinatura-bloqueada",
  "/painel/configuracoes/assinatura",
] as const;

const CASOS = MARCADORES.flatMap(([rotulo, marcador]) =>
  ASSINATURAS.flatMap((assinatura) => ROTAS.map((rota) => [rotulo, assinatura, rota, marcador] as const)),
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cadeia de redirect do painel (issue 368)", () => {
  it.each(CASOS)(
    "marcador %s · %s · %s → cadeia de redirect termina em ≤2 saltos sem repetir rota",
    async (_rotulo, assinatura, rota, marcador) => {
      lojaAtual = fazerLoja(marcador, assinatura);
      const visitadas = await cadeia(rota);
      const saltos = visitadas.length - 1;

      expect(new Set(visitadas).size, `rota repetida (ciclo): ${visitadas.join(" → ")}`).toBe(visitadas.length);
      expect(saltos, `saltos demais: ${visitadas.join(" → ")}`).toBeLessThanOrEqual(2);

      const final = visitadas[visitadas.length - 1];
      expect(final.startsWith("/painel"), `saiu do painel (fail-closed inesperado): ${visitadas.join(" → ")}`).toBe(true);
      const isenta = final === "/painel/assinatura-bloqueada" || final === "/painel/configuracoes/assinatura";
      if (marcador === null) {
        // Nunca publicada: termina no assistente (D4; DD14: assistente vence o
        // paywall). Só fica numa tela isenta quem ENTROU nela por URL direta (D5).
        const entrouIsenta = rota === "/painel/assinatura-bloqueada" || rota === "/painel/configuracoes/assinatura";
        expect(
          final.startsWith("/painel/primeiros-passos/") || (isenta && entrouIsenta),
          `loja nunca publicada terminou fora do assistente: ${visitadas.join(" → ")}`,
        ).toBe(true);
      } else {
        expect(
          final.startsWith("/painel/primeiros-passos"),
          `loja já publicada terminou no assistente: ${visitadas.join(" → ")}`,
        ).toBe(false);
      }
    },
  );
});
