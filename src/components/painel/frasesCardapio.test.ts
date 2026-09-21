/**
 * [256] As duas frases de RN-03 e a saída oferecida pela recusa da remoção.
 * Puras, afirmadas byte a byte — é para isso que elas saíram do `.tsx`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  frasesDoImpacto,
  fraseExclusivos,
  fraseMenu,
  rotuloConverter,
} from "./frasesCardapio";

describe("frases de impacto (RN-03, D14)", () => {
  it("o que SOME vem antes do que FICA", () => {
    expect(frasesDoImpacto(4, 2)).toEqual([
      "2 produtos são exclusivos deste cardápio e vão sumir da vitrine.",
      "4 produtos do menu continuam aparecendo e vendendo normalmente.",
    ]);
  });

  it("singulariza as duas", () => {
    expect(fraseExclusivos(1)).toBe(
      "1 produto é exclusivo deste cardápio e vai sumir da vitrine.",
    );
    expect(fraseMenu(1)).toBe(
      "1 produto do menu continua aparecendo e vendendo normalmente.",
    );
  });

  it("zero não vira frase — não há nada a avisar", () => {
    expect(fraseExclusivos(0)).toBeNull();
    expect(fraseMenu(0)).toBeNull();
    expect(frasesDoImpacto(0, 0)).toEqual([]);
  });

  it("a saída a um clique diz o número", () => {
    expect(rotuloConverter(1)).toBe("Converter 1 produto para o menu");
    expect(rotuloConverter(3)).toBe("Converter os 3 produtos para o menu");
  });
});

/**
 * Trava de FONTE, porque é o único jeito sem jsdom: nenhuma frase do painel
 * pode prometer que os produtos voltariam a ser vendidos ao religar o
 * cardápio. É FALSO para o produto exclusivo (RN-03) e é a meia-verdade que o
 * lojista só descobriria olhando a vitrine.
 *
 * A agulha é MONTADA em pedaços de propósito: o critério de aceite da 256 é
 * `grep -rn "<a promessa>" src/` NÃO devolver nada, e um teste que a escreve
 * por extenso reprovaria o próprio critério que ele protege.
 */
describe("trava de fonte (critério de aceite da 256)", () => {
  const RAIZ = join(import.meta.dirname, "..", "..");

  const ARQUIVOS = [
    "components/painel/FormVigencia.tsx",
    "components/painel/PreviewVigencia.tsx",
    "components/painel/frasesCardapio.ts",
    "components/painel/rascunhoCardapio.ts",
    "app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient.tsx",
    "app/(painel)/painel/(bloqueavel)/cardapios/page.tsx",
  ];

  /**
   * O CÓDIGO, sem comentário. Os próprios comentários destes arquivos citam as
   * frases proibidas para explicar por que são proibidas — sem tirá-los, a
   * trava dispararia contra a documentação da trava.
   */
  function fonte(caminho: string): string {
    return readFileSync(join(RAIZ, caminho), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  const PROMESSA_PROIBIDA = ["voltam", "a", "vender"].join(" ");

  it("nenhuma tela de cardápio promete que os produtos voltariam a vender", () => {
    for (const caminho of ARQUIVOS) {
      expect(fonte(caminho)).not.toContain(PROMESSA_PROIBIDA);
    }
  });

  it("alvo de toque é o valor LITERAL, nunca a classe semântica do Tailwind", () => {
    // Mesmo motivo da agulha montada acima: o critério de aceite grepa estes
    // dois literais na rota e eles não podem existir nem num comentário.
    const CLASSE_PROIBIDA = ["min", "h", "11"].join("-");
    const TAMANHO_PROIBIDO = `size="${["icon", "sm"].join("-")}"`;
    for (const caminho of ARQUIVOS) {
      const texto = fonte(caminho);
      expect(texto).not.toContain(CLASSE_PROIBIDA);
      expect(texto).not.toContain(TAMANHO_PROIBIDO);
    }
    // E os dois que têm controle de toque usam a régua literal.
    expect(fonte("components/painel/FormVigencia.tsx")).toContain(
      "min-h-[44px] min-w-[44px]",
    );
    expect(
      fonte("app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient.tsx"),
    ).toContain("min-h-[44px] min-w-[44px]");
  });

  it("`PreviewVigencia` não faz conta de data: nem `Date`, nem `Intl`, nem `fusoLoja`", () => {
    const texto = fonte("components/painel/PreviewVigencia.tsx");
    expect(texto).not.toContain("fusoLoja");
    expect(texto).not.toContain("new Date");
    expect(texto).not.toContain("Intl.");
  });

  it("a lista não monta relógio no browser — o estado é do request", () => {
    const texto = fonte(
      "app/(painel)/painel/(bloqueavel)/cardapios/CardapiosClient.tsx",
    );
    expect(texto).not.toContain("setInterval");
    expect(texto).not.toContain("new Date");
    expect(
      fonte("app/(painel)/painel/(bloqueavel)/cardapios/page.tsx"),
    ).toContain('export const dynamic = "force-dynamic"');
  });
});

// ═══════════════ [284] RED — as CINCO frases novas do diálogo de três saídas ══
//
// Critério 10 de `specs/remocao-cardapio-exclusivos.md`: as cinco funções puras
// que os dois botões novos e a segunda confirmação da cascata usam, afirmadas
// BYTE A BYTE em singular e plural. Elas nascem NESTE módulo (§Mensagens da
// spec), não no `.tsx` — é o único jeito de travá-las sem jsdom.
//
// Import DINÂMICO por caminho em VARIÁVEL, e não `import { … } from "./…"`:
// os cinco símbolos ainda não existem, e um import estático faria `tsc
// --noEmit` e a coleta do arquivo inteiro morrerem — os quatro casos verdes de
// cima parariam de rodar e o RED viraria erro de resolução em vez de asserção.
// Assim cada caso falha com a SUA mensagem, que é o contrato da fase GREEN.

const MODULO_FRASES = "./frasesCardapio";

type FrasesDaRemocao = {
  rotuloArquivar(n: number): string;
  rotuloRemoverProdutos(n: number): string;
  fraseArquivar(n: number): string;
  fraseCascataPermanente(n: number): string;
  rotuloConfirmarCascata(n: number): string;
};

const NOMES_NOVOS = [
  "rotuloArquivar",
  "rotuloRemoverProdutos",
  "fraseArquivar",
  "fraseCascataPermanente",
  "rotuloConfirmarCascata",
] as const;

async function frasesDaRemocao(): Promise<FrasesDaRemocao> {
  const mod = (await import(/* @vite-ignore */ MODULO_FRASES)) as Partial<FrasesDaRemocao>;
  const faltando = NOMES_NOVOS.filter((n) => typeof mod[n] !== "function");
  if (faltando.length > 0) {
    throw new Error(
      `[RED 284 · critério 10] \`src/components/painel/frasesCardapio.ts\` ainda não exporta: ` +
        `${faltando.join(", ")}. As cinco frases são aditivas (spec §Mensagens) — ` +
        `nenhuma delas pode nascer dentro do .tsx.`,
    );
  }
  return mod as FrasesDaRemocao;
}

describe("[284] as cinco frases do diálogo de três saídas (critério 10)", () => {
  it("o módulo exporta as cinco funções novas", async () => {
    const f = await frasesDaRemocao();
    for (const nome of NOMES_NOVOS) {
      expect(typeof f[nome], `${nome} não é função`).toBe("function");
    }
  });

  it("`rotuloArquivar` — 2º botão da recusa, singular e plural", async () => {
    const { rotuloArquivar } = await frasesDaRemocao();
    expect(rotuloArquivar(1)).toBe("Arquivar 1 produto");
    expect(rotuloArquivar(3)).toBe("Arquivar os 3 produtos");
  });

  it("`rotuloRemoverProdutos` — 3º botão (destrutivo), singular e plural", async () => {
    const { rotuloRemoverProdutos } = await frasesDaRemocao();
    expect(rotuloRemoverProdutos(1)).toBe("Remover 1 produto");
    expect(rotuloRemoverProdutos(3)).toBe("Remover os 3 produtos");
  });

  it("`fraseArquivar` promete REVERSÍVEL — some da vitrine, não é apagado", async () => {
    const { fraseArquivar } = await frasesDaRemocao();
    expect(fraseArquivar(1)).toBe(
      "O produto fica guardado e some da vitrine. Você pode exibi-lo de novo quando quiser.",
    );
    expect(fraseArquivar(2)).toBe(
      "Os 2 produtos ficam guardados e somem da vitrine. Você pode exibi-los de novo quando quiser.",
    );
  });

  /**
   * A frase que sustenta a única escolha IRREVERSÍVEL da fatia. Ela não pode
   * ser eufemística: "apagados permanentemente" e "não poderão ser
   * recuperados" são o contrato que a §Fora do Escopo (sem desfazer, sem
   * lixeira) obriga a UI a declarar ANTES do clique.
   */
  it("`fraseCascataPermanente` é literal sobre a irreversibilidade", async () => {
    const { fraseCascataPermanente } = await frasesDaRemocao();
    expect(fraseCascataPermanente(1)).toBe(
      "1 produto será apagado permanentemente e não poderá ser recuperado.",
    );
    expect(fraseCascataPermanente(4)).toBe(
      "4 produtos serão apagados permanentemente e não poderão ser recuperados.",
    );
    for (const n of [1, 4]) {
      expect(fraseCascataPermanente(n)).toContain("permanentemente");
    }
  });

  it("`rotuloConfirmarCascata` — o botão que confirma de verdade", async () => {
    const { rotuloConfirmarCascata } = await frasesDaRemocao();
    expect(rotuloConfirmarCascata(1)).toBe("Apagar 1 produto e remover o cardápio");
    expect(rotuloConfirmarCascata(5)).toBe("Apagar 5 produtos e remover o cardápio");
  });

  /**
   * Trava de vocabulário (§Ressalva de vocabulário, não negociável): "arquivar"
   * é `oculto = true`, NUNCA `disponivel = false` ("esgotado", que continua
   * visível). Nenhuma frase de arquivar pode dizer "esgotado" nem prometer
   * apagar; nenhuma frase de cascata pode prometer que dá para exibir de novo.
   */
  it("arquivar não fala de apagar, e cascata não promete recuperação", async () => {
    const { fraseArquivar, rotuloArquivar, fraseCascataPermanente, rotuloConfirmarCascata } =
      await frasesDaRemocao();
    for (const texto of [fraseArquivar(1), fraseArquivar(2), rotuloArquivar(1), rotuloArquivar(2)]) {
      expect(texto.toLowerCase()).not.toContain("apagad");
      expect(texto.toLowerCase()).not.toContain("esgotad");
      expect(texto.toLowerCase()).not.toContain("permanente");
    }
    for (const texto of [
      fraseCascataPermanente(1),
      fraseCascataPermanente(2),
      rotuloConfirmarCascata(1),
      rotuloConfirmarCascata(2),
    ]) {
      expect(texto.toLowerCase()).not.toContain("guardado");
      expect(texto.toLowerCase()).not.toContain("de novo");
    }
  });
});
