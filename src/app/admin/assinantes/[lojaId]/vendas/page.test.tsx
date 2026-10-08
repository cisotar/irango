/**
 * Issue 358 — aba Vendas do hub admin (RN-V20, D12). Fiação da page: loader
 * escopado, parte financeira compartilhada, action ADMIN ligada ao lojaId, e
 * NENHUM dado de cliente (nem import, nem render). Molde: pedidos/page.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const LOJA_ID = "11111111-1111-1111-1111-111111111111";
const LOJA = { id: LOJA_ID, nome: "Loja Teste", timezone: "America/Sao_Paulo", dia_inicio_ciclo: 5 };
const RELATORIO = { ok: false as const };

const carregarVendasLojaAdmin = vi.fn(async (..._a: unknown[]) => ({ loja: LOJA, relatorio: RELATORIO }));
vi.mock("../carga-vendas", () => ({
  carregarVendasLojaAdmin: (...a: unknown[]) => carregarVendasLojaAdmin(...a),
}));

const salvarCicloVendasAdmin = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/admin/assinantes/actions/admin-vendas", () => ({
  salvarCicloVendasAdmin: (...a: unknown[]) => salvarCicloVendasAdmin(...a),
}));

const salvarCicloVendas = vi.fn();
vi.mock("@/lib/actions/vendas", () => ({
  salvarCicloVendas: (...a: unknown[]) => salvarCicloVendas(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import VendasAdminPage from "./page";
import { RelatorioVendas, type RelatorioVendasProps } from "@/components/painel/RelatorioVendas";

const RAIZ = process.cwd();
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

async function renderizar(searchParams: Record<string, string> = {}): Promise<ReactElement> {
  return VendasAdminPage({
    params: Promise.resolve({ lojaId: LOJA_ID }),
    searchParams: Promise.resolve(searchParams),
  });
}

/** Acha o elemento `RelatorioVendas` na árvore devolvida pela page. */
function propsDoRelatorio(arvore: ReactElement): RelatorioVendasProps {
  const filhos = (arvore.props as { children: ReactElement[] }).children;
  const el = filhos.find((f) => f.type === RelatorioVendas);
  if (!el) throw new Error("RelatorioVendas não renderizado");
  return el.props as RelatorioVendasProps;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin de Vendas (358)", () => {
  it("carrega pelo loader escopado com os filtros revalidados da URL", async () => {
    await renderizar({ periodo: "semana", entrega: "x" });
    expect(carregarVendasLojaAdmin).toHaveBeenCalledTimes(1);
    const [id, filtros, agora] = carregarVendasLojaAdmin.mock.calls[0]!;
    expect(id).toBe(LOJA_ID);
    expect(filtros).toMatchObject({ periodo: "semana", entrega: "ambos" });
    expect(agora).toBeInstanceOf(Date);
  });

  it("RelatorioVendas recebe base admin, ranking null e o aviso de filtro", async () => {
    const props = propsDoRelatorio(await renderizar({ entrega: "x", ranking: "tudo" }));
    expect(props.baseVendas).toBe(`/admin/assinantes/${LOJA_ID}/vendas`);
    expect(props.ranking).toBeNull();
    expect(props.avisoFiltros).toBe(true);
    expect(props.diaInicioCiclo).toBe(5);
    expect(props.relatorio).toBe(RELATORIO);
  });

  it("D12: salvarCiclo é a action ADMIN ligada ao lojaId, nunca a do lojista", async () => {
    const props = propsDoRelatorio(await renderizar());
    await props.salvarCiclo({ dia_inicio_ciclo: 7 });
    expect(salvarCicloVendasAdmin).toHaveBeenCalledWith(LOJA_ID, { dia_inicio_ciclo: 7 });
    expect(salvarCicloVendas).not.toHaveBeenCalled();
  });

  it("renderiza a mensagem genérica quando a carga falha, com os avisos", async () => {
    const html = renderToStaticMarkup(await renderizar());
    expect(html).toContain("Não foi possível carregar o relatório. Tente de novo.");
    expect(html).toContain("Este relatório cobre só as vendas feitas pelo iRango.");
    expect(html).not.toContain("Clientes fiéis");
  });

  it("RN-V20: o arquivo não importa o card nem o loader de clientes fiéis", () => {
    const fonte = ler("src/app/admin/assinantes/[lojaId]/vendas/page.tsx");
    expect(fonte).not.toMatch(/RankingClientesFieis|carregarRankingClientes/);
    expect(fonte).not.toMatch(/createServiceClient/);
  });

  it("RN-V20: o layout admin segue com 'clientes' e sem 'vendas' em rotasAusentes", () => {
    const layout = ler("src/app/admin/assinantes/[lojaId]/layout.tsx");
    const ausentes = layout.match(/rotasAusentes:\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(ausentes).toContain('"clientes"');
    expect(ausentes).not.toContain("vendas");
  });
});
