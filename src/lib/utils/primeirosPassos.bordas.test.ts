import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  ETAPAS_ASSISTENTE,
  ROTA_PRIMEIROS_PASSOS,
  etapaDaPendencia,
  etapaDeRetomada,
  etapasComPendencia,
  rotaDaEtapa,
} from "./primeirosPassos";
import {
  pendenciasPublicacao,
  type EstadoProntidao,
  type PendenciaPublicacao,
} from "./publicacao";

/**
 * Issue 368 (P8) — bordas de etapas/retomada que o teste de contrato não cobre:
 * independência da ordem da lista, duplicatas, e a ligação REAL com
 * `pendenciasPublicacao` (a retomada nasce das pendências do gate, não de uma
 * lista paralela).
 */

const PERFIL: PendenciaPublicacao = { tipo: "perfil" };
const ENDERECO: PendenciaPublicacao = { tipo: "endereco", faltando: ["endereco_cep"] };
const LOCALIZACAO: PendenciaPublicacao = { tipo: "localizacao" };
const PAGAMENTO: PendenciaPublicacao = { tipo: "pagamento" };
const PRODUTO: PendenciaPublicacao = { tipo: "produto" };

function permutacoes<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) =>
    permutacoes([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]),
  );
}

const ENDERECO_COMPLETO = {
  endereco_cep: "01310-100",
  endereco_rua: "Avenida Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
};

function estado(extra: Partial<EstadoProntidao> = {}): EstadoProntidao {
  return {
    nome: "Loja Nova",
    whatsapp: "11999990000",
    ...ENDERECO_COMPLETO,
    latitude: -23.56,
    longitude: -46.65,
    produtosDisponiveis: 1,
    formasPagamento: 1,
    ...extra,
  } as EstadoProntidao;
}

describe("etapaDeRetomada — bordas", () => {
  it("o resultado não depende da ordem da lista (todas as permutações)", () => {
    const todas = [PERFIL, ENDERECO, LOCALIZACAO, PAGAMENTO, PRODUTO];
    for (const p of permutacoes(todas)) {
      expect(etapaDeRetomada(p)).toBe("perfil");
    }
    for (const p of permutacoes([LOCALIZACAO, PAGAMENTO, PRODUTO])) {
      expect(etapaDeRetomada(p)).toBe("pagamentos");
    }
  });

  it("pendências repetidas não mudam a retomada nem o conjunto", () => {
    expect(etapaDeRetomada([PRODUTO, PRODUTO, LOCALIZACAO, LOCALIZACAO])).toBe("produtos");
    expect([...etapasComPendencia([PERFIL, ENDERECO])]).toEqual(["perfil"]);
  });

  it("localizacao + pagamento → 'pagamentos' (revisar é a última etapa, nunca vence)", () => {
    expect(etapaDeRetomada([LOCALIZACAO, PAGAMENTO])).toBe("pagamentos");
  });

  it("não muta a lista recebida", () => {
    const lista = Object.freeze([PRODUTO, PERFIL]);
    expect(etapaDeRetomada(lista)).toBe("perfil");
    expect(lista).toEqual([PRODUTO, PERFIL]);
  });
});

describe("retomada ligada ao gate REAL (pendenciasPublicacao)", () => {
  it("loja vazia → perfil", () => {
    const vazia = estado({
      nome: "",
      whatsapp: null,
      endereco_cep: null,
      endereco_rua: null,
      endereco_numero: null,
      endereco_bairro: null,
      endereco_cidade: null,
      endereco_estado: null,
      latitude: null,
      longitude: null,
      produtosDisponiveis: 0,
      formasPagamento: 0,
    });
    expect(etapaDeRetomada(pendenciasPublicacao(vazia))).toBe("perfil");
  });

  it("endereço incompleto SUPRIME 'localizacao': a retomada fica em perfil, nunca em revisar", () => {
    const e = estado({ endereco_numero: "  ", latitude: null, longitude: null });
    const p = pendenciasPublicacao(e);
    expect(p.map((x) => x.tipo)).toEqual(["endereco"]);
    expect(etapaDeRetomada(p)).toBe("perfil");
  });

  it("só um lado do par de coordenadas → localizacao → revisar", () => {
    const e = estado({ latitude: -23.56, longitude: null });
    expect(etapaDeRetomada(pendenciasPublicacao(e))).toBe("revisar");
  });

  it("endereço e par ok, sem produto → produtos; tudo ok → revisar", () => {
    expect(etapaDeRetomada(pendenciasPublicacao(estado({ produtosDisponiveis: 0 })))).toBe(
      "produtos",
    );
    expect(etapaDeRetomada(pendenciasPublicacao(estado()))).toBe("revisar");
  });

  it("nome só com espaços conta como perfil pendente", () => {
    expect(etapaDeRetomada(pendenciasPublicacao(estado({ nome: "   " })))).toBe("perfil");
  });
});

describe("ETAPAS_ASSISTENTE — integridade", () => {
  it("toda etapa tem rota única sob ROTA_PRIMEIROS_PASSOS e uma page.tsx no disco", () => {
    const rotas = ETAPAS_ASSISTENTE.map((e) => rotaDaEtapa(e.etapa));
    expect(new Set(rotas).size).toBe(ETAPAS_ASSISTENTE.length);
    for (const e of ETAPAS_ASSISTENTE) {
      expect(rotaDaEtapa(e.etapa)).toBe(`${ROTA_PRIMEIROS_PASSOS}/${e.etapa}`);
      const page = join(
        process.cwd(),
        "src/app/(painel)/painel/primeiros-passos",
        e.etapa,
        "page.tsx",
      );
      expect(existsSync(page), `falta a page da etapa "${e.etapa}"`).toBe(true);
    }
  });

  it("toda pendência do gate cai numa etapa existente", () => {
    const etapas = new Set<string>(ETAPAS_ASSISTENTE.map((e) => e.etapa));
    for (const p of [PERFIL, ENDERECO, LOCALIZACAO, PAGAMENTO, PRODUTO]) {
      expect(etapas.has(etapaDaPendencia(p))).toBe(true);
    }
  });
});
