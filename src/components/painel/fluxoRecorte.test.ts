import { describe, it, expect, vi } from "vitest";

import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";
import {
  CAMPO_MINIATURA,
  CAMPO_ORIGEM,
  LARGURA_MINIMA_RECOMENDADA_LOGO,
  LARGURA_MINIMA_RECOMENDADA_PRODUTO,
  MSG_ENVIO_FALHOU,
  MSG_FOTO_REMOVIDA_DA_GALERIA,
  MSG_MUITAS_TENTATIVAS,
  MSG_ORIGEM_REMOVIDA,
  MSG_RECORTE_FALHOU,
  MSG_TETO,
  type ResultadoEnvioGaleria,
} from "@/lib/actions/galeria-contrato";
import type { ResultadoPreparoGaleria } from "@/lib/utils/reducaoImagem";
import {
  MSG_ABRIR_IMAGEM_FALHOU,
  avisoImagemPequena,
  baixarOriginalDaGaleria,
  enviarRecorteComOrigem,
  imagemPequenaDemais,
  mensagemDeErro,
  montarFormDataOriginal,
  montarFormDataRecorte,
  type EnviarParaGaleria,
  type EnviarRecorte,
  type OrigemDoRecorte,
} from "./fluxoRecorte";

/**
 * Decisões do fluxo "escolher origem → recortar → enviar recorte" dos
 * uploaders de foto e logo (specs/galeria-imagens-loja.md, páginas 3 e 4).
 * O canvas e o clique não rodam aqui (`environment: node`, sem jsdom): o que
 * se prova é o que a casca faz com o recorte JÁ exportado — quais actions
 * chama, em que ordem, com que FormData e o que diz quando falha.
 */

const ORIGEM_ID = "33333333-3333-4333-8333-333333333333";
const GENERICA = "Não foi possível enviar a foto. Tente novamente.";
const URL_RECORTE = "https://exemplo.supabase.co/storage/v1/object/public/produtos/l/r.webp";

const recorte = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
const original = new Blob([new Uint8Array([4])], { type: "image/webp" });
const miniatura = new Blob([new Uint8Array([5])], { type: "image/webp" });

function preparoOk(): (arquivo: Blob) => Promise<ResultadoPreparoGaleria> {
  return vi.fn(async () => ({ ok: true as const, original, miniatura }));
}

function galeriaOk(): EnviarParaGaleria {
  return vi.fn(
    async (): Promise<ResultadoEnvioGaleria> => ({
      ok: true,
      imagem: { id: ORIGEM_ID, url: "https://x/y.webp", miniatura_url: null, criado_em: "2026-10-06T00:00:00Z" },
    }),
  );
}

function recorteOk(): EnviarRecorte {
  return vi.fn(async () => ({ ok: true as const, url: URL_RECORTE }));
}

function fluxo(over: {
  origem?: OrigemDoRecorte;
  preparar?: (arquivo: Blob) => Promise<ResultadoPreparoGaleria>;
  enviarParaGaleria?: EnviarParaGaleria;
  enviarRecorte?: EnviarRecorte;
}) {
  return enviarRecorteComOrigem({
    origem: over.origem ?? { tipo: "galeria", origemId: ORIGEM_ID },
    recorte,
    nomeArquivo: "foto.webp",
    preparar: over.preparar ?? preparoOk(),
    enviarParaGaleria: over.enviarParaGaleria ?? galeriaOk(),
    enviarRecorte: over.enviarRecorte ?? recorteOk(),
    erroGenerico: GENERICA,
  });
}

describe("aviso de imagem pequena (D10)", () => {
  it("avisa abaixo da largura recomendada do destino e não avisa no limite", () => {
    expect(imagemPequenaDemais(799, LARGURA_MINIMA_RECOMENDADA_PRODUTO)).toBe(true);
    expect(imagemPequenaDemais(800, LARGURA_MINIMA_RECOMENDADA_PRODUTO)).toBe(false);
    expect(imagemPequenaDemais(320, LARGURA_MINIMA_RECOMENDADA_LOGO)).toBe(true);
    expect(imagemPequenaDemais(400, LARGURA_MINIMA_RECOMENDADA_LOGO)).toBe(false);
  });

  it("logo legada de 320 px escolhida para PRODUTO avisa; para LOGO também (o recorte amplia)", () => {
    expect(imagemPequenaDemais(320, LARGURA_MINIMA_RECOMENDADA_PRODUTO)).toBe(true);
    expect(imagemPequenaDemais(600, LARGURA_MINIMA_RECOMENDADA_LOGO)).toBe(false);
  });

  it("largura ainda desconhecida (mídia carregando) ou inválida não avisa", () => {
    expect(imagemPequenaDemais(null, 800)).toBe(false);
    expect(imagemPequenaDemais(0, 800)).toBe(false);
    expect(imagemPequenaDemais(Number.NaN, 800)).toBe(false);
  });

  it("o texto leva o número do destino", () => {
    expect(avisoImagemPequena(LARGURA_MINIMA_RECOMENDADA_PRODUTO)).toBe(
      "Esta imagem é pequena e pode ficar borrada. Prefira uma com pelo menos 800 px de largura.",
    );
    expect(avisoImagemPequena(LARGURA_MINIMA_RECOMENDADA_LOGO)).toContain("pelo menos 400 px");
  });
});

describe("FormData", () => {
  it("recorte leva o arquivo em CAMPO_ARQUIVO e o origem_id em CAMPO_ORIGEM, um valor de cada", () => {
    const fd = montarFormDataRecorte(recorte, "logo.webp", ORIGEM_ID);
    expect(fd.getAll(CAMPO_ORIGEM)).toEqual([ORIGEM_ID]);
    const arquivo = fd.getAll(CAMPO_ARQUIVO);
    expect(arquivo).toHaveLength(1);
    expect(arquivo[0]).toBeInstanceOf(Blob);
    expect((arquivo[0] as File).name).toBe("logo.webp");
    // O componente nunca escolhe a loja: quem fixa `loja_id` é o adapter admin.
    expect(fd.has("loja_id")).toBe(false);
  });

  it("original leva original + miniatura, sem origem_id", () => {
    const fd = montarFormDataOriginal(original, miniatura);
    expect(fd.getAll(CAMPO_ARQUIVO)).toHaveLength(1);
    expect(fd.getAll(CAMPO_MINIATURA)).toHaveLength(1);
    expect(fd.has(CAMPO_ORIGEM)).toBe(false);
  });
});

describe("mensagemDeErro", () => {
  it("passa adiante só as literais acionáveis do contrato", () => {
    for (const m of [MSG_ORIGEM_REMOVIDA, MSG_FOTO_REMOVIDA_DA_GALERIA, MSG_TETO, MSG_MUITAS_TENTATIVAS]) {
      expect(mensagemDeErro(m, GENERICA)).toBe(m);
    }
  });

  it("qualquer outro texto vira a genérica (nunca vaza detalhe)", () => {
    expect(mensagemDeErro('duplicate key value violates "imagens_loja_pkey"', GENERICA)).toBe(GENERICA);
    expect(mensagemDeErro("", GENERICA)).toBe(GENERICA);
  });
});

describe("enviarRecorteComOrigem — (a) origem da galeria", () => {
  it("sobe SÓ o recorte, com o origem_id escolhido; não reduz nem envia original", async () => {
    const preparar = preparoOk();
    const enviarParaGaleria = galeriaOk();
    const enviarRecorte = recorteOk();

    const r = await fluxo({ preparar, enviarParaGaleria, enviarRecorte });

    expect(r).toEqual({ ok: true, url: URL_RECORTE });
    expect(preparar).not.toHaveBeenCalled();
    expect(enviarParaGaleria).not.toHaveBeenCalled();
    expect(enviarRecorte).toHaveBeenCalledTimes(1);
    const fd = vi.mocked(enviarRecorte).mock.calls[0][0];
    expect(fd.get(CAMPO_ORIGEM)).toBe(ORIGEM_ID);
    expect(fd.get(CAMPO_ARQUIVO)).toBeInstanceOf(Blob);
  });

  it("origem removida em outra aba: mostra MSG_ORIGEM_REMOVIDA e volta ao estado anterior", async () => {
    const r = await fluxo({
      enviarRecorte: vi.fn(async () => ({ ok: false as const, erro: MSG_ORIGEM_REMOVIDA })),
    });
    expect(r).toEqual({ ok: false, mensagem: MSG_ORIGEM_REMOVIDA, fecharCropper: true });
  });

  it("logo recusada pelo trigger (recorte já removido) também volta ao estado anterior", async () => {
    const r = await fluxo({
      enviarRecorte: vi.fn(async () => ({ ok: false as const, erro: MSG_FOTO_REMOVIDA_DA_GALERIA })),
    });
    expect(r).toEqual({ ok: false, mensagem: MSG_FOTO_REMOVIDA_DA_GALERIA, fecharCropper: true });
  });

  it("erro genérico mantém o cropper aberto para tentar de novo, sem vazar o texto cru", async () => {
    const r = await fluxo({
      enviarRecorte: vi.fn(async () => ({ ok: false as const, erro: "storage: bucket not found" })),
    });
    expect(r).toEqual({ ok: false, mensagem: GENERICA, fecharCropper: false });
  });

  it("action que lança vira genérica, sem propagar a exceção", async () => {
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await fluxo({
      enviarRecorte: vi.fn(async () => {
        throw new Error("rede");
      }),
    });
    expect(r).toEqual({ ok: false, mensagem: GENERICA, fecharCropper: false });
    erroLog.mockRestore();
  });
});

describe("enviarRecorteComOrigem — (b) arquivo novo (P3)", () => {
  const arquivo = new Blob([new Uint8Array([9])], { type: "image/jpeg" });

  it("ORDEM: reduz → envia original + miniatura → envia recorte com o origem_id DEVOLVIDO", async () => {
    const ordem: string[] = [];
    const preparar = vi.fn(async (b: Blob) => {
      ordem.push("preparar");
      expect(b).toBe(arquivo);
      return { ok: true as const, original, miniatura };
    });
    const enviarParaGaleria = vi.fn(async (fd: FormData): Promise<ResultadoEnvioGaleria> => {
      ordem.push("galeria");
      expect(fd.get(CAMPO_ARQUIVO)).toBeInstanceOf(Blob);
      expect(fd.get(CAMPO_MINIATURA)).toBeInstanceOf(Blob);
      return {
        ok: true,
        imagem: { id: ORIGEM_ID, url: "https://x/o.webp", miniatura_url: "https://x/m.webp", criado_em: "2026-10-06T00:00:00Z" },
      };
    });
    const enviarRecorte = vi.fn(async (fd: FormData) => {
      ordem.push("recorte");
      expect(fd.get(CAMPO_ORIGEM)).toBe(ORIGEM_ID);
      return { ok: true as const, url: URL_RECORTE };
    });

    const r = await fluxo({ origem: { tipo: "arquivo", arquivo }, preparar, enviarParaGaleria, enviarRecorte });

    expect(r).toEqual({ ok: true, url: URL_RECORTE });
    expect(ordem).toEqual(["preparar", "galeria", "recorte"]);
  });

  it("falha na SEGUNDA chamada: toast MSG_RECORTE_FALHOU e sai do cropper (a original já está na galeria)", async () => {
    const r = await fluxo({
      origem: { tipo: "arquivo", arquivo },
      enviarRecorte: vi.fn(async () => ({ ok: false as const, erro: MSG_MUITAS_TENTATIVAS })),
    });
    expect(r).toEqual({ ok: false, mensagem: MSG_RECORTE_FALHOU, fecharCropper: true });
  });

  it("galeria recusa (teto): nada mais sobe, mensagem do teto, cropper fica aberto", async () => {
    const enviarRecorte = recorteOk();
    const r = await fluxo({
      origem: { tipo: "arquivo", arquivo },
      enviarParaGaleria: vi.fn(async () => ({ ok: false as const, erro: MSG_TETO })),
      enviarRecorte,
    });
    expect(r).toEqual({ ok: false, mensagem: MSG_TETO, fecharCropper: false });
    expect(enviarRecorte).not.toHaveBeenCalled();
  });

  it("galeria com erro não acionável: genérica de envio, sem o texto cru", async () => {
    const r = await fluxo({
      origem: { tipo: "arquivo", arquivo },
      enviarParaGaleria: vi.fn(async () => ({ ok: false as const, erro: "insert failed: 42501" })),
    });
    expect(r).toEqual({ ok: false, mensagem: MSG_ENVIO_FALHOU, fecharCropper: false });
  });

  it("redução falha: nenhuma action é chamada e a mensagem do preparo chega ao lojista", async () => {
    const enviarParaGaleria = galeriaOk();
    const enviarRecorte = recorteOk();
    const r = await fluxo({
      origem: { tipo: "arquivo", arquivo },
      preparar: vi.fn(async () => ({ ok: false as const, erro: "Escolha uma versão menor." })),
      enviarParaGaleria,
      enviarRecorte,
    });
    expect(r).toEqual({ ok: false, mensagem: "Escolha uma versão menor.", fecharCropper: true });
    expect(enviarParaGaleria).not.toHaveBeenCalled();
    expect(enviarRecorte).not.toHaveBeenCalled();
  });
});

describe("baixarOriginalDaGaleria (DP4)", () => {
  const URL_ORIGINAL = "https://exemplo.supabase.co/storage/v1/object/public/produtos/l/galeria/o.webp";
  const validarOk = vi.fn(async () => null);

  function resposta(status: number, corpo: Blob = original): Response {
    return new Response(corpo, { status });
  }

  it("busca a URL COM ?recorte=1 e mode cors (fora da chave do service worker)", async () => {
    const buscar = vi.fn(async () => resposta(200));
    const r = await baixarOriginalDaGaleria(URL_ORIGINAL, validarOk, buscar);
    expect(r.ok).toBe(true);
    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("recorte")).toBe("1");
    expect(url.startsWith(URL_ORIGINAL)).toBe(true);
    expect(init.mode).toBe("cors");
  });

  it("passa o blob pelo MESMO gate do arquivo local e recusa o que ele recusa", async () => {
    const validar = vi.fn(async () => "Conteúdo do arquivo não corresponde a uma imagem válida.");
    const r = await baixarOriginalDaGaleria(URL_ORIGINAL, validar, vi.fn(async () => resposta(200)));
    expect(validar).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: false, erro: "Conteúdo do arquivo não corresponde a uma imagem válida." });
  });

  it("400/404 do Storage = removida em outra aba", async () => {
    for (const status of [400, 404]) {
      const r = await baixarOriginalDaGaleria(URL_ORIGINAL, validarOk, vi.fn(async () => resposta(status)));
      expect(r).toEqual({ ok: false, erro: MSG_ORIGEM_REMOVIDA });
    }
  });

  it("5xx ou falha de rede: mensagem genérica de abrir", async () => {
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await baixarOriginalDaGaleria(URL_ORIGINAL, validarOk, vi.fn(async () => resposta(503))),
    ).toEqual({ ok: false, erro: MSG_ABRIR_IMAGEM_FALHOU });
    expect(
      await baixarOriginalDaGaleria(
        URL_ORIGINAL,
        validarOk,
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      ),
    ).toEqual({ ok: false, erro: MSG_ABRIR_IMAGEM_FALHOU });
    erroLog.mockRestore();
  });

  it("URL que não é https nem chega ao fetch (fotoSegura)", async () => {
    const buscar = vi.fn(async () => resposta(200));
    const r = await baixarOriginalDaGaleria("javascript:alert(1)", validarOk, buscar);
    expect(r).toEqual({ ok: false, erro: MSG_ABRIR_IMAGEM_FALHOU });
    expect(buscar).not.toHaveBeenCalled();
  });
});
