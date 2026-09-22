/**
 * [289] O store de "qual produto está em foco".
 *
 * É ele que substitui os dois `useState` de `SecaoCatalogo` e o que permite ao
 * `ModalPromocoes` abrir o ÚNICO `ProdutoModal` da vitrine sem criar um segundo
 * caminho de compra (D1 — a rejeição da segunda instância é por SEGURANÇA:
 * `temDesconto: true` é montado num lugar só, e é ele que alimenta
 * `promocaoExibida` no payload do pedido, 238/RN-12-a).
 *
 * `environment: node`, sem jsdom: foco, animação e trava de scroll do Base UI
 * não são observáveis aqui. O store é puro e exportado — é onde mora tudo o que
 * dá para provar.
 */
import { describe, it, expect, beforeEach } from "vitest";

import type { ProdutoModalDados } from "@/components/vitrine/ProdutoModal";
import {
  abrirProdutoEmFoco,
  fecharProdutoEmFoco,
  getServerSnapshot,
  getSnapshot,
  subscribe,
  zerarProdutoEmFoco,
} from "./useProdutoEmFoco";

function produto(n: number): ProdutoModalDados {
  return {
    id: `p${n}`,
    nome: `Prato ${n}`,
    descricao: null,
    foto_url: null,
    categoria_id: null,
    preco: 100,
    precoEfetivo: 80,
    temDesconto: true,
    seloDesconto: "-20%",
    descontoFim: null,
    compravel: true,
    motivoNaoCompravel: null,
  };
}

beforeEach(() => {
  zerarProdutoEmFoco();
});

describe("useProdutoEmFoco — store de produto em foco", () => {
  it("nasce fechado, sem produto nenhum", () => {
    expect(getSnapshot()).toEqual({
      dados: null,
      aberto: false,
      origem: "catalogo",
    });
  });

  it("`abrir` guarda os dados e a origem", () => {
    const p = produto(1);
    abrirProdutoEmFoco(p, "promocoes");
    const foco = getSnapshot();
    expect(foco.aberto).toBe(true);
    expect(foco.origem).toBe("promocoes");
    // MESMA referência: nada é clonado no caminho do modal (RN-9).
    expect(foco.dados).toBe(p);
  });

  it("a origem default é o catálogo", () => {
    abrirProdutoEmFoco(produto(1));
    expect(getSnapshot().origem).toBe("catalogo");
  });

  it("`fechar` zera `aberto` SEM perder a identidade do produto", () => {
    const p = produto(1);
    abrirProdutoEmFoco(p, "promocoes");
    fecharProdutoEmFoco();
    expect(getSnapshot().aberto).toBe(false);
    // O Base UI ainda anima a saída lendo o conteúdo — esvaziar aqui piscaria.
    expect(getSnapshot().dados).toBe(p);
  });

  it("dois `abrir` seguidos SUBSTITUEM o produto — nunca dois em disputa", () => {
    abrirProdutoEmFoco(produto(1), "catalogo");
    const segundo = produto(2);
    abrirProdutoEmFoco(segundo, "promocoes");
    const foco = getSnapshot();
    expect(foco.dados).toBe(segundo);
    expect(foco.origem).toBe("promocoes");
    expect(foco.aberto).toBe(true);
  });

  it("`zerar` devolve o estado inicial (RN-12: trocar de loja não reabre nada)", () => {
    abrirProdutoEmFoco(produto(1), "promocoes");
    fecharProdutoEmFoco();
    zerarProdutoEmFoco();
    expect(getSnapshot()).toEqual({
      dados: null,
      aberto: false,
      origem: "catalogo",
    });
  });

  it("`getServerSnapshot` é o estado fechado — nada no SSR", () => {
    abrirProdutoEmFoco(produto(1), "promocoes");
    expect(getServerSnapshot()).toEqual({
      dados: null,
      aberto: false,
      origem: "catalogo",
    });
    // Referência ESTÁVEL entre chamadas (requisito do useSyncExternalStore).
    expect(getServerSnapshot()).toBe(getServerSnapshot());
  });

  it("`getSnapshot` mantém a referência enquanto nada muda", () => {
    const antes = getSnapshot();
    expect(getSnapshot()).toBe(antes);
    abrirProdutoEmFoco(produto(1));
    expect(getSnapshot()).not.toBe(antes);
  });

  it("`subscribe` notifica a cada mutação e o unsubscribe para de notificar", () => {
    let chamadas = 0;
    const cancelar = subscribe(() => {
      chamadas += 1;
    });
    abrirProdutoEmFoco(produto(1));
    expect(chamadas).toBe(1);
    fecharProdutoEmFoco();
    expect(chamadas).toBe(2);
    cancelar();
    abrirProdutoEmFoco(produto(2));
    expect(chamadas).toBe(2);
  });

  it("não persiste nada: o módulo não toca storage nenhum", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(
      new URL("./useProdutoEmFoco.ts", import.meta.url),
      "utf8",
    );
    expect(fonte).not.toMatch(/localStorage|sessionStorage/);
  });
});
