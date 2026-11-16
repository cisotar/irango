import { describe, it, expect } from "vitest";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";
import { perfilInicialDaLoja } from "./perfilInicial";

/**
 * Issue 368 (P8) — fonte única do formulário de perfil (painel, assistente e
 * admin). Trava o que entra e, principalmente, o que NÃO entra.
 */

const LOJA = {
  id: "loja-1",
  dono_id: "dono-1",
  nome: "Loja X",
  slug: "loja-x",
  telefone: "1133334444",
  whatsapp: "11999990000",
  whatsapp_envio_automatico: true,
  modal_promocoes: false,
  endereco_cep: "01310-100",
  endereco_rua: "Avenida Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
  latitude: -23.561414,
  longitude: -46.655881,
  chave_pix: "segredo",
  primeira_publicacao_em: "2026-01-01T00:00:00Z",
} as unknown as LojaCompleta;

describe("perfilInicialDaLoja", () => {
  it("mapeia exatamente os campos do formulário", () => {
    expect(perfilInicialDaLoja(LOJA)).toEqual({
      nome: "Loja X",
      slug: "loja-x",
      telefone: "1133334444",
      whatsapp: "11999990000",
      whatsapp_envio_automatico: true,
      modal_promocoes: false,
      endereco_cep: "01310-100",
      endereco_rua: "Avenida Paulista",
      endereco_numero: "1000",
      endereco_bairro: "Bela Vista",
      endereco_cidade: "São Paulo",
      endereco_estado: "SP",
    });
  });

  it("nunca vaza coordenadas, id, dono nem campos fora do form (seguranca.md §19)", () => {
    const r = perfilInicialDaLoja(LOJA) as Record<string, unknown>;
    for (const k of ["latitude", "longitude", "id", "dono_id", "chave_pix", "primeira_publicacao_em"]) {
      expect(k in r, k).toBe(false);
    }
    expect(JSON.stringify(r)).not.toContain("-23.56");
  });

  it("preserva null (loja recém-criada) sem converter para string vazia", () => {
    const nova = {
      ...LOJA,
      telefone: null,
      whatsapp: null,
      endereco_cep: null,
      endereco_estado: null,
    } as unknown as LojaCompleta;
    const r = perfilInicialDaLoja(nova);
    expect(r.telefone).toBeNull();
    expect(r.whatsapp).toBeNull();
    expect(r.endereco_cep).toBeNull();
    expect(r.endereco_estado).toBeNull();
  });

  it("booleanos falsos não viram padrão verdadeiro", () => {
    const r = perfilInicialDaLoja({
      ...LOJA,
      whatsapp_envio_automatico: false,
      modal_promocoes: false,
    } as unknown as LojaCompleta);
    expect(r.whatsapp_envio_automatico).toBe(false);
    expect(r.modal_promocoes).toBe(false);
  });
});
