import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { FormProduto } from "@/components/painel/FormProduto";

/**
 * TRAVA DE ROTEAMENTO — o destino de cardápios é INJETADO, nunca escrito no
 * componente.
 *
 * O bug que originou esta trava: no hub admin, editando a loja de um TERCEIRO,
 * "Escolher um cardápio" levava a `/painel/cardapios` — o painel da loja do
 * ADMIN logado. Completar o formulário criaria o cardápio na loja errada.
 * `/admin/assinantes/[lojaId]/cardapios` não existe (issue 256), então não há
 * href correto a inferir: o mundo admin passa `null` e o link some.
 *
 * Mesmo contrato do `NavPainel` (href vem do layout) e da issue 160 (prop
 * obrigatória, sem default): regra de roteamento não mora em componente de
 * apresentação, e omitir tem de quebrar o build, não gravar na loja errada.
 */

const RAIZ = join(process.cwd(), "src");

/** Remove comentários: eles CITAM a rota para explicá-la, e isso é legítimo. */
function codigoSemComentarios(caminho: string): string {
  return readFileSync(caminho, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function arquivosDeFonte(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) return arquivosDeFonte(caminho);
    // Arquivos de teste ficam de fora: eles CITAM a rota para afirmá-la.
    return /\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)
      ? [caminho]
      : [];
  });
}

/**
 * Os arquivos vigiados: tudo em `components/painel/**` (reusado pelo hub admin
 * via `CardapioAdminClient`) mais o `ProdutosClient`, que mora na árvore do
 * painel mas é montado pelos DOIS mundos.
 */
function vigiados(): { caminho: string }[] {
  return [
    ...arquivosDeFonte(join(RAIZ, "components/painel")),
    join(RAIZ, "app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient.tsx"),
  ].map((caminho) => ({ caminho }));
}

describe("o destino de cardápios nunca é hardcoded em componente reusado", () => {
  it("a lista de vigiados não está vazia (senão o teste passa por vacuidade)", () => {
    expect(vigiados().length).toBeGreaterThan(1);
  });

  it.each(vigiados())(
    "$caminho não contém o literal /painel/cardapios em código",
    ({ caminho }) => {
      // Qualquer aspa: `"`, `'` ou template literal. Se alguém reintroduzir
      // `router.push("/painel/cardapios")` ou `<Link href='/painel/cardapios'>`,
      // este teste fica vermelho antes de o admin cair na loja errada.
      expect(codigoSemComentarios(caminho)).not.toMatch(
        /["'`]\/painel\/cardapios/,
      );
    },
  );
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const CATEGORIAS = [{ id: "cat-1", nome: "Lanches", exibir_imagens: true }];

/**
 * Produto EXCLUSIVO DE CARDÁPIO e em nenhum cardápio: é exatamente o estado que
 * abre o bloco "Escolha um cardápio antes" — onde o link vivia.
 */
function renderFormAdmin(hrefCardapios: string | null): string {
  return renderToStaticMarkup(
    <FormProduto
      categorias={CATEGORIAS}
      inicial={{ id: "prod-1", nome: "Coxinha", visibilidade: "cardapio" }}
      cardapiosDoProduto={[]}
      hrefCardapios={hrefCardapios}
      lojaSlug="lanches-base"
      lojaId="loja-alvo"
      fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
      onCriar={vi.fn(async () => ({ ok: true }) as const)}
      onAtualizar={vi.fn(async () => ({ ok: true }) as const)}
      onEnviarFoto={vi.fn(async () => ({ ok: true, url: "" }) as never)}
    />,
  );
}

describe("FormProduto — saída do aviso de RN-14 por mundo", () => {
  it("com hrefCardapios null (hub admin), o HTML não tem link para o painel", () => {
    const html = renderFormAdmin(null);
    expect(html).not.toContain('href="/painel/cardapios"');
    expect(html).not.toContain("/painel/cardapios");
  });

  it("com null, o aviso permanece e explica onde cardápios se gerenciam", () => {
    const html = renderFormAdmin(null);
    expect(html).toContain("Escolha um cardápio");
    expect(html).toContain("gerenciados pelo painel do lojista");
  });

  it("com a rota do lojista, o botão volta a ser link para ela", () => {
    const html = renderFormAdmin("/painel/cardapios");
    expect(html).toContain('href="/painel/cardapios"');
    expect(html).toContain("Escolher um cardápio");
  });
});
