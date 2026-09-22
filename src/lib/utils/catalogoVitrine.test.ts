import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  agruparPorCardapio,
  derivarPromocionaisParaModal,
  projetarProdutoVitrine,
  // [247] RED — AINDA NÃO IMPLEMENTADOS (stub de assinatura em ./catalogoVitrine.ts).
  projetarCatalogoVitrine,
  type ProdutoParaVitrine,
  type ProdutoVitrine,
} from "./catalogoVitrine";
import type { CardapioVigencia, VinculoVigencia } from "./vigenciaCardapio";
import { instanteNoFuso } from "./fusoLoja";
import { rotuloVoltaQuando } from "./descreverVigencia";
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
/** [247] fuso da LOJA — 3º/4º parâmetros passaram a ser obrigatórios. */
const TZ = "America/Sao_Paulo";

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

/** [247] `projetarProdutoVitrine` passou a exigir `visibilidade` na entrada. */
type ProdutoParaVitrineComVisibilidade = ProdutoParaVitrine & { visibilidade: string };

function base(
  over: Partial<ProdutoParaVitrineComVisibilidade> = {},
): ProdutoParaVitrineComVisibilidade {
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
    visibilidade: "menu",
    ...over,
  };
}

/** `Intl` usa NBSP entre "R$" e o número; normaliza para comparar literal. */
const semNbsp = (s: string | null) => (s == null ? s : s.replace(/\u00a0/g, " "));

describe("224 — formato do objeto projetado", () => {
  it("devolve EXATAMENTE as 12 chaves do contrato, sem sobra e sem falta", () => {
    const v = projetarProdutoVitrine(base(), [], AGORA, TZ);
    expect(Object.keys(v).sort()).toEqual([...CHAVES_CONTRATO].sort());
  });

  it("NÃO carrega nenhuma das cinco colunas cruas de desconto (regra 6)", () => {
    // Produto COM desconto vigente: é o caso em que as colunas cruas teriam
    // valor e a projeção preguiçosa (spread da row) as deixaria vazar.
    const v = projetarProdutoVitrine(
      base({ desconto_ativo: true, desconto_tipo: "percentual", desconto_valor: 20 }),
      [],
      AGORA,
      TZ,
    );
    const chaves = Object.keys(v);
    for (const coluna of COLUNAS_CRUAS) {
      expect(chaves).not.toContain(coluna);
      expect(coluna in v).toBe(false);
    }
  });

  it("NÃO carrega `loja_id`, `ordem`, `disponivel` nem `oculto` crus", () => {
    const chaves = Object.keys(projetarProdutoVitrine(base(), [], AGORA, TZ));
    for (const coluna of ["loja_id", "ordem", "disponivel", "oculto"]) {
      expect(chaves).not.toContain(coluna);
    }
  });

  it("não muta a entrada (função pura)", () => {
    const entrada = base({ desconto_ativo: true, desconto_tipo: "fixo", desconto_valor: 30 });
    const copia = structuredClone(entrada);
    projetarProdutoVitrine(entrada, [], AGORA, TZ);
    expect(entrada).toEqual(copia);
  });
});

describe("224 — preço e desconto (D1, RN-02, reuso de precoEfetivo)", () => {
  it("sem desconto: precoEfetivo === preco, temDesconto false, selo e fim null", () => {
    const v = projetarProdutoVitrine(base(), [], AGORA, TZ);
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
      [],
      AGORA,
      TZ,
    );
    expect(v.precoEfetivo).toBe(80);
    expect(v.temDesconto).toBe(true);
    expect(v.seloDesconto).toBe("-20%");
    expect(v.descontoFim).toBe(fim);
  });

  it("fixo vigente: 100 − R$ 30 ⇒ 70, selo '-R$ 30,00'", () => {
    const v = projetarProdutoVitrine(
      base({ desconto_ativo: true, desconto_tipo: "fixo", desconto_valor: 30 }),
      [],
      AGORA,
      TZ,
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
      [],
      AGORA,
      TZ,
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
    const mascarada = projetarProdutoVitrine(base(), [], AGORA, TZ);
    const crua = projetarProdutoVitrine(
      base({
        desconto_ativo: true,
        desconto_tipo: "percentual",
        desconto_valor: 20,
        desconto_fim: "2026-09-01T00:00:00.000Z",
      }),
      [],
      AGORA,
      TZ,
    );
    expect(crua).toEqual(mascarada);
  });

  it("invariante temDesconto ⇔ precoEfetivo < preco em todos os casos", () => {
    const casos: ProdutoParaVitrineComVisibilidade[] = [
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
      const v = projetarProdutoVitrine(caso, [], AGORA, TZ);
      expect(v.temDesconto).toBe(v.precoEfetivo < v.preco);
      // Selo e temDesconto andam juntos — selo órfão vira "-20%" sem preço novo.
      expect(v.seloDesconto === null).toBe(!v.temDesconto);
      expect(v.precoEfetivo).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("224 — comprabilidade (D13 / RN-19)", () => {
  it("disponivel = true ⇒ compravel true e motivoNaoCompravel null", () => {
    const v = projetarProdutoVitrine(base({ disponivel: true }), [], AGORA, TZ);
    expect(v.compravel).toBe(true);
    expect(v.motivoNaoCompravel).toBe(null);
  });

  it("disponivel = false ⇒ compravel false e motivo 'esgotado'", () => {
    const v = projetarProdutoVitrine(base({ disponivel: false }), [], AGORA, TZ);
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
      [],
      AGORA,
      TZ,
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
    };
    const v = projetarProdutoVitrine(daView, [], AGORA, TZ);
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
      projetarProdutoVitrine(base(), [], AGORA, TZ),
      projetarProdutoVitrine(base({ id: "x", categoria_id: null }), [], AGORA, TZ),
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

  it("não abre NENHUMA query além das quatro que já existiam", () => {
    const chamadas = [...codigo.matchAll(/\bbuscar[A-Za-z]+\s*\(/g)].map((m) =>
      m[0].replace(/\s*\($/, ""),
    );
    const PERMITIDAS = [
      "buscarLojaPorSlug",
      "buscarCategorias",
      "buscarProdutosPublicos",
      "buscarOpcionaisPorCategoria",
      // [247] 5ª query, e SÓ ela: a guarda continua letal para a 6ª.
      "buscarCardapiosComProdutos",
    ];
    expect([...new Set(chamadas)].filter((c) => !PERMITIDAS.includes(c))).toEqual([]);
    // E nenhuma query crua nova escapando pelo client do Supabase na página.
    expect(/\.from\(/.test(codigo)).toBe(false);
  });

  it("não manipula nenhuma coluna crua de desconto no SSR (regra 6)", () => {
    expect(COLUNAS_CRUAS.filter((coluna) => codigo.includes(coluna))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// [247] Fase RED — extensão do contrato com VIGÊNCIA de cardápio.
//
// Spec: `specs/cardapio-sazonal.md` cenários 3 e 6 · RN-05, RN-06, RN-13 ·
// D4, D14. Plano técnico da issue 247, §"O que o RED precisa provar" (§5.7).
//
// Nada aqui reproduz a fórmula da produção: as linhas do cenário 3 são a TABELA
// da spec transcrita, com o veredito literal escrito à mão coluna a coluna.
// ═════════════════════════════════════════════════════════════════════════════

const SP = "America/Sao_Paulo";
/** Instante absoluto a partir do horário LOCAL da loja (primitivo da 222). */
const emSP = (local: string) => new Date(instanteNoFuso(local, SP));

/** Cenário 1 da spec: recorrente sáb+dom, 11:00–15:00. */
/**
 * [273] O vínculo SEM dias do item — a forma de 100% das linhas no deploy da
 * 272. A projeção tem de sair byte a byte igual à de antes do eixo mudar.
 */
const semDias = <C extends CardapioVigencia>(cardapio: C): VinculoVigencia<C> => ({
  cardapio,
  dias_semana: null,
});

const FIM_DE_SEMANA: CardapioVigencia = {
  id: "c0000000-0000-4000-8000-000000000001",
  nome: "Fim de semana",
  ativo: true,
  modo: "recorrente",
  dias_semana: [6, 0],
  dias_mes: null,
  hora_inicio: "11:00",
  hora_fim: "15:00",
  prazo_inicio: null,
  prazo_fim: null,
};

/** Cenário 6: prazo fixo 01/06/2026 → 01/09/2026, EXPIRADO em dezembro. */
const INVERNO: CardapioVigencia = {
  id: "c0000000-0000-4000-8000-000000000002",
  nome: "Cardápio de Inverno",
  ativo: true,
  modo: "prazo_fixo",
  dias_semana: null,
  dias_mes: null,
  hora_inicio: null,
  hora_fim: null,
  prazo_inicio: "2026-06-01T00:00:00.000Z",
  prazo_fim: "2026-09-01T00:00:00.000Z",
};

/** Terça 13/10/2026 12:00 — FORA da janela sáb+dom (cenário 3). */
const TERCA = emSP("2026-10-13T12:00");
/** Sábado 17/10/2026 12:00 — DENTRO da janela 11:00–15:00. */
const SABADO = emSP("2026-10-17T12:00");
/** Domingo 20/12/2026 12:00 — "Inverno" já expirou (cenário 6). */
const DEZEMBRO = emSP("2026-12-20T12:00");

describe("247 — cenário 3 literal: compravel === disponivel && dentroDaJanela", () => {
  // As SEIS linhas renderizáveis da tabela do cenário 3 (as duas de `oculto`
  // não chegam a virar `ProdutoVitrine`: a view não as devolve).
  const LINHAS: Array<{
    linha: string;
    agora: Date;
    visibilidade: "menu" | "cardapio";
    disponivel: boolean;
    compravel: boolean;
    motivo: "esgotado" | "fora_da_janela" | null;
  }> = [
    {
      linha: "dentro da janela, disponivel=false, 'cardapio' ⇒ esgotado",
      agora: SABADO,
      visibilidade: "cardapio",
      disponivel: false,
      compravel: false,
      motivo: "esgotado",
    },
    {
      linha: "dentro da janela, disponivel=false, 'menu' ⇒ esgotado",
      agora: SABADO,
      visibilidade: "menu",
      disponivel: false,
      compravel: false,
      motivo: "esgotado",
    },
    {
      linha: "fora da janela, disponivel=true, 'cardapio' ⇒ fora_da_janela",
      agora: TERCA,
      visibilidade: "cardapio",
      disponivel: true,
      compravel: false,
      motivo: "fora_da_janela",
    },
    {
      // PRECEDÊNCIA (RN-05): numa terça a feijoada não acabou — ela não é
      // servida hoje. "Esgotado" seria factualmente errado.
      linha: "fora da janela E disponivel=false, 'cardapio' ⇒ fora_da_janela",
      agora: TERCA,
      visibilidade: "cardapio",
      disponivel: false,
      compravel: false,
      motivo: "fora_da_janela",
    },
    {
      // D14: cardápio não afeta produto do menu.
      linha: "fora da janela, disponivel=true, 'menu' ⇒ COMPRÁVEL, sem motivo",
      agora: TERCA,
      visibilidade: "menu",
      disponivel: true,
      compravel: true,
      motivo: null,
    },
    {
      // O motivo de janela NÃO se aplica a produto do menu: não há precedência.
      linha: "fora da janela, disponivel=false, 'menu' ⇒ esgotado",
      agora: TERCA,
      visibilidade: "menu",
      disponivel: false,
      compravel: false,
      motivo: "esgotado",
    },
  ];

  for (const caso of LINHAS) {
    it(caso.linha, () => {
      const v = projetarProdutoVitrine(
        base({ visibilidade: caso.visibilidade, disponivel: caso.disponivel }),
        [semDias(FIM_DE_SEMANA)],
        caso.agora,
        SP,
      );
      expect(v.compravel).toBe(caso.compravel);
      expect(v.motivoNaoCompravel).toBe(caso.motivo);
    });
  }

  it("lista de cardápios VAZIA ⇒ saída idêntica ao v1 (não-regressão)", () => {
    // 100% da produção hoje: nenhuma loja tem cardápio. O catálogo tem de sair
    // byte a byte igual ao de antes da issue.
    for (const disponivel of [true, false]) {
      const v = projetarProdutoVitrine(base({ disponivel }), [], TERCA, SP);
      expect(v.compravel).toBe(disponivel);
      expect(v.motivoNaoCompravel).toBe(disponivel ? null : "esgotado");
    }
  });

  it("produto 'cardapio' SEM vínculo nenhum não é comprável fora de janela alguma", () => {
    // Fail-closed: exclusivo de cardápio sem cardápio aberto não vende.
    const v = projetarProdutoVitrine(
      base({ visibilidade: "cardapio", disponivel: true }),
      [],
      TERCA,
      SP,
    );
    expect(v.compravel).toBe(false);
    expect(v.motivoNaoCompravel).toBe("fora_da_janela");
  });

  it("cardápio INATIVO não abre janela nenhuma (RN-03), mesmo no horário", () => {
    const v = projetarProdutoVitrine(
      base({ visibilidade: "cardapio", disponivel: true }),
      [semDias({ ...FIM_DE_SEMANA, ativo: false })],
      SABADO,
      SP,
    );
    expect(v.compravel).toBe(false);
    expect(v.motivoNaoCompravel).toBe("fora_da_janela");
  });

  it("UNIÃO (cenário 4): basta UM cardápio aberto entre dois", () => {
    const v = projetarProdutoVitrine(
      base({ visibilidade: "cardapio", disponivel: true }),
      [
        semDias(FIM_DE_SEMANA), // fechado na quarta
        semDias({ ...INVERNO, prazo_inicio: "2026-06-01T00:00:00.000Z", prazo_fim: "2026-09-01T00:00:00.000Z" }),
      ],
      emSP("2026-07-15T12:00"), // quarta, dentro do prazo do Inverno
      SP,
    );
    expect(v.compravel).toBe(true);
    expect(v.motivoNaoCompravel).toBe(null);
  });

  it("`visibilidade` continua AUSENTE das chaves do objeto projetado (regra 6)", () => {
    const projetado = projetarProdutoVitrine(
      base({ visibilidade: "cardapio" }),
      [semDias(FIM_DE_SEMANA)],
      TERCA,
      SP,
    );
    // Asserção sobre as CHAVES, não sobre o valor: um `...produto` a vazaria
    // com valor correto e `toMatchObject` não veria nada.
    expect(Object.keys(projetado)).not.toContain("visibilidade");
    expect("visibilidade" in projetado).toBe(false);
    // E as 12 chaves do contrato continuam lá, sem sobra e sem falta.
    expect(Object.keys(projetado).sort()).toEqual([...CHAVES_CONTRATO].sort());
  });

  it("nenhuma coluna crua de VIGÊNCIA entra no objeto projetado", () => {
    const chaves = Object.keys(
      projetarProdutoVitrine(base({ visibilidade: "cardapio" }), [semDias(FIM_DE_SEMANA)], TERCA, SP),
    );
    for (const coluna of ["dias_semana", "dias_mes", "hora_inicio", "hora_fim", "prazo_inicio", "prazo_fim"]) {
      expect(chaves).not.toContain(coluna);
    }
  });
});

describe("247 — projetarCatalogoVitrine: as três saídas correlacionadas", () => {
  const CAT_SOPAS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const CAT_BEBIDAS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

  const categorias: Categoria[] = [
    {
      id: CAT_SOPAS,
      loja_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      nome: "Sopas",
      ordem: 1,
      exibir_imagens: true,
      criado_em: "2026-01-01T00:00:00.000Z",
    },
    {
      id: CAT_BEBIDAS,
      loja_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      nome: "Bebidas",
      ordem: 2,
      exibir_imagens: true,
      criado_em: "2026-01-01T00:00:00.000Z",
    },
  ];

  const SOPA = base({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    nome: "Sopa de cebola",
    categoria_id: CAT_SOPAS,
    visibilidade: "cardapio",
    disponivel: true,
  });
  const COCA = base({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    nome: "Coca-Cola 2L",
    categoria_id: CAT_BEBIDAS,
    visibilidade: "menu",
    disponivel: true,
  });

  /** Cenário 6: os dois produtos estão no MESMO cardápio expirado. */
  const vinculosPorProduto = new Map<string, VinculoVigencia[]>([
    [SOPA.id, [semDias(INVERNO)]],
    [COCA.id, [semDias(INVERNO)]],
  ]);

  it("cenário 6 — a sopa 'cardapio' NÃO está na lista devolvida (RN-13/D14)", () => {
    const { produtos } = projetarCatalogoVitrine({
      produtos: [SOPA, COCA],
      vinculosPorProduto,
      agora: DEZEMBRO,
      timezone: SP,
    });
    expect(produtos.map((p) => p.id)).toEqual([COCA.id]);
  });

  it("cenário 6 — a Coca 'menu' do mesmo cardápio expirado segue COMPRÁVEL", () => {
    const { produtos, rotulosVigencia } = projetarCatalogoVitrine({
      produtos: [SOPA, COCA],
      vinculosPorProduto,
      agora: DEZEMBRO,
      timezone: SP,
    });
    const coca = produtos.find((p) => p.id === COCA.id);
    expect(coca?.compravel).toBe(true);
    expect(coca?.motivoNaoCompravel).toBe(null);
    // Produto do menu NUNCA tem rótulo de vigência.
    expect(COCA.id in rotulosVigencia).toBe(false);
  });

  it("cenário 6 — a categoria que só tinha a sopa NÃO é devolvida por agruparCatalogo", () => {
    // A composição REAL da página: projetar → agrupar (ordem invertida na 247).
    const { produtos } = projetarCatalogoVitrine({
      produtos: [SOPA, COCA],
      vinculosPorProduto,
      agora: DEZEMBRO,
      timezone: SP,
    });
    const grupos = agruparCatalogo(produtos, categorias);
    expect(grupos.map((g) => g.nome)).toEqual(["Bebidas"]);
    expect(grupos.map((g) => g.id)).not.toContain(CAT_SOPAS);
  });

  it("produto 'menu' fora da janela: compravel true e NENHUM rótulo", () => {
    const { produtos, rotulosVigencia } = projetarCatalogoVitrine({
      produtos: [COCA],
      vinculosPorProduto: new Map([[COCA.id, [semDias(FIM_DE_SEMANA)]]]),
      agora: TERCA,
      timezone: SP,
    });
    expect(produtos[0].compravel).toBe(true);
    expect(rotulosVigencia).toEqual({});
  });

  it("TODO produto com motivo 'fora_da_janela' tem rótulo; nenhum comprável tem", () => {
    const marcado = base({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
      visibilidade: "cardapio",
      disponivel: true,
    });
    const esgotado = base({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
      visibilidade: "menu",
      disponivel: false,
    });
    const { produtos, rotulosVigencia } = projetarCatalogoVitrine({
      produtos: [marcado, esgotado, COCA],
      vinculosPorProduto: new Map([[marcado.id, [semDias(FIM_DE_SEMANA)]]]),
      agora: TERCA,
      timezone: SP,
    });

    // Propriedade sobre a lista inteira — não amostragem.
    const foraDaJanela = produtos.filter((p) => p.motivoNaoCompravel === "fora_da_janela");
    expect(foraDaJanela.length).toBeGreaterThan(0);
    expect(foraDaJanela.every((p) => p.id in rotulosVigencia)).toBe(true);
    expect(produtos.filter((p) => p.compravel).every((p) => !(p.id in rotulosVigencia))).toBe(true);
    // E nenhum rótulo órfão: o mapa não tem chave sem produto marcado.
    expect(Object.keys(rotulosVigencia).sort()).toEqual(foraDaJanela.map((p) => p.id).sort());
    // O esgotado do menu não ganha rótulo de vigência.
    expect(esgotado.id in rotulosVigencia).toBe(false);
  });

  it("[254] o rótulo é a frase REAL do cardápio que abre mais cedo (RN-07)", () => {
    const marcado = base({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5",
      visibilidade: "cardapio",
      disponivel: true,
    });
    const { rotulosVigencia } = projetarCatalogoVitrine({
      produtos: [marcado],
      vinculosPorProduto: new Map([[marcado.id, [semDias(FIM_DE_SEMANA)]]]),
      agora: TERCA,
      timezone: SP,
    });
    // A 247 afirmava aqui o provisório "Indisponível no momento", pelo nome e
    // pelo texto, para que a troca fosse obrigatória e visível. A 254 fez a
    // troca: o texto agora é o de `rotuloVoltaQuando` para o FIM_DE_SEMANA
    // (sáb+dom, 11:00–15:00) numa terça — a volta real, e não um genérico.
    expect(rotulosVigencia[marcado.id]).toBe(
      rotuloVoltaQuando(semDias(FIM_DE_SEMANA), TERCA, SP),
    );
    expect(rotulosVigencia[marcado.id]).toBe("Sáb e dom, 11:00–15:00");
    expect(rotulosVigencia[marcado.id]).not.toBe("Indisponível no momento");
  });

  // [testar/273] Lacuna: TODOS os testes acima de "fora_da_janela" usam
  // `semDias(...)` — o vínculo SEM dias do item, herdando a janela inteira do
  // cardápio. Nenhum prova o caso central da 273: cardápio ABERTO agora (o
  // "Especiais do Dia", 7 dias) com um ITEM cujo `dias_semana` não bate com
  // hoje. Sem este teste, um bug que trocasse `escolherVinculoParaRotulo` +
  // `rotuloVoltaQuando` para ler sempre o CARDÁPIO (em vez do vínculo)
  // passaria despercebido: o rótulo diria "Todos os dias" para um prato que só
  // sai na quarta e no sábado — uma mentira para o cliente. Escopo apenas de
  // 273 (produto + rótulo): o filtro da SEÇÃO de destaque por item é a 279.
  describe("273 — item fora do dia dentro de um cardápio ABERTO", () => {
    const ESPECIAIS_TODOS_OS_DIAS: CardapioVigencia = {
      id: "c0000000-0000-4000-8000-000000000009",
      nome: "Especiais do Dia",
      ativo: true,
      modo: "recorrente",
      dias_semana: [0, 1, 2, 3, 4, 5, 6],
      dias_mes: null,
      hora_inicio: null,
      hora_fim: null,
      prazo_inicio: null,
      prazo_fim: null,
    };
    // 2026-10-12 é segunda (o dia seguinte ao domingo 11/10) — fora do dia do
    // item {qua, sáb}, mas o cardápio está aberto (ele abre os 7 dias).
    const SEGUNDA = emSP("2026-10-12T12:00");

    it("marca fora_da_janela e o rótulo é o do ITEM, nunca 'Todos os dias' do cardápio", () => {
      const feijoada = base({
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        nome: "Feijoada",
        visibilidade: "cardapio",
        disponivel: true,
      });
      const vinculo: VinculoVigencia = {
        cardapio: ESPECIAIS_TODOS_OS_DIAS,
        dias_semana: [3, 6],
      };

      const { produtos, rotulosVigencia } = projetarCatalogoVitrine({
        produtos: [feijoada],
        vinculosPorProduto: new Map([[feijoada.id, [vinculo]]]),
        agora: SEGUNDA,
        timezone: SP,
      });

      const projetado = produtos.find((p) => p.id === feijoada.id);
      // Continua na lista: cardápio recorrente sem faixa degenerada sempre
      // tem volta (RN-03) — o produto fica MARCADO, não some.
      expect(projetado).toBeDefined();
      expect(projetado?.compravel).toBe(false);
      expect(projetado?.motivoNaoCompravel).toBe("fora_da_janela");

      expect(rotulosVigencia[feijoada.id]).toBe(rotuloVoltaQuando(vinculo, SEGUNDA, SP));
      expect(rotulosVigencia[feijoada.id]).toBe("Só às quartas e sábados");
      expect(rotulosVigencia[feijoada.id]).not.toBe("Todos os dias");
    });
  });

  it("cardapiosAbertos traz só os ativos ABERTOS agora, e preserva `ordem` (D4)", () => {
    type CardapioDaLoja = CardapioVigencia & { ordem: number };
    const abertoComOrdem: CardapioDaLoja = { ...FIM_DE_SEMANA, ordem: 7 };
    const fechado: CardapioDaLoja = { ...INVERNO, ordem: 1 };
    const desligado: CardapioDaLoja = {
      ...FIM_DE_SEMANA,
      id: "c0000000-0000-4000-8000-000000000003",
      ativo: false,
      ordem: 2,
    };

    const { cardapiosAbertos } = projetarCatalogoVitrine<CardapioDaLoja>({
      produtos: [SOPA],
      vinculosPorProduto: new Map([[SOPA.id, [semDias(abertoComOrdem), semDias(fechado), semDias(desligado)]]]),
      agora: SABADO,
      timezone: SP,
    });

    expect(cardapiosAbertos.map((c) => c.id)).toEqual([abertoComOrdem.id]);
    // A genérica é o que faz `ordem` sobreviver à projeção sem que o módulo de
    // vigência conheça um campo de apresentação.
    expect(cardapiosAbertos[0].ordem).toBe(7);
  });

  it("cardápio sem NENHUM produto do catálogo não vira produto fantasma", () => {
    const { produtos } = projetarCatalogoVitrine({
      produtos: [COCA],
      vinculosPorProduto: new Map([
        [COCA.id, [semDias(FIM_DE_SEMANA)]],
        ["produto-oculto-fora-do-catalogo", [semDias(FIM_DE_SEMANA)]],
      ]),
      agora: SABADO,
      timezone: SP,
    });
    expect(produtos.map((p) => p.id)).toEqual([COCA.id]);
  });

  it("loja SEM cardápio nenhum ⇒ catálogo idêntico ao de hoje (não-regressão)", () => {
    const entrada = [SOPA, COCA].map((p) => ({ ...p, visibilidade: "menu" }));
    const { produtos, rotulosVigencia, cardapiosAbertos } = projetarCatalogoVitrine({
      produtos: entrada,
      vinculosPorProduto: new Map(),
      agora: DEZEMBRO,
      timezone: SP,
    });
    expect(produtos.map((p) => p.id)).toEqual(entrada.map((p) => p.id));
    expect(produtos).toEqual(
      entrada.map((p) => projetarProdutoVitrine(p, [], DEZEMBRO, SP)),
    );
    expect(rotulosVigencia).toEqual({});
    expect(cardapiosAbertos).toEqual([]);
  });
});

describe("247/254 — guarda estática: o provisório do rótulo NÃO sobreviveu", () => {
  const fonte = readFileSync(FONTE_CONTRATO, "utf8");

  // Montados por partes de propósito: o critério de aceite da 254 é que
  // `grep -rn` por qualquer um dos dois volte VAZIO em `src/` — e um teste que
  // os escrevesse por extenso seria justamente o resultado que sobra no grep.
  const CONSTANTE_PROVISORIA = ["ROTULO", "VIGENCIA", "PROVISORIO"].join("_");
  const MARCADOR = `TEMP(${254})`;

  it("nem a constante provisória nem o marcador de dívida existem mais", () => {
    // O inverso exato da guarda da 247: enquanto o provisório vivia, o marcador
    // era obrigatório; entregue a 254, é a PRESENÇA dele que vira regressão.
    expect(fonte).not.toContain(CONSTANTE_PROVISORIA);
    expect(fonte).not.toContain(MARCADOR);
  });

  it("o rótulo vem de `descreverVigencia` — uma redação, sem texto solto aqui", () => {
    expect(fonte).toMatch(/from\s+"\.\/descreverVigencia"/);
    // Nenhuma frase de vigência escrita à mão neste arquivo (M6).
    expect(fonte).not.toContain('"Indisponível no momento"');
  });

  it("`MotivoNaoCompravel` ACRESCENTA 'fora_da_janela' sem remover 'esgotado'", () => {
    const bloco = fonte.match(/export type MotivoNaoCompravel = ([^;]*);/);
    expect(bloco?.[1]).toContain('"esgotado"');
    expect(bloco?.[1]).toContain('"fora_da_janela"');
  });

  it("a decisão de janela vem toda de `vigenciaCardapio` — sem segunda cópia", () => {
    const corpo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(corpo).toMatch(/from\s+"\.\/vigenciaCardapio"/);
    // Nenhuma aritmética de fuso nem de dia da semana reescrita aqui.
    expect(corpo).not.toContain("Intl.");
    expect(corpo).not.toContain("getDay(");
    expect(corpo).not.toMatch(/\bas\s+CardapioVigencia\b/);
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
      [],
      AGORA,
      TZ,
      mapa,
    );
    expect(v.foto_url).toBe(null);
  });

  it("categoria que EXIBE imagens ⇒ a URL passa intacta", () => {
    const v = projetarProdutoVitrine(
      base({ categoria_id: CAT_MOSTRA }),
      [],
      AGORA,
      TZ,
      mapa,
    );
    expect(v.foto_url).toBe("https://cdn.exemplo.test/feijoada.jpg");
  });

  it("produto SEM categoria ('Outros') e categoria fora do mapa seguem com foto (RN-5)", () => {
    expect(
      projetarProdutoVitrine(base({ categoria_id: null }), [], AGORA, TZ, mapa)
        .foto_url,
    ).not.toBe(null);
    expect(
      projetarProdutoVitrine(
        base({ categoria_id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd9" }),
        [],
        AGORA,
        TZ,
        mapa,
      ).foto_url,
    ).not.toBe(null);
  });

  it("sem o mapa (recálculo/painel) o objeto é byte a byte o de antes", () => {
    expect(projetarProdutoVitrine(base(), [], AGORA, TZ, undefined)).toEqual(
      projetarProdutoVitrine(base(), [], AGORA, TZ),
    );
  });

  it("a MESMA referência sai da projeção ⇒ a duplicata de render não pode carregar a URL", () => {
    // O ponto de segurança da 248: com o zeramento por GRUPO, uma segunda
    // seção (destaque, D16-a) copiaria o produto cru e traria a foto de volta.
    // Com ele dentro da projeção, existe UM objeto e UM `foto_url`.
    const { produtos } = projetarCatalogoVitrine({
      produtos: [base({ categoria_id: CAT_OCULTA, visibilidade: "menu" })],
      vinculosPorProduto: new Map(),
      agora: AGORA,
      timezone: TZ,
      exibirImagensPorCategoria: mapa,
    });
    expect(produtos[0].foto_url).toBe(null);
  });
});

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
    },
    {
      id: CAT_SOPAS,
      loja_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      nome: "Sopas",
      ordem: 2,
      exibir_imagens: true,
      criado_em: "2026-01-01T00:00:00.000Z",
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
    visibilidade: "menu",
  });
  const NHOQUE = base({
    id: "c8000000-0000-4000-8000-000000000002",
    nome: "Nhoque",
    categoria_id: CAT_MASSAS,
    visibilidade: "menu",
  });
  const SOPA_CEBOLA = base({
    id: "c8000000-0000-4000-8000-000000000003",
    nome: "Sopa de cebola",
    categoria_id: CAT_SOPAS,
    visibilidade: "cardapio",
  });

  const vinculos = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
    [LASANHA.id, [semDias(INVERNO_ABERTO)]],
    [SOPA_CEBOLA.id, [semDias(INVERNO_ABERTO)]],
  ]);

  function projetarCenario8() {
    return projetarCatalogoVitrine<CardapioDaLoja>({
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
    const { produtos, cardapiosAbertos } = projetarCatalogoVitrine<CardapioDaLoja>({
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
    const { produtos, cardapiosAbertos } = projetarCatalogoVitrine<CardapioDaLoja>({
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
    const { produtos, cardapiosAbertos } = projetarCatalogoVitrine<CardapioDaLoja>({
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
    const { produtos, cardapiosAbertos } = projetarCatalogoVitrine<CardapioDaLoja>({
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
    visibilidade: "cardapio",
  });
  const VIRADO = base({
    id: "27900000-0000-4000-8000-000000000002",
    nome: "Virado à paulista",
    visibilidade: "cardapio",
  });
  const DOBRADINHA = base({
    id: "27900000-0000-4000-8000-000000000003",
    nome: "Dobradinha",
    visibilidade: "cardapio",
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
    return projetarCatalogoVitrine<CardapioDaLoja>({
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

  it("quarta — o item fora do dia fica MARCADO, com o selo dos dias do ITEM (RN-08)", () => {
    const { produtos, rotulosVigencia } = projetar(QUARTA);
    const porNome = new Map(produtos.map((p) => [p.nome, p]));

    expect(porNome.get("Feijoada")?.compravel).toBe(true);
    expect(porNome.get("Virado à paulista")?.motivoNaoCompravel).toBe(
      "fora_da_janela",
    );
    expect(rotulosVigencia[VIRADO.id]).toBe("Só às segundas");
    expect(rotulosVigencia[DOBRADINHA.id]).toBe("Só às terças");
    expect(rotulosVigencia[FEIJOADA.id]).toBeUndefined();
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
      visibilidade: "menu",
    });
    const soQuarta = new Map<string, VinculoVigencia<CardapioDaLoja>[]>([
      [refri.id, [comDias(ESPECIAIS, [3])]],
    ]);
    const { produtos, cardapiosAbertos } =
      projetarCatalogoVitrine<CardapioDaLoja>({
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
      projetarCatalogoVitrine<CardapioDaLoja>({
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
        projetarCatalogoVitrine<CardapioDaLoja>({
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
      projetarCatalogoVitrine<CardapioDaLoja>({
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
