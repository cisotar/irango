import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Fiação da page admin de configuração (issue 144). Prova apenas o roteamento de
 * props — a regra de negócio vive no componente (143) e na action (142), já
 * testados à parte. Aqui asseveramos que a page:
 *   - renderiza `ModulosImpressaoAdmin` com as flags JÁ EM MÃOS do loader
 *     (`carregarLojaAdmin`), sem query nova, passando `modulos={{a4,termica}}` cru
 *     (a coerção fail-closed `=== true` é do componente);
 *   - o coloca ACIMA e como IRMÃO de `ConfiguracaoAdminClient` (não dentro dele:
 *     billing/entitlement admin-only fica separado do espelho de config do lojista);
 *   - envolve ambos numa raiz `div.space-y-12`.
 *
 * Padrão espelha `pedidos/[id]/page.test.tsx`: invoca o default export async e
 * inspeciona o elemento retornado com os dois filhos mockados como `() => null`,
 * sem renderizar. Ambiente `node`.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

// Loja fake do loader: flags a4:true / termica:false para provar o repasse CRU
// (sem coerção na page). Demais campos mínimos p/ montar as props do client.
const lojaFake = {
  id: LOJA_ID,
  modulo_impressao_a4: true,
  modulo_impressao_termica: false,
  nome: "Pizzaria Alvo",
  slug: "pizzaria-alvo",
  telefone: null,
  whatsapp: null,
  endereco_cep: null,
  endereco_rua: null,
  endereco_numero: null,
  endereco_bairro: null,
  endereco_cidade: null,
  endereco_estado: null,
  ativo: false,
  logo_url: null,
  horarios: {},
  timezone: "America/Sao_Paulo",
  tema: {},
};

// Loader mockado: já testado à parte (carga). A page só o consome — zero query nova.
const carregarLojaAdmin = vi.fn(async (_lojaId: string) => ({
  loja: lojaFake,
  zonas: [],
  formasPagamento: [],
}));
vi.mock("../carga", () => ({
  carregarLojaAdmin: (lojaId: string) => carregarLojaAdmin(lojaId),
}));

// Filhos mockados como componentes distintos: identificamos cada um por REFERÊNCIA
// (`child.type === Mock`) para provar ordem e relação de irmandade sem renderizar.
vi.mock("./ModulosImpressaoAdmin", () => ({
  ModulosImpressaoAdmin: Object.assign(() => null, {
    displayName: "ModulosImpressaoAdmin",
  }),
}));
vi.mock("./ConfiguracaoAdminClient", () => ({
  ConfiguracaoAdminClient: Object.assign(() => null, {
    displayName: "ConfiguracaoAdminClient",
  }),
}));

// Imports APÓS os vi.mock(): recebem as MESMAS referências mockadas usadas pela page.
import { ModulosImpressaoAdmin } from "./ModulosImpressaoAdmin";
import { ConfiguracaoAdminClient } from "./ConfiguracaoAdminClient";
import ConfiguracaoAdminPage from "./page";

type ElementoReact = ReactElement<{
  className?: string;
  children?: unknown;
}>;

async function renderizar(): Promise<ElementoReact> {
  return (await ConfiguracaoAdminPage({
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

describe("page admin /configuracoes — fiação do card de módulos pagos", () => {
  it("consome o loader escopado (carregarLojaAdmin) sem query nova", async () => {
    await renderizar();

    expect(carregarLojaAdmin).toHaveBeenCalledTimes(1);
    expect(carregarLojaAdmin).toHaveBeenCalledWith(LOJA_ID);
  });

  it("raiz é um div.space-y-12 envolvendo os dois cards", async () => {
    const elemento = await renderizar();

    expect(elemento.type).toBe("div");
    expect(elemento.props.className).toBe("space-y-12");
    expect(filhos(elemento)).toHaveLength(2);
  });

  it("ModulosImpressaoAdmin vem ACIMA de ConfiguracaoAdminClient e como IRMÃO (não filho)", async () => {
    const elemento = await renderizar();
    const [primeiro, segundo] = filhos(elemento);

    // Ordem: módulos pagos ANTES do espelho de config do lojista.
    expect(primeiro.type).toBe(ModulosImpressaoAdmin);
    expect(segundo.type).toBe(ConfiguracaoAdminClient);

    // Irmandade: o card de config NÃO está aninhado dentro do card de módulos.
    const filhosDoModulos = (primeiro.props as { children?: unknown }).children;
    expect(filhosDoModulos).toBeUndefined();
  });

  it("passa lojaId + as flags CRUAS do loader ({a4:true, termica:false}) a ModulosImpressaoAdmin", async () => {
    const elemento = await renderizar();
    const [primeiro] = filhos(elemento);
    const props = primeiro.props as {
      lojaId: string;
      modulos: { a4: boolean; termica: boolean };
    };

    expect(props.lojaId).toBe(LOJA_ID);
    // Sem `?? false`: a page repassa o valor cru; a coerção fail-closed é do componente.
    expect(props.modulos).toEqual({ a4: true, termica: false });
  });
});
