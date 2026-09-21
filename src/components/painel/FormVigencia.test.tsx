/**
 * [257][258][259] Markup do `FormVigencia` e do `PreviewVigencia`.
 *
 * Ambiente: vitest environment=node — sem jsdom. `renderToStaticMarkup`, o
 * mesmo padrão de `CuponsClient.test.tsx`. O que um clique produz não é
 * observável aqui; o que É observável — e é o que estas issues prometem — é o
 * que existe no DOM de saída: os alvos de 44px literais, a ausência de campo
 * de fim sob preset, e a linha "Agora:" só na configuração salva.
 *
 * A lógica que o clique dispara está travada em `rascunhoCardapio.test.ts`,
 * que é puro.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { FormVigencia } from "./FormVigencia";
import { PreviewVigencia } from "./PreviewVigencia";
import type { CardapioVigencia } from "@/lib/utils/vigenciaCardapio";

const SP = "America/Sao_Paulo";
const FUSO = "America/Sao_Paulo (GMT-3)";

function montar(
  cardapio: CardapioVigencia | null,
  linhaAgora: string | null = null,
): string {
  return renderToStaticMarkup(
    <FormVigencia
      cardapio={cardapio}
      timezone={SP}
      fusoRotulo={FUSO}
      agoraLocal="2026-09-19T13:04"
      linhaAgora={linhaAgora}
      salvar={vi.fn(async () => ({ ok: true }) as const)}
      voltarHref="/painel/cardapios"
    />,
  );
}

function recorrente(over: Partial<CardapioVigencia> = {}): CardapioVigencia {
  return {
    id: "c1",
    nome: "Feijoada",
    ativo: true,
    modo: "recorrente",
    dias_semana: [6],
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    prazo_inicio: null,
    prazo_fim: null,
    ...over,
  };
}

describe("FormVigencia — modo Repete sempre (257)", () => {
  it("fala vocabulário de lojista, nunca 'recorrente'/'prazo fixo'", () => {
    const html = montar(null);
    expect(html).toContain("Repete sempre");
    expect(html).toContain("Período com data de fim");
    expect(html).toContain("Ao salvar, vale só o modo selecionado.");
    expect(html).not.toContain(">recorrente<");
    expect(html).not.toContain("prazo fixo");
  });

  it("diz ANTES que eixo vazio é sem restrição", () => {
    const html = montar(null);
    expect(html).toContain("Nenhum dia marcado = todos os dias.");
    expect(html).toContain("Sem horário marcado, o cardápio aparece o dia inteiro.");
  });

  it("os sete dias são toggles com aria-pressed dentro de um role=group", () => {
    const html = montar(recorrente());
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    // grid-cols-4 no mobile: sete alvos de 44px não cabem em 360px.
    expect(html).toContain("grid-cols-4");
    expect(html).toContain("sm:grid-cols-7");
  });

  it("dias do mês nasce FECHADO quando não há dia do mês marcado", () => {
    expect(montar(recorrente())).toContain("Escolher dias do mês");
  });

  it("dias do mês nasce ABERTO quando o cardápio salvo já usa o eixo", () => {
    const html = montar(recorrente({ dias_mes: [1, 15] }));
    expect(html).not.toContain("Escolher dias do mês");
    expect(html).toContain("grid-cols-7");
  });

  it("a nota do dia 31 só aparece quando 31 está marcado", () => {
    const nota = "O dia 31 não existe em todo mês";
    expect(montar(recorrente({ dias_mes: [1, 15] }))).not.toContain(nota);
    expect(montar(recorrente({ dias_mes: [31] }))).toContain(nota);
  });
});

describe("FormVigencia — modo Período com data de fim (258)", () => {
  const comPreset = recorrente({
    modo: "prazo_fixo",
    dias_semana: null,
    prazo_inicio: "2026-09-19T14:00:00Z",
    prazo_fim: "2026-09-26T14:00:00Z",
  });

  it("os quatro chips são os quatro presets, em português de lojista", () => {
    const html = montar(comPreset);
    for (const rotulo of ["1 dia", "7 dias", "1 mês", "Escolher as datas"]) {
      expect(html).toContain(rotulo);
    }
    // Nunca o literal do schema na tela.
    expect(html).not.toContain(">diario<");
    expect(html).not.toContain(">mensal<");
  });

  it("com preset NÃO existe campo editável de fim no DOM", () => {
    const html = montar(comPreset);
    expect(html).not.toContain('aria-label="Data de fim"');
    expect(html).toContain("Termina em");
    // O fim exibido sai de `calcularFimDoPreset`, a mesma do servidor.
    expect(html).toContain("26/09/2026, 11:00");
  });

  it("o fuso da loja é nomeado ao lado das datas", () => {
    expect(montar(comPreset)).toContain(`Fuso da loja: ${FUSO}`);
  });
});

describe("PreviewVigencia — a frase é a interface (259)", () => {
  it("renderiza a frase pronta e o fuso nomeado, com aria-live polite", () => {
    const html = renderToStaticMarkup(
      <PreviewVigencia
        frase="Aparece todo sábado e domingo, das 11:00 às 15:00."
        fusoRotulo="America/Sao_Paulo"
      />,
    );
    expect(html).toContain("Aparece todo sábado e domingo, das 11:00 às 15:00.");
    expect(html).toContain("Fuso da loja: America/Sao_Paulo");
    expect(html).toContain('aria-live="polite"');
  });

  it("a linha 'Agora:' não aparece sem configuração salva", () => {
    const html = renderToStaticMarkup(
      <PreviewVigencia frase="Aparece todo dia." fusoRotulo="America/Manaus" />,
    );
    expect(html).not.toContain("Agora (");
  });

  it("a linha 'Agora:' aparece quando o servidor a manda", () => {
    const html = renderToStaticMarkup(
      <PreviewVigencia
        frase="Aparece todo dia."
        fusoRotulo="America/Manaus"
        linhaAgora="Agora (sáb, 19/09, 13:04): APARECENDO"
      />,
    );
    expect(html).toContain("Agora (sáb, 19/09, 13:04): APARECENDO");
  });

  it("o form salvo mostra a linha do servidor; o form de criação, não", () => {
    const linha = "Agora (sáb, 19/09, 13:04): APARECENDO";
    expect(montar(recorrente(), linha)).toContain(linha);
    expect(montar(null, null)).not.toContain("Agora (");
  });
});
