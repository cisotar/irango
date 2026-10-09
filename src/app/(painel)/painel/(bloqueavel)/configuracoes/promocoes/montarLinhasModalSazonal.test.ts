import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ModalSazonalComSelecao } from "@/lib/supabase/queries/modaisSazonais";

import { montarLinhasModalSazonal } from "./montarLinhasModalSazonal";

/**
 * [362] A montagem de linha é COMPARTILHADA pela page do lojista e pela page
 * admin da loja-alvo. Este arquivo cobre as invariantes que as duas telas
 * herdam dela — um campo a menos aqui some calado de UMA das telas.
 *
 * Molde: `montarPayloadModalSazonal.test.ts` (irmão neutro desta pasta).
 */

const LOJA_ID = "11111111-1111-4111-8111-111111111111";

function modal(over: Partial<ModalSazonalComSelecao> = {}): ModalSazonalComSelecao {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    loja_id: LOJA_ID,
    titulo: "Festa junina",
    mensagem: { versao: 1, paragrafos: [{ trechos: [{ texto: "Promo" }] }] },
    ativo: false,
    exibicao_inicio: "2026-06-01T00:00:00-03:00",
    exibicao_fim: "2026-06-30T23:59:59-03:00",
    mostrar_promocoes_junto: false,
    criado_em: "2026-05-01T00:00:00-03:00",
    atualizado_em: "2026-05-01T00:00:00-03:00",
    categorias: ["33333333-3333-4333-8333-333333333333"],
    cardapios: ["44444444-4444-4444-8444-444444444444"],
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("montarLinhasModalSazonal", () => {
  it("repassa id, título, janela, seleção e o toggle, sem remapear a seleção", () => {
    const m = modal();

    const [linha] = montarLinhasModalSazonal([m], LOJA_ID, new Date());

    expect(linha).toMatchObject({
      id: m.id,
      titulo: m.titulo,
      ativo: false,
      exibicao_inicio: m.exibicao_inicio,
      exibicao_fim: m.exibicao_fim,
      mostrar_promocoes_junto: false,
      categorias: m.categorias,
      cardapios: m.cardapios,
    });
    // Nenhuma coluna autoritativa de banco vaza para a linha da UI.
    expect("loja_id" in linha).toBe(false);
    expect("criado_em" in linha).toBe(false);
  });

  it("mensagem INVÁLIDA vira `null` (parse fail-closed, RN-M04) e não derruba a lista", () => {
    const linhas = montarLinhasModalSazonal(
      [modal({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mensagem: { versao: 99 } })],
      LOJA_ID,
      new Date(),
    );

    expect(linhas).toHaveLength(1);
    expect(linhas[0].mensagem).toBeNull();
  });

  it("o `estado` é derivado da janela com o `agora` RECEBIDO — o mesmo para todas as linhas", () => {
    const dentro = new Date("2026-06-15T12:00:00-03:00");
    const linhas = montarLinhasModalSazonal(
      [
        modal({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ativo: true }),
        modal({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ativo: false }),
      ],
      LOJA_ID,
      dentro,
    );

    expect(linhas[0].estado.rotulo).toBe("Ativo");
    expect(linhas[1].estado.rotulo).toBe("Rascunho");
  });

  it("o mesmo modal ativo muda de estado só pelo `agora` passado (o relógio é do servidor)", () => {
    const m = modal({ ativo: true });

    const antes = montarLinhasModalSazonal([m], LOJA_ID, new Date("2026-05-01T00:00:00-03:00"));
    const durante = montarLinhasModalSazonal([m], LOJA_ID, new Date("2026-06-15T12:00:00-03:00"));

    expect(antes[0].estado.rotulo).toBe("Fora da janela");
    expect(durante[0].estado.rotulo).toBe("Ativo");
  });

  it("lista vazia devolve lista vazia", () => {
    expect(montarLinhasModalSazonal([], LOJA_ID, new Date())).toEqual([]);
  });
});
