/**
 * Teste de regressão de ponta a ponta — issue 139 (crítica).
 *
 * Não é um teste NOVO de comportamento: 127–138 já entregaram e testaram cada
 * camada isoladamente (130 = util puro; 135/136/137 = gate no componente e nas
 * pages painel/admin). Este arquivo AMARRA banco → util → componente num único
 * lugar e prova as duas invariantes que, se quebradas, liberariam uma variante
 * não contratada ou vazariam entre lojas:
 *
 *   1. Isolamento cruzado (RN-M2): loja A (só térmica) e loja B (só A4) nunca
 *      compartilham marcador de impressão — cada `variantesHabilitadas(loja)`
 *      real (não hard-coded) decide o que `DetalhePedido` monta no DOM.
 *   2. Fail-closed (RN-M1): loja sem módulo — via flags false OU via
 *      `variantesHabilitadas(null)` — não monta seletor nem bloco algum.
 *   3. Fonte única (sugestão do audit da 130): análise estática confirmando que
 *      ninguém fora de `variantesHabilitadas.ts` reimplementa o mapa
 *      modulo_impressao_* → variante.
 *
 * Ambiente: vitest environment=node. Estratégia: renderToStaticMarkup, mesmo
 * padrão de DetalhePedido.test.tsx/ComandaCozinha.test.tsx (cujo factory de
 * `PedidoComItens` é reproduzido aqui).
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// DetalhePedido renderiza AcoesStatus (client), que chama useRouter() no topo;
// SSR estático não tem App Router montado. Mock idêntico ao de
// DetalhePedido.test.tsx — infra de render, sem relação com o que este arquivo
// cobre.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { DetalhePedido } from "@/components/painel/DetalhePedido";
import {
  variantesHabilitadas,
  type VarianteImpressao,
} from "@/lib/utils/variantesHabilitadas";
import type { PedidoComItens } from "@/lib/supabase/queries/pedidos";
import type { LojaCompleta } from "@/lib/supabase/queries/lojas";

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures — mesmo factory de PedidoComItens de DetalhePedido.test.tsx /
// ComandaCozinha.test.tsx (não recriado do zero: só os campos que os blocos de
// impressão consomem).
// ═══════════════════════════════════════════════════════════════════════════

function pedido(over: Partial<PedidoComItens> = {}): PedidoComItens {
  return {
    id: "abcdef12-3456-7890-abcd-ef1234567890",
    nome_cliente: "Fulano de Teste",
    telefone_cliente: "(11) 90000-0000",
    status: "pendente",
    subtotal: 3000,
    desconto: 0,
    cupom_codigo: null,
    taxa_entrega: 500,
    total: 3500,
    forma_pagamento: "pix",
    observacoes: null,
    endereco_entrega: null,
    token_acesso: "tok-nao-usado-neste-arquivo",
    criado_em: "2026-07-07T17:32:00Z",
    tipo_entrega: "retirada",
    troco_para: null,
    itens_pedido: [
      { id: "item-1", nome: "X-Salada", preco: 1500, quantidade: 2 },
    ],
    ...over,
  } as unknown as PedidoComItens;
}

function renderDetalhe(modulosImpressao: VarianteImpressao[]): string {
  return renderToStaticMarkup(
    <DetalhePedido
      pedido={pedido()}
      modulosImpressao={modulosImpressao}
      nomeLoja="Loja Teste"
    />,
  );
}

// Marcadores de texto LITERAIS por variante — os mesmos de DetalhePedido.test.tsx.
// `renderToStaticMarkup` não aplica `uppercase`, então o texto sai como no
// componente-fonte.
const MARCADOR_COMANDA = "Comanda — Cozinha"; // ComandaCozinha.tsx (título)
const MARCADOR_RECIBO = "Documento sem valor fiscal"; // ReciboCliente.tsx (rodapé RN-P6)
const MARCADOR_A4 = "Comum (A4)"; // SeletorImprimirPedido, rótulo do botão direto (1 variante)

type FlagsLoja = Pick<
  LojaCompleta,
  "modulo_impressao_a4" | "modulo_impressao_termica"
>;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Isolamento cruzado — loja A (só térmica) vs. loja B (só A4)
// ═══════════════════════════════════════════════════════════════════════════

describe("Isolamento cruzado do entitlement de impressão (banco → util → componente)", () => {
  const LOJA_A_TERMICA: FlagsLoja = {
    modulo_impressao_termica: true,
    modulo_impressao_a4: false,
  };
  const LOJA_B_A4: FlagsLoja = {
    modulo_impressao_a4: true,
    modulo_impressao_termica: false,
  };

  it("hop banco → util: variantesHabilitadas deriva A=['cozinha','recibo'] e B=['a4'] das flags reais (não hard-coded no teste)", () => {
    expect(variantesHabilitadas(LOJA_A_TERMICA)).toEqual(["cozinha", "recibo"]);
    expect(variantesHabilitadas(LOJA_B_A4)).toEqual(["a4"]);
  });

  it("loja A (só térmica): DetalhePedido monta cozinha + recibo, e NUNCA o marcador A4-only", () => {
    const html = renderDetalhe(variantesHabilitadas(LOJA_A_TERMICA));
    expect(html).toContain(MARCADOR_COMANDA);
    expect(html).toContain(MARCADOR_RECIBO);
    expect(html).toContain("Imprimir"); // 2 variantes → trigger de menu (RN-P4)
    expect(html).not.toContain(MARCADOR_A4);
  });

  it("loja B (só A4): DetalhePedido monta só o seletor A4, e NUNCA os blocos térmicos", () => {
    const html = renderDetalhe(variantesHabilitadas(LOJA_B_A4));
    expect(html).toContain(MARCADOR_A4);
    expect(html).not.toContain(MARCADOR_COMANDA);
    expect(html).not.toContain(MARCADOR_RECIBO);
    // 1 variante só → botão direto, sem trigger de menu.
    expect(html).not.toContain("Imprimir");
  });

  it("nunca cruzado: o detalhe de A não contém NENHUM marcador exclusivo de B, e vice-versa", () => {
    const htmlA = renderDetalhe(variantesHabilitadas(LOJA_A_TERMICA));
    const htmlB = renderDetalhe(variantesHabilitadas(LOJA_B_A4));

    for (const marcadorDeA of [MARCADOR_COMANDA, MARCADOR_RECIBO]) {
      expect(
        htmlB,
        `loja B (só A4) não pode ver "${marcadorDeA}" — vazamento cross-loja de entitlement`,
      ).not.toContain(marcadorDeA);
    }
    expect(
      htmlA,
      `loja A (só térmica) não pode ver "${MARCADOR_A4}" — vazamento cross-loja de entitlement`,
    ).not.toContain(MARCADOR_A4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Loja sem módulo — RN-M1 fail-closed (regressão)
// ═══════════════════════════════════════════════════════════════════════════

describe("Loja sem módulo de impressão — RN-M1 fail-closed (regressão)", () => {
  function assertSemSeletorNemBlocos(variantes: VarianteImpressao[]): void {
    expect(variantes).toEqual([]);
    const html = renderDetalhe(variantes);
    expect(html).not.toContain("Imprimir");
    expect(html).not.toContain(MARCADOR_COMANDA);
    expect(html).not.toContain(MARCADOR_RECIBO);
    expect(html).not.toContain(MARCADOR_A4);
    expect(html).not.toContain("Via da cozinha");
    expect(html).not.toContain("Recibo do cliente");
  }

  it("ambas as flags false → variantesHabilitadas=[] → sem seletor e sem NENHUM bloco de variante no DOM", () => {
    const LOJA_SEM_MODULO: FlagsLoja = {
      modulo_impressao_a4: false,
      modulo_impressao_termica: false,
    };
    assertSemSeletorNemBlocos(variantesHabilitadas(LOJA_SEM_MODULO));
  });

  it("variantesHabilitadas(null) → [] → sem seletor e sem NENHUM bloco de variante no DOM", () => {
    assertSemSeletorNemBlocos(variantesHabilitadas(null));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Fonte única — ninguém fora de variantesHabilitadas.ts reimplementa o mapa
//    modulo_impressao_* → variante (sugestão do audit da issue 130)
// ═══════════════════════════════════════════════════════════════════════════
//
// Estratégia de análise estática por descoberta em filesystem (mesmo precedente
// de enforcement-escopo-admin.test.ts): caminha src/ inteiro, sem lista manual
// de arquivos a vigiar — um arquivo novo que reimplemente o mapa é pego sem
// precisar editar este teste.

describe("Fonte única do entitlement de impressão", () => {
  const SRC = join(process.cwd(), "src");

  function listarArquivosFonte(dir: string): string[] {
    const arquivos: string[] = [];
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const caminho = join(dir, entrada.name);
      if (entrada.isDirectory()) {
        arquivos.push(...listarArquivosFonte(caminho));
      } else if (/\.tsx?$/.test(entrada.name)) {
        arquivos.push(caminho);
      }
    }
    return arquivos;
  }

  const TODOS = listarArquivosFonte(SRC);
  const isTeste = (caminho: string): boolean => /\.test\.tsx?$/.test(caminho);

  it("sanidade da descoberta: encontra pelo menos 100 arquivos .ts/.tsx sob src/ (evita suíte virar no-op silencioso)", () => {
    expect(TODOS.length).toBeGreaterThanOrEqual(100);
  });

  // ── Checagem robusta (o "ao menos" sugerido pela issue quando isolar o mapa
  // é difícil): as flags CRUAS do banco só podem ser lidas fora do util em três
  // lugares — a blocklist `CAMPOS_LOJA_SOMENTE_SERVIDOR` (admin-loja.ts, que
  // só BLOQUEIA a coluna em PATCH; não decide variante nenhuma), os tipos
  // gerados do schema (database.types.ts) e testes. Qualquer outro arquivo que
  // leia `modulo_impressao_a4`/`modulo_impressao_termica` e decida algo sozinho
  // reabre RN-M2 com uma segunda fonte de decisão — não confiável por definição
  // (motivo de a issue 130 ter centralizado isto num único util puro).
  const FLAG_RE = /modulo_impressao_(a4|termica)/;
  const PERMITIDOS_FLAGS = new Set([
    join(SRC, "lib/utils/variantesHabilitadas.ts"),
    join(SRC, "lib/actions/admin-loja.ts"),
    join(SRC, "lib/database.types.ts"),
  ]);

  it("modulo_impressao_a4/modulo_impressao_termica só aparecem no util, na blocklist admin-loja, nos tipos gerados, ou em testes", () => {
    const violacoes = TODOS.filter((caminho) => {
      if (isTeste(caminho)) return false;
      if (PERMITIDOS_FLAGS.has(caminho)) return false;
      return FLAG_RE.test(readFileSync(caminho, "utf8"));
    });
    expect(
      violacoes,
      `arquivo(s) fora da fonte única lendo as flags de módulo — possível 2ª decisão de entitlement:\n${violacoes.join("\n")}`,
    ).toEqual([]);
  });

  // ── Checagem complementar (mais frágil por natureza, mas tentada primeiro
  // como pede a issue): os literais de DECISÃO "cozinha"/"recibo" do mapa RN-M2
  // só devem existir como string literal na fonte única. Exclusões: testes; o
  // CSS (fora do escopo .ts/.tsx — não entra na varredura); e componentes que já
  // recebem a lista PRONTA e só a CONSOMEM como valor de variante recebida
  // (`.includes(...)`) — hoje só `DetalhePedido.tsx`. Um consumidor novo
  // legítimo deve ser adicionado a esta allowlist explicitamente, nunca por
  // afrouxar a regex.
  const LITERAL_RE = /["']cozinha["']|["']recibo["']/;
  const PERMITIDOS_LITERAIS = new Set([
    join(SRC, "lib/utils/variantesHabilitadas.ts"),
    join(SRC, "components/painel/DetalhePedido.tsx"),
  ]);

  it("literais 'cozinha'/'recibo' de decisão do mapa RN-M2 só existem no util (fora consumo já decidido e testes)", () => {
    const violacoes = TODOS.filter((caminho) => {
      if (isTeste(caminho)) return false;
      if (PERMITIDOS_LITERAIS.has(caminho)) return false;
      return LITERAL_RE.test(readFileSync(caminho, "utf8"));
    });
    expect(
      violacoes,
      `arquivo(s) com literal 'cozinha'/'recibo' fora da fonte única e fora do consumo já decidido:\n${violacoes.join("\n")}`,
    ).toEqual([]);
  });
});
