// Issue 326, iteração 2 — funções PURAS da tela de faixas de entrega.
//
// Ambiente node (sem jsdom): nada é renderizado. Cobre o que a tela usa para
// montar o payload (`montarPayload`). O envio (`enviarZonas`) e a fila do
// salvamento automático (`criarFilaGravacao`, C6) foram extraídos para
// `gravacaoZonas.ts` na issue 325, com os testes em `gravacaoZonas.test.ts`.
// O gesto (blur, switch, diálogo) fica no checklist do usuário.
import { describe, expect, it } from "vitest";

import { montarPayload, type FaixaEditavel } from "./TabelaFaixasEntrega";
import { MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA } from "@/lib/validacoes/entrega";

const linha = (taxa: string, gratis: string | null = null, ativo = true): FaixaEditavel => ({
  taxa,
  gratis,
  ativo,
});

describe("montarPayload — estado da tela → payload da action", () => {
  it("faixas válidas ⇒ payload com taxa, grátis e ativo de cada faixa (valor sem máscara e com vírgula)", () => {
    const r = montarPayload(2, [linha("4"), linha("6.5", "80.00"), linha("7,25", null, false)]);

    expect(r).toEqual({
      ok: true,
      payload: {
        incremento: 2,
        faixas: [
          { taxa: 4, pedido_minimo_gratis: null, ativo: true },
          { taxa: 6.5, pedido_minimo_gratis: 80, ativo: true },
          { taxa: 7.25, pedido_minimo_gratis: null, ativo: false },
        ],
      },
    });
  });

  it("sem faixas ⇒ payload vazio válido (remover tudo grava lista vazia)", () => {
    expect(montarPayload(1, [])).toEqual({ ok: true, payload: { incremento: 1, faixas: [] } });
  });

  it("preço vazio ⇒ erro citando a faixa e o índice da linha (nada pela metade)", () => {
    const r = montarPayload(1, [linha("4"), linha("")]);

    expect(r).toEqual({ ok: false, erro: "Informe o preço da faixa de 1–2 km.", indice: 1 });
  });

  it("preço vazio numa faixa DESLIGADA também bloqueia (ela é gravada)", () => {
    const r = montarPayload(1, [linha("4"), linha("", null, false)]);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.indice).toBe(1);
  });

  it("preço inválido ⇒ erro na linha", () => {
    const r = montarPayload(2, [linha("abc")]);

    expect(r).toEqual({ ok: false, erro: "Informe o preço da faixa de 0–2 km.", indice: 0 });
  });

  it("frete grátis ligado e vazio ⇒ erro citando a faixa", () => {
    const r = montarPayload(1, [linha("4"), linha("5"), linha("6", "")]);

    expect(r).toEqual({
      ok: false,
      erro: "Informe o valor do frete grátis da faixa de 2–3 km ou desligue a opção.",
      indice: 2,
    });
  });

  it("preço com mais de 2 casas ⇒ erro do schema apontando o preço da faixa", () => {
    const r = montarPayload(1, [linha("4.555")]);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.indice).toBe(0);
      expect(r.erro).toContain("o preço da faixa de 0–1 km");
    }
  });

  it("ativa depois de desligada ⇒ mensagem do contrato na PRIMEIRA ativa depois do buraco", () => {
    const r = montarPayload(1, [linha("4"), linha("5", null, false), linha("6"), linha("7")]);

    expect(r).toEqual({ ok: false, erro: MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA, indice: 2 });
  });
});
