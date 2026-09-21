import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { FormProduto } from "@/components/painel/FormProduto";
import { rotaCardapiosAdmin } from "@/lib/utils/rotasCardapios";

/**
 * TRAVA DE ROTEAMENTO — o destino de cardápios é INJETADO, nunca escrito no
 * componente.
 *
 * O bug que originou esta trava: no hub admin, editando a loja de um TERCEIRO,
 * "Escolher um cardápio" levava a `/painel/cardapios` — o painel da loja do
 * ADMIN logado. Completar o formulário criaria o cardápio na loja errada.
 *
 * [269] A rota admin passou a existir, então o mundo admin injeta
 * `/admin/assinantes/<lojaId>/cardapios` em vez de `null` — e a trava fica MAIS
 * necessária, não menos: agora há dois destinos legítimos, e escrever qualquer
 * um deles dentro de código compartilhado manda um dos mundos para a loja
 * errada. `null` continua sendo contrato válido (mundo sem rota de cardápios).
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
 * via `CardapioAdminClient`), o `ProdutosClient`, que mora na árvore do painel
 * mas é montado pelos DOIS mundos, e — desde a 269 — a pasta `cardapios/` do
 * lojista INTEIRA: `CardapiosClient` é montado também pelo hub admin, e as
 * páginas ao lado dele são o lugar mais provável para um quarto link fixo
 * aparecer. A base de rota vem de `@/lib/utils/rotasCardapios`, fora das duas
 * árvores, para que nenhum mundo herde a do outro por descuido.
 */
function vigiados(): { caminho: string }[] {
  return [
    ...arquivosDeFonte(join(RAIZ, "components/painel")),
    ...arquivosDeFonte(
      join(RAIZ, "app/(painel)/painel/(bloqueavel)/cardapios"),
    ),
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

  /**
   * [269] O mundo admin deixou de passar `null`: a rota da LOJA-ALVO existe.
   * Este caso trava o outro lado da injeção — o botão tem de aparecer e apontar
   * para `/admin/assinantes/<lojaId>/cardapios`, nunca para o painel do admin.
   */
  it("com a rota ADMIN da loja-alvo, o botão aparece apontando para ela", () => {
    const href = rotaCardapiosAdmin("loja-alvo");
    const html = renderFormAdmin(href);
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain("Escolher um cardápio");
    expect(html).not.toContain("/painel/cardapios");
  });
});
