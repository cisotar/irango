// Fluxo "escolher origem → recortar → enviar recorte" dos uploaders de foto de
// produto e de logo (specs/galeria-imagens-loja.md, páginas 3 e 4; D2, D10,
// P3, RN-G18). Sem React e sem DOM: o ambiente de teste não tem jsdom, então
// toda decisão (texto, ordem das chamadas, FormData) mora aqui e é testada ao
// lado. O canvas (`exportarCrop`) e a redução (`prepararImagemParaGaleria`)
// chegam injetados.
//
// Nada daqui é autoridade: o servidor revalida o arquivo, a posse do
// `origem_id` e a loja. Isto decide só o que a UI faz e diz.

import { CAMPO_ARQUIVO } from "@/lib/actions/upload-contrato";
import {
  CAMPO_MINIATURA,
  CAMPO_ORIGEM,
  MSG_ENVIO_FALHOU,
  MSG_FOTO_REMOVIDA_DA_GALERIA,
  MSG_MUITAS_TENTATIVAS,
  MSG_ORIGEM_REMOVIDA,
  MSG_RECORTE_FALHOU,
  MSG_TENTE_DE_NOVO,
  MSG_TETO,
  urlParaRecorte,
  type CursorGaleria,
  type ResultadoEnvioGaleria,
  type ResultadoListagemGaleria,
} from "@/lib/actions/galeria-contrato";
import type { ResultadoPreparoGaleria } from "@/lib/utils/reducaoImagem";
import { fotoSegura } from "@/lib/utils/fotoSegura";

// ── Contratos das actions injetadas (obrigatórias, sem default — issue 160) ──

/** Lista as originais da galeria (1ª página sem cursor; "Carregar mais" com cursor). */
export type ListarGaleria = (cursor?: CursorGaleria) => Promise<ResultadoListagemGaleria>;

/** Envia uma original (+ miniatura) para a galeria. */
export type EnviarParaGaleria = (formData: FormData) => Promise<ResultadoEnvioGaleria>;

/** Recorte enviado: a forma comum de `enviarFotoProduto` e `salvarLogoLoja`. */
export type ResultadoRecorte = { ok: true; url: string } | { ok: false; erro: string };

export type EnviarRecorte = (formData: FormData) => Promise<ResultadoRecorte>;

// ── Origem do recorte ────────────────────────────────────────────────────────

/**
 * De onde veio a imagem que está no cropper:
 *  - `galeria`: uma original que JÁ está na galeria (sobe só o recorte);
 *  - `arquivo`: um arquivo novo do aparelho (no "Confirmar", sobe a original
 *    para a galeria e depois o recorte — P3).
 */
export type OrigemDoRecorte =
  | { tipo: "galeria"; origemId: string }
  | { tipo: "arquivo"; arquivo: Blob };

// ── Aviso de imagem pequena (D10) ────────────────────────────────────────────

/**
 * D10: avisa (sem bloquear) quando a largura natural da imagem está abaixo da
 * recomendada para o destino. Largura desconhecida ou inválida não avisa.
 */
export function imagemPequenaDemais(
  larguraNatural: number | null,
  larguraMinimaRecomendada: number,
): boolean {
  return (
    larguraNatural !== null &&
    Number.isFinite(larguraNatural) &&
    larguraNatural > 0 &&
    larguraNatural < larguraMinimaRecomendada
  );
}

/** O texto do D10 com o número do destino (800 produto, 400 logo). */
export function avisoImagemPequena(larguraMinimaRecomendada: number): string {
  return `Esta imagem é pequena e pode ficar borrada. Prefira uma com pelo menos ${larguraMinimaRecomendada} px de largura.`;
}

// ── FormData ─────────────────────────────────────────────────────────────────

/** Recorte + `origem_id` (D2: as actions de recorte exigem a origem). */
export function montarFormDataRecorte(
  recorte: Blob,
  nomeArquivo: string,
  origemId: string,
): FormData {
  const fd = new FormData();
  fd.append(CAMPO_ARQUIVO, recorte, nomeArquivo);
  fd.append(CAMPO_ORIGEM, origemId);
  return fd;
}

/** Original reduzida + miniatura (P4/P9), o par que `enviarImagemGaleria` espera. */
export function montarFormDataOriginal(original: Blob, miniatura: Blob): FormData {
  const fd = new FormData();
  fd.append(CAMPO_ARQUIVO, original, "original.webp");
  fd.append(CAMPO_MINIATURA, miniatura, "miniatura.webp");
  return fd;
}

// ── Mensagens ────────────────────────────────────────────────────────────────

/**
 * Mensagens do servidor que dizem ao lojista o que fazer. São literais do
 * contrato (sem detalhe interno); qualquer outra coisa vira a genérica do
 * chamador (seguranca.md §14).
 */
const MENSAGENS_ACIONAVEIS: ReadonlySet<string> = new Set([
  MSG_ORIGEM_REMOVIDA,
  MSG_FOTO_REMOVIDA_DA_GALERIA,
  MSG_TENTE_DE_NOVO,
  MSG_TETO,
  MSG_MUITAS_TENTATIVAS,
]);

export function mensagemDeErro(erro: string, generica: string): string {
  return MENSAGENS_ACIONAVEIS.has(erro) ? erro : generica;
}

/** A origem sumiu (removida em outra aba): a UI volta ao estado anterior. */
export function origemFoiRemovida(erro: string): boolean {
  return erro === MSG_ORIGEM_REMOVIDA || erro === MSG_FOTO_REMOVIDA_DA_GALERIA;
}

// ── Envio do recorte ─────────────────────────────────────────────────────────

export type ResultadoFluxoRecorte =
  | { ok: true; url: string }
  | {
      ok: false;
      mensagem: string;
      /** `true` → sai do cropper (volta ao estado anterior); `false` → deixa tentar de novo. */
      fecharCropper: boolean;
    };

/**
 * "Confirmar e enviar" do cropper, com o recorte JÁ exportado:
 *
 *  (a) origem da galeria → só `enviarRecorte(recorte + origem_id)`;
 *  (b) arquivo novo → `preparar` (original ≤ 2048 + miniatura 400) →
 *      `enviarParaGaleria` → `enviarRecorte` com o `origem_id` devolvido.
 *      Se a segunda chamada falhar, a original já está na galeria e o lojista
 *      lê `MSG_RECORTE_FALHOU`.
 *
 * Só chamado no "Confirmar": cancelar o cropper não chega aqui e não sobe nada
 * (RN-G18). Nunca lança — exceção de uma action vira mensagem genérica.
 */
export async function enviarRecorteComOrigem(p: {
  origem: OrigemDoRecorte;
  recorte: Blob;
  nomeArquivo: string;
  preparar: (arquivo: Blob) => Promise<ResultadoPreparoGaleria>;
  enviarParaGaleria: EnviarParaGaleria;
  enviarRecorte: EnviarRecorte;
  /** Genérica do destino ("Não foi possível enviar a foto…"). */
  erroGenerico: string;
}): Promise<ResultadoFluxoRecorte> {
  let origemId: string;

  if (p.origem.tipo === "galeria") {
    origemId = p.origem.origemId;
  } else {
    const par = await p.preparar(p.origem.arquivo);
    // A imagem em si é o problema (grande demais mesmo reduzida, formato que
    // o navegador não converte): tentar de novo não resolve.
    if (!par.ok) return { ok: false, mensagem: par.erro, fecharCropper: true };

    let envio: ResultadoEnvioGaleria;
    try {
      envio = await p.enviarParaGaleria(montarFormDataOriginal(par.original, par.miniatura));
    } catch (e) {
      console.error("[fluxoRecorte] enviarParaGaleria", e);
      return { ok: false, mensagem: MSG_ENVIO_FALHOU, fecharCropper: false };
    }
    // Nada subiu: o cropper fica aberto para tentar de novo ou cancelar.
    if (!envio.ok) {
      return { ok: false, mensagem: mensagemDeErro(envio.erro, MSG_ENVIO_FALHOU), fecharCropper: false };
    }
    origemId = envio.imagem.id;

    const recorte = await chamarRecorte(p.enviarRecorte, p.recorte, p.nomeArquivo, origemId);
    if (!recorte.ok) return { ok: false, mensagem: MSG_RECORTE_FALHOU, fecharCropper: true };
    return { ok: true, url: recorte.url };
  }

  const recorte = await chamarRecorte(p.enviarRecorte, p.recorte, p.nomeArquivo, origemId);
  if (recorte.ok) return { ok: true, url: recorte.url };
  return {
    ok: false,
    mensagem: mensagemDeErro(recorte.erro, p.erroGenerico),
    fecharCropper: origemFoiRemovida(recorte.erro),
  };
}

async function chamarRecorte(
  enviar: EnviarRecorte,
  recorte: Blob,
  nomeArquivo: string,
  origemId: string,
): Promise<ResultadoRecorte> {
  try {
    return await enviar(montarFormDataRecorte(recorte, nomeArquivo, origemId));
  } catch (e) {
    console.error("[fluxoRecorte] enviarRecorte", e);
    return { ok: false, erro: "" };
  }
}

// ── Download da original escolhida na galeria (DP4) ──────────────────────────

export const MSG_ABRIR_IMAGEM_FALHOU = "Não foi possível abrir a imagem. Tente de novo.";

export type ResultadoDownloadOriginal = { ok: true; blob: Blob } | { ok: false; erro: string };

/**
 * Baixa a original para o cropper: `fetch` com CORS → `Blob`. O chamador cria
 * o objectURL e segue o MESMO caminho do arquivo local (mesma revogação, mesmo
 * gate de magic bytes, passado em `validar`).
 *
 * A URL leva `?recorte=1` (`urlParaRecorte`): o service worker guarda a
 * resposta OPACA de todo `<img>` da URL sem query, e um `fetch` com CORS da
 * mesma chave receberia essa resposta e falharia. Com a query a chave do cache
 * é outra, e o Storage ignora a query.
 *
 * 400/404 do Storage = o objeto não existe mais (removido em outra aba).
 */
export async function baixarOriginalDaGaleria(
  url: string,
  validar: (blob: Blob) => Promise<string | null>,
  buscar: typeof fetch = fetch,
): Promise<ResultadoDownloadOriginal> {
  const segura = fotoSegura(url);
  if (!segura) return { ok: false, erro: MSG_ABRIR_IMAGEM_FALHOU };
  try {
    const resposta = await buscar(urlParaRecorte(segura), { mode: "cors" });
    if (resposta.status === 400 || resposta.status === 404) {
      return { ok: false, erro: MSG_ORIGEM_REMOVIDA };
    }
    if (!resposta.ok) return { ok: false, erro: MSG_ABRIR_IMAGEM_FALHOU };
    const blob = await resposta.blob();
    const invalido = await validar(blob);
    if (invalido) return { ok: false, erro: invalido };
    return { ok: true, blob };
  } catch (e) {
    console.error("[fluxoRecorte] baixarOriginalDaGaleria", e);
    return { ok: false, erro: MSG_ABRIR_IMAGEM_FALHOU };
  }
}
