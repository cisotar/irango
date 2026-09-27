import { describe, expect, it } from "vitest";

import type { ProdutoModalDados } from "@/components/vitrine/ProdutoModal";
import type { MensagemModalValidada } from "@/lib/validacoes/mensagemModal";

import { montarModalSazonal, type ModalAtivoParaVitrine } from "./montarModalSazonal";

/** [314] RN-M01 (abertura por ativo + janela) e RN-M07 (supressão derivada). */

const AGORA = new Date("2026-10-05T12:00:00-03:00");

function modal(over: Partial<ModalAtivoParaVitrine> = {}): ModalAtivoParaVitrine {
  return {
    titulo: "Festival de Inverno",
    exibicao_inicio: "2026-10-01T00:00:00-03:00",
    exibicao_fim: "2026-10-16T00:00:00-03:00",
    mostrar_promocoes_junto: false,
    ...over,
  };
}

const MENSAGEM = {
  versao: 1,
  paragrafos: [{ trechos: [{ texto: "Venha provar" }] }],
} as unknown as MensagemModalValidada;

const PRATO = { id: "p1", nome: "Caldo verde" } as unknown as ProdutoModalDados;

describe("montarModalSazonal — RN-M01: ativo + janela, e só isso", () => {
  const tabela: {
    caso: string;
    mensagem: MensagemModalValidada | null;
    produtos: ProdutoModalDados[];
  }[] = [
    { caso: "sem mensagem, sem pratos → só o título", mensagem: null, produtos: [] },
    { caso: "com mensagem, sem pratos → título + mensagem", mensagem: MENSAGEM, produtos: [] },
    { caso: "sem mensagem, com pratos → título + pratos", mensagem: null, produtos: [PRATO] },
    { caso: "com mensagem e pratos → tudo", mensagem: MENSAGEM, produtos: [PRATO] },
  ];

  it.each(tabela)("$caso", ({ mensagem, produtos }) => {
    const r = montarModalSazonal({ modalAtivo: modal(), agora: AGORA, produtos, mensagem });
    expect(r.modalSazonal).toEqual({ titulo: "Festival de Inverno", mensagem, produtos });
  });

  it("sem modal ativo: nada abre e nada é suprimido", () => {
    const r = montarModalSazonal({ modalAtivo: null, agora: AGORA, produtos: [PRATO], mensagem: MENSAGEM });
    expect(r).toEqual({ modalSazonal: null, suprimirPromocoes: false });
  });

  it("antes do início da janela: não abre", () => {
    const r = montarModalSazonal({
      modalAtivo: modal({ exibicao_inicio: "2026-10-06T00:00:00-03:00" }),
      agora: AGORA,
      produtos: [PRATO],
      mensagem: MENSAGEM,
    });
    expect(r).toEqual({ modalSazonal: null, suprimirPromocoes: false });
  });

  it("fim da janela é exclusivo: no instante do fim, não abre", () => {
    const r = montarModalSazonal({
      modalAtivo: modal({ exibicao_fim: "2026-10-05T12:00:00-03:00" }),
      agora: AGORA,
      produtos: [],
      mensagem: null,
    });
    expect(r).toEqual({ modalSazonal: null, suprimirPromocoes: false });
  });
});

describe("montarModalSazonal — RN-M07: supressão só quando o sazonal desce", () => {
  it("modal no ar sem 'mostrar promoções junto' suprime", () => {
    const r = montarModalSazonal({ modalAtivo: modal(), agora: AGORA, produtos: [], mensagem: null });
    expect(r.suprimirPromocoes).toBe(true);
  });

  it("modal no ar com 'mostrar promoções junto' não suprime", () => {
    const r = montarModalSazonal({
      modalAtivo: modal({ mostrar_promocoes_junto: true }),
      agora: AGORA,
      produtos: [],
      mensagem: null,
    });
    expect(r.modalSazonal).not.toBeNull();
    expect(r.suprimirPromocoes).toBe(false);
  });

  it("invariante: suprimirPromocoes implica modalSazonal !== null, em todas as combinações", () => {
    const modais: (ModalAtivoParaVitrine | null)[] = [
      null,
      modal(),
      modal({ mostrar_promocoes_junto: true }),
      modal({ exibicao_inicio: "2026-10-06T00:00:00-03:00" }),
      modal({ exibicao_inicio: "2026-10-06T00:00:00-03:00", mostrar_promocoes_junto: true }),
      modal({ exibicao_fim: "2026-10-05T12:00:00-03:00" }),
    ];
    let combinacoes = 0;
    let suprimiu = 0;
    for (const modalAtivo of modais) {
      for (const mensagem of [null, MENSAGEM]) {
        for (const produtos of [[], [PRATO]]) {
          const r = montarModalSazonal({ modalAtivo, agora: AGORA, produtos, mensagem });
          combinacoes++;
          if (r.suprimirPromocoes) {
            suprimiu++;
            expect(r.modalSazonal).not.toBeNull();
          }
        }
      }
    }
    expect(combinacoes).toBe(24);
    // o laço não é vácuo: há combinações que suprimem
    expect(suprimiu).toBe(4);
  });
});
