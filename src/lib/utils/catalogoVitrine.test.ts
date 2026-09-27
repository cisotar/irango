import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  agruparPorCardapio,
  derivarPromocionaisParaModal,
  derivarProdutosDoModalSazonal,
  projetarProdutoVitrine,
  projetarCatalogoVitrine,
  type ProdutoParaVitrine,
  type ProdutoVitrine,
} from "./catalogoVitrine";
import {
  cardapioAberto,
  type CardapioVigencia,
  type VinculoVigencia,
} from "./vigenciaCardapio";
import { instanteNoFuso } from "./fusoLoja";
import { ROTULO_SEM_VOLTA } from "./descreverVigencia";
import {
  FREQUENCIA_PERMANENTE,
  type AvaliacaoFrequencia,
  type Frequencia,
} from "./frequencia";
import {
  agruparCatalogo,
  type GrupoOpcional,
  type ProdutoPublico,
} from "@/lib/supabase/queries/produtos";
import type { CategoriaComProdutos } from "@/components/vitrine/SecaoCatalogo";
import type { Categoria } from "@/lib/supabase/queries/categorias";

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
/** [323] A avaliação de frequência chega PRONTA à projeção de um produto. */
const DENTRO: AvaliacaoFrequencia = { disponivel: true, motivo: null };

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

/** [323] A entrada do catálogo carrega os 5 eixos de frequência (permanente). */
type ProdutoParaVitrineComFrequencia = ProdutoParaVitrine & Frequencia;

function base(
  over: Partial<ProdutoParaVitrineComFrequencia> = {},
): ProdutoParaVitrineComFrequencia {
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
    ...FREQUENCIA_PERMANENTE,
    ...over,
  };
}

/** `Intl` usa NBSP entre "R$" e o número; normaliza para comparar literal. */
const semNbsp = (s: string | null) => (s == null ? s : s.replace(/\u00a0/g, " "));

describe("224 — formato do objeto projetado", () => {
  it("devolve EXATAMENTE as 12 chaves do contrato, sem sobra e sem falta", () => {
    const v = projetarProdutoVitrine(base(), DENTRO, AGORA);
    expect(Object.keys(v).sort()).toEqual([...CHAVES_CONTRATO].sort());
  });

  it("NÃO carrega nenhuma das cinco colunas cruas de desconto (regra 6)", () => {
    // Produto COM desconto vigente: é o caso em que as colunas cruas teriam
    // valor e a projeção preguiçosa (spread da row) as deixaria vazar.
    const v = projetarProdutoVitrine(
      base({ desconto_ativo: true, desconto_tipo: "percentual", desconto_valor: 20 }),
      DENTRO,
      AGORA,
    );
    const chaves = Object.keys(v);
    for (const coluna of COLUNAS_CRUAS) {
      expect(chaves).not.toContain(coluna);
      expect(coluna in v).toBe(false);
    }
  });

  it("NÃO carrega `loja_id`, `ordem`, `disponivel` nem `oculto` crus", () => {
    const chaves = Object.keys(projetarProdutoVitrine(base(), DENTRO, AGORA));
    for (const coluna of ["loja_id", "ordem", "disponivel", "oculto"]) {
      expect(chaves).not.toContain(coluna);
    }
  });

  it("não muta a entrada (função pura)", () => {
    const entrada = base({ desconto_ativo: true, desconto_tipo: "fixo", desconto_valor: 30 });
    const copia = structuredClone(entrada);
    projetarProdutoVitrine(entrada, DENTRO, AGORA);
    expect(entrada).toEqual(copia);
  });
});

describe("224 — preço e desconto (D1, RN-02, reuso de precoEfetivo)", () => {
  it("sem desconto: precoEfetivo === preco, temDesconto false, selo e fim null", () => {
    const v = projetarProdutoVitrine(base(), DENTRO, AGORA);
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
      DENTRO,
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
      DENTRO,
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
      DENTRO,
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
    const mascarada = projetarProdutoVitrine(base(), DENTRO, AGORA);
    const crua = projetarProdutoVitrine(
      base({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
        desconto_fim: "2026-09-01T00:00:00.000Z",
      }),
      DENTRO,
      AGORA,
    );
    expect(crua).toEqual(mascarada);
  });

  it("invariante temDesconto ⇔ precoEfetivo < preco em todos os casos", () => {
    const casos: ProdutoParaVitrineComFrequencia[] = [
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
      const v = projetarProdutoVitrine(caso, DENTRO, AGORA);
      expect(v.temDesconto).toBe(v.precoEfetivo < v.preco);
      // Selo e temDesconto andam juntos — selo órfão vira "-20%" sem preço novo.
      expect(v.seloDesconto === null).toBe(!v.temDesconto);
      expect(v.precoEfetivo).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("224 — comprabilidade (D13 / RN-19)", () => {
  it("disponivel = true ⇒ compravel true e motivoNaoCompravel null", () => {
    const v = projetarProdutoVitrine(base({ disponivel: true }), DENTRO, AGORA);
    expect(v.compravel).toBe(true);
    expect(v.motivoNaoCompravel).toBe(null);
  });

  it("disponivel = false ⇒ compravel false e motivo 'esgotado'", () => {
    const v = projetarProdutoVitrine(base({ disponivel: false }), DENTRO, AGORA);
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
      DENTRO,
      AGORA,
    );
    expect(v.compravel).toBe(false);
    expect(v.precoEfetivo).toBe(80);
    expect(v.temDesconto).toBe(true);
  });
});

describe("224 — encaixe nas peças existentes", () => {
  it("aceita `ProdutoPublico` (as 15 colunas da view 265/245) sem cast", () => {
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
      visibilidade: "menu",
      // 320: as 5 colunas de frequência (permanente).
      dias_semana: null,
      hora_inicio: null,
      hora_fim: null,
      periodo_inicio: null,
      periodo_fim: null,
    };
    const v = projetarProdutoVitrine(daView, DENTRO, AGORA);
    expect(v).toMatchObject({ id: daView.id, preco: 8, precoEfetivo: 8, categoria_id: null });

    // O conjunto de chaves é travado, não só conferido por amostragem: um
    // refactor que troque a cópia campo a campo por `...produto` vazaria
    // `visibilidade` e as cinco colunas cruas de desconto ao payload que desce
    // ao browser, e `toMatchObject` não veria nada. Achado do `auditar` na 245.
    expect(Object.keys(v).sort()).toEqual(
      [
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
      ].sort(),
    );
    expect(v).not.toHaveProperty("visibilidade");
  });

  it("`agruparCatalogo` agrupa ProdutoVitrine sem edição da suíte dele", () => {
    const projetados: ProdutoVitrine[] = [
      projetarProdutoVitrine(base(), DENTRO, AGORA),
      projetarProdutoVitrine(base({ id: "x", categoria_id: null }), DENTRO, AGORA),
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

  it("projeta o catálogo por `projetarCatalogoVitrine` (ponto de entrada único, 247)", () => {
    // Booleano, não `toMatch`: a página inteira num diff de falha é ruído.
    // [247] O literal `projetarProdutoVitrine` NÃO é substring de
    // `projetarCatalogoVitrine` — a guarda troca de alvo junto com a página.
    expect(
      /import\s*\{[^}]*projetarCatalogoVitrine[^}]*\}\s*from\s*["']@\/lib\/utils\/catalogoVitrine["']/.test(
        pagina,
      ),
    ).toBe(true);
  });

  it("deriva 'pratos promocionais' por filtro sobre o catálogo já carregado", () => {
    // RN-15: zero query nova, zero tabela nova — `filter(p => p.temDesconto)`.
    // [289] O filtro saiu de `page.tsx` para a camada pura: a página CHAMA a
    // derivação e o `filter` continua existindo num lugar só, aqui do lado.
    expect(/derivarPromocionaisParaModal\(/.test(pagina)).toBe(true);
    expect(
      /\.filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.temDesconto\s*\)/.test(
        readFileSync(FONTE_CONTRATO, "utf8"),
      ),
    ).toBe(true);
  });

  it("não abre NENHUMA query além das seis que já existiam", () => {
    const chamadas = [...codigo.matchAll(/\bbuscar[A-Za-z]+\s*\(/g)].map((m) =>
      m[0].replace(/\s*\($/, ""),
    );
    const PERMITIDAS = [
      "buscarLojaPorSlug",
      "buscarCategorias",
      "buscarProdutosPublicos",
      "buscarOpcionaisPorCategoria",
      // [247] A 5ª query (`buscarCardapiosComProdutos`) SAIU na 323: o cardápio
      // sazonal virou função morta e a frequência mora em produtos/categorias.
      // [303] O modal sazonal ATIVO da loja (RN-02). A guarda continua letal
      // para qualquer query nova. Os PRODUTOS do modal são DERIVADOS do
      // catálogo já carregado (`derivarProdutosDoModalSazonal`) — zero query
      // nova de produto (RN-10).
      "buscarModalSazonalAtivo",
    ];
    expect([...new Set(chamadas)].filter((c) => !PERMITIDAS.includes(c))).toEqual([]);
    // E nenhuma query crua nova escapando pelo client do Supabase na página.
    expect(/\.from\(/.test(codigo)).toBe(false);
  });

  it("[323] sem seção de cardápio: nenhuma leitura nem agrupamento de cardápio", () => {
    for (const proibido of [
      "buscarCardapiosComProdutos",
      "agruparPorCardapio",
      "rotuloJanelaDestaque",
      "secoesDestaque",
    ]) {
      expect(codigo.includes(proibido), proibido).toBe(false);
    }
    // O agrupamento recebe as categorias que a MESMA projeção liberou.
    expect(/agruparCatalogo\(\s*produtosVitrine\s*,\s*categoriasVisiveis\s*\)/.test(codigo)).toBe(true);
  });

  it("não manipula nenhuma coluna crua de desconto no SSR (regra 6)", () => {
    expect(COLUNAS_CRUAS.filter((coluna) => codigo.includes(coluna))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [323] Frequência de exibição na projeção — substitui a vigência de cardápio
// (247/254/273), que virou função morta (S5).
//
// Spec: `specs/frequencia-exibicao.md` RN-1, RN-2, RN-3, RN-7, RN-8 · plano C7.
// Os vereditos são escritos à mão; a regra de janela é de `./frequencia`.
// ═════════════════════════════════════════════════════════════════════════════

const SP = "America/Sao_Paulo";
/** Instante absoluto a partir do horário LOCAL da loja (primitivo da 222). */
const emSP = (local: string) => new Date(instanteNoFuso(local, SP));

/**
 * [273/S5] O vínculo SEM dias do item — usado pelos testes de
 * `agruparPorCardapio` (função morta) mais abaixo.
 */
const semDias = <C extends CardapioVigencia>(cardapio: C): VinculoVigencia<C> => ({
  cardapio,
  dias_semana: null,
});

/** Sábado 17/10/2026 12:00 — dentro de cardápio de fim de semana. */
const SABADO = emSP("2026-10-17T12:00");
/** Sábado 16/01/2027 12:00 — o instante dos cenários de frequência. */
const JANEIRO_SABADO = emSP("2027-01-16T12:00");

const FORA: AvaliacaoFrequencia = { disponivel: false, motivo: "fora_da_frequencia" };

const LOJA = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** Linha INTEIRA de categoria (o `agruparCatalogo` recebe `Categoria[]`). */
function categoriaRow(id: string, nome: string, ordem: number, over: Partial<Categoria> = {}): Categoria {
  return {
    id,
    loja_id: LOJA,
    nome,
    ordem,
    exibir_imagens: true,
    criado_em: "2026-01-01T00:00:00.000Z",
    oculta: false,
    dias_semana: null,
    hora_inicio: null,
    hora_fim: null,
    periodo_inicio: null,
    periodo_fim: null,
    ...over,
  };
}

describe("323 — projetarProdutoVitrine: compravel = disponivel && avaliação", () => {
  const LINHAS: Array<{
    linha: string;
    avaliacao: AvaliacaoFrequencia;
    disponivel: boolean;
    compravel: boolean;
    motivo: "esgotado" | "fora_da_janela" | null;
  }> = [
    { linha: "dentro, disponível ⇒ comprável", avaliacao: DENTRO, disponivel: true, compravel: true, motivo: null },
    { linha: "dentro, esgotado ⇒ esgotado", avaliacao: DENTRO, disponivel: false, compravel: false, motivo: "esgotado" },
    { linha: "fora, disponível ⇒ fora_da_janela", avaliacao: FORA, disponivel: true, compravel: false, motivo: "fora_da_janela" },
    {
      // PRECEDÊNCIA: fora da frequência o item não "acabou" — ele não é
      // servido agora. "Esgotado" seria factualmente errado.
      linha: "fora E esgotado ⇒ fora_da_janela",
      avaliacao: FORA,
      disponivel: false,
      compravel: false,
      motivo: "fora_da_janela",
    },
  ];

  for (const caso of LINHAS) {
    it(caso.linha, () => {
      const v = projetarProdutoVitrine(base({ disponivel: caso.disponivel }), caso.avaliacao, SABADO);
      expect(v.compravel).toBe(caso.compravel);
      expect(v.motivoNaoCompravel).toBe(caso.motivo);
    });
  }

  it("nenhuma coluna crua de FREQUÊNCIA entra no objeto projetado (regra 6)", () => {
    const projetado = projetarProdutoVitrine(
      base({ dias_semana: [6], hora_inicio: "11:00", hora_fim: "15:00", periodo_inicio: "2026-12-01" }),
      FORA,
      SABADO,
    );
    for (const coluna of ["dias_semana", "hora_inicio", "hora_fim", "periodo_inicio", "periodo_fim", "visibilidade"]) {
      expect(Object.keys(projetado)).not.toContain(coluna);
    }
    expect(Object.keys(projetado).sort()).toEqual([...CHAVES_CONTRATO].sort());
  });
});

describe("323 — projetarCatalogoVitrine: frequência produto ∩ categoria", () => {
  const CAT_LIVRE = categoriaRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "Bebidas", 1);
  const CAT_ALMOCO = categoriaRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "Almoço executivo", 2, {
    dias_semana: [1, 2, 3, 4, 5],
  });
  const CAT_OCULTA = categoriaRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", "Sobremesas", 3, { oculta: true });
  const CAT_NATAL = categoriaRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", "Especiais de Natal", 4, {
    periodo_inicio: "2026-12-01",
    periodo_fim: "2026-12-31",
  });
  const CAT_NUNCA = categoriaRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", "Pausa", 5, { dias_semana: [] });
  const CAT_CARNAVAL = categoriaRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6", "Carnaval", 6, {
    periodo_inicio: "2027-02-01",
  });
  const CATEGORIAS = [CAT_LIVRE, CAT_ALMOCO, CAT_OCULTA, CAT_NATAL, CAT_NUNCA, CAT_CARNAVAL];

  let n = 0;
  const produto = (nome: string, categoria: Categoria | null, over: Partial<ProdutoParaVitrineComFrequencia> = {}) =>
    base({
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(++n).padStart(12, "0")}`,
      nome,
      categoria_id: categoria?.id ?? null,
      ...over,
    });

  const COCA = produto("Coca-Cola", CAT_LIVRE);
  const COCA_ESGOTADA = produto("Guaraná", CAT_LIVRE, { disponivel: false });
  const SUCO_NUNCA = produto("Suco do dia", CAT_LIVRE, { dias_semana: [] });
  const PANETONE = produto("Panetone", CAT_LIVRE, { periodo_inicio: "2027-01-01", periodo_fim: "2027-01-10" });
  const PASCOA = produto("Ovo de Páscoa", CAT_LIVRE, { periodo_inicio: "2027-03-01" });
  const JANTA = produto("Janta", CAT_LIVRE, { hora_inicio: "18:00", hora_fim: "23:00" });
  const FEIJOADA = produto("Feijoada", CAT_ALMOCO);
  const PF = produto("PF", CAT_ALMOCO, { disponivel: false });
  const PUDIM = produto("Pudim", CAT_OCULTA);
  const RABANADA = produto("Rabanada", CAT_NATAL);
  const PAUSADO = produto("Pausado", CAT_NUNCA);
  const MARCHINHA = produto("Marchinha", CAT_CARNAVAL);
  const AVULSO = produto("Avulso", null);
  const ORFAO = produto("Órfão", categoriaRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9", "Removida", 9));

  const TODOS = [
    COCA, COCA_ESGOTADA, SUCO_NUNCA, PANETONE, PASCOA, JANTA, FEIJOADA, PF,
    PUDIM, RABANADA, PAUSADO, MARCHINHA, AVULSO, ORFAO,
  ];

  const r = projetarCatalogoVitrine({
    produtos: TODOS,
    categorias: CATEGORIAS,
    agora: JANEIRO_SABADO,
    timezone: SP,
  });
  const porId = new Map(r.produtos.map((p) => [p.id, p]));
  const ids = r.produtos.map((p) => p.id);

  it("RN-2: categoria OCULTA some — ela e os produtos dela, sem cair em 'Outros'", () => {
    expect(ids).not.toContain(PUDIM.id);
    expect(r.categoriasVisiveis.map((c) => c.id)).not.toContain(CAT_OCULTA.id);
    const grupos = agruparCatalogo(r.produtos, r.categoriasVisiveis);
    expect(grupos.map((g) => g.nome)).not.toContain("Sobremesas");
    expect(grupos.flatMap((g) => g.produtos.map((p) => p.id))).not.toContain(PUDIM.id);
  });

  it("RN-2: categoria FORA da frequência aparece, com TODOS os itens fora_da_janela", () => {
    expect(r.categoriasVisiveis.map((c) => c.id)).toContain(CAT_ALMOCO.id);
    for (const p of [FEIJOADA, PF]) {
      expect(porId.get(p.id)?.compravel).toBe(false);
      // Inclusive o esgotado: a janela vence (precedência).
      expect(porId.get(p.id)?.motivoNaoCompravel).toBe("fora_da_janela");
      expect(r.rotulosVigencia[p.id]).toBe("Só seg a sex");
    }
  });

  it("RN-7: produto com período ENCERRADO está AUSENTE", () => {
    expect(ids).not.toContain(PANETONE.id);
  });

  it("RN-7: categoria ENCERRADA some de categoriasVisiveis, com todos os produtos (nem em 'Outros')", () => {
    expect(r.categoriasVisiveis.map((c) => c.id)).not.toContain(CAT_NATAL.id);
    expect(ids).not.toContain(RABANADA.id);
    const outros = agruparCatalogo(r.produtos, r.categoriasVisiveis).find((g) => g.id === null);
    expect(outros?.produtos.map((p) => p.id) ?? []).not.toContain(RABANADA.id);
  });

  it("RN-7: período que ainda NÃO começou ⇒ presente e marcado, 'A partir de dd/MM'", () => {
    expect(porId.get(PASCOA.id)?.motivoNaoCompravel).toBe("fora_da_janela");
    expect(r.rotulosVigencia[PASCOA.id]).toBe("A partir de 01/03");
    expect(r.categoriasVisiveis.map((c) => c.id)).toContain(CAT_CARNAVAL.id);
    expect(porId.get(MARCHINHA.id)?.motivoNaoCompravel).toBe("fora_da_janela");
    expect(r.rotulosVigencia[MARCHINHA.id]).toBe("A partir de 01/02");
  });

  it("RN-8: produto `[]` presente, fora_da_janela, rótulo ROTULO_SEM_VOLTA", () => {
    expect(porId.get(SUCO_NUNCA.id)?.compravel).toBe(false);
    expect(porId.get(SUCO_NUNCA.id)?.motivoNaoCompravel).toBe("fora_da_janela");
    expect(r.rotulosVigencia[SUCO_NUNCA.id]).toBe(ROTULO_SEM_VOLTA);
  });

  it("RN-8: categoria `[]` presente, com todos os itens marcados", () => {
    expect(r.categoriasVisiveis.map((c) => c.id)).toContain(CAT_NUNCA.id);
    expect(porId.get(PAUSADO.id)?.motivoNaoCompravel).toBe("fora_da_janela");
    expect(r.rotulosVigencia[PAUSADO.id]).toBe(ROTULO_SEM_VOLTA);
  });

  it("RN-3: produto fora do horário fica marcado na PRÓPRIA categoria, com o horário", () => {
    expect(porId.get(JANTA.id)?.categoria_id).toBe(CAT_LIVRE.id);
    expect(porId.get(JANTA.id)?.motivoNaoCompravel).toBe("fora_da_janela");
    expect(r.rotulosVigencia[JANTA.id]).toBe("Das 18:00 às 23:00");
  });

  it("dentro da frequência: comprável sem rótulo; esgotado sem rótulo", () => {
    expect(porId.get(COCA.id)).toMatchObject({ compravel: true, motivoNaoCompravel: null });
    expect(porId.get(COCA_ESGOTADA.id)?.motivoNaoCompravel).toBe("esgotado");
    expect(COCA.id in r.rotulosVigencia).toBe(false);
    expect(COCA_ESGOTADA.id in r.rotulosVigencia).toBe(false);
  });

  it("D5: categoria AUSENTE da lista ⇒ produto omitido (fail-closed); sem categoria ⇒ 'Outros'", () => {
    expect(ids).not.toContain(ORFAO.id);
    expect(ids).toContain(AVULSO.id);
    const outros = agruparCatalogo(r.produtos, r.categoriasVisiveis).find((g) => g.id === null);
    expect(outros?.produtos.map((p) => p.id)).toEqual([AVULSO.id]);
  });

  it("TODO produto 'fora_da_janela' tem rótulo; nenhum rótulo órfão", () => {
    const fora = r.produtos.filter((p) => p.motivoNaoCompravel === "fora_da_janela");
    expect(fora.length).toBeGreaterThan(0);
    expect(Object.keys(r.rotulosVigencia).sort()).toEqual(fora.map((p) => p.id).sort());
  });

  it("categoriasVisiveis preserva a linha inteira e a ordem de entrada (genérica em C)", () => {
    expect(r.categoriasVisiveis).toEqual([CAT_LIVRE, CAT_ALMOCO, CAT_NUNCA, CAT_CARNAVAL]);
    expect(r.categoriasVisiveis[1]).toBe(CAT_ALMOCO);
  });

  it("S5: `visibilidade = 'cardapio'` é IGNORADA — permanente vende", () => {
    const legado: ProdutoPublico = {
      id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      loja_id: LOJA,
      categoria_id: CAT_LIVRE.id,
      nome: "Legado",
      descricao: null,
      preco: 10,
      disponivel: true,
      ordem: 0,
      foto_url: null,
      desconto_ativo: false,
      desconto_tipo: null,
      desconto_valor: null,
      desconto_inicio: null,
      desconto_fim: null,
      visibilidade: "cardapio",
      dias_semana: null,
      hora_inicio: null,
      hora_fim: null,
      periodo_inicio: null,
      periodo_fim: null,
    };
    const { produtos } = projetarCatalogoVitrine({
      produtos: [legado],
      categorias: [CAT_LIVRE],
      agora: JANEIRO_SABADO,
      timezone: SP,
    });
    expect(produtos[0]).toMatchObject({ compravel: true, motivoNaoCompravel: null });
  });

  it("loja toda permanente ⇒ catálogo idêntico ao de hoje (não-regressão)", () => {
    const entrada = [COCA, COCA_ESGOTADA, AVULSO];
    const { produtos, rotulosVigencia, categoriasVisiveis } = projetarCatalogoVitrine({
      produtos: entrada,
      categorias: [CAT_LIVRE],
      agora: JANEIRO_SABADO,
      timezone: SP,
    });
    expect(produtos).toEqual(entrada.map((p) => projetarProdutoVitrine(p, DENTRO, JANEIRO_SABADO)));
    expect(rotulosVigencia).toEqual({});
    expect(categoriasVisiveis).toEqual([CAT_LIVRE]);
  });

  it("fuso da loja: o mesmo instante encerra em São Paulo e ainda vende em Manaus", () => {
    const VIRADA = new Date("2027-01-01T03:30:00.000Z");
    const natal = base({ id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2", categoria_id: null, periodo_fim: "2026-12-31" });
    const emSp = projetarCatalogoVitrine({ produtos: [natal], categorias: [], agora: VIRADA, timezone: SP });
    const emManaus = projetarCatalogoVitrine({ produtos: [natal], categorias: [], agora: VIRADA, timezone: "America/Manaus" });
    expect(emSp.produtos).toEqual([]);
    expect(emManaus.produtos[0]?.compravel).toBe(true);
  });
});

describe("247/254/323 — guarda estática da projeção", () => {
  const fonte = readFileSync(FONTE_CONTRATO, "utf8");

  // Montados por partes de propósito: o critério de aceite da 254 é que
  // `grep -rn` por qualquer um dos dois volte VAZIO em `src/`.
  const CONSTANTE_PROVISORIA = ["ROTULO", "VIGENCIA", "PROVISORIO"].join("_");
  const MARCADOR = `TEMP(${254})`;

  it("nem a constante provisória nem o marcador de dívida existem mais", () => {
    expect(fonte).not.toContain(CONSTANTE_PROVISORIA);
    expect(fonte).not.toContain(MARCADOR);
  });

  it("o rótulo vem de `descreverVigencia` — uma redação, sem texto solto aqui", () => {
    expect(fonte).toMatch(/from\s+"\.\/descreverVigencia"/);
    // Nenhuma frase de vigência escrita à mão neste arquivo (M6).
    expect(fonte).not.toContain('"Indisponível no momento"');
  });

  it("`MotivoNaoCompravel` continua com 'esgotado' e 'fora_da_janela', sem motivo novo (D8)", () => {
    const bloco = fonte.match(/export type MotivoNaoCompravel = ([^;]*);/);
    expect(bloco?.[1]).toContain('"esgotado"');
    expect(bloco?.[1]).toContain('"fora_da_janela"');
    expect(bloco?.[1]).not.toContain("encerrado");
    expect(bloco?.[1]).not.toContain("categoria_oculta");
  });

  it("[323] a decisão de janela vem toda de `./frequencia` — sem segunda cópia", () => {
    const corpo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(corpo).toMatch(/from\s+"\.\/frequencia"/);
    expect(corpo).toContain("avaliarFrequenciaNaLoja(");
    expect(corpo).toContain("categoriaVisivel(");
    // A projeção de catálogo não avalia mais vigência de cardápio (S5).
    expect(corpo).not.toContain("avaliarVigenciaDoProduto");
    // Nenhuma aritmética de fuso nem de dia da semana reescrita aqui.
    expect(corpo).not.toContain("Intl.");
    expect(corpo).not.toContain("getDay(");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [248] D16 puro — `agruparPorCardapio`, ordem determinística e o `foto_url`
// zerado POR PRODUTO. Cenário 8 da spec, literal.
// ═════════════════════════════════════════════════════════════════════════════

describe("248 — foto_url é propriedade do PRODUTO, não do grupo (RN-06)", () => {
  const CAT_OCULTA = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  const CAT_MOSTRA = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
  const mapa = new Map([
    [CAT_OCULTA, false],
    [CAT_MOSTRA, true],
  ]);

  it("categoria 'ocultar' ⇒ foto_url null já na projeção", () => {
    const v = projetarProdutoVitrine(
      base({ categoria_id: CAT_OCULTA }),
      DENTRO,
      AGORA,
      mapa,
    );
    expect(v.foto_url).toBe(null);
  });

  it("categoria que EXIBE imagens ⇒ a URL passa intacta", () => {
    const v = projetarProdutoVitrine(
      base({ categoria_id: CAT_MOSTRA }),
      DENTRO,
      AGORA,
      mapa,
    );
    expect(v.foto_url).toBe("https://cdn.exemplo.test/feijoada.jpg");
  });

  it("produto SEM categoria ('Outros') e categoria fora do mapa seguem com foto (RN-5)", () => {
    expect(
      projetarProdutoVitrine(base({ categoria_id: null }), DENTRO, AGORA, mapa)
        .foto_url,
    ).not.toBe(null);
    expect(
      projetarProdutoVitrine(
        base({ categoria_id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd9" }),
        DENTRO,
        AGORA,
        mapa,
      ).foto_url,
    ).not.toBe(null);
  });

  it("sem o mapa (recálculo/painel) o objeto é byte a byte o de antes", () => {
    expect(projetarProdutoVitrine(base(), DENTRO, AGORA, undefined)).toEqual(
      projetarProdutoVitrine(base(), DENTRO, AGORA),
    );
  });

  it("a MESMA referência sai da projeção ⇒ a duplicata de render não pode carregar a URL", () => {
    // O ponto de segurança da 248: com o zeramento por GRUPO, uma segunda
    // seção (destaque, D16-a) copiaria o produto cru e traria a foto de volta.
    // Com ele dentro da projeção, existe UM objeto e UM `foto_url`.
    const { produtos } = projetarCatalogoVitrine({
      produtos: [base({ categoria_id: CAT_OCULTA })],
      categorias: [categoriaRow(CAT_OCULTA, "Ocultar imagens", 1, { exibir_imagens: false })],
      agora: AGORA,
      timezone: SP,
      exibirImagensPorCategoria: mapa,
    });
    expect(produtos[0].foto_url).toBe(null);
  });
});

/**
 * [323/S5] `agruparPorCardapio` virou função morta: a página não monta mais
 * seção de cardápio. Os testes dela ficam, e montam aqui a entrada que a página
 * montava — os produtos projetados (permanentes, a regra de compra de cardápio
 * saiu da projeção) e os cardápios ABERTOS agora, por `cardapioAberto`.
 */
function projetarLegado<C extends CardapioVigencia>(entrada: {
  produtos: ProdutoParaVitrineComFrequencia[];
  vinculosPorProduto: ReadonlyMap<string, VinculoVigencia<C>[]>;
  agora: Date;
  timezone: string;
  exibirImagensPorCategoria?: ReadonlyMap<string, boolean>;
}): { produtos: ProdutoVitrine[]; cardapiosAbertos: C[] } {
  const produtos = entrada.produtos.map((p) =>
    projetarProdutoVitrine(p, DENTRO, entrada.agora, entrada.exibirImagensPorCategoria),
  );
  const vistos = new Set<string>();
  const cardapiosAbertos: C[] = [];
  for (const lista of entrada.vinculosPorProduto.values()) {
    for (const { cardapio } of lista) {
      if (vistos.has(cardapio.id)) continue;
      vistos.add(cardapio.id);
      if (cardapioAberto(cardapio, entrada.agora, entrada.timezone)) cardapiosAbertos.push(cardapio);
    }
  }
  return { produtos, cardapiosAbertos };
}

describe("248 — agruparPorCardapio (D16/RN-15), cenário 8", () => {
  type CardapioDaLoja = CardapioVigencia & { ordem: number };

  const CAT_MASSAS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
  const CAT_SOPAS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

  const categoriasCenario8: Categoria[] = [
    {
      id: CAT_MASSAS,
      loja_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      nome: "Massas",
      ordem: 1,
      exibir_imagens: true,
      criado_em: "2026-01-01T00:00:00.000Z",
      oculta: false,
      dias_semana: null,
      hora_inicio: null,
      hora_fim: null,
      periodo_inicio: null,
      periodo_fim: null,
    },
    {
      id: CAT_SOPAS,
      loja_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      nome: "Sopas",
      ordem: 2,
      exibir_imagens: true,
      criado_em: "2026-01-01T00:00:00.000Z",
      oculta: false,
      dias_semana: null,
      hora_inicio: null,
      hora_fim: null,
      periodo_inicio: null,
      periodo_fim: null,
    },
  ];

  /** "Cardápio de Inverno" ABERTO agora — recorrente sem restrição de dia. */
  const INVERNO_ABERTO: CardapioDaLoja = {
    id: "c0000000-0000-4000-8000-00000000c8a1",
    nome: "Cardápio de Inverno",
    ativo: true,
    modo: "recorrente",
    dias_semana: null,
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    prazo_inicio: null,
    prazo_fim: null,
    ordem: 1,
  };

  const LASANHA = base({
    id: "c8000000-0000-4000-8000-000000000001",
    nome: "Lasanha",
    categoria_id: CAT_MASSAS,
  });
  const NHOQUE = base({
    id: "c8000000-0000-4000-8000-000000000002",
    nome: "Nhoque",
    categoria_id: CAT_MASSAS,
  });
  const SOPA_CEBOLA = base({
    id: "c8000000-0000-4000-8000-000000000003",
    nome: "Sopa de cebola",
    categoria_id: CAT_SOPAS,
  });

  const vinculos = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
    [LASANHA.id, [semDias(INVERNO_ABERTO)]],
    [SOPA_CEBOLA.id, [semDias(INVERNO_ABERTO)]],
  ]);

  function projetarCenario8() {
    return projetarLegado<CardapioDaLoja>({
      produtos: [LASANHA, NHOQUE, SOPA_CEBOLA],
      vinculosPorProduto: vinculos,
      agora: SABADO,
      timezone: SP,
    });
  }

  it("cenário 8 — 3 produtos, 3 seções, 5 cards", () => {
    const { produtos, cardapiosAbertos } = projetarCenario8();
    const destaque = agruparPorCardapio(produtos, cardapiosAbertos, vinculos, SABADO, SP);
    const categoriasSecoes = agruparCatalogo(produtos, categoriasCenario8);

    expect(produtos).toHaveLength(3);
    expect(destaque.map((s) => s.nome)).toEqual(["Cardápio de Inverno"]);
    expect(destaque[0].produtos.map((p) => p.nome)).toEqual([
      "Lasanha",
      "Sopa de cebola",
    ]);
    expect(categoriasSecoes.map((g) => g.nome)).toEqual(["Massas", "Sopas"]);
    // 5 cards: 2 no destaque + 2 em Massas + 1 em Sopas.
    const cards =
      destaque[0].produtos.length +
      categoriasSecoes.reduce((n, g) => n + g.produtos.length, 0);
    expect(cards).toBe(5);
  });

  it("cenário 8 — a duplicata é de RENDER: a MESMA referência nas duas seções", () => {
    const { produtos, cardapiosAbertos } = projetarCenario8();
    const destaque = agruparPorCardapio(produtos, cardapiosAbertos, vinculos, SABADO, SP);
    const massas = agruparCatalogo(produtos, categoriasCenario8)[0];

    const noDestaque = destaque[0].produtos.find((p) => p.nome === "Lasanha");
    const naCategoria = massas.produtos.find((p) => p.nome === "Lasanha");
    expect(noDestaque).toBe(naCategoria);
  });

  it("a seção carrega o discriminante `tipo: \"cardapio\"`", () => {
    const { produtos, cardapiosAbertos } = projetarCenario8();
    expect(
      agruparPorCardapio(produtos, cardapiosAbertos, vinculos, SABADO, SP)[0].tipo,
    ).toBe("cardapio");
  });

  // [279] Continua valendo — mas por FILTRO (`itemAberto`), não mais por
  // propriedade da união dos cardápios.
  it("NENHUM produto de seção de destaque está fora da janela", () => {
    const { produtos, cardapiosAbertos } = projetarCenario8();
    const secoes = agruparPorCardapio(produtos, cardapiosAbertos, vinculos, SABADO, SP);
    for (const secao of secoes) {
      for (const produto of secao.produtos) {
        expect(produto.motivoNaoCompravel).not.toBe("fora_da_janela");
      }
    }
  });

  it("produto ESGOTADO aparece na seção de destaque, com o motivo 'esgotado'", () => {
    const { produtos, cardapiosAbertos } = projetarLegado<CardapioDaLoja>({
      produtos: [{ ...LASANHA, disponivel: false }],
      vinculosPorProduto: new Map([[LASANHA.id, [semDias(INVERNO_ABERTO)]]]),
      agora: SABADO,
      timezone: SP,
    });
    const secao = agruparPorCardapio(produtos, cardapiosAbertos, vinculos, SABADO, SP)[0];
    expect(secao.produtos.map((p) => p.nome)).toEqual(["Lasanha"]);
    expect(secao.produtos[0].compravel).toBe(false);
    expect(secao.produtos[0].motivoNaoCompravel).toBe("esgotado");
  });

  it("produto em DOIS cardápios abertos sai nas DUAS seções (D16-a)", () => {
    const VERAO: CardapioDaLoja = {
      ...INVERNO_ABERTO,
      id: "c0000000-0000-4000-8000-00000000c8a2",
      nome: "Cardápio de Verão",
      ordem: 2,
    };
    const dois = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
      [LASANHA.id, [semDias(INVERNO_ABERTO), semDias(VERAO)]],
    ]);
    const { produtos, cardapiosAbertos } = projetarLegado<CardapioDaLoja>({
      produtos: [LASANHA],
      vinculosPorProduto: dois,
      agora: SABADO,
      timezone: SP,
    });
    const secoes = agruparPorCardapio(produtos, cardapiosAbertos, dois, SABADO, SP);
    expect(secoes.map((s) => s.nome)).toEqual([
      "Cardápio de Inverno",
      "Cardápio de Verão",
    ]);
    expect(secoes.every((s) => s.produtos.length === 1)).toBe(true);
  });

  it("seção de destaque VAZIA não é emitida (regra da 177, reaplicada)", () => {
    // O cardápio está aberto, mas o produto dele saiu do catálogo (RN-13).
    const { cardapiosAbertos } = projetarCenario8();
    expect(agruparPorCardapio([], cardapiosAbertos, vinculos, SABADO, SP)).toEqual([]);
  });

  it("nenhum cardápio aberto ⇒ nenhuma seção de destaque", () => {
    const { produtos } = projetarCenario8();
    expect(agruparPorCardapio(produtos, [], vinculos, SABADO, SP)).toEqual([]);
  });

  it("ordem `ordem → nome → id`, com EMPATE nos dois primeiros critérios", () => {
    const semana = (
      id: string,
      nome: string,
      ordem: number,
    ): CardapioDaLoja => ({ ...INVERNO_ABERTO, id, nome, ordem });

    // ordem 1 aparece antes de ordem 2; dentro de ordem 1 o nome decide; com
    // nome IGUAL, o id decide.
    const b1 = semana("c0000000-0000-4000-8000-0000000000b1", "Bistrô", 1);
    const a2 = semana("c0000000-0000-4000-8000-0000000000a2", "Almoço", 2);
    const z1 = semana("c0000000-0000-4000-8000-0000000000z1", "Bistrô", 1);
    const a1 = semana("c0000000-0000-4000-8000-0000000000a1", "Almoço", 1);

    const vinculosOrdem = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
      [LASANHA.id, [semDias(b1), semDias(a2), semDias(z1), semDias(a1)]],
    ]);
    const { produtos, cardapiosAbertos } = projetarLegado<CardapioDaLoja>({
      produtos: [LASANHA],
      vinculosPorProduto: vinculosOrdem,
      agora: SABADO,
      timezone: SP,
    });

    expect(
      agruparPorCardapio(produtos, cardapiosAbertos, vinculosOrdem, SABADO, SP).map(
        (s) => s.id,
      ),
    ).toEqual([a1.id, b1.id, z1.id, a2.id]);
  });

  it("foto_url de categoria 'ocultar' é null TAMBÉM na seção de destaque", () => {
    const mapa = new Map([[CAT_SOPAS, false]]);
    const { produtos, cardapiosAbertos } = projetarLegado<CardapioDaLoja>({
      produtos: [SOPA_CEBOLA],
      vinculosPorProduto: vinculos,
      agora: SABADO,
      timezone: SP,
      exibirImagensPorCategoria: mapa,
    });
    const secao = agruparPorCardapio(produtos, cardapiosAbertos, vinculos, SABADO, SP)[0];
    expect(secao.produtos[0].foto_url).toBe(null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [279] D16-b/RN-05 — a seção do cardápio lista só os ITENS DO DIA, e some
// quando nenhum item do cardápio está aberto hoje.
//
// Nada aqui reescreve a regra de dia: o veredito é o de `itemAberto` (273), e
// os casos são os da spec §Vitrine da loja, com o resultado escrito à mão.
// ═════════════════════════════════════════════════════════════════════════════

describe("279 — agruparPorCardapio filtra por ITEM, não por cardápio", () => {
  type CardapioDaLoja = CardapioVigencia & { ordem: number };

  /** "Especiais do Dia": recorrente, ativo, ABERTO os 7 dias. */
  const ESPECIAIS: CardapioDaLoja = {
    id: "c0000000-0000-4000-8000-0000000002f9",
    nome: "Especiais do Dia",
    ativo: true,
    modo: "recorrente",
    dias_semana: null,
    dias_mes: null,
    hora_inicio: null,
    hora_fim: null,
    prazo_inicio: null,
    prazo_fim: null,
    ordem: 1,
  };

  const comDias = (
    cardapio: CardapioDaLoja,
    dias: number[],
  ): VinculoVigencia<CardapioDaLoja> => ({ cardapio, dias_semana: dias });

  const FEIJOADA = base({
    id: "27900000-0000-4000-8000-000000000001",
    nome: "Feijoada",
  });
  const VIRADO = base({
    id: "27900000-0000-4000-8000-000000000002",
    nome: "Virado à paulista",
  });
  const DOBRADINHA = base({
    id: "27900000-0000-4000-8000-000000000003",
    nome: "Dobradinha",
  });

  /** Feijoada {qua,sáb}, Virado {seg}, Dobradinha {ter} — um cardápio só. */
  const agenda = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
    [FEIJOADA.id, [comDias(ESPECIAIS, [3, 6])]],
    [VIRADO.id, [comDias(ESPECIAIS, [1])]],
    [DOBRADINHA.id, [comDias(ESPECIAIS, [2])]],
  ]);

  /** Quarta 14/10/2026 12:00 e domingo 18/10/2026 12:00, no fuso da LOJA. */
  const QUARTA = emSP("2026-10-14T12:00");
  const DOMINGO = emSP("2026-10-18T12:00");

  function projetar(agora: Date) {
    return projetarLegado<CardapioDaLoja>({
      produtos: [FEIJOADA, VIRADO, DOBRADINHA],
      vinculosPorProduto: agenda,
      agora,
      timezone: SP,
    });
  }

  it("quarta — a seção do cardápio aberto os 7 dias contém SÓ o item {qua,sáb}", () => {
    const { produtos, cardapiosAbertos } = projetar(QUARTA);
    const secoes = agruparPorCardapio(
      produtos,
      cardapiosAbertos,
      agenda,
      QUARTA,
      SP,
    );

    // RN-13: nenhum dos três some do catálogo — todos têm volta.
    expect(produtos.map((p) => p.nome)).toEqual([
      "Feijoada",
      "Virado à paulista",
      "Dobradinha",
    ]);
    expect(secoes.map((s) => s.nome)).toEqual(["Especiais do Dia"]);
    expect(secoes[0].produtos.map((p) => p.nome)).toEqual(["Feijoada"]);
  });

  it("domingo sem NENHUM item do dia — a seção não é devolvida", () => {
    const { produtos, cardapiosAbertos } = projetar(DOMINGO);

    // O cardápio continua ABERTO (7 dias): quem esvazia a seção é o item.
    expect(cardapiosAbertos.map((c) => c.nome)).toEqual(["Especiais do Dia"]);
    expect(
      agruparPorCardapio(produtos, cardapiosAbertos, agenda, DOMINGO, SP),
    ).toEqual([]);
  });

  it("produto 'menu' com vínculo agendado é comprável TODO dia — e some só da seção", () => {
    const refri = base({
      id: "27900000-0000-4000-8000-000000000004",
      nome: "Refrigerante",
    });
    const soQuarta = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
      [refri.id, [comDias(ESPECIAIS, [3])]],
    ]);
    const { produtos, cardapiosAbertos } =
      projetarLegado<CardapioDaLoja>({
        produtos: [refri],
        vinculosPorProduto: soQuarta,
        agora: DOMINGO,
        timezone: SP,
      });

    // RN-05: 'menu' curto-circuita antes de olhar cardápio — vende no domingo.
    expect(produtos[0].compravel).toBe(true);
    // Mas a seção é a projeção do CARDÁPIO, não da comprabilidade.
    expect(
      agruparPorCardapio(produtos, cardapiosAbertos, soQuarta, DOMINGO, SP),
    ).toEqual([]);
  });

  it("dois cardápios abertos, agenda só num deles ⇒ sai na seção de quem abre PARA ELE", () => {
    const NOITE: CardapioDaLoja = {
      ...ESPECIAIS,
      id: "c0000000-0000-4000-8000-0000000002fa",
      nome: "Especiais da Noite",
      ordem: 2,
    };
    const dois = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
      [FEIJOADA.id, [comDias(ESPECIAIS, [3, 6]), comDias(NOITE, [1])]],
    ]);
    const { produtos, cardapiosAbertos } =
      projetarLegado<CardapioDaLoja>({
        produtos: [FEIJOADA],
        vinculosPorProduto: dois,
        agora: QUARTA,
        timezone: SP,
      });

    // `dentroDaJanela` é a UNIÃO dos vínculos: pôr o produto em mais um
    // cardápio nunca reduz disponibilidade.
    expect(produtos[0].compravel).toBe(true);
    const secoes = agruparPorCardapio(
      produtos,
      cardapiosAbertos,
      dois,
      QUARTA,
      SP,
    );
    expect(secoes.map((s) => s.nome)).toEqual(["Especiais do Dia"]);
  });

  it("vínculo SEM dias do item ⇒ o comportamento de hoje, em qualquer dia", () => {
    const semAgenda = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
      [FEIJOADA.id, [semDias(ESPECIAIS)]],
    ]);
    for (const agora of [QUARTA, DOMINGO]) {
      const { produtos, cardapiosAbertos } =
        projetarLegado<CardapioDaLoja>({
          produtos: [FEIJOADA],
          vinculosPorProduto: semAgenda,
          agora,
          timezone: SP,
        });
      expect(
        agruparPorCardapio(
          produtos,
          cardapiosAbertos,
          semAgenda,
          agora,
          SP,
        )[0].produtos.map((p) => p.nome),
      ).toEqual(["Feijoada"]);
    }
  });

  it("produto ESGOTADO dentro do dia continua na seção (disponivel é ortogonal)", () => {
    const soFeijoada = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
      [FEIJOADA.id, [comDias(ESPECIAIS, [3, 6])]],
    ]);
    const { produtos, cardapiosAbertos } =
      projetarLegado<CardapioDaLoja>({
        produtos: [{ ...FEIJOADA, disponivel: false }],
        vinculosPorProduto: soFeijoada,
        agora: QUARTA,
        timezone: SP,
      });
    const secao = agruparPorCardapio(
      produtos,
      cardapiosAbertos,
      soFeijoada,
      QUARTA,
      SP,
    )[0];

    expect(secao.produtos.map((p) => p.motivoNaoCompravel)).toEqual([
      "esgotado",
    ]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [289] `derivarPromocionaisParaModal` — os promocionais prontos para o DETALHE.
//
// O que esta função decide: QUAIS pratos o modal de promoções lista (RN-15, o
// mesmo filtro de sempre) e COM QUE dados cada um abre o `ProdutoModal` — os
// opcionais da categoria dele e a frase de "quando volta". Nada de monetário é
// calculado aqui: `temDesconto` já veio da projeção.
// ═════════════════════════════════════════════════════════════════════════════

describe("289 — derivarPromocionaisParaModal", () => {
  const prato = (
    id: string,
    patch: Partial<ProdutoVitrine> = {},
  ): ProdutoVitrine => ({
    id,
    nome: `Prato ${id}`,
    descricao: null,
    foto_url: null,
    categoria_id: null,
    preco: 100,
    precoEfetivo: 100,
    temDesconto: false,
    seloDesconto: null,
    descontoFim: null,
    compravel: true,
    motivoNaoCompravel: null,
    ...patch,
  });

  const emPromocao = (id: string, patch: Partial<ProdutoVitrine> = {}) =>
    prato(id, {
      precoEfetivo: 80,
      temDesconto: true,
      seloDesconto: "-20%",
      ...patch,
    });

  const GRUPOS_LANCHE = [
    { id: "g1", nome: "Ponto da carne", obrigatorio: false, opcionais: [] },
  ] as unknown as GrupoOpcional[];
  const GRUPOS_BEBIDA = [
    { id: "g2", nome: "Gelo", obrigatorio: false, opcionais: [] },
  ] as unknown as GrupoOpcional[];

  const secao = (
    id: string | null,
    produtos: ProdutoVitrine[],
  ): CategoriaComProdutos => ({ id, nome: `Cat ${id}`, produtos });

  it("lista SÓ os pratos com desconto, na ordem do catálogo", () => {
    const promocionais = derivarPromocionaisParaModal(
      [
        secao("c1", [prato("a"), emPromocao("b", { categoria_id: "c1" })]),
        secao("c2", [emPromocao("c", { categoria_id: "c2" }), prato("d")]),
      ],
      {},
      {},
    );
    expect(promocionais.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("catálogo sem promoção nenhuma devolve lista vazia", () => {
    expect(derivarPromocionaisParaModal([secao("c1", [prato("a")])], {}, {})).toEqual(
      [],
    );
  });

  it("acopla os grupos de opcional da categoria CERTA, pela MESMA referência", () => {
    const [lanche, bebida] = derivarPromocionaisParaModal(
      [
        secao("c1", [emPromocao("a", { categoria_id: "c1" })]),
        secao("c2", [emPromocao("b", { categoria_id: "c2" })]),
      ],
      { c1: GRUPOS_LANCHE, c2: GRUPOS_BEBIDA },
      {},
    );
    // Referência, não cópia: é o mesmo objeto que já viaja no payload RSC.
    expect(lanche.gruposOpcionais).toBe(GRUPOS_LANCHE);
    expect(bebida.gruposOpcionais).toBe(GRUPOS_BEBIDA);
  });

  it("produto SEM categoria não recebe opcionais de ninguém", () => {
    const [semCategoria] = derivarPromocionaisParaModal(
      [secao(null, [emPromocao("a", { categoria_id: null })])],
      { c1: GRUPOS_LANCHE },
      {},
    );
    expect(semCategoria.gruposOpcionais).toBeUndefined();
  });

  it("categoria sem opcional cadastrado não inventa grupo", () => {
    const [p] = derivarPromocionaisParaModal(
      [secao("c9", [emPromocao("a", { categoria_id: "c9" })])],
      { c1: GRUPOS_LANCHE },
      {},
    );
    expect(p.gruposOpcionais).toBeUndefined();
  });

  it("acopla o rótulo de vigência POR ID do produto", () => {
    const [a, b] = derivarPromocionaisParaModal(
      [secao("c1", [emPromocao("a"), emPromocao("b")])],
      {},
      { a: "Volta amanhã, às 11:00", b: "Volta no sábado" },
    );
    expect(a.rotuloIndisponivel).toBe("Volta amanhã, às 11:00");
    expect(b.rotuloIndisponivel).toBe("Volta no sábado");
  });

  it("chave de vigência AUSENTE não inventa rótulo (fica `undefined`)", () => {
    const [p] = derivarPromocionaisParaModal(
      [secao("c1", [emPromocao("a")])],
      {},
      { outro: "Volta no sábado" },
    );
    expect(p.rotuloIndisponivel).toBeUndefined();
  });

  it("preserva o contrato INTEIRO do produto (nada remontado campo a campo, D13)", () => {
    const origem = emPromocao("a", {
      categoria_id: "c1",
      compravel: false,
      motivoNaoCompravel: "esgotado",
      foto_url: "https://exemplo.test/foto.jpg",
      descontoFim: "2026-09-30T00:00:00.000Z",
    });
    const [p] = derivarPromocionaisParaModal([secao("c1", [origem])], {}, {});
    for (const chave of CHAVES_CONTRATO) {
      expect(p[chave as keyof ProdutoVitrine]).toEqual(
        origem[chave as keyof ProdutoVitrine],
      );
    }
    // RN-8: esgotado em promoção continua listado — comprabilidade não filtra.
    expect(p.compravel).toBe(false);
  });

  it("é pura: não lê relógio e não muta as seções de entrada", () => {
    const secoes = [secao("c1", [emPromocao("a", { categoria_id: "c1" })])];
    const antes = JSON.stringify(secoes);
    derivarPromocionaisParaModal(secoes, { c1: GRUPOS_LANCHE }, { a: "x" });
    expect(JSON.stringify(secoes)).toBe(antes);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [303/RN-10] `derivarProdutosDoModalSazonal` — produtos curados do modal sazonal.
//
// A função filtra SOBRE o que a página já projetou: seções de categoria e
// seções de destaque (cardápios abertos). Cardápio fora de vigência não tem
// seção em `secoesDestaque` e portanto não contribui produto — a vigência
// filtra aqui por reuso, não por aritmética nova.
//
// O que estes testes provam:
//  1. seleção de categorias devolve os produtos das categorias selecionadas;
//  2. seleção de cardápios devolve os produtos das seções de destaque selecionadas;
//  3. união sem duplicatas (dedup por id, primeira aparição prevalece);
//  4. cardápio fora de vigência não contribui produtos (a seção simplesmente
//     não existe em `secoesDestaque`);
//  5. seleção vazia dos dois eixos devolve lista vazia;
//  6. grupo "Outros" (id === null) nunca entra por engano;
//  7. o contrato completo do produto (ProdutoVitrine) é preservado — nada remontado
//     campo a campo, mesma exigência de `derivarPromocionaisParaModal` (D13).
// ═════════════════════════════════════════════════════════════════════════════

describe("303 — derivarProdutosDoModalSazonal", () => {
  // ── helpers compartilhados ─────────────────────────────────────────────────

  const p = (id: string, patch: Partial<ProdutoVitrine> = {}): ProdutoVitrine => ({
    id,
    nome: `Produto ${id}`,
    descricao: null,
    foto_url: null,
    categoria_id: null,
    preco: 50,
    precoEfetivo: 50,
    temDesconto: false,
    seloDesconto: null,
    descontoFim: null,
    compravel: true,
    motivoNaoCompravel: null,
    ...patch,
  });

  const secaoCategoria = (
    id: string | null,
    produtos: ProdutoVitrine[],
  ): CategoriaComProdutos => ({ id, nome: `Cat ${id}`, produtos });

  const secaoCardapio = (
    id: string,
    produtos: ProdutoVitrine[],
  ): CategoriaComProdutos => ({ id, nome: `Cardápio ${id}`, produtos });

  const CAT_A = "aaaa0000-0000-4000-8000-000000000001";
  const CAT_B = "bbbb0000-0000-4000-8000-000000000002";
  const CARD_X = "xxxx0000-0000-4000-8000-000000000003";
  const CARD_Y = "yyyy0000-0000-4000-8000-000000000004";

  const P1 = p("p1", { categoria_id: CAT_A });
  const P2 = p("p2", { categoria_id: CAT_A });
  const P3 = p("p3", { categoria_id: CAT_B });
  const P4 = p("p4"); // em cardápio CARD_X

  const GRUPOS_ENTRADA = [
    { id: "g1", nome: "Ponto", obrigatorio: false, opcionais: [] },
  ] as unknown as GrupoOpcional[];

  // ── cenários principais ────────────────────────────────────────────────────

  it("só categorias selecionadas — devolve produtos das categorias, na ordem do catálogo", () => {
    const resultado = derivarProdutosDoModalSazonal(
      [secaoCategoria(CAT_A, [P1, P2]), secaoCategoria(CAT_B, [P3])],
      [],
      {},
      {},
      { categorias: [CAT_A], cardapios: [] },
    );
    expect(resultado.map((r) => r.id)).toEqual(["p1", "p2"]);
  });

  it("só cardápios selecionados — devolve produtos das seções de destaque ativas", () => {
    const resultado = derivarProdutosDoModalSazonal(
      [],
      [secaoCardapio(CARD_X, [P4])],
      {},
      {},
      { categorias: [], cardapios: [CARD_X] },
    );
    expect(resultado.map((r) => r.id)).toEqual(["p4"]);
  });

  it("ambos selecionados — retorna união, ordem: categorias primeiro, depois cardápios", () => {
    const resultado = derivarProdutosDoModalSazonal(
      [secaoCategoria(CAT_A, [P1])],
      [secaoCardapio(CARD_X, [P4])],
      {},
      {},
      { categorias: [CAT_A], cardapios: [CARD_X] },
    );
    expect(resultado.map((r) => r.id)).toEqual(["p1", "p4"]);
  });

  it("dedup por id — produto em categoria E cardápio selecionados aparece UMA vez, na posição da categoria", () => {
    // P1 está em CAT_A (categoria) e também no CARD_X (seção de destaque).
    const resultado = derivarProdutosDoModalSazonal(
      [secaoCategoria(CAT_A, [P1])],
      [secaoCardapio(CARD_X, [P1, P4])],
      {},
      {},
      { categorias: [CAT_A], cardapios: [CARD_X] },
    );
    // P1 aparece só uma vez (posição da categoria), P4 entra depois.
    expect(resultado.map((r) => r.id)).toEqual(["p1", "p4"]);
  });

  it("cardápio fora de vigência não contribui — sua seção simplesmente não está em secoesDestaque", () => {
    // O filtro de vigência acontece antes: `agruparPorCardapio` só emite seções
    // de cardápios abertos. Cardápio expirado não tem seção; logo, não há produto.
    const resultado = derivarProdutosDoModalSazonal(
      [],
      // secoesDestaque está vazia — o cardápio CARD_Y expirou antes do SSR
      [],
      {},
      {},
      { categorias: [], cardapios: [CARD_Y] },
    );
    expect(resultado).toEqual([]);
  });

  it("seleção vazia dos dois eixos devolve array vazio", () => {
    const resultado = derivarProdutosDoModalSazonal(
      [secaoCategoria(CAT_A, [P1, P2])],
      [secaoCardapio(CARD_X, [P4])],
      {},
      {},
      { categorias: [], cardapios: [] },
    );
    expect(resultado).toEqual([]);
  });

  it("grupo 'Outros' (id === null) nunca entra, mesmo com null nos cardapios", () => {
    // `has(null)` é sempre false — o grupo "Outros" não é selecionável.
    const outros = secaoCategoria(null, [P1]);
    const resultado = derivarProdutosDoModalSazonal(
      [outros],
      [],
      {},
      {},
      // TypeScript não aceita null na lista de strings; o teste valida o
      // comportamento em runtime (valor null nunca deveria chegar, mas a
      // guarda `secao.id === null` existe no código por segurança).
      { categorias: [] as string[], cardapios: [] },
    );
    expect(resultado).toEqual([]);
  });

  it("categoria não selecionada não contribui nenhum produto", () => {
    const resultado = derivarProdutosDoModalSazonal(
      [secaoCategoria(CAT_A, [P1]), secaoCategoria(CAT_B, [P3])],
      [],
      {},
      {},
      { categorias: [CAT_B], cardapios: [] },
    );
    // Só CAT_B foi selecionada; P1 de CAT_A não aparece.
    expect(resultado.map((r) => r.id)).toEqual(["p3"]);
  });

  it("acopla gruposOpcionais e rotuloIndisponivel pelo enriquecimento de modal", () => {
    const GRUPOS = [{ id: "g1", nome: "Ponto", obrigatorio: false, opcionais: [] }] as unknown as GrupoOpcional[];
    const produto = p("p1", { categoria_id: CAT_A });
    const resultado = derivarProdutosDoModalSazonal(
      [secaoCategoria(CAT_A, [produto])],
      [],
      { [CAT_A]: GRUPOS },
      { p1: "Volta sábado" },
      { categorias: [CAT_A], cardapios: [] },
    );
    expect(resultado[0].gruposOpcionais).toBe(GRUPOS);
    expect(resultado[0].rotuloIndisponivel).toBe("Volta sábado");
  });

  it("produto SEM categoria não recebe grupos de opcional de nenhuma categoria", () => {
    const semCategoria = p("p-sem", { categoria_id: null });
    const resultado = derivarProdutosDoModalSazonal(
      [],
      [secaoCardapio(CARD_X, [semCategoria])],
      { [CAT_A]: GRUPOS_ENTRADA },
      {},
      { categorias: [], cardapios: [CARD_X] },
    );
    expect(resultado[0].gruposOpcionais).toBeUndefined();
  });

  it("preserva o contrato INTEIRO de ProdutoVitrine — nada remontado campo a campo", () => {
    const origin = p("p-full", {
      categoria_id: CAT_A,
      compravel: false,
      motivoNaoCompravel: "esgotado",
      foto_url: "https://cdn.example/foto.jpg",
      temDesconto: true,
      precoEfetivo: 40,
      seloDesconto: "-20%",
      descontoFim: "2026-10-01T00:00:00.000Z",
    });
    const resultado = derivarProdutosDoModalSazonal(
      [secaoCategoria(CAT_A, [origin])],
      [],
      {},
      {},
      { categorias: [CAT_A], cardapios: [] },
    );
    // Cada campo do contrato deve chegar intacto.
    const r = resultado[0];
    expect(r.id).toBe(origin.id);
    expect(r.compravel).toBe(false);
    expect(r.motivoNaoCompravel).toBe("esgotado");
    expect(r.foto_url).toBe("https://cdn.example/foto.jpg");
    expect(r.temDesconto).toBe(true);
    expect(r.precoEfetivo).toBe(40);
    expect(r.seloDesconto).toBe("-20%");
    expect(r.descontoFim).toBe("2026-10-01T00:00:00.000Z");
  });

  it("é pura — não muta as listas de entrada", () => {
    const categorias = [secaoCategoria(CAT_A, [P1])];
    const destaque = [secaoCardapio(CARD_X, [P4])];
    const snapCat = JSON.stringify(categorias);
    const snapDest = JSON.stringify(destaque);
    derivarProdutosDoModalSazonal(categorias, destaque, {}, {}, {
      categorias: [CAT_A],
      cardapios: [CARD_X],
    });
    expect(JSON.stringify(categorias)).toBe(snapCat);
    expect(JSON.stringify(destaque)).toBe(snapDest);
  });

  it("duas categorias selecionadas — produtos de ambas, na ordem das seções", () => {
    const resultado = derivarProdutosDoModalSazonal(
      [secaoCategoria(CAT_A, [P1, P2]), secaoCategoria(CAT_B, [P3])],
      [],
      {},
      {},
      { categorias: [CAT_A, CAT_B], cardapios: [] },
    );
    expect(resultado.map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("dois cardápios selecionados — produtos de ambos, ordem das seções de destaque", () => {
    const resultado = derivarProdutosDoModalSazonal(
      [],
      [secaoCardapio(CARD_X, [P4]), secaoCardapio(CARD_Y, [P3])],
      {},
      {},
      { categorias: [], cardapios: [CARD_X, CARD_Y] },
    );
    expect(resultado.map((r) => r.id)).toEqual(["p4", "p3"]);
  });

  it("categoria com lista vazia de produtos não contribui nada", () => {
    const resultado = derivarProdutosDoModalSazonal(
      [secaoCategoria(CAT_A, [])],
      [],
      {},
      {},
      { categorias: [CAT_A], cardapios: [] },
    );
    expect(resultado).toEqual([]);
  });
});
