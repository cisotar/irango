import { describe, it, expect } from "vitest";

import * as primeirosPassos from "./primeirosPassos";
import type { PendenciaPublicacao } from "./publicacao";

/**
 * Issue 368 — etapas e retomada do assistente (D6).
 *
 * Retomada = etapa de MENOR índice em ETAPAS_ASSISTENTE entre as etapas das
 * pendências do gate (`etapaDaPendencia`); sem pendência → "revisar".
 * perfil|endereco → "perfil"; localizacao → "revisar" (onde está o botão D14);
 * pagamento → "pagamentos"; produto → "produtos". Horários, entregas e
 * opcionais nunca são retomada (não entram no gate).
 */

// `as const` estreita cada etapa; o teste lê `podePular` em todas.
const mod = async () => ({
  ...primeirosPassos,
  ETAPAS_ASSISTENTE: primeirosPassos.ETAPAS_ASSISTENTE as ReadonlyArray<{
    etapa: primeirosPassos.EtapaAssistente;
    rotulo: string;
    podePular?: boolean;
  }>,
});
type Pendencia = PendenciaPublicacao;

const PERFIL: Pendencia = { tipo: "perfil" };
const ENDERECO: Pendencia = { tipo: "endereco", faltando: ["endereco_cep"] };
const LOCALIZACAO: Pendencia = { tipo: "localizacao" };
const PAGAMENTO: Pendencia = { tipo: "pagamento" };
const PRODUTO: Pendencia = { tipo: "produto" };

describe("primeirosPassos (issue 368)", () => {
  it("ETAPAS_ASSISTENTE segue a ordem de D6", async () => {
    const { ETAPAS_ASSISTENTE, ROTA_PRIMEIROS_PASSOS } = await mod();
    expect(ROTA_PRIMEIROS_PASSOS).toBe("/painel/primeiros-passos");
    expect(ETAPAS_ASSISTENTE.map((e) => e.etapa)).toEqual([
      "perfil",
      "horarios",
      "entregas",
      "pagamentos",
      "produtos",
      "opcionais",
      "revisar",
    ]);
    expect(ETAPAS_ASSISTENTE.filter((e) => e.podePular).map((e) => e.etapa)).toEqual(["opcionais"]);
  });

  it("sem pendência → 'revisar'", async () => {
    expect((await mod()).etapaDeRetomada([])).toBe("revisar");
  });

  it("perfil → 'perfil'", async () => {
    expect((await mod()).etapaDeRetomada([PERFIL, PAGAMENTO, PRODUTO])).toBe("perfil");
  });

  it("endereco → 'perfil'", async () => {
    const m = await mod();
    expect(m.etapaDaPendencia(ENDERECO)).toBe("perfil");
    expect(m.etapaDeRetomada([ENDERECO, PRODUTO])).toBe("perfil");
  });

  it("localizacao sozinha → 'revisar'", async () => {
    const m = await mod();
    expect(m.etapaDaPendencia(LOCALIZACAO)).toBe("revisar");
    expect(m.etapaDeRetomada([LOCALIZACAO])).toBe("revisar");
  });

  it("pagamento + produto → 'pagamentos'", async () => {
    expect((await mod()).etapaDeRetomada([PAGAMENTO, PRODUTO])).toBe("pagamentos");
  });

  it("só produto → 'produtos'", async () => {
    expect((await mod()).etapaDeRetomada([PRODUTO])).toBe("produtos");
  });

  it("localizacao + produto → 'produtos' (menor índice, não a ordem da lista)", async () => {
    expect((await mod()).etapaDeRetomada([LOCALIZACAO, PRODUTO])).toBe("produtos");
  });

  it("horarios, entregas e opcionais nunca são retomada", async () => {
    const m = await mod();
    const todas = [PERFIL, ENDERECO, LOCALIZACAO, PAGAMENTO, PRODUTO];
    const etapas = m.etapasComPendencia(todas);
    for (const nunca of ["horarios", "entregas", "opcionais"] as const) {
      expect(etapas.has(nunca)).toBe(false);
    }
    expect([...etapas].sort()).toEqual(["pagamentos", "perfil", "produtos", "revisar"]);
  });

  it("rotaDaEtapa('perfil') === '/painel/primeiros-passos/perfil'", async () => {
    const m = await mod();
    expect(m.rotaDaEtapa("perfil")).toBe("/painel/primeiros-passos/perfil");
    expect(m.rotaDaEtapa("revisar")).toBe("/painel/primeiros-passos/revisar");
  });
});
