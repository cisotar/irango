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
  lote: undefined as unknown,
}));

vi.mock("@/app/(painel)/painel/(bloqueavel)/produtos/ProdutosClient", () => ({
  ProdutosClient: (props: { acoes?: Record<string, unknown>; lote?: unknown }) => {
    capturado.acoes = props.acoes;
    capturado.lote = props.lote;
    return null;
  },
}));

vi.mock("@/app/admin/assinantes/actions/admin-categorias", () => ({
  criarCategoriaAdmin: vi.fn(async () => ({ ok: true })),
  atualizarCategoriaAdmin: vi.fn(async () => ({ ok: true })),
  removerCategoriaAdmin: vi.fn(async () => ({ ok: true })),
  // [323] Frequência de categoria.
  alternarOcultaCategoriaAdmin: vi.fn(async () => ({ ok: true })),
  definirFrequenciaCategoriaAdmin: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/app/admin/assinantes/actions/admin-produtos", () => ({
  criarProdutoAdmin: vi.fn(async () => ({ ok: true })),
  atualizarProdutoAdmin: vi.fn(async () => ({ ok: true })),
  removerProdutoAdmin: vi.fn(async () => ({ ok: true })),
  alternarDisponibilidadeAdmin: vi.fn(async () => ({ ok: true })),
  alternarOcultoAdmin: vi.fn(async () => ({ ok: true })),
  // [293] Sem este mock, a chave nova cairia no módulo real e o teste de
  // fiação não provaria nada sobre ela.
  reordenarProdutosAdmin: vi.fn(async () => ({ ok: true })),
  // [323] Frequência de produto (seleção/unitário e grade).
  aplicarFrequenciaEmProdutosAdmin: vi.fn(async () => ({ ok: true })),
  salvarGradeDeDiasAdmin: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/app/admin/assinantes/actions/admin-upload", () => ({
  enviarFotoProdutoAdmin: vi.fn(async () => ({ ok: true })),
}));

// Galeria (specs/galeria-imagens-loja.md, página 3): o seletor da foto lista e
// envia na galeria da LOJA-ALVO.
vi.mock("@/app/admin/assinantes/actions/admin-galeria", () => ({
  listarImagensGaleriaAdmin: vi.fn(async () => ({ ok: true, imagens: [], proximo_cursor: null })),
  enviarImagemGaleriaAdmin: vi.fn(async () => ({ ok: false, erro: "stub" })),
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
  aplicarFrequenciaEmProdutosAdmin,
  salvarGradeDeDiasAdmin,
} from "@/app/admin/assinantes/actions/admin-produtos";
import {
  alternarOcultaCategoriaAdmin,
  definirFrequenciaCategoriaAdmin,
} from "@/app/admin/assinantes/actions/admin-categorias";
import {
  enviarImagemGaleriaAdmin,
  listarImagensGaleriaAdmin,
} from "@/app/admin/assinantes/actions/admin-galeria";

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
  // [293] A chave do modo reordenar PRODUTOS: sem ela injetada, o hub admin
  // cairia na action do LOJISTA, que resolve a loja por `auth.uid()`.
  "reordenarProdutos",
  "criarCategoriaOpcional",
  "atualizarCategoriaOpcional",
  "removerCategoriaOpcional",
  "criarOpcional",
  "atualizarOpcional",
  "alternarOpcionalAtivo",
  "removerOpcional",
  "reordenarOpcionaisDaCategoria",
  "reordenarItensDoGrupoOpcional",
  // [323] As 4 da frequência de exibição.
  "aplicarFrequenciaEmProdutos",
  "salvarGradeDeDias",
  "alternarOcultaCategoria",
  "definirFrequenciaCategoria",
  // Galeria no seletor da foto.
  "listarImagensGaleria",
  "enviarImagemGaleria",
] as const;

function renderizar(lojaId = LOJA_ALVO) {
  renderToStaticMarkup(
    <CardapioAdminClient
      lojaSlug="loja-teste"
      lojaId={lojaId}
      produtos={[]}
      categorias={[]}
      opcionaisPorCategoria={{}}
      vinculosPorProduto={{}}
      frequencias={{ produtos: {}, categorias: {}, agora: "2026-09-27T12:00:00.000Z", timezone: "America/Sao_Paulo" }}
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

  it("injeta as 27 actions do ProdutosClient — nenhuma cai no fallback do lojista", () => {
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

  it("[323] as 4 de frequência fixam o `lojaId` da URL como 1º argumento", async () => {
    renderizar();
    const a = capturado.acoes as Record<string, (...args: unknown[]) => unknown>;
    const payload = { qualquer: "coisa" };
    await a.aplicarFrequenciaEmProdutos(payload);
    await a.salvarGradeDeDias(payload);
    await a.alternarOcultaCategoria("cat-1", true);
    await a.definirFrequenciaCategoria(payload);

    expect(aplicarFrequenciaEmProdutosAdmin).toHaveBeenCalledWith(LOJA_ALVO, payload);
    expect(salvarGradeDeDiasAdmin).toHaveBeenCalledWith(LOJA_ALVO, payload);
    expect(alternarOcultaCategoriaAdmin).toHaveBeenCalledWith(LOJA_ALVO, "cat-1", true);
    expect(definirFrequenciaCategoriaAdmin).toHaveBeenCalledWith(LOJA_ALVO, payload);
  });

  it("galeria: listarImagensGaleria(cursor) chama listarImagensGaleriaAdmin(lojaId, cursor)", async () => {
    renderizar();
    const a = capturado.acoes as Record<string, (...args: unknown[]) => unknown>;
    const cursor = { criado_em: "2026-10-01T00:00:00.000Z", id: "22222222-2222-4222-8222-222222222222" };
    await a.listarImagensGaleria(cursor);
    expect(listarImagensGaleriaAdmin).toHaveBeenCalledWith(LOJA_ALVO, cursor);
  });

  it("galeria: enviarImagemGaleria(fd) SOBRESCREVE o loja_id com o da URL e chama enviarImagemGaleriaAdmin", async () => {
    renderizar();
    const a = capturado.acoes as Record<string, (fd: FormData) => unknown>;
    const fd = new FormData();
    fd.set("loja_id", "99999999-9999-4999-8999-999999999999");
    await a.enviarImagemGaleria(fd);
    expect(enviarImagemGaleriaAdmin).toHaveBeenCalledTimes(1);
    const recebido = vi.mocked(enviarImagemGaleriaAdmin).mock.calls[0][0];
    expect(recebido.getAll("loja_id")).toEqual([LOJA_ALVO]);
  });

  it("[323] a prop `lote` (cardápio) não é mais passada", () => {
    renderizar();
    expect(capturado.lote).toBeUndefined();
  });
});
