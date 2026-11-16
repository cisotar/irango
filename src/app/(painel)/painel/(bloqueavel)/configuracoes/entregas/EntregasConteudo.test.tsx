import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

/**
 * Issue 368 (P8) — loader extraído `EntregasConteudo`, compartilhado pela page
 * do painel e pela etapa "entregas" do assistente. Só o I/O é mockado; o
 * mapeamento loja → props (modalidadesDaLoja) é real. `EntregasClient` é
 * substituído por um marcador para ler as props que o servidor entrega.
 */

const NEXT_REDIRECT = "NEXT_REDIRECT";
const redirect = vi.fn((_d: string) => {
  throw new Error(NEXT_REDIRECT);
});
vi.mock("next/navigation", () => ({ redirect: (d: string) => redirect(d) }));

const SUPABASE = { __supabase: true };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => SUPABASE }));

const buscarLojaDoDono = vi.fn();
vi.mock("@/lib/supabase/queries/lojas", () => ({
  buscarLojaDoDono: (c: unknown) => buscarLojaDoDono(c),
}));

const listarZonasParaEdicao = vi.fn();
vi.mock("@/lib/supabase/queries/entregaPagamento", () => ({
  listarZonasParaEdicao: (c: unknown, id: string) => listarZonasParaEdicao(c, id),
}));

vi.mock("@/lib/actions/entrega", () => ({
  definirFormaFrete: "ACAO_DEFINIR",
  salvarModalidadesEntrega: "ACAO_MODALIDADES",
  salvarZonasEntrega: "ACAO_ZONAS",
}));

function EntregasClientMarcador() {
  return null;
}
vi.mock("./EntregasClient", () => ({ EntregasClient: EntregasClientMarcador }));

import { EntregasConteudo } from "./EntregasConteudo";
import EntregasPage from "./page";

function loja(extra: Record<string, unknown> = {}) {
  return {
    id: "loja-1",
    latitude: null,
    longitude: null,
    aceita_retirada: true,
    aceita_entrega: true,
    modo_frete: "automatico",
    taxa_entrega_fora_zona: 7.5,
    ...extra,
  };
}

async function props(hrefPerfil = "/x"): Promise<Record<string, unknown>> {
  const el = (await EntregasConteudo({ hrefPerfil })) as ReactElement<Record<string, unknown>>;
  expect(el.type).toBe(EntregasClientMarcador);
  return el.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  buscarLojaDoDono.mockResolvedValue(loja());
  listarZonasParaEdicao.mockResolvedValue({ versao: 4, forma: "km", zonas: [{ id: "z1" }] });
});

describe("EntregasConteudo", () => {
  it("lê as zonas da loja do DONO (loja.id vindo do banco) com o client autenticado", async () => {
    buscarLojaDoDono.mockResolvedValue(loja({ id: "loja-do-dono" }));
    const p = await props();
    expect(buscarLojaDoDono).toHaveBeenCalledWith(SUPABASE);
    expect(listarZonasParaEdicao).toHaveBeenCalledWith(SUPABASE, "loja-do-dono");
    expect(p.versao).toBe(4);
    expect(p.forma).toBe("km");
    expect(p.zonas).toEqual([{ id: "z1" }]);
    expect(p.taxaForaZona).toBe(7.5);
  });

  it("hrefPerfil chega intacto ao client (é o que difere entre painel e assistente)", async () => {
    expect((await props("/painel/primeiros-passos/perfil")).hrefPerfil).toBe(
      "/painel/primeiros-passos/perfil",
    );
  });

  it("temCoordenadas é boolean e exige o PAR; as coordenadas nunca chegam ao client", async () => {
    buscarLojaDoDono.mockResolvedValue(loja({ latitude: -23.5, longitude: -46.6 }));
    const completo = await props();
    expect(completo.temCoordenadas).toBe(true);
    expect(JSON.stringify(completo)).not.toContain("-23.5");

    for (const par of [
      { latitude: -23.5, longitude: null },
      { latitude: null, longitude: -46.6 },
      { latitude: null, longitude: null },
    ]) {
      buscarLojaDoDono.mockResolvedValue(loja(par));
      expect((await props()).temCoordenadas).toBe(false);
    }
  });

  it("coordenada 0 é válida (não é tratada como ausente)", async () => {
    buscarLojaDoDono.mockResolvedValue(loja({ latitude: 0, longitude: 0 }));
    expect((await props()).temCoordenadas).toBe(true);
  });

  it("modalidades derivam da loja: a combinar e sem retirada", async () => {
    buscarLojaDoDono.mockResolvedValue(
      loja({ modo_frete: "a_combinar", aceita_retirada: false, aceita_entrega: true }),
    );
    expect((await props()).modalidades).toEqual({
      aceita_retirada: false,
      aceita_entrega: true,
      modo_frete: "a_combinar",
    });
  });

  it("injeta as actions do LOJISTA (nenhuma variante admin)", async () => {
    expect((await props()).acoes).toEqual({
      salvarModalidades: "ACAO_MODALIDADES",
      salvarZonas: "ACAO_ZONAS",
      definirForma: "ACAO_DEFINIR",
    });
  });

  it("sem loja → redirect('/painel') e não consulta zonas", async () => {
    buscarLojaDoDono.mockResolvedValue(null);
    await expect(EntregasConteudo({ hrefPerfil: "/x" })).rejects.toThrow(NEXT_REDIRECT);
    expect(redirect).toHaveBeenCalledWith("/painel");
    expect(listarZonasParaEdicao).not.toHaveBeenCalled();
  });

  it("erro da query de zonas propaga (não mascara como tela vazia)", async () => {
    listarZonasParaEdicao.mockRejectedValue(new Error("falha-db"));
    await expect(EntregasConteudo({ hrefPerfil: "/x" })).rejects.toThrow("falha-db");
  });
});

describe("EntregasPage (painel)", () => {
  it("usa o link de perfil do painel, não o do assistente", () => {
    const el = EntregasPage() as ReactElement<{ hrefPerfil: string }>;
    expect(el.type).toBe(EntregasConteudo);
    expect(el.props.hrefPerfil).toBe("/painel/configuracoes/perfil");
  });
});
