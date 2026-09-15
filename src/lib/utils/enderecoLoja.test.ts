/**
 * [197] Fase RED — endereço curto (RN-R1), adaptador do endereço do cliente
 * e montador do href do Google Maps (RN-R5/RN-R6).
 *
 * Alvo: `src/lib/utils/enderecoLoja.ts` — AINDA NÃO EXISTE. Estes testes
 * falham até a fase GREEN (`executar`) criar o módulo.
 *
 * Contrato esperado (spec `specs/retirada-endereco-da-loja.md` v0.3.0):
 *   formatarEnderecoLoja(loja: colunas endereco_* de lojas/vitrine_lojas): string | null
 *   formatarEnderecoCliente(endereco: unknown /* JSONB endereco_entrega *\/): string | null
 *   montarHrefMapsLoja(loja: colunas endereco_*): string | null
 *
 * Ambiente: vitest environment=node, módulo puro sem I/O.
 */

import { describe, it, expect } from "vitest";

import {
  formatarEnderecoLoja,
  formatarEnderecoCliente,
  montarHrefMapsLoja,
} from "./enderecoLoja";
import { montarConsultaGeocoding } from "@/lib/actions/patches-loja";

/** Origem do link do Maps — literal no código de produção (RN-R6). */
const ORIGEM_MAPS = "https://www.google.com/maps/search/?api=1&query=";

type ColunasEndereco = {
  endereco_rua?: string | null;
  endereco_numero?: string | null;
  endereco_bairro?: string | null;
  endereco_cidade?: string | null;
  endereco_estado?: string | null;
  endereco_cep?: string | null;
};

function loja(overrides: ColunasEndereco = {}): ColunasEndereco {
  return {
    endereco_rua: "Rua das Flores",
    endereco_numero: "100",
    endereco_bairro: "Centro",
    endereco_cidade: "Campinas",
    endereco_estado: "SP",
    endereco_cep: "13010-000",
    ...overrides,
  };
}

const VAZIOS: Array<[string, string | null]> = [
  ["null", null],
  ["string vazia", ""],
  ["só espaços", "   "],
];

// ---------------------------------------------------------------------------
// RN-R1 — formato curto `{rua}, {numero} · {bairro}` (endereço da LOJA)
// ---------------------------------------------------------------------------

describe("[197] RN-R1 formatarEnderecoLoja — formato curto", () => {
  it("todas as partes presentes → 'rua, numero · bairro'", () => {
    expect(formatarEnderecoLoja(loja())).toBe("Rua das Flores, 100 · Centro");
  });

  it("nunca inclui cidade, estado nem CEP (RN-R1 encurtada em 2026-09-15)", () => {
    const texto = formatarEnderecoLoja(loja());
    expect(texto).not.toContain("Campinas");
    expect(texto).not.toContain("SP");
    expect(texto).not.toContain("13010-000");
    expect(texto).not.toContain("CEP");
  });

  it("sem número → 'rua · bairro', sem vírgula órfã", () => {
    const texto = formatarEnderecoLoja(loja({ endereco_numero: null }));
    expect(texto).toBe("Rua das Flores · Centro");
    expect(texto).not.toContain(", ·");
    expect(texto).not.toMatch(/,\s*$/);
  });

  it("sem bairro → 'rua, numero', sem separador '·' órfão", () => {
    const texto = formatarEnderecoLoja(loja({ endereco_bairro: null }));
    expect(texto).toBe("Rua das Flores, 100");
    expect(texto).not.toContain("·");
  });

  it("sem rua → 'numero · bairro', sem vírgula na frente", () => {
    const texto = formatarEnderecoLoja(loja({ endereco_rua: null }));
    expect(texto).toBe("100 · Centro");
    expect(texto).not.toMatch(/^[,·\s]/);
  });

  it("só bairro preenchido → 'bairro', sem separador nenhum", () => {
    const texto = formatarEnderecoLoja(
      loja({ endereco_rua: null, endereco_numero: null }),
    );
    expect(texto).toBe("Centro");
    expect(texto).not.toContain("·");
    expect(texto).not.toContain(",");
  });

  it("só rua preenchida → 'rua', sem separador nenhum", () => {
    const texto = formatarEnderecoLoja(
      loja({ endereco_numero: null, endereco_bairro: null }),
    );
    expect(texto).toBe("Rua das Flores");
    expect(texto).not.toContain("·");
    expect(texto).not.toContain(",");
  });

  it("aplica trim em cada parte", () => {
    expect(
      formatarEnderecoLoja(
        loja({
          endereco_rua: "  Rua das Flores  ",
          endereco_numero: " 100 ",
          endereco_bairro: "  Centro ",
        }),
      ),
    ).toBe("Rua das Flores, 100 · Centro");
  });

  it.each(VAZIOS)(
    "rua/numero/bairro todos %s → null (RN-R5: nunca '—', nunca string vazia)",
    (_rotulo, valor) => {
      expect(
        formatarEnderecoLoja(
          loja({
            endereco_rua: valor,
            endereco_numero: valor,
            endereco_bairro: valor,
          }),
        ),
      ).toBeNull();
    },
  );

  it("cidade/estado/CEP preenchidos não salvam um endereço sem rua/numero/bairro → null", () => {
    expect(
      formatarEnderecoLoja({
        endereco_rua: null,
        endereco_numero: null,
        endereco_bairro: null,
        endereco_cidade: "Campinas",
        endereco_estado: "SP",
        endereco_cep: "13010-000",
      }),
    ).toBeNull();
  });

  it("objeto totalmente vazio → null", () => {
    expect(formatarEnderecoLoja({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RN-R1 — mesmo formato curto para o endereço do CLIENTE (JSONB endereco_entrega).
// Substitui as duas cópias de `formatarEndereco` (whatsappPedido.ts:33 e
// confirmacao/page.tsx:60), que hoje emitem cidade, estado e CEP.
// ---------------------------------------------------------------------------

describe("[197] RN-R1 formatarEnderecoCliente — adaptador do JSONB endereco_entrega", () => {
  const CLIENTE = {
    rua: "Rua das Flores",
    numero: "100",
    bairro: "Centro",
    cidade: "Campinas",
    estado: "SP",
    cep: "13010-000",
  };

  it("mesmo formato curto do endereço da loja", () => {
    expect(formatarEnderecoCliente(CLIENTE)).toBe(
      "Rua das Flores, 100 · Centro",
    );
  });

  it("não emite cidade, estado nem CEP (pedido literal do dono, item 2)", () => {
    const texto = formatarEnderecoCliente(CLIENTE);
    expect(texto).not.toContain("Campinas");
    expect(texto).not.toContain("SP");
    expect(texto).not.toContain("13010-000");
    expect(texto).not.toContain("CEP");
  });

  it("paridade: mesmo endereço nos dois shapes produz a MESMA string (RN-R2 fonte única)", () => {
    expect(formatarEnderecoCliente(CLIENTE)).toBe(formatarEnderecoLoja(loja()));
  });

  it("sem bairro → 'rua, numero', sem '·' órfão", () => {
    expect(
      formatarEnderecoCliente({ ...CLIENTE, bairro: "   " }),
    ).toBe("Rua das Flores, 100");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string", "Rua das Flores, 100"],
    ["número", 42],
    ["array", []],
  ])("JSONB %s (não-objeto) → null", (_rotulo, valor) => {
    expect(formatarEnderecoCliente(valor)).toBeNull();
  });

  it("objeto com todas as partes vazias → null (nunca '—')", () => {
    expect(
      formatarEnderecoCliente({ rua: "", numero: "  ", bairro: null }),
    ).toBeNull();
  });

  it("ignora chaves desconhecidas do JSONB livre", () => {
    expect(
      formatarEnderecoCliente({
        ...CLIENTE,
        complemento: "fundos",
        referencia: "ao lado da praça",
      }),
    ).toBe("Rua das Flores, 100 · Centro");
  });
});

// ---------------------------------------------------------------------------
// RN-R6 — href do Google Maps: origem literal, consulta via montarConsultaGeocoding
// ---------------------------------------------------------------------------

describe("[197] RN-R6 montarHrefMapsLoja — origem literal + consulta codificada", () => {
  it("usa exatamente a origem oficial, literal no código", () => {
    expect(montarHrefMapsLoja(loja())!.startsWith(ORIGEM_MAPS)).toBe(true);
  });

  it("a consulta é exatamente montarConsultaGeocoding do endereço (RN-R6, reuso)", () => {
    const href = montarHrefMapsLoja(loja())!;
    const consulta = new URL(href).searchParams.get("query");
    expect(consulta).toBe(montarConsultaGeocoding(loja()));
    expect(consulta).toBe("Rua das Flores, 100, Centro, Campinas - SP, Brasil");
  });

  it("🛑 o CEP NÃO aparece na consulta (issues 185/186 — token envenenador)", () => {
    const href = montarHrefMapsLoja(
      loja({ endereco_cep: "12914-190" }),
    )!;
    expect(href).not.toContain("12914");
    expect(href).not.toContain("CEP");
    expect(new URL(href).searchParams.get("query")).not.toContain("12914-190");
  });

  it("sem cidade → null (RN-R5: sem âncora geográfica, sem link)", () => {
    expect(montarHrefMapsLoja(loja({ endereco_cidade: null }))).toBeNull();
    expect(montarHrefMapsLoja(loja({ endereco_cidade: "   " }))).toBeNull();
  });

  it("sem estado → null (RN-R5)", () => {
    expect(montarHrefMapsLoja(loja({ endereco_estado: null }))).toBeNull();
    expect(montarHrefMapsLoja(loja({ endereco_estado: "  " }))).toBeNull();
  });

  it("sem cidade nem estado → null", () => {
    expect(
      montarHrefMapsLoja(
        loja({ endereco_cidade: null, endereco_estado: null }),
      ),
    ).toBeNull();
  });

  it("endereço com &, #, espaço e acento não quebra o link (encodeURIComponent)", () => {
    const href = montarHrefMapsLoja(
      loja({
        endereco_rua: "Av. Ponte & Praça #7",
        endereco_bairro: "Jardim São João",
      }),
    )!;
    // A URL continua parseável e tem um único '?': nada escapou para a
    // estrutura da URL.
    expect(() => new URL(href)).not.toThrow();
    expect(href.split("?").length).toBe(2);
    // O '&' do endereço NÃO virou separador de parâmetro.
    const url = new URL(href);
    expect([...url.searchParams.keys()].sort()).toEqual(["api", "query"]);
    expect(url.searchParams.get("query")).toContain("Av. Ponte & Praça #7");
    expect(url.searchParams.get("query")).toContain("Jardim São João");
    // Codificado na string crua — nunca cru.
    expect(href).not.toContain("Praça #7");
    expect(href).toContain("%26"); // &
    expect(href).toContain("%23"); // #
  });

  it("esquema e domínio nunca vêm do banco (tentativa de javascript: no campo de rua)", () => {
    const href = montarHrefMapsLoja(
      loja({ endereco_rua: "javascript:alert(1)//" }),
    )!;
    expect(href.startsWith(ORIGEM_MAPS)).toBe(true);
    expect(href).not.toContain("javascript:alert");
    expect(new URL(href).protocol).toBe("https:");
    expect(new URL(href).hostname).toBe("www.google.com");
  });

  it("🔴 a consulta não carrega nada de searchParams da confirmação (token/pedido)", () => {
    // Objeto poluído com as chaves da rota `/confirmacao?pedido=...&token=...`:
    // o montador só pode ler colunas endereco_*.
    const poluido = {
      ...loja(),
      token: "tok-secreto-do-pedido",
      pedido: "11111111-1111-1111-1111-111111111111",
      token_acesso: "tok-secreto-do-pedido",
    };
    const href = montarHrefMapsLoja(poluido)!;
    expect(href).not.toContain("tok-secreto-do-pedido");
    expect(href).not.toContain("11111111");
    expect(href.toLowerCase()).not.toContain("token");
    expect(href.toLowerCase()).not.toContain("pedido");
  });
});
