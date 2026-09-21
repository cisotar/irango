/**
 * Teste de FIAÇÃO (achado da auditoria da issue 143 — não crítica). Prova que
 * `CardapioAdminClient` injeta TODAS as 10 actions admin no `ProdutosClient`
 * com o `lojaId` da URL fixado por closure. Existe porque uma lacuna real
 * passou despercebida: `alternarOculto` ficou sem cobertura admin e caiu no
 * fallback do lojista (falha silenciosa atrás da RLS `produtos_escrita_propria`
 * — UPDATE casava 0 linhas). Este teste falha se qualquer uma das 10 chaves
 * ficar sem injeção — pega a mesma classe de bug antes de chegar em produção.
 *
 * Ambiente: environment=node, sem jsdom (padrão do projeto). Captura o objeto
 * `acoes` via stub do `ProdutosClient`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111";

const capturado = vi.hoisted(() => ({
  acoes: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient", () => ({
  ProdutosClient: (props: { acoes?: Record<string, unknown> }) => {
    capturado.acoes = props.acoes;
    return null;
  },
}));

vi.mock("@/app/admin/assinantes/actions/admin-categorias", () => ({
  criarCategoriaAdmin: vi.fn(async () => ({ ok: true })),
  atualizarCategoriaAdmin: vi.fn(async () => ({ ok: true })),
  removerCategoriaAdmin: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/app/admin/assinantes/actions/admin-produtos", () => ({
  criarProdutoAdmin: vi.fn(async () => ({ ok: true })),
  atualizarProdutoAdmin: vi.fn(async () => ({ ok: true })),
  removerProdutoAdmin: vi.fn(async () => ({ ok: true })),
  alternarDisponibilidadeAdmin: vi.fn(async () => ({ ok: true })),
  alternarOcultoAdmin: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/app/admin/assinantes/actions/admin-upload", () => ({
  enviarFotoProdutoAdmin: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/app/admin/assinantes/actions/admin-opcionais", () => ({
  salvarAssociacaoOpcionaisAdmin: vi.fn(async () => ({ ok: true })),
  // [217] As 9 restantes do CRUD de opcionais: o modal do cardápio monta o
  // mesmo cartão de associação, e o wrapper admin tem de injetar TODAS.
  criarCategoriaOpcionalAdmin: vi.fn(async () => ({ ok: true })),
  atualizarCategoriaOpcionalAdmin: vi.fn(async () => ({ ok: true })),
  removerCategoriaOpcionalAdmin: vi.fn(async () => ({ ok: true })),
  criarOpcionalAdmin: vi.fn(async () => ({ ok: true })),
  atualizarOpcionalAdmin: vi.fn(async () => ({ ok: true })),
  alternarOpcionalAtivoAdmin: vi.fn(async () => ({ ok: true })),
  removerOpcionalAdmin: vi.fn(async () => ({ ok: true })),
  reordenarOpcionaisDaCategoriaAdmin: vi.fn(async () => ({ ok: true })),
  reordenarItensDoGrupoOpcionalAdmin: vi.fn(async () => ({ ok: true })),
}));

import { CardapioAdminClient } from "./CardapioAdminClient";
import {
  alternarDisponibilidadeAdmin,
  alternarOcultoAdmin,
} from "@/app/admin/assinantes/actions/admin-produtos";

const CHAVES_ESPERADAS = [
  "criarCategoria",
  "atualizarCategoria",
  "removerCategoria",
  "criarProduto",
  "atualizarProduto",
  "removerProduto",
  "alternarDisponibilidade",
  "alternarOculto",
  "enviarFotoProduto",
  "salvarAssociacaoOpcionais",
  // [217] `alternarExibirImagens` e `reordenarCategorias` já eram injetadas mas
  // não estavam listadas; as 9 de opcionais entram com o cartão no modal.
  "alternarExibirImagens",
  "reordenarCategorias",
  "criarCategoriaOpcional",
  "atualizarCategoriaOpcional",
  "removerCategoriaOpcional",
  "criarOpcional",
  "atualizarOpcional",
  "alternarOpcionalAtivo",
  "removerOpcional",
  "reordenarOpcionaisDaCategoria",
  "reordenarItensDoGrupoOpcional",
] as const;

function renderizar(lojaId = LOJA_ALVO) {
  renderToStaticMarkup(
    <CardapioAdminClient
      lojaSlug="loja-teste"
      lojaId={lojaId}
      produtos={[]}
      categorias={[]}
      opcionaisPorCategoria={{}}
      cardapiosDoLote={[]}
      vinculosPorProduto={{}}
      promocoes={{}}
      fusoLojaRotulo="America/Sao_Paulo (GMT-3)"
      categoriasOpcional={[]}
      opcionais={[]}
      associacoes={[]}
    />,
  );
}

describe("CardapioAdminClient — paridade de injeção de acoes (achado 143)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturado.acoes = undefined;
  });

  it("injeta as 21 actions do ProdutosClient — nenhuma cai no fallback do lojista", () => {
    renderizar();
    for (const chave of CHAVES_ESPERADAS) {
      expect(
        capturado.acoes?.[chave],
        `acoes.${chave} deveria estar definida`,
      ).toBeTypeOf("function");
    }
  });

  it("alternarOculto(id, oculto) chama alternarOcultoAdmin(lojaId, id, oculto) — a lacuna encontrada na auditoria", async () => {
    renderizar();
    const alternarOculto = capturado.acoes?.alternarOculto as (
      id: string,
      oculto: boolean,
    ) => unknown;
    await alternarOculto("produto-1", true);

    expect(alternarOcultoAdmin).toHaveBeenCalledWith(
      LOJA_ALVO,
      "produto-1",
      true,
    );
  });

  it("alternarDisponibilidade(id, disponivel) chama alternarDisponibilidadeAdmin(lojaId, id, disponivel)", async () => {
    renderizar();
    const alternarDisponibilidade = capturado.acoes
      ?.alternarDisponibilidade as (id: string, disponivel: boolean) => unknown;
    await alternarDisponibilidade("produto-2", false);

    expect(alternarDisponibilidadeAdmin).toHaveBeenCalledWith(
      LOJA_ALVO,
      "produto-2",
      false,
    );
  });
});
