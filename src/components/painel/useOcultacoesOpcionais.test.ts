/**
 * Fase RED (TDD) da issue 331 — fatia F5: o ESTADO de UI da exceção
 * produto×grupo, com uma única fonte (plan/loop-ocultar-opcionais-por-produto.md,
 * "Desenho", camada 4).
 *
 * `useOcultacoesOpcionais(ocultosDoServidor, salvar)` mantém um mapa otimista
 * `produtoId → Set<grupoId>` e expõe `oculto`, `alternar` e `aplicarLote`.
 * Uma instância no `ProdutosClient` (card + `FormProduto`), outra no
 * `OpcionaisClient` ("Por produto").
 *
 * Ambiente: vitest `environment: node`, sem jsdom — um clique não re-renderiza
 * nada aqui. Por isso a orquestração vive numa máquina PURA exportada do mesmo
 * módulo, `criarOcultacoesOtimistas(deps)`, com re-render, anúncio e refresh
 * INJETADOS (architecture.md §8, padrão `criarSalvamentoCoalescido` /
 * `alternarAssociacaoOpcional`). O hook é a casca: `aoMudar` = setState,
 * `aoFalhar` = anúncio, `aoSalvar` = `router.refresh()`.
 *
 * O servidor é a autoridade (F1–F3); aqui nada é barreira de segurança. O que
 * este arquivo protege é a UX: otimismo imediato, reversão SÓ do que falhou, e
 * o lote mandado à action ser exatamente a intenção.
 */

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

import {
  criarOcultacoesOtimistas,
  useOcultacoesOpcionais,
  type AlteracaoOcultacao,
  type OcultacoesOpcionais,
  type ResultadoOcultacoes,
} from "./useOcultacoesOpcionais";

const P1 = "prod-1";
const P2 = "prod-2";
const G1 = "grupo-1";
const G2 = "grupo-2";

type Deferido = {
  promessa: Promise<ResultadoOcultacoes>;
  resolver: (r: ResultadoOcultacoes) => void;
  rejeitar: (e: unknown) => void;
};
function deferido(): Deferido {
  let resolver!: (r: ResultadoOcultacoes) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<ResultadoOcultacoes>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

function montar(
  iniciais: { produto_id: string; categoria_opcional_id: string }[] = [],
  salvar = vi.fn(async (_a: AlteracaoOcultacao[]): Promise<ResultadoOcultacoes> => ({ ok: true })),
) {
  const aoMudar = vi.fn();
  const aoFalhar = vi.fn();
  const aoSalvar = vi.fn();
  const o = criarOcultacoesOtimistas({ iniciais, salvar, aoMudar, aoFalhar, aoSalvar });
  return { o, salvar, aoMudar, aoFalhar, aoSalvar };
}

describe("331 F5 · criarOcultacoesOtimistas — leitura", () => {
  it("reflete as linhas do servidor: par presente = oculto, o resto = exibido", () => {
    const { o } = montar([{ produto_id: P1, categoria_opcional_id: G1 }]);
    expect(o.oculto(P1, G1)).toBe(true);
    expect(o.oculto(P1, G2)).toBe(false);
    expect(o.oculto(P2, G1)).toBe(false); // a exceção é POR PRODUTO
  });
});

describe("331 F5 · alternar — um par, uma alteração", () => {
  it("alternar um par exibido manda [{oculto:true}] e, depois, alternar de novo manda [{oculto:false}]", async () => {
    const { o, salvar } = montar();
    await o.alternar(P1, G1);
    expect(salvar).toHaveBeenNthCalledWith(1, [
      { produtoId: P1, categoriaOpcionalId: G1, oculto: true },
    ]);
    expect(o.oculto(P1, G1)).toBe(true);

    await o.alternar(P1, G1);
    expect(salvar).toHaveBeenNthCalledWith(2, [
      { produtoId: P1, categoriaOpcionalId: G1, oculto: false },
    ]);
    expect(o.oculto(P1, G1)).toBe(false);
  });

  it("OTIMISTA: o estado muda e re-renderiza ANTES da action responder", async () => {
    const d = deferido();
    const salvar = vi.fn(() => d.promessa);
    const { o, aoMudar } = montar([], salvar);
    const emVoo = o.alternar(P1, G1);
    expect(o.oculto(P1, G1)).toBe(true);
    expect(aoMudar).toHaveBeenCalled();
    d.resolver({ ok: true });
    await expect(emVoo).resolves.toBe(true);
  });

  it("sucesso → aoSalvar (router.refresh) uma vez; nenhum anúncio de falha", async () => {
    const { o, aoSalvar, aoFalhar } = montar();
    await o.alternar(P1, G1);
    expect(aoSalvar).toHaveBeenCalledTimes(1);
    expect(aoFalhar).not.toHaveBeenCalled();
  });

  it("falha {ok:false} → REVERTE o par, anuncia a mensagem e não chama aoSalvar", async () => {
    const salvar = vi.fn(async () => ({ ok: false, erro: "Não foi possível salvar." }) as const);
    const { o, aoFalhar, aoSalvar } = montar([], salvar);
    const r = await o.alternar(P1, G1);
    expect(r).toBe(false);
    expect(o.oculto(P1, G1)).toBe(false);
    expect(aoFalhar).toHaveBeenCalledTimes(1);
    expect(String(aoFalhar.mock.calls[0][0]).length).toBeGreaterThan(0);
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it("action LANÇA → também reverte e anuncia (nunca deixa a UI mentindo)", async () => {
    const salvar = vi.fn(async () => {
      throw new Error("rede caiu");
    });
    const { o, aoFalhar } = montar([{ produto_id: P1, categoria_opcional_id: G1 }], salvar);
    const r = await o.alternar(P1, G1); // tentar EXIBIR
    expect(r).toBe(false);
    expect(o.oculto(P1, G1)).toBe(true); // voltou a oculto
    expect(aoFalhar).toHaveBeenCalledTimes(1);
  });

  it("reversão CIRÚRGICA: a falha de um par não desfaz outro par em voo que deu certo", async () => {
    const d1 = deferido();
    const d2 = deferido();
    const salvar = vi.fn().mockReturnValueOnce(d1.promessa).mockReturnValueOnce(d2.promessa);
    const { o } = montar([], salvar);
    const a = o.alternar(P1, G1);
    const b = o.alternar(P2, G2);
    d2.resolver({ ok: true });
    await b;
    d1.resolver({ ok: false, erro: "falhou" });
    await a;
    expect(o.oculto(P1, G1)).toBe(false); // revertido
    expect(o.oculto(P2, G2)).toBe(true); // intacto
  });

  it("alternar um par não toca outro produto nem outro grupo", async () => {
    const { o } = montar([{ produto_id: P2, categoria_opcional_id: G1 }]);
    await o.alternar(P1, G1);
    expect(o.oculto(P1, G1)).toBe(true);
    expect(o.oculto(P2, G1)).toBe(true);
    expect(o.oculto(P1, G2)).toBe(false);
  });
});

describe("331 F5 · aplicarLote — o 'Por produto' manda o diff", () => {
  it("manda EXATAMENTE as alterações recebidas, numa chamada, e aplica todas otimistamente", async () => {
    const { o, salvar } = montar([{ produto_id: P2, categoria_opcional_id: G1 }]);
    const lote: AlteracaoOcultacao[] = [
      { produtoId: P1, categoriaOpcionalId: G1, oculto: true },
      { produtoId: P2, categoriaOpcionalId: G1, oculto: false },
    ];
    const r = await o.aplicarLote(lote);
    expect(r).toBe(true);
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(salvar).toHaveBeenCalledWith(lote);
    expect(o.oculto(P1, G1)).toBe(true);
    expect(o.oculto(P2, G1)).toBe(false);
  });

  it("lote vazio → NENHUMA chamada (o zod recusaria [] no servidor) e devolve true", async () => {
    const { o, salvar, aoSalvar } = montar();
    const r = await o.aplicarLote([]);
    expect(r).toBe(true);
    expect(salvar).not.toHaveBeenCalled();
    expect(aoSalvar).not.toHaveBeenCalled();
  });

  it("falha → reverte o LOTE INTEIRO e anuncia uma vez", async () => {
    const salvar = vi.fn(async () => ({ ok: false, erro: "Não foi possível salvar." }) as const);
    const { o, aoFalhar } = montar([{ produto_id: P2, categoria_opcional_id: G1 }], salvar);
    const r = await o.aplicarLote([
      { produtoId: P1, categoriaOpcionalId: G1, oculto: true },
      { produtoId: P2, categoriaOpcionalId: G1, oculto: false },
    ]);
    expect(r).toBe(false);
    expect(o.oculto(P1, G1)).toBe(false);
    expect(o.oculto(P2, G1)).toBe(true);
    expect(aoFalhar).toHaveBeenCalledTimes(1);
  });
});

describe("331 F5 · useOcultacoesOpcionais — a casca React", () => {
  /**
   * Render SSR único (padrão de `useCarrinho.test.ts`): prova que o hook
   * semeia o estado a partir das linhas do SERVIDOR e que render não grava.
   */
  function api(
    iniciais: { produto_id: string; categoria_opcional_id: string }[],
    salvar: (a: AlteracaoOcultacao[]) => Promise<ResultadoOcultacoes>,
  ): OcultacoesOpcionais {
    let capturada: OcultacoesOpcionais | undefined;
    function Sonda() {
      capturada = useOcultacoesOpcionais(iniciais, salvar);
      return null;
    }
    renderToStaticMarkup(createElement(Sonda));
    if (!capturada) throw new Error("hook não rodou");
    return capturada;
  }

  it("semeia do servidor e expõe oculto/alternar/aplicarLote; render não chama a action", () => {
    const salvar = vi.fn(async () => ({ ok: true }) as const);
    const o = api([{ produto_id: P1, categoria_opcional_id: G1 }], salvar);
    expect(o.oculto(P1, G1)).toBe(true);
    expect(o.oculto(P1, G2)).toBe(false);
    expect(typeof o.alternar).toBe("function");
    expect(typeof o.aplicarLote).toBe("function");
    expect(salvar).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

/**
 * CONTRATO PARA A FASE GREEN — src/components/painel/useOcultacoesOpcionais.ts
 *
 *   export type AlteracaoOcultacao = { produtoId; categoriaOpcionalId; oculto: boolean }
 *   export type OcultacoesOpcionais = {
 *     oculto(produtoId, grupoId): boolean;
 *     alternar(produtoId, grupoId): Promise<boolean>;          // true = gravou
 *     aplicarLote(alteracoes): Promise<boolean>;               // [] → true sem I/O
 *   }
 *   export function criarOcultacoesOtimistas(deps: {
 *     iniciais: OcultoOpcional[]; salvar; aoMudar(); aoFalhar(msg); aoSalvar();
 *   }): OcultacoesOpcionais
 *   export function useOcultacoesOpcionais(ocultosDoServidor, salvar): OcultacoesOpcionais
 *     — aoMudar = re-render, aoFalhar = anúncio (toast/aria-live), aoSalvar = router.refresh()
 *     — ao receber NOVOS ocultosDoServidor (pós-refresh) re-semeia o mapa.
 */
