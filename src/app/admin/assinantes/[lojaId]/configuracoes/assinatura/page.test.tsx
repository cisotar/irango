import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Fiação da sub-rota admin /configuracoes/assinatura (issue 153). Prova apenas o
 * roteamento loader→componentes — a regra de valor/status/escopo vive no loader
 * (`carga.test.ts`) e nas actions admin (151, testadas à parte). Aqui asseveramos
 * que a page:
 *   - consome `carregarAssinaturaAdmin(lojaId)` (nunca `createServiceClient` inline);
 *   - posiciona `ModulosImpressaoAdmin` como card IRMÃO e ACIMA da view de
 *     assinatura, com as flags CRUAS do loader ({a4,termica});
 *   - agrupa a view de assinatura num `div.space-y-6` na ordem
 *     AvisoEstadoBloqueado → CartaoStatusAssinatura → AssinaturaAdminClient →
 *     TabelaFaturas;
 *   - passa a `AssinaturaAdminClient` o `lojaId`, `planoAtualId`, `temAssinatura`
 *     e os `planos` já mapeados (`PlanoView`).
 *
 * Padrão espelha `configuracoes/page.test.tsx`: invoca o default export async e
 * inspeciona o elemento retornado com os filhos mockados como `() => null`, sem
 * renderizar. Ambiente `node`.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// Loja fake do loader: flags a4:true / termica:false para provar o repasse CRU
// (sem coerção na page). Status/assinatura montam a view de assinatura.
const lojaFake = {
  id: LOJA_ID,
  assinatura_status: "ativa",
  assinatura_inicio: "2026-01-01T00:00:00.000Z",
  assinatura_fim_periodo: "2026-02-01T00:00:00.000Z",
  provider_subscription_id: "sub_123" as string | null,
  plano_id: "plano-1",
  modulo_impressao_a4: true,
  modulo_impressao_termica: false,
};

const planoAtualFake = { id: "plano-1", nome: "Mensal", preco: 5000, intervalo: "mês" };
// Plano do catálogo com campos EXTRA: prova que a page mapeia só id/nome/preco/intervalo.
const planosFake = [
  { id: "plano-1", nome: "Mensal", preco: 5000, intervalo: "mês", ativo: true, criado_em: "x" },
  { id: "plano-2", nome: "Anual", preco: 50000, intervalo: "ano", ativo: true, criado_em: "y" },
];
const faturasFake = [{ id: "fat-1" }];

// Loader mockado: já testado à parte (carga.test.ts). A page só o consome.
const carregarAssinaturaAdmin = vi.fn(async (_lojaId: string) => ({
  loja: lojaFake,
  planoAtual: planoAtualFake,
  planos: planosFake,
  faturas: faturasFake,
}));
vi.mock("../../carga", () => ({
  carregarAssinaturaAdmin: (lojaId: string) => carregarAssinaturaAdmin(lojaId),
}));

// Filhos mockados como componentes distintos: identificamos cada um por REFERÊNCIA
// (`child.type === Mock`) para provar ordem e irmandade sem renderizar.
vi.mock("../ModulosImpressaoAdmin", () => ({
  ModulosImpressaoAdmin: Object.assign(() => null, {
    displayName: "ModulosImpressaoAdmin",
  }),
}));
vi.mock("./AssinaturaAdminClient", () => ({
  AssinaturaAdminClient: Object.assign(() => null, {
    displayName: "AssinaturaAdminClient",
  }),
}));
vi.mock("@/components/painel/AvisoEstadoBloqueado", () => ({
  AvisoEstadoBloqueado: Object.assign(() => null, {
    displayName: "AvisoEstadoBloqueado",
  }),
}));
vi.mock("@/components/painel/CartaoStatusAssinatura", () => ({
  CartaoStatusAssinatura: Object.assign(() => null, {
    displayName: "CartaoStatusAssinatura",
  }),
}));
vi.mock("@/components/painel/TabelaFaturas", () => ({
  TabelaFaturas: Object.assign(() => null, { displayName: "TabelaFaturas" }),
}));

// Imports APÓS os vi.mock(): recebem as MESMAS referências mockadas usadas pela page.
import { ModulosImpressaoAdmin } from "../ModulosImpressaoAdmin";
import { AssinaturaAdminClient } from "./AssinaturaAdminClient";
import { AvisoEstadoBloqueado } from "@/components/painel/AvisoEstadoBloqueado";
import { CartaoStatusAssinatura } from "@/components/painel/CartaoStatusAssinatura";
import { TabelaFaturas } from "@/components/painel/TabelaFaturas";
import AssinaturaConfiguracaoAdminPage from "./page";

type ElementoReact = ReactElement<{
  className?: string;
  children?: unknown;
}>;

async function renderizar(): Promise<ElementoReact> {
  return (await AssinaturaConfiguracaoAdminPage({
    params: Promise.resolve({ lojaId: LOJA_ID }),
  })) as ElementoReact;
}

function filhos(elemento: ElementoReact): ElementoReact[] {
  const c = elemento.props.children;
  return (Array.isArray(c) ? c : [c]) as ElementoReact[];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin /configuracoes/assinatura — fiação", () => {
  it("consome o loader escopado (carregarAssinaturaAdmin) 1× com o lojaId da URL", async () => {
    await renderizar();

    expect(carregarAssinaturaAdmin).toHaveBeenCalledTimes(1);
    expect(carregarAssinaturaAdmin).toHaveBeenCalledWith(LOJA_ID);
  });

  it("raiz é um div.space-y-12 com 2 filhos (card de módulos + view de assinatura)", async () => {
    const elemento = await renderizar();

    expect(elemento.type).toBe("div");
    expect(elemento.props.className).toBe("space-y-12");
    expect(filhos(elemento)).toHaveLength(2);
  });

  it("ModulosImpressaoAdmin vem ACIMA da view de assinatura e como IRMÃO (não filho), com flags CRUAS", async () => {
    const elemento = await renderizar();
    const [primeiro, segundo] = filhos(elemento);

    // 1º filho: card de módulos pagos, ANTES da view de assinatura.
    expect(primeiro.type).toBe(ModulosImpressaoAdmin);
    const propsModulos = primeiro.props as {
      lojaId: string;
      modulos: { a4: boolean; termica: boolean };
      children?: unknown;
    };
    expect(propsModulos.lojaId).toBe(LOJA_ID);
    // Sem `?? false`: repasse cru; a coerção fail-closed é do componente.
    expect(propsModulos.modulos).toEqual({ a4: true, termica: false });
    // Irmandade: a view de assinatura NÃO está aninhada dentro do card de módulos.
    expect(propsModulos.children).toBeUndefined();

    // 2º filho: a view de assinatura, agrupada num div.space-y-6.
    expect(segundo.type).toBe("div");
    expect(segundo.props.className).toBe("space-y-6");
  });

  it("a view de assinatura respeita a ordem Aviso → Cartão → Client → Tabela", async () => {
    const elemento = await renderizar();
    const [, segundo] = filhos(elemento);
    const viewFilhos = filhos(segundo);

    expect(viewFilhos).toHaveLength(4);
    expect(viewFilhos[0].type).toBe(AvisoEstadoBloqueado);
    expect(viewFilhos[1].type).toBe(CartaoStatusAssinatura);
    expect(viewFilhos[2].type).toBe(AssinaturaAdminClient);
    expect(viewFilhos[3].type).toBe(TabelaFaturas);
  });

  it("passa lojaId, planoAtualId, temAssinatura e os planos mapeados a AssinaturaAdminClient", async () => {
    const elemento = await renderizar();
    const [, segundo] = filhos(elemento);
    const client = filhos(segundo)[2];
    const props = client.props as {
      lojaId: string;
      planoAtualId: string | null;
      temAssinatura: boolean;
      planos: { id: string; nome: string; preco: number; intervalo: string }[];
    };

    expect(props.lojaId).toBe(LOJA_ID);
    expect(props.planoAtualId).toBe("plano-1");
    // temAssinaturaAtiva("ativa", "sub_123") === true (função pura reusada, não mockada).
    expect(props.temAssinatura).toBe(true);
    // Mapeamento PlanoView: só id/nome/preco/intervalo (campos extra descartados).
    expect(props.planos).toEqual([
      { id: "plano-1", nome: "Mensal", preco: 5000, intervalo: "mês" },
      { id: "plano-2", nome: "Anual", preco: 50000, intervalo: "ano" },
    ]);
  });

  it("loja sem provider_subscription_id → temAssinatura=false (prova que NÃO é hardcoded true)", async () => {
    // Mesmo status "ativa" do lojaFake padrão, mas SEM assinatura vigente
    // (provider_subscription_id null). Se a page hardcodasse `temAssinatura = true`
    // em vez de chamar `temAssinaturaAtiva`, este teste pegaria a regressão.
    carregarAssinaturaAdmin.mockResolvedValueOnce({
      loja: { ...lojaFake, provider_subscription_id: null },
      planoAtual: planoAtualFake,
      planos: planosFake,
      faturas: faturasFake,
    });

    const elemento = await renderizar();
    const [, segundo] = filhos(elemento);
    const client = filhos(segundo)[2];
    const props = client.props as { temAssinatura: boolean };

    expect(props.temAssinatura).toBe(false);
  });
});
