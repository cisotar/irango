/**
 * RED — re-auditoria de segurança da 180-B, achado MÉDIA A (2ª parte).
 *
 * O modal do painel (`PerfilClient`) tratava só `transitorio` e `esgotado`; os
 * motivos introduzidos pela correção do achado 2/3 (`throttle_interno` e
 * `indisponivel_config`) caíam no `else` genérico — *"Não localizamos seu
 * endereço no mapa — confira rua, número e CEP"* — culpando o LOJISTA por uma
 * falha NOSSA (nosso balde de burst / nossa env var ausente). É o mesmo erro de
 * atribuição de culpa que a 180-B acabou de eliminar do lado do comprador.
 *
 * A seleção de mensagem vira função PURA para ser testável sem DOM (o repo não
 * tem jsdom — ver PerfilClient.test.tsx), mesmo molde de `montarPayloadPerfil`.
 */

import { describe, it, expect } from "vitest";

import { avisoGeocodingPerfil } from "./avisoGeocoding";

/** Trecho que culpa o lojista — proibido quando a falha é NOSSA. */
const CULPA_O_LOJISTA = "confira rua, número e CEP";

describe("[re-auditoria 180-B / MÉDIA A] avisoGeocodingPerfil não culpa o lojista por falha nossa", () => {
  it("throttle_interno tem texto PRÓPRIO e NÃO manda conferir o endereço", () => {
    const texto = avisoGeocodingPerfil("throttle_interno");
    expect(texto).not.toContain(CULPA_O_LOJISTA);
    expect(texto).not.toBe(avisoGeocodingPerfil(undefined));
    // Throttle nosso passa em instantes: o lojista pode re-salvar.
    expect(texto.toLowerCase()).toContain("instantes");
  });

  it("indisponivel_config tem texto PRÓPRIO e NÃO manda conferir o endereço", () => {
    const texto = avisoGeocodingPerfil("indisponivel_config");
    expect(texto).not.toContain(CULPA_O_LOJISTA);
    expect(texto).not.toBe(avisoGeocodingPerfil(undefined));
    expect(texto).not.toBe(avisoGeocodingPerfil("throttle_interno"));
  });

  it("os dois motivos confirmam que o endereço FOI salvo (só as zonas por raio ficam pendentes)", () => {
    for (const motivo of ["throttle_interno", "indisponivel_config"] as const) {
      expect(avisoGeocodingPerfil(motivo)).toContain("salvo");
      expect(avisoGeocodingPerfil(motivo)).toContain("raio");
    }
  });

  // ── não-regressão dos ramos que já existiam ────────────────────────────────
  it("transitorio segue pedindo re-salvar em instantes, sem culpar o endereço", () => {
    const texto = avisoGeocodingPerfil("transitorio");
    expect(texto).not.toContain(CULPA_O_LOJISTA);
    expect(texto.toLowerCase()).toContain("instantes");
  });

  it("esgotado_global (orçamento do serviço de mapas) segue com texto de falha NOSSA", () => {
    const texto = avisoGeocodingPerfil("esgotado_global");
    expect(texto).not.toContain(CULPA_O_LOJISTA);
    expect(texto).toContain("serviço de mapas");
  });

  it("nao_encontrado/cep_inexistente/sem motivo → aí SIM pede conferir o endereço", () => {
    for (const motivo of [undefined, "nao_encontrado", "cep_inexistente"] as const) {
      expect(avisoGeocodingPerfil(motivo)).toContain(CULPA_O_LOJISTA);
    }
  });
});
