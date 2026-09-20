import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  projetarProdutoVitrine,
  type ProdutoParaVitrine,
  type ProdutoVitrine,
} from "./catalogoVitrine";
import { agruparCatalogo, type ProdutoPublico } from "@/lib/supabase/queries/produtos";

/**
 * [224] Fase RED — contrato de catálogo `ProdutoVitrine` + `projetarProdutoVitrine`.
 *
 * Spec: `specs/desconto-por-produto-e-pratos-promocionais.md` §Contrato de catálogo
 * (regras 1–6), RN-15, RN-19, D1, D13. Plano: §5.7, linha 224.
 *
 * O que este arquivo prova:
 *  1. nenhum campo do contrato é opcional (`?:` ausente do bloco do tipo);
 *  2. as CINCO colunas cruas de desconto estão AUSENTES do objeto projetado —
 *     asserção sobre as CHAVES, não sobre valor (regra 6: o que a UI não precisa,
 *     o payload RSC não carrega);
 *  3. `temDesconto ⇔ precoEfetivo < preco`, com os números literais de RN-02;
 *  4. `compravel === disponivel` e `motivoNaoCompravel === "esgotado"` (D13/RN-19);
 *  5. a página da vitrine continua SEM cache e SEM query nova para "pratos
 *     promocionais" (RN-15: filtro sobre o catálogo já carregado);
 *  6. paridade view-mascarada (265) ↔ row crua fora da janela: mesmo veredito.
 *
 * `agora` SEMPRE injetado — nenhuma leitura de relógio, determinismo total.
 */

const AGORA = new Date("2026-09-20T12:00:00.000Z");

/** As 12 chaves do contrato v1, e SÓ elas (§Contrato de catálogo). */
const CHAVES_CONTRATO = [
  "id",
  "nome",
  "descricao",
  "foto_url",
  "categoria_id",
  "preco",
  "precoEfetivo",
  "temDesconto",
  "seloDesconto",
  "descontoFim",
  "compravel",
  "motivoNaoCompravel",
] as const;

/** As cinco colunas CRUAS que não podem trafegar ao cliente (regra 6). */
const COLUNAS_CRUAS = [
  "desconto_ativo",
  "desconto_tipo",
  "desconto_valor",
  "desconto_inicio",
  "desconto_fim",
] as const;

function base(over: Partial<ProdutoParaVitrine> = {}): ProdutoParaVitrine {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nome: "Feijoada",
    descricao: "com couve",
    foto_url: "https://cdn.exemplo.test/feijoada.jpg",
    categoria_id: "22222222-2222-4222-8222-222222222222",
    disponivel: true,
    preco: 100,
    desconto_ativo: false,
    desconto_tipo: null,
    desconto_valor: null,
    desconto_inicio: null,
    desconto_fim: null,
    ...over,
  };
}

/** `Intl` usa NBSP entre "R$" e o número; normaliza para comparar literal. */
const semNbsp = (s: string | null) => (s == null ? s : s.replace(/\u00a0/g, " "));

describe("224 — formato do objeto projetado", () => {
  it("devolve EXATAMENTE as 12 chaves do contrato, sem sobra e sem falta", () => {
    const v = projetarProdutoVitrine(base(), AGORA);
    expect(Object.keys(v).sort()).toEqual([...CHAVES_CONTRATO].sort());
  });

  it("NÃO carrega nenhuma das cinco colunas cruas de desconto (regra 6)", () => {
    // Produto COM desconto vigente: é o caso em que as colunas cruas teriam
    // valor e a projeção preguiçosa (spread da row) as deixaria vazar.
    const v = projetarProdutoVitrine(
      base({ desconto_ativo: true, desconto_tipo: "percentual", desconto_valor: 20 }),
      AGORA,
    );
    const chaves = Object.keys(v);
    for (const coluna of COLUNAS_CRUAS) {
      expect(chaves).not.toContain(coluna);
      expect(coluna in v).toBe(false);
    }
  });

  it("NÃO carrega `loja_id`, `ordem`, `disponivel` nem `oculto` crus", () => {
    const chaves = Object.keys(projetarProdutoVitrine(base(), AGORA));
    for (const coluna of ["loja_id", "ordem", "disponivel", "oculto"]) {
      expect(chaves).not.toContain(coluna);
    }
  });

  it("não muta a entrada (função pura)", () => {
    const entrada = base({ desconto_ativo: true, desconto_tipo: "fixo", desconto_valor: 30 });
    const copia = structuredClone(entrada);
    projetarProdutoVitrine(entrada, AGORA);
    expect(entrada).toEqual(copia);
  });
});

describe("224 — preço e desconto (D1, RN-02, reuso de precoEfetivo)", () => {
  it("sem desconto: precoEfetivo === preco, temDesconto false, selo e fim null", () => {
    const v = projetarProdutoVitrine(base(), AGORA);
    expect(v.preco).toBe(100);
    expect(v.precoEfetivo).toBe(100);
    expect(v.temDesconto).toBe(false);
    expect(v.seloDesconto).toBe(null);
    expect(v.descontoFim).toBe(null);
  });

  it("percentual vigente: 100 @ 20% ⇒ 80, selo '-20%', descontoFim repassado", () => {
    const fim = "2026-12-31T02:59:59.000Z";
    const v = projetarProdutoVitrine(
      base({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
        desconto_inicio: "2026-09-01T00:00:00.000Z",
        desconto_fim: fim,
      }),
      AGORA,
    );
    expect(v.precoEfetivo).toBe(80);
    expect(v.temDesconto).toBe(true);
    expect(v.seloDesconto).toBe("-20%");
    expect(v.descontoFim).toBe(fim);
  });

  it("fixo vigente: 100 − R$ 30 ⇒ 70, selo '-R$ 30,00'", () => {
    const v = projetarProdutoVitrine(
      base({ desconto_ativo: true, desconto_tipo: "fixo", desconto_valor: 30 }),
      AGORA,
    );
    expect(v.precoEfetivo).toBe(70);
    expect(v.temDesconto).toBe(true);
    expect(semNbsp(v.seloDesconto)).toBe("-R$ 30,00");
    // Sem prazo configurado ⇒ null, nunca undefined (campo obrigatório).
    expect(v.descontoFim).toBe(null);
  });

  it("row CRUA fora da janela (buscarProdutosPorIds): preço cheio, sem selo", () => {
    // `buscarProdutosPorIds` continua `select('*')` e NÃO filtra vigência — a
    // projeção precisa recusar sozinha a promoção que já terminou.
    const v = projetarProdutoVitrine(
      base({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
        desconto_inicio: "2026-08-01T00:00:00.000Z",
        desconto_fim: "2026-09-01T00:00:00.000Z", // terminou antes de AGORA
      }),
      AGORA,
    );
    expect(v.precoEfetivo).toBe(100);
    expect(v.temDesconto).toBe(false);
    expect(v.seloDesconto).toBe(null);
    // DECISÃO (ver relatório do RED): sem desconto vigente não existe contagem
    // regressiva a exibir — `descontoFim` de promoção encerrada não trafega.
    expect(v.descontoFim).toBe(null);
  });

  it("paridade: row MASCARADA pela view (265) ⇒ mesmo veredito da row crua expirada", () => {
    // A view `vitrine_produtos` zera as cinco colunas fora da janela (D5): o
    // resultado projetado tem de ser byte a byte o mesmo dos dois lados, senão
    // vitrine (view) e recálculo (tabela) divergem em silêncio.
    const mascarada = projetarProdutoVitrine(base(), AGORA);
    const crua = projetarProdutoVitrine(
      base({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
        desconto_fim: "2026-09-01T00:00:00.000Z",
      }),
      AGORA,
    );
    expect(crua).toEqual(mascarada);
  });

  it("invariante temDesconto ⇔ precoEfetivo < preco em todos os casos", () => {
    const casos: ProdutoParaVitrine[] = [
      base(),
      base({ desconto_ativo: true, desconto_tipo: "percentual", desconto_valor: 20 }),
      base({ desconto_ativo: true, desconto_tipo: "fixo", desconto_valor: 30 }),
      base({ desconto_ativo: false, desconto_tipo: "percentual", desconto_valor: 20 }),
      base({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
        desconto_inicio: "2027-01-01T00:00:00.000Z", // agendada para o futuro
      }),
    ];
    for (const caso of casos) {
      const v = projetarProdutoVitrine(caso, AGORA);
      expect(v.temDesconto).toBe(v.precoEfetivo < v.preco);
      // Selo e temDesconto andam juntos — selo órfão vira "-20%" sem preço novo.
      expect(v.seloDesconto === null).toBe(!v.temDesconto);
      expect(v.precoEfetivo).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("224 — comprabilidade (D13 / RN-19)", () => {
  it("disponivel = true ⇒ compravel true e motivoNaoCompravel null", () => {
    const v = projetarProdutoVitrine(base({ disponivel: true }), AGORA);
    expect(v.compravel).toBe(true);
    expect(v.motivoNaoCompravel).toBe(null);
  });

  it("disponivel = false ⇒ compravel false e motivo 'esgotado'", () => {
    const v = projetarProdutoVitrine(base({ disponivel: false }), AGORA);
    expect(v.compravel).toBe(false);
    expect(v.motivoNaoCompravel).toBe("esgotado");
  });

  it("esgotado NÃO apaga o preço promocional (as duas dimensões são ortogonais)", () => {
    const v = projetarProdutoVitrine(
      base({
        disponivel: false,
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
      }),
      AGORA,
    );
    expect(v.compravel).toBe(false);
    expect(v.precoEfetivo).toBe(80);
    expect(v.temDesconto).toBe(true);
  });
});

describe("224 — encaixe nas peças existentes", () => {
  it("aceita `ProdutoPublico` (as 14 colunas da view 265) sem cast", () => {
    // Prova de TIPO + runtime: o único caller de vitrine passa o que
    // `buscarProdutosPublicos` devolve. Se a assinatura exigisse a row inteira
    // de `produtos`, este arquivo nem compilaria.
    const daView: ProdutoPublico = {
      id: "33333333-3333-4333-8333-333333333333",
      loja_id: "44444444-4444-4444-8444-444444444444",
      categoria_id: null,
      nome: "Refrigerante",
      descricao: null,
      preco: 8,
      disponivel: true,
      ordem: 1,
      foto_url: null,
      desconto_ativo: false,
      desconto_tipo: null,
      desconto_valor: null,
      desconto_inicio: null,
      desconto_fim: null,
    };
    const v = projetarProdutoVitrine(daView, AGORA);
    expect(v).toMatchObject({ id: daView.id, preco: 8, precoEfetivo: 8, categoria_id: null });
  });

  it("`agruparCatalogo` agrupa ProdutoVitrine sem edição da suíte dele", () => {
    const projetados: ProdutoVitrine[] = [
      projetarProdutoVitrine(base(), AGORA),
      projetarProdutoVitrine(base({ id: "x", categoria_id: null }), AGORA),
    ];
    const grupos = agruparCatalogo(projetados, []);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].nome).toBe("Outros");
    expect(grupos[0].produtos).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Guardas ESTÁTICAS: o que nenhum teste de runtime pega (não há jsdom no repo).
// ─────────────────────────────────────────────────────────────────────────────

const RAIZ = process.cwd();
const FONTE_CONTRATO = join(RAIZ, "src/lib/utils/catalogoVitrine.ts");
const FONTE_PAGINA = join(RAIZ, "src/app/(publica)/loja/[slug]/page.tsx");

describe("224 — nenhum campo do contrato é opcional (regra 5 / RN-19)", () => {
  const fonte = readFileSync(FONTE_CONTRATO, "utf8");
  const bloco = fonte.match(/export type ProdutoVitrine = \{([\s\S]*?)\n\};/);

  it("o tipo `ProdutoVitrine` existe e é um objeto literal", () => {
    expect(bloco).not.toBeNull();
  });

  it("`grep \"?:\"` dentro do bloco do tipo não devolve nada", () => {
    // Campo ausente vira `undefined` no componente client e produz "R$ NaN"
    // silencioso — ou um catálogo inteiro que se acha comprável (bug vivo D13).
    expect(bloco?.[1].match(/\?\s*:/g) ?? []).toEqual([]);
  });

  it("o contrato declara as 12 chaves esperadas", () => {
    for (const chave of CHAVES_CONTRATO) {
      expect(bloco?.[1]).toMatch(new RegExp(`\\n\\s*${chave}\\s*:`));
    }
  });

  it("a projeção não lê relógio: `agora` só entra por parâmetro", () => {
    const corpo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(corpo).not.toMatch(/Date\.now\(\)/);
    expect(corpo).not.toMatch(/new Date\(\s*\)/);
  });
});

describe("224 — a página da vitrine (RN-15): sem cache e sem query nova", () => {
  const pagina = readFileSync(FONTE_PAGINA, "utf8");
  // CÓDIGO sem comentário: o comentário de `page.tsx:30–42` CITA `'use cache'` e
  // `revalidate` para explicar por que a vitrine não os usa — casar a citação
  // daria falso positivo e o teste passaria a proibir a documentação, não o cache.
  const codigo = pagina.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("continua sem ISR/cache de rota (dado vivo por decisão, page.tsx:30–42)", () => {
    const proibidos = [
      /export\s+const\s+revalidate/,
      /['"]use cache['"]/,
      /unstable_cache/,
      /force-static/,
    ];
    expect(proibidos.filter((re) => re.test(codigo)).map(String)).toEqual([]);
  });

  it("projeta o catálogo por `projetarProdutoVitrine` (fonte única do contrato)", () => {
    // Booleano, não `toMatch`: a página inteira num diff de falha é ruído.
    expect(
      /import\s*\{[^}]*projetarProdutoVitrine[^}]*\}\s*from\s*["']@\/lib\/utils\/catalogoVitrine["']/.test(
        pagina,
      ),
    ).toBe(true);
  });

  it("deriva 'pratos promocionais' por filtro sobre o catálogo já carregado", () => {
    // RN-15: zero query nova, zero tabela nova — `filter(p => p.temDesconto)`.
    expect(
      /\.filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.temDesconto\s*\)/.test(pagina),
    ).toBe(true);
  });

  it("não abre NENHUMA query além das quatro que já existiam", () => {
    const chamadas = [...codigo.matchAll(/\bbuscar[A-Za-z]+\s*\(/g)].map((m) =>
      m[0].replace(/\s*\($/, ""),
    );
    const PERMITIDAS = [
      "buscarLojaPorSlug",
      "buscarCategorias",
      "buscarProdutosPublicos",
      "buscarOpcionaisPorCategoria",
    ];
    expect([...new Set(chamadas)].filter((c) => !PERMITIDAS.includes(c))).toEqual([]);
    // E nenhuma query crua nova escapando pelo client do Supabase na página.
    expect(/\.from\(/.test(codigo)).toBe(false);
  });

  it("não manipula nenhuma coluna crua de desconto no SSR (regra 6)", () => {
    expect(COLUNAS_CRUAS.filter((coluna) => codigo.includes(coluna))).toEqual([]);
  });
});
