import { describe, it, expect } from "vitest";
import {
  planejarAssociacaoOpcionais,
  haAlteracaoNaAssociacao,
} from "./associacao-opcionais";

/**
 * Testes da função pura que RN-12 (issue 208) introduziu para substituir o
 * delete+insert do conjunto inteiro (que zerava `ordem` a cada clique de
 * checkbox). Compartilhada por lojista e admin — se este arquivo pegar um bug
 * aqui, as duas vias de escrita herdam a correção.
 */

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const D = "dddddddd-dddd-dddd-dddd-dddddddddddd";

describe("planejarAssociacaoOpcionais", () => {
  it("conjunto vazio dos dois lados: nada a remover, nada a inserir", () => {
    const plano = planejarAssociacaoOpcionais([], []);
    expect(plano).toEqual({ remover: [], inserir: [] });
  });

  it("todos os atuais são desmarcados: remover = todos, inserir = []", () => {
    const atuais = [
      { categoria_opcional_id: A, ordem: 0 },
      { categoria_opcional_id: B, ordem: 1 },
    ];
    const plano = planejarAssociacaoOpcionais(atuais, []);
    expect(plano.remover.sort()).toEqual([A, B].sort());
    expect(plano.inserir).toEqual([]);
  });

  it("todos os atuais permanecem marcados: remover = [], inserir = [] (ordem não é tocada)", () => {
    const atuais = [
      { categoria_opcional_id: A, ordem: 5 },
      { categoria_opcional_id: B, ordem: 9 },
    ];
    const plano = planejarAssociacaoOpcionais(atuais, [A, B]);
    expect(plano).toEqual({ remover: [], inserir: [] });
  });

  it("grupo novo entra com ordem = max(ordem dos que permanecem) + 1", () => {
    const atuais = [
      { categoria_opcional_id: A, ordem: 2 },
      { categoria_opcional_id: B, ordem: 7 },
    ];
    // C é novo, A e B permanecem (max = 7) → C entra em 8.
    const plano = planejarAssociacaoOpcionais(atuais, [A, B, C]);
    expect(plano.remover).toEqual([]);
    expect(plano.inserir).toEqual([{ categoria_opcional_id: C, ordem: 8 }]);
  });

  it("sem nenhum permanente, a numeração dos novos começa em 0", () => {
    // Nada de `atuais` sobrevive na seleção → base da numeração é 0, não a
    // ordem antiga que está sendo removida.
    const atuais = [{ categoria_opcional_id: A, ordem: 9 }];
    const plano = planejarAssociacaoOpcionais(atuais, [B, C]);
    expect(plano.remover).toEqual([A]);
    expect(plano.inserir).toEqual([
      { categoria_opcional_id: B, ordem: 0 },
      { categoria_opcional_id: C, ordem: 1 },
    ]);
  });

  it("ordem com buracos entre os que permanecem: novo usa o MAIOR valor, não a contagem", () => {
    // Só A permanece, com ordem=40 (buraco: nunca existiu 1..39 nessa
    // categoria). Se a função usasse "quantidade de permanentes" em vez de
    // max(ordem), o novo colidiria com uma ordem já ocupada por A.
    const atuais = [
      { categoria_opcional_id: A, ordem: 40 },
      { categoria_opcional_id: B, ordem: 3 },
    ];
    const plano = planejarAssociacaoOpcionais(atuais, [A, C]);
    expect(plano.remover).toEqual([B]);
    expect(plano.inserir).toEqual([{ categoria_opcional_id: C, ordem: 41 }]);
  });

  it("entrada duplicada em `marcados` é absorvida: só uma linha de inserir", () => {
    const plano = planejarAssociacaoOpcionais([], [C, C, D]);
    expect(plano.inserir).toEqual([
      { categoria_opcional_id: C, ordem: 0 },
      { categoria_opcional_id: D, ordem: 1 },
    ]);
  });

  it("marcado duplicado que TAMBÉM já está associado: não vira insert nem remove (idempotente)", () => {
    const atuais = [{ categoria_opcional_id: A, ordem: 0 }];
    const plano = planejarAssociacaoOpcionais(atuais, [A, A]);
    expect(plano).toEqual({ remover: [], inserir: [] });
  });

  it("mistura: remove um, mantém um, insere um novo — cada um no balde certo", () => {
    const atuais = [
      { categoria_opcional_id: A, ordem: 0 }, // sai
      { categoria_opcional_id: B, ordem: 1 }, // fica
    ];
    const plano = planejarAssociacaoOpcionais(atuais, [B, C]);
    expect(plano.remover).toEqual([A]);
    expect(plano.inserir).toEqual([{ categoria_opcional_id: C, ordem: 2 }]);
  });
});

describe("haAlteracaoNaAssociacao — gate do botão Reordenar (209)", () => {
  const s = (...ids: string[]) => new Set(ids);

  it("conjuntos idênticos → false (pode reordenar)", () => {
    expect(haAlteracaoNaAssociacao(s("a", "b"), s("a", "b"))).toBe(false);
  });

  it("ordem de iteração não importa — é conjunto, não lista", () => {
    expect(haAlteracaoNaAssociacao(s("a", "b"), s("b", "a"))).toBe(false);
  });

  it("grupo recém-MARCADO e não salvo → true (bloqueia)", () => {
    // O caso que a trava existe para pegar: 'c' ainda não tem linha em
    // categoria_produto_opcionais, e mandá-lo na permutação derrubaria a RPC.
    expect(haAlteracaoNaAssociacao(s("a", "b"), s("a", "b", "c"))).toBe(true);
  });

  it("grupo DESMARCADO e não salvo → true (bloqueia)", () => {
    expect(haAlteracaoNaAssociacao(s("a", "b"), s("a"))).toBe(true);
  });

  it("troca de mesmo tamanho → true (tamanho igual não é suficiente)", () => {
    // Sem a checagem de pertinência, o `size` igual passaria batido.
    expect(haAlteracaoNaAssociacao(s("a", "b"), s("a", "c"))).toBe(true);
  });

  it("ambos vazios → false", () => {
    expect(haAlteracaoNaAssociacao(s(), s())).toBe(false);
  });

  it("gravados vazios e um marcado → true", () => {
    expect(haAlteracaoNaAssociacao(s(), s("a"))).toBe(true);
  });
});
