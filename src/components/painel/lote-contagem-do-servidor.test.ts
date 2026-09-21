import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * [260] TRAVA DE FONTE — RN-09-a: **a contagem nunca é do cliente.**
 *
 * Não há jsdom nesta máquina (issue 176), então "o diálogo não conta a seleção"
 * não é afirmável por render. O que é afirmável é o CÓDIGO: nenhum consumidor
 * da copy de lote pode alimentar `total` com o tamanho de um `Set`/array local.
 * É o mesmo tipo de trava que `enforcement-escopo-queries.test.ts` aplica às
 * queries — disciplina que não é testável vira desenho impossível de violar
 * sem quebrar um teste.
 *
 * A obrigatoriedade de `previa` (a outra metade de M8) é travada pelo `tsc`:
 * `DialogoLoteCardapioProps.previa` não é opcional, então montar o diálogo
 * antes de a prévia do servidor chegar não compila.
 */

const RAIZ = join(process.cwd(), "src");
const MODULO = "copiaLotePromocao";

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) return arquivosTs(caminho);
    // Arquivos de teste ficam de fora: eles CITAM as frases para afirmá-las.
    return /\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)
      ? [caminho]
      : [];
  });
}

/** Todo arquivo que importa a copy de lote, menos o módulo e o teste dele. */
function consumidores(): { caminho: string; fonte: string }[] {
  return arquivosTs(RAIZ)
    .filter((caminho) => !caminho.includes(`utils/${MODULO}`))
    .map((caminho) => ({ caminho, fonte: readFileSync(caminho, "utf8") }))
    .filter(({ fonte }) => fonte.includes(`utils/${MODULO}`));
}

describe("a copy de lote só recebe número vindo do servidor", () => {
  it("existe pelo menos um consumidor (senão o teste passaria por vacuidade)", () => {
    expect(consumidores().length).toBeGreaterThan(0);
  });

  it.each(consumidores())(
    "$caminho não alimenta `total` com contagem local",
    ({ fonte }) => {
      // `total: selecionados.size`, `total: lista.length`, `total: ids.length`…
      expect(fonte).not.toMatch(/total:\s*[\w.]*\.(size|length)\b/);
      // …nem com um literal inventado no cliente.
      expect(fonte).not.toMatch(/total:\s*\d/);
    },
  );

  it("o diálogo não conhece a seleção do cliente", () => {
    const fonte = readFileSync(
      join(RAIZ, "components/painel/DialogoLoteCardapio.tsx"),
      "utf8",
    );
    expect(fonte).not.toMatch(/selecionados/);
    // Os quatro números que ele mostra saem todos da MESMA prévia do servidor.
    expect(fonte).toMatch(/total:\s*previa\.total/);
    expect(fonte).toMatch(/menu:\s*previa\.menu/);
    expect(fonte).toMatch(/cardapio:\s*previa\.cardapio/);
    expect(fonte).toMatch(/fraseOcultos\(previa\.ocultos\)/);
  });
});

/**
 * [261] D14 tem UM só domínio e UMA só recusa legível. O enum vive em
 * `lib/validacoes/produto.ts` (`visibilidadeProduto`) e é reusado pelo form
 * (`schemaProduto`) e pelo lote (`schemaVisibilidadeEmLote`); a frase de RN-14
 * vive em `lib/actions/produto-contrato.ts` e é reusada pelas duas escritas.
 */
describe("D14 não tem segunda definição", () => {
  it("o enum de visibilidade é declarado uma vez só", () => {
    const declaracoes = arquivosTs(RAIZ)
      .map((caminho) => ({ caminho, fonte: readFileSync(caminho, "utf8") }))
      .filter(({ fonte }) =>
        /z\.enum\(\s*\[\s*"menu"\s*,\s*"cardapio"\s*\]\s*\)/.test(fonte),
      )
      .map(({ caminho }) => caminho);

    expect(declaracoes).toEqual([join(RAIZ, "lib/validacoes/produto.ts")]);
  });

  it("a recusa de RN-14 é uma frase só, no módulo neutro", () => {
    const frase = "Este produto não está em nenhum cardápio.";
    const donos = arquivosTs(RAIZ)
      .map((caminho) => ({ caminho, fonte: readFileSync(caminho, "utf8") }))
      .filter(({ fonte }) => fonte.includes(frase))
      .map(({ caminho }) => caminho);

    // O módulo neutro (a fonte, para as Server Actions) e o `FormProduto` (o
    // aviso PREVENTIVO da §13.5, que é outra coisa: aparece antes de tentar
    // salvar, com o atalho junto). Nenhum terceiro lugar.
    expect(donos.sort()).toEqual(
      [
        join(RAIZ, "components/painel/FormProduto.tsx"),
        join(RAIZ, "lib/actions/produto-contrato.ts"),
      ].sort(),
    );
  });
});
