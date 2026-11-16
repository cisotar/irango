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
    expect(texto).not.toBe(avisoGeocodingPerfil("nao_encontrado"));
    // Throttle nosso passa em instantes: o lojista pode re-salvar.
    expect(texto.toLowerCase()).toContain("instantes");
  });

  it("indisponivel_config tem texto PRÓPRIO e NÃO manda conferir o endereço", () => {
    const texto = avisoGeocodingPerfil("indisponivel_config");
    expect(texto).not.toContain(CULPA_O_LOJISTA);
    expect(texto).not.toBe(avisoGeocodingPerfil("nao_encontrado"));
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

  // Issue 368 (DD8): `undefined` saiu do tipo — sem motivo, o cliente cai em
  // "transitorio" e nunca culpa o dado do lojista.
  it("nao_encontrado/cep_inexistente → aí SIM pede conferir o endereço", () => {
    for (const motivo of ["nao_encontrado", "cep_inexistente"] as const) {
      expect(avisoGeocodingPerfil(motivo)).toContain(CULPA_O_LOJISTA);
    }
  });
});

// ── Issue 368 (RED) — DD9: texto do botão "Localizar meu endereço de novo" ────
// O botão D14 não salva nada: os textos de `acao: "localizar"` não podem falar
// em salvar nem afirmar que o endereço "foi salvo". Falha nossa nunca manda
// conferir o endereço; dado do lojista (nao_encontrado/cep_inexistente) manda.
type Motivo = Exclude<Parameters<typeof avisoGeocodingPerfil>[0], undefined>;
const avisoCom = avisoGeocodingPerfil as unknown as (m: Motivo, acao?: "salvar" | "localizar") => string;

const TODOS: Motivo[] = [
  "nao_encontrado",
  "transitorio",
  "esgotado_global",
  "esgotado_ip",
  "cep_inexistente",
  "throttle_interno",
  "indisponivel_config",
];
const FALHA_NOSSA: Motivo[] = ["transitorio", "throttle_interno", "indisponivel_config", "esgotado_global", "esgotado_ip"];

describe("avisoGeocodingPerfil — acao 'localizar' (issue 368, DD9)", () => {
  it("acao 'localizar': nenhum texto contém 'salvar'", () => {
    for (const motivo of TODOS) {
      const texto = avisoCom(motivo, "localizar");
      expect(texto.length, motivo).toBeGreaterThan(0);
      expect(texto.toLowerCase(), motivo).not.toMatch(/salv/);
    }
  });

  it("acao 'localizar' + falha nossa não manda conferir", () => {
    for (const motivo of FALHA_NOSSA) {
      const texto = avisoCom(motivo, "localizar");
      expect(texto.toLowerCase(), motivo).not.toContain("confira");
      expect(texto, motivo).not.toBe(avisoCom(motivo, "salvar"));
    }
  });

  it("acao 'localizar' + nao_encontrado/cep_inexistente pede conferir", () => {
    for (const motivo of ["nao_encontrado", "cep_inexistente"] as const) {
      expect(avisoCom(motivo, "localizar").toLowerCase(), motivo).toContain("confira");
    }
  });

  it("acao omitida = 'salvar' (textos atuais intactos)", () => {
    const ATUAIS: Record<string, string> = {
      transitorio:
        "Não conseguimos localizar seu endereço agora. Tente salvar novamente em instantes para ativar as zonas por raio.",
      throttle_interno:
        "Muitas consultas ao mapa ao mesmo tempo por aqui. Seu endereço foi salvo; tente salvar novamente em instantes para ativar as zonas por raio.",
      indisponivel_config:
        "Nosso serviço de mapas está com um problema de configuração e nossa equipe já foi avisada. Seu endereço foi salvo; tente novamente mais tarde para ativar as zonas por raio.",
      esgotado_global:
        "O serviço de mapas está indisponível no momento. Seu endereço foi salvo; tente salvar novamente mais tarde para ativar as zonas por raio.",
      esgotado_ip:
        "O serviço de mapas está indisponível no momento. Seu endereço foi salvo; tente salvar novamente mais tarde para ativar as zonas por raio.",
      nao_encontrado:
        "Não localizamos seu endereço no mapa — confira rua, número e CEP. Zonas por raio ficam inativas até corrigir.",
      cep_inexistente:
        "Não localizamos seu endereço no mapa — confira rua, número e CEP. Zonas por raio ficam inativas até corrigir.",
    };
    for (const motivo of TODOS) {
      expect(avisoGeocodingPerfil(motivo), motivo).toBe(ATUAIS[motivo]);
      expect(avisoCom(motivo, "salvar"), motivo).toBe(ATUAIS[motivo]);
    }
  });
});
