// Envio de imagens da galeria (specs/galeria-imagens-loja.md, RN-G3, RN-G4,
// RN-G12, RN-G16). Módulo NEUTRO — sem `'use server'` — com UMA implementação
// do fluxo para os dois mundos: o lojista passa o client autenticado (RLS) e um
// INSERT próprio; o admin passa o service client e um INSERT via `escopo.inserir`.
// A loja (`lojaId`) chega sempre já resolvida pelo chamador: da sessão
// (lojista) ou validada como uuid depois da prova de admin — nunca do payload.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buscarOriginalDaLoja, contarOriginaisDaLoja } from "@/lib/supabase/queries/imagens";
import { schemaStorageUrl } from "@/lib/validacoes/storage";
import { validarBlobImagem } from "./upload-imagem";
import {
  BUCKET_IMAGENS,
  TETO_IMAGENS_POR_LOJA,
  MSG_TETO,
  MSG_ORIGEM_REMOVIDA,
  MSG_ENVIO_FALHOU,
  MSG_IMAGEM_INVALIDA,
  caminhoOriginal,
  caminhoMiniatura,
  caminhoRecorte,
  ehErroOrigemIndisponivel,
  type ResultadoEnvioGaleria,
} from "./galeria-contrato";

type Client = SupabaseClient<Database>;
type RespostaInsert = PromiseLike<{ data?: unknown; error: unknown }>;

/** Compensação best-effort: apaga do Storage o que subiu antes da falha. */
async function apagarSubidos(client: Client, caminhos: string[], rotulo: string): Promise<void> {
  if (caminhos.length === 0) return;
  try {
    const { error } = await client.storage.from(BUCKET_IMAGENS).remove(caminhos);
    if (error) console.error(`[${rotulo}] compensação falhou`, error);
  } catch (e) {
    console.error(`[${rotulo}] compensação falhou`, e);
  }
}

function urlPublica(client: Client, caminho: string): string {
  return client.storage.from(BUCKET_IMAGENS).getPublicUrl(caminho).data.publicUrl;
}

function criadoEmDe(data: unknown): string {
  if (data != null && typeof data === "object") {
    const v = (data as { criado_em?: unknown }).criado_em;
    if (typeof v === "string") return v;
  }
  return new Date().toISOString();
}

/**
 * Original + miniatura para a galeria: valida as duas (`validarBlobImagem`;
 * miniatura sempre webp), confere o teto no servidor ANTES do upload, sobe nos
 * caminhos montados aqui e registra a linha com `bytes` medido do buffer. Se o
 * INSERT falha, apaga os dois objetos.
 */
export async function subirOriginalNaGaleria(p: {
  client: Client;
  lojaId: string;
  original: Blob;
  miniatura: Blob;
  inserir: (linha: {
    id: string;
    caminho: string;
    miniatura_caminho: string;
    bytes: number;
  }) => RespostaInsert;
  rotulo: string;
}): Promise<ResultadoEnvioGaleria> {
  const original = await validarBlobImagem(p.original);
  if (!original.ok) return { ok: false, erro: original.erro };
  const miniatura = await validarBlobImagem(p.miniatura);
  if (!miniatura.ok) return { ok: false, erro: miniatura.erro };
  if (miniatura.tipoReal !== "image/webp") return { ok: false, erro: MSG_IMAGEM_INVALIDA };

  // Teto autoritativo (RN-G12). Erro de contagem não fura o teto: recusa.
  try {
    const total = await contarOriginaisDaLoja(p.client, p.lojaId);
    if (total >= TETO_IMAGENS_POR_LOJA) return { ok: false, erro: MSG_TETO };
  } catch (e) {
    console.error(`[${p.rotulo}] falha ao contar originais`, e);
    return { ok: false, erro: MSG_ENVIO_FALHOU };
  }

  const id = crypto.randomUUID();
  const caminho = caminhoOriginal(p.lojaId, id, original.ext);
  const caminhoMini = caminhoMiniatura(p.lojaId, id);
  const subidos: string[] = [];
  try {
    const up = await p.client.storage
      .from(BUCKET_IMAGENS)
      .upload(caminho, original.buffer, { contentType: original.tipoReal });
    if (up.error) throw up.error;
    subidos.push(caminho);

    const upMini = await p.client.storage
      .from(BUCKET_IMAGENS)
      .upload(caminhoMini, miniatura.buffer, { contentType: "image/webp" });
    if (upMini.error) throw upMini.error;
    subidos.push(caminhoMini);

    const { data, error } = await p.inserir({
      id,
      caminho,
      miniatura_caminho: caminhoMini,
      bytes: original.buffer.byteLength,
    });
    if (error) throw error;

    return {
      ok: true,
      imagem: {
        id,
        url: urlPublica(p.client, caminho),
        miniatura_url: urlPublica(p.client, caminhoMini),
        criado_em: criadoEmDe(data),
      },
    };
  } catch (e) {
    console.error(`[${p.rotulo}] falha no envio`, e);
    await apagarSubidos(p.client, subidos, p.rotulo);
    return { ok: false, erro: MSG_ENVIO_FALHOU };
  }
}

/**
 * Recorte de uma original (D2, RN-G3): valida o arquivo, confere que a origem é
 * original não pendente DA LOJA antes do upload, sobe em `caminhoRecorte` e
 * registra a linha-cópia. `exigirUrlDoStorage` barra URL externa antes de
 * qualquer persistência (logo, que grava a URL na mesma action).
 */
export async function subirRecorteDaGaleria(p: {
  client: Client;
  lojaId: string;
  origemId: string;
  destino: "produto" | "logo";
  arquivo: Blob;
  exigirUrlDoStorage: boolean;
  inserir: (linha: { origem_id: string; caminho: string; bytes: number }) => RespostaInsert;
  erroGenerico: string;
  rotulo: string;
}): Promise<{ ok: true; url: string; caminho: string } | { ok: false; erro: string }> {
  const validacao = await validarBlobImagem(p.arquivo);
  if (!validacao.ok) return { ok: false, erro: validacao.erro };

  try {
    const origem = await buscarOriginalDaLoja(p.client, p.lojaId, p.origemId);
    if (!origem) return { ok: false, erro: MSG_ORIGEM_REMOVIDA };
  } catch (e) {
    console.error(`[${p.rotulo}] falha ao conferir a origem`, e);
    return { ok: false, erro: p.erroGenerico };
  }

  const caminho = caminhoRecorte(p.lojaId, p.destino, crypto.randomUUID(), validacao.ext);
  const { error: erroUpload } = await p.client.storage
    .from(BUCKET_IMAGENS)
    .upload(caminho, validacao.buffer, { contentType: validacao.tipoReal });
  if (erroUpload) {
    console.error(`[${p.rotulo}] falha no upload`, erroUpload);
    return { ok: false, erro: p.erroGenerico };
  }

  const url = urlPublica(p.client, caminho);
  if (p.exigirUrlDoStorage && !schemaStorageUrl.safeParse(url).success) {
    console.error(`[${p.rotulo}] URL pública fora do Storage`, url);
    await apagarSubidos(p.client, [caminho], p.rotulo);
    return { ok: false, erro: p.erroGenerico };
  }

  try {
    const { error } = await p.inserir({
      origem_id: p.origemId,
      caminho,
      bytes: validacao.buffer.byteLength,
    });
    if (error) throw error;
  } catch (e) {
    console.error(`[${p.rotulo}] falha ao registrar o recorte`, e);
    await apagarSubidos(p.client, [caminho], p.rotulo);
    // Corrida: a origem ficou pendente entre a checagem e o INSERT.
    return { ok: false, erro: ehErroOrigemIndisponivel(e) ? MSG_ORIGEM_REMOVIDA : p.erroGenerico };
  }

  return { ok: true, url, caminho };
}
