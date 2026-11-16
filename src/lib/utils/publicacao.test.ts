import { describe, it, expect } from "vitest";

import * as publicacao from "./publicacao";
import type { EstadoProntidao } from "./publicacao";
import { schemaPerfil } from "@/lib/validacoes/loja";
import { montarConsultaGeocoding } from "@/lib/actions/patches-loja";

/**
 * Issue 368 + 193 — gate ÚNICO de publicação (D7) e mensagens (D10).
 *
 * `podePublicarLoja(estado)` é PURA sobre um estado já carregado do banco
 * (`EstadoProntidao`); devolve `{ ok: true }` ou a 1ª pendência. As contagens
 * vêm de `carregarProntidaoPublicacao` (queries/publicacao.ts), testada à parte.
 *
 * Os 4 casos da versão anterior (nome+WhatsApp) viraram linhas da matriz com a
 * mesma semântica: nome ausente/só espaços e WhatsApp ausente/vazio → recusa.
 */

// O banco pode devolver `nome` nulo e o aviso D15 recebe recortes parciais da
// loja: só a ENTRADA dessas três funções é alargada aqui; saídas e o resto do
// módulo seguem com os tipos reais, então o tsc trava o contrato.
type Estado = Omit<EstadoProntidao, "nome"> & { nome: string | null };
type LojaAviso = Parameters<typeof publicacao.varianteAvisoEndereco>[0];

const p = {
  ...publicacao,
  podePublicarLoja: (e: Estado) => publicacao.podePublicarLoja(e as EstadoProntidao),
  pendenciasPublicacao: (e: Estado) => publicacao.pendenciasPublicacao(e as EstadoProntidao),
  varianteAvisoEndereco: (l: Partial<LojaAviso> & { ativo?: boolean }) =>
    publicacao.varianteAvisoEndereco(l as LojaAviso),
};

const ENDERECO = {
  endereco_cep: "01310-100",
  endereco_rua: "Avenida Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
};

const PRONTA: Estado = {
  nome: "Burger do Zé",
  whatsapp: "5511999999999",
  ...ENDERECO,
  latitude: -23.56,
  longitude: -46.65,
  produtosDisponiveis: 3,
  formasPagamento: 1,
};

const CAMPOS = [
  "endereco_cep",
  "endereco_rua",
  "endereco_numero",
  "endereco_bairro",
  "endereco_cidade",
  "endereco_estado",
] as const;

describe("podePublicarLoja — gate D7 (matriz de condições)", () => {
  const LINHAS: Array<[string, string, Partial<Estado>]> = [
    ["nome nulo", "perfil", { nome: null }],
    ["nome só espaços", "perfil", { nome: "   " }],
    ["WhatsApp nulo", "perfil", { whatsapp: null }],
    ["WhatsApp vazio", "perfil", { whatsapp: "" }],
    ...CAMPOS.map((c): [string, string, Partial<Estado>] => [c, "endereco", { [c]: null } as Partial<Estado>]),
    ["latitude nula", "localizacao", { latitude: null }],
    ["longitude nula", "localizacao", { longitude: null }],
    ["0 produtos", "produto", { produtosDisponiveis: 0 }],
    ["0 formas", "pagamento", { formasPagamento: 0 }],
  ];

  it.each(LINHAS)("sem %s → pendência %s", (_rotulo, tipo, sobrescrita) => {
    const r = p.podePublicarLoja({ ...PRONTA, ...sobrescrita });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.pendencia.tipo).toBe(tipo);
  });

  it("tudo presente → { ok: true }", () => {
    expect(p.podePublicarLoja(PRONTA)).toEqual({ ok: true });
  });

  it("endereço incompleto e sem par → pendência 'endereco', não 'localizacao'", () => {
    const estado = { ...PRONTA, endereco_cidade: null, latitude: null, longitude: null };
    const r = p.podePublicarLoja(estado);
    expect(r).toEqual({ ok: false, pendencia: { tipo: "endereco", faltando: ["endereco_cidade"] } });
    expect(p.pendenciasPublicacao(estado).map((x) => x.tipo)).not.toContain("localizacao");
  });

  it("campo só com espaços conta como faltando", () => {
    expect(p.camposEnderecoFaltando({ ...ENDERECO, endereco_rua: "   " })).toEqual(["endereco_rua"]);
    const r = p.podePublicarLoja({ ...PRONTA, endereco_bairro: "  " });
    expect(r).toEqual({ ok: false, pendencia: { tipo: "endereco", faltando: ["endereco_bairro"] } });
  });

  it("pendenciasPublicacao devolve todas, na ordem perfil → endereco → localizacao → pagamento → produto", () => {
    expect(
      p
        .pendenciasPublicacao({
          ...PRONTA,
          whatsapp: null,
          endereco_numero: null,
          produtosDisponiveis: 0,
          formasPagamento: 0,
        })
        .map((x) => x.tipo),
    ).toEqual(["perfil", "endereco", "pagamento", "produto"]);
    expect(
      p
        .pendenciasPublicacao({ ...PRONTA, whatsapp: null, latitude: null, produtosDisponiveis: 0, formasPagamento: 0 })
        .map((x) => x.tipo),
    ).toEqual(["perfil", "localizacao", "pagamento", "produto"]);
    expect(p.pendenciasPublicacao(PRONTA)).toEqual([]);
  });
});

describe("mensagens do gate (D10)", () => {
  it("mensagem de endereço lista só os campos que faltam, com rótulo", () => {
    expect(p.mensagemEnderecoIncompleto(["endereco_cep", "endereco_numero"])).toBe(
      "Preencha CEP e número do endereço da loja antes de publicar.",
    );
    const tres = p.mensagemEnderecoIncompleto(["endereco_rua", "endereco_cidade", "endereco_estado"]);
    expect(tres).toBe("Preencha rua, cidade e UF do endereço da loja antes de publicar.");
    expect(tres).not.toMatch(/CEP|número|bairro/);
    expect(
      p.mensagemPendencia({ tipo: "endereco", faltando: ["endereco_bairro"] }),
    ).toBe(p.mensagemEnderecoIncompleto(["endereco_bairro"]));
    expect(p.ROTULOS_CAMPOS_ENDERECO).toEqual({
      endereco_cep: "CEP",
      endereco_rua: "rua",
      endereco_numero: "número",
      endereco_bairro: "bairro",
      endereco_cidade: "cidade",
      endereco_estado: "UF",
    });
  });

  it("mensagem de localização contém ROTULO_LOCALIZAR_DE_NOVO e não contém 'confira', 'corrija' nem 'errado'", () => {
    expect(p.ROTULO_LOCALIZAR_DE_NOVO).toBe("Localizar meu endereço de novo");
    expect(p.ERRO_SEM_LOCALIZACAO).toBe(
      "Toque em “Localizar meu endereço de novo” e tente publicar de novo em instantes.",
    );
    const msg = p.mensagemPendencia({ tipo: "localizacao" });
    expect(msg).toBe(p.ERRO_SEM_LOCALIZACAO);
    expect(msg).toContain(p.ROTULO_LOCALIZAR_DE_NOVO);
    expect(msg.toLowerCase()).not.toMatch(/confira|corrija|errado/);
  });

  it("contexto admin: (b) manda salvar o perfil, não cita o botão que o hub não tem", () => {
    const msg = publicacao.mensagemPendencia({ tipo: "localizacao" }, "admin");
    expect(msg).toBe(publicacao.ERRO_SEM_LOCALIZACAO_ADMIN);
    expect(msg).toContain("Salve o perfil de novo");
    expect(msg).not.toContain(p.ROTULO_LOCALIZAR_DE_NOVO);
    expect(msg.toLowerCase()).not.toMatch(/confira|corrija|errado/);
    expect(publicacao.mensagemPendencia({ tipo: "produto" }, "admin")).toBe(p.ERRO_SEM_PRODUTO);
  });

  it("mensagens de perfil, produto e pagamento: uma cada", () => {
    expect(p.ERRO_PERFIL_INCOMPLETO).toBe("Complete nome e WhatsApp antes de publicar a loja.");
    expect(p.ERRO_SEM_PAGAMENTO).toBe("Cadastre ao menos uma forma de pagamento antes de publicar a loja.");
    expect(p.ERRO_SEM_PRODUTO).toBe("Cadastre ao menos um produto disponível antes de publicar a loja.");
    expect(p.mensagemPendencia({ tipo: "perfil" })).toBe(p.ERRO_PERFIL_INCOMPLETO);
    expect(p.mensagemPendencia({ tipo: "pagamento" })).toBe(p.ERRO_SEM_PAGAMENTO);
    expect(p.mensagemPendencia({ tipo: "produto" })).toBe(p.ERRO_SEM_PRODUTO);
  });

  it("nenhuma mensagem começa com 'Sem' ou 'Caso não'", () => {
    const msgs = [
      p.mensagemPendencia({ tipo: "perfil" }),
      p.mensagemPendencia({ tipo: "endereco", faltando: [...CAMPOS] }),
      p.mensagemPendencia({ tipo: "endereco", faltando: ["endereco_cep"] }),
      p.mensagemPendencia({ tipo: "localizacao" }),
      p.mensagemPendencia({ tipo: "pagamento" }),
      p.mensagemPendencia({ tipo: "produto" }),
    ];
    for (const m of msgs) {
      expect(typeof m).toBe("string");
      expect(m.length).toBeGreaterThan(0);
      expect(m, m).not.toMatch(/^(Sem\b|Caso não)/i);
    }
  });
});

describe("paridade de lista de campos (DD1)", () => {
  it("paridade com schemaPerfil: CAMPOS_ENDERECO_LOJA = chaves endereco_* do shape, todas obrigatórias", () => {
    const doShape = Object.keys(schemaPerfil.shape).filter((k) => k.startsWith("endereco_"));
    expect([...p.CAMPOS_ENDERECO_LOJA].sort()).toEqual(doShape.sort());
    expect([...p.CAMPOS_ENDERECO_LOJA]).toEqual([...CAMPOS]);
    const shape = schemaPerfil.shape as unknown as Record<string, { safeParse: (v: unknown) => { success: boolean } }>;
    for (const k of p.CAMPOS_ENDERECO_LOJA) {
      expect(shape[k].safeParse(undefined).success, `${k} deveria ser obrigatório no schemaPerfil`).toBe(false);
    }
  });

  it("paridade com o geocoding: endereço completo ⇒ montarConsultaGeocoding não nula", () => {
    expect(p.camposEnderecoFaltando(ENDERECO)).toEqual([]);
    expect(montarConsultaGeocoding(ENDERECO)).not.toBeNull();
  });
});

describe("varianteAvisoEndereco — aviso persistente D15", () => {
  const PUBLICADA = { primeira_publicacao_em: "2026-01-01T00:00:00Z", ativo: true };

  it("marcador nulo → null", () => {
    expect(p.varianteAvisoEndereco({ primeira_publicacao_em: null, latitude: null, longitude: null })).toBeNull();
  });

  it("publicada e endereço incompleto → 'completar-endereco'", () => {
    expect(
      p.varianteAvisoEndereco({ ...PUBLICADA, ...ENDERECO, endereco_cep: null, latitude: -23.5, longitude: -46.6 }),
    ).toBe("completar-endereco");
  });

  it("publicada, completa, sem par → 'localizar-de-novo'", () => {
    expect(p.varianteAvisoEndereco({ ...PUBLICADA, ...ENDERECO, latitude: null, longitude: null })).toBe(
      "localizar-de-novo",
    );
  });

  it("publicada completa com par → null", () => {
    expect(p.varianteAvisoEndereco({ ...PUBLICADA, ...ENDERECO, latitude: -23.5, longitude: -46.6 })).toBeNull();
  });

  it("despublicada com marcador e sem par → 'localizar-de-novo' (D1)", () => {
    expect(
      p.varianteAvisoEndereco({ ...PUBLICADA, ativo: false, ...ENDERECO, latitude: -23.5, longitude: null }),
    ).toBe("localizar-de-novo");
  });
});
