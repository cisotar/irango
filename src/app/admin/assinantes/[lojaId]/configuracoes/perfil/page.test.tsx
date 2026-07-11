import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Fiação da sub-rota admin /configuracoes/perfil (issue 152). Prova apenas o
 * roteamento loader→wrapper: a regra vive na action admin (091) e o escopo/
 * fail-closed no loader (`carga.test.ts`). Aqui asseveramos que a page:
 *   - consome `carregarLojaAdminBase(lojaId)` (nunca `createServiceClient` inline);
 *   - renderiza `PerfilAdminClient` com `lojaId` + as props derivadas
 *     (`perfilInicial`, `publicado`, `podePublicar`, `logoUrlInicial`).
 *
 * Padrão espelha `pedidos/[id]/page.test.tsx`: invoca o default export async e
 * inspeciona o elemento retornado com o wrapper mockado como `() => null`, sem
 * renderizar. Ambiente `node`.
 */

const LOJA_ID = "11111111-1111-1111-1111-111111111111";

const lojaFake = {
  id: LOJA_ID,
  nome: "Pizzaria Alvo",
  slug: "pizzaria-alvo",
  telefone: null,
  whatsapp: "5511999999999" as string | null,
  endereco_cep: null,
  endereco_rua: null,
  endereco_numero: null,
  endereco_bairro: null,
  endereco_cidade: null,
  endereco_estado: null,
  ativo: false,
  logo_url: "https://storage.local/logo.webp",
};

const carregarLojaAdminBase = vi.fn(async (_lojaId: string) => lojaFake);
vi.mock("../../carga", () => ({
  carregarLojaAdminBase: (lojaId: string) => carregarLojaAdminBase(lojaId),
}));

vi.mock("./PerfilAdminClient", () => ({
  PerfilAdminClient: () => null,
}));

import { PerfilAdminClient } from "./PerfilAdminClient";
import PerfilConfiguracaoAdminPage from "./page";

type Props = {
  lojaId: string;
  inicial: { nome: string; slug: string; whatsapp: string | null };
  publicado: boolean;
  podePublicar: boolean;
  logoUrlInicial: string | null;
};

async function renderizar(): Promise<ReactElement<Props>> {
  return (await PerfilConfiguracaoAdminPage({
    params: Promise.resolve({ lojaId: LOJA_ID }),
  })) as ReactElement<Props>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("page admin /configuracoes/perfil — fiação", () => {
  it("consome o loader base escopado por lojaId (sem createServiceClient inline)", async () => {
    await renderizar();

    expect(carregarLojaAdminBase).toHaveBeenCalledTimes(1);
    expect(carregarLojaAdminBase).toHaveBeenCalledWith(LOJA_ID);
  });

  it("renderiza PerfilAdminClient com lojaId + props derivadas", async () => {
    const el = await renderizar();

    expect(el.type).toBe(PerfilAdminClient);
    expect(el.props.lojaId).toBe(LOJA_ID);
    expect(el.props.publicado).toBe(false);
    expect(el.props.logoUrlInicial).toBe("https://storage.local/logo.webp");
    expect(el.props.inicial.nome).toBe("Pizzaria Alvo");
    expect(el.props.inicial.slug).toBe("pizzaria-alvo");
  });

  it("podePublicar=true com nome + whatsapp preenchidos", async () => {
    const el = await renderizar();
    expect(el.props.podePublicar).toBe(true);
  });

  it("podePublicar=false quando falta whatsapp (preview do gate do servidor)", async () => {
    carregarLojaAdminBase.mockResolvedValueOnce({ ...lojaFake, whatsapp: null });
    const el = await renderizar();
    expect(el.props.podePublicar).toBe(false);
  });
});
