import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NavegacaoEtapas } from "./NavegacaoEtapas";
import { ETAPAS_ASSISTENTE, rotaDaEtapa } from "@/lib/utils/primeirosPassos";

/**
 * Issue 368 (P8) — "Voltar"/"Próximo" do assistente: cada etapa aponta para as
 * vizinhas certas, as pontas não têm link para fora da sequência e "opcionais"
 * vira "Pular para revisar".
 */

function hrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

describe("NavegacaoEtapas", () => {
  it("cada etapa do meio linka a anterior (Voltar) e a seguinte (Próximo: rótulo)", () => {
    for (let i = 1; i < ETAPAS_ASSISTENTE.length - 1; i++) {
      const ant = ETAPAS_ASSISTENTE[i - 1];
      const seg = ETAPAS_ASSISTENTE[i + 1];
      const m = renderToStaticMarkup(<NavegacaoEtapas etapa={ETAPAS_ASSISTENTE[i].etapa} />);
      expect(hrefs(m), ETAPAS_ASSISTENTE[i].etapa).toEqual([
        rotaDaEtapa(ant.etapa),
        rotaDaEtapa(seg.etapa),
      ]);
      expect(m).toContain("Voltar");
      if (seg.etapa !== "revisar") expect(m).toContain(`Próximo: ${seg.rotulo}`);
    }
  });

  it("primeira etapa (perfil): sem Voltar, só o avanço para horários", () => {
    const m = renderToStaticMarkup(<NavegacaoEtapas etapa="perfil" />);
    expect(m).not.toContain("Voltar");
    expect(hrefs(m)).toEqual([rotaDaEtapa("horarios")]);
    expect(m).toContain("Próximo: Horários");
  });

  it("'opcionais' vira 'Pular para revisar' e leva a /revisar; Voltar leva a produtos", () => {
    const m = renderToStaticMarkup(<NavegacaoEtapas etapa="opcionais" />);
    expect(m).toContain("Pular para revisar");
    expect(m).not.toContain("Próximo:");
    expect(hrefs(m)).toEqual([rotaDaEtapa("produtos"), rotaDaEtapa("revisar")]);
    expect(m).toContain("Adicione opcionais agora ou depois");
  });

  it("'produtos' avança para opcionais (não pula direto para revisar)", () => {
    const m = renderToStaticMarkup(<NavegacaoEtapas etapa="produtos" />);
    expect(m).toContain("Próximo: Opcionais");
    expect(m).not.toContain("Pular");
  });

  it("última etapa (revisar): só Voltar, nunca avanço", () => {
    const m = renderToStaticMarkup(<NavegacaoEtapas etapa="revisar" />);
    expect(hrefs(m)).toEqual([rotaDaEtapa("opcionais")]);
    expect(m).not.toContain("Próximo");
  });

  it("nunca há botão primário: navegar não salva (o Salvar da tela é o primário)", () => {
    for (const e of ETAPAS_ASSISTENTE) {
      const m = renderToStaticMarkup(<NavegacaoEtapas etapa={e.etapa} />);
      expect(m).not.toContain("bg-primary");
    }
  });
});
