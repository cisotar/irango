/**
 * Teste de FIAÇÃO do `GaleriaAdminClient` (specs/galeria-imagens-loja.md,
 * página 2). Prova que o wrapper injeta as variantes `*Admin` no
 * `GaleriaImagens` com o `lojaId` da URL fixado em closure, que o envio leva o
 * `loja_id` no FormData e que as actions do LOJISTA nunca são tocadas (cairiam
 * na loja do admin logado). A autoridade continua nas actions do servidor.
 *
 * Ambiente node, sem jsdom: o `GaleriaImagens` é stub que CAPTURA `acoes`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111";
const IMG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type Acoes = {
  enviarImagem: (fd: FormData) => Promise<unknown>;
  listarMais: (cursor: { criado_em: string; id: string }) => Promise<unknown>;
  consultarUso: (ids: string[]) => Promise<unknown>;
  remover: (ids: string[]) => Promise<unknown>;
};

const capturado = vi.hoisted(() => ({
  acoes: undefined as Acoes | undefined,
  voltarHref: undefined as string | undefined,
}));

vi.mock("@/components/painel/GaleriaImagens", () => ({
  GaleriaImagens: (props: { acoes: Acoes; voltarHref: string }) => {
    capturado.acoes = props.acoes;
    capturado.voltarHref = props.voltarHref;
    return null;
  },
}));

vi.mock("@/app/admin/assinantes/actions/admin-galeria", () => ({
  enviarImagemGaleriaAdmin: vi.fn(async () => ({ ok: false, erro: "x" })),
  listarImagensGaleriaAdmin: vi.fn(async () => ({ ok: true, imagens: [], proximo_cursor: null })),
  consultarUsoImagensAdmin: vi.fn(async () => ({ ok: true, usos: [] })),
  removerImagensGaleriaAdmin: vi.fn(async () => ({ ok: false, erro: "x" })),
}));

vi.mock("@/lib/actions/galeria", () => ({
  enviarImagemGaleria: vi.fn(),
  listarImagensGaleria: vi.fn(),
  consultarUsoImagens: vi.fn(),
  removerImagensGaleria: vi.fn(),
}));

import { GaleriaAdminClient } from "./GaleriaAdminClient";
import {
  consultarUsoImagensAdmin,
  enviarImagemGaleriaAdmin,
  listarImagensGaleriaAdmin,
  removerImagensGaleriaAdmin,
} from "@/app/admin/assinantes/actions/admin-galeria";
import * as lojista from "@/lib/actions/galeria";

function renderizar(lojaId = LOJA_ALVO) {
  renderToStaticMarkup(
    <GaleriaAdminClient
      lojaId={lojaId}
      imagensIniciais={[]}
      cursorInicial={null}
      totalInicial={0}
      usosIniciais={[]}
    />,
  );
}

function nenhumaDoLojista() {
  expect(lojista.enviarImagemGaleria).not.toHaveBeenCalled();
  expect(lojista.listarImagensGaleria).not.toHaveBeenCalled();
  expect(lojista.consultarUsoImagens).not.toHaveBeenCalled();
  expect(lojista.removerImagensGaleria).not.toHaveBeenCalled();
}

describe("GaleriaAdminClient — fiação das actions admin da galeria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturado.acoes = undefined;
  });

  it("injeta as quatro actions e o voltar da loja-alvo", () => {
    renderizar();
    expect(capturado.acoes?.enviarImagem).toBeTypeOf("function");
    expect(capturado.acoes?.listarMais).toBeTypeOf("function");
    expect(capturado.acoes?.consultarUso).toBeTypeOf("function");
    expect(capturado.acoes?.remover).toBeTypeOf("function");
    expect(capturado.voltarHref).toBe(`/admin/assinantes/${LOJA_ALVO}`);
  });

  it("enviarImagem põe o loja_id da URL no FormData e chama a variante admin", async () => {
    renderizar();
    const fd = new FormData();
    fd.set("loja_id", "99999999-9999-4999-8999-999999999999");
    await capturado.acoes!.enviarImagem(fd);

    expect(enviarImagemGaleriaAdmin).toHaveBeenCalledTimes(1);
    const enviado = vi.mocked(enviarImagemGaleriaAdmin).mock.calls[0]?.[0] as FormData;
    // `set`: um valor só, o da URL — nunca o que já estivesse no FormData.
    expect(enviado.getAll("loja_id")).toEqual([LOJA_ALVO]);
    nenhumaDoLojista();
  });

  it("listarMais, consultarUso e remover levam o lojaId da URL", async () => {
    renderizar();
    const cursor = { criado_em: "2026-10-06T12:00:00.000Z", id: IMG };
    await capturado.acoes!.listarMais(cursor);
    await capturado.acoes!.consultarUso([IMG]);
    await capturado.acoes!.remover([IMG]);

    expect(listarImagensGaleriaAdmin).toHaveBeenCalledWith(LOJA_ALVO, cursor);
    expect(consultarUsoImagensAdmin).toHaveBeenCalledWith(LOJA_ALVO, [IMG]);
    expect(removerImagensGaleriaAdmin).toHaveBeenCalledWith(LOJA_ALVO, [IMG]);
    nenhumaDoLojista();
  });

  it("usa o lojaId recebido como escopo (loja-alvo, não a do admin)", async () => {
    const OUTRA = "99999999-9999-4999-8999-999999999999";
    renderizar(OUTRA);
    await capturado.acoes!.remover([IMG]);
    expect(removerImagensGaleriaAdmin).toHaveBeenCalledWith(OUTRA, [IMG]);
  });
});
