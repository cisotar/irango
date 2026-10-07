"use server";

// Server Actions de logo da loja (issue 003). Persiste/remove `lojas.logo_url`
// sob RLS, recebendo o Blob do crop via FormData. Mesmo contrato de segurança
// das demais actions (seguranca.md §10/§13/§14/§18):
//   - client AUTENTICADO (RLS do bucket `produtos` e de `lojas_update_proprio`),
//     NUNCA service_role;
//   - loja_id DERIVADO do auth (buscarLojaDoDono) — loja_id no FormData é IGNORADO;
//   - dupla validação server-side (metadado + conteúdo real) via validarBlobImagem;
//   - nome de saída UUID, path escopado `{loja_id}/logo/{uuid}.{ext}` (relativo ao
//     bucket, SEM prefixo `produtos/` — senão foldername(name)[1] vira "produtos"
//     e a policy RLS recusa o upload);
//   - schemaStorageUrl valida a URL pública ANTES do UPDATE — barra URL externa;
//   - UPDATE da coluna allowlist `{ logo_url }` `.eq("id", loja.id)` sob RLS;
//   - erro genérico ao client, detalhe só em console.error;
//   - [galeria] exige `origem_id`, registra a linha-cópia antes do UPDATE e
//     traduz a recusa do trigger de M4 e o deadlock (galeria-contrato.ts).

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { schemaOrigemId } from "@/lib/validacoes/galeria";
import { CAMPO_ARQUIVO } from "./upload-contrato";
import type { ResultadoLogo, ResultadoSalvarLogo } from "./logo-contrato";
import {
  CAMPO_ORIGEM,
  MSG_IMAGEM_INVALIDA,
  MSG_MUITAS_TENTATIVAS,
  MSG_NAO_AUTORIZADO,
  erroDeEscritaDeImagem,
} from "./galeria-contrato";
import { subirRecorteDaGaleria } from "./galeria-upload";
import { processarRemocoesPendentes } from "./galeria-pendentes";

const ERRO_GENERICO = "Não foi possível salvar a logo. Tente novamente.";

// revalidatePath best-effort. `revalidarVitrine` de loja.ts é PRIVADO daquele
// módulo `'use server'` (não exportável) — reimplementado aqui (mesmo padrão).
function revalidarVitrine(...slugs: string[]): void {
  for (const slug of slugs) {
    try {
      revalidatePath(`/loja/${slug}`);
    } catch (e) {
      console.error("revalidarVitrine:", e);
    }
  }
}

/**
 * Recebe o Blob do crop (campo `CAMPO_ARQUIVO`) e o `origem_id` OBRIGATÓRIO
 * (original da própria loja), valida no servidor, escreve em
 * `{loja_id}/logo/{uuid}.{ext}`, registra a linha-cópia ANTES do UPDATE e
 * persiste `lojas.logo_url` sob RLS. Qualquer `loja_id` no FormData é IGNORADO.
 */
export async function salvarLogoLoja(
  formData: FormData,
): Promise<ResultadoSalvarLogo> {
  // Rate limit por IP (contenção de abuso/custo, fail-open — não é gate).
  const ip = extrairIp(await headers());
  const rl = await verificarRateLimit("salvarLogoLoja", ip);
  if (!rl.permitido) {
    return { ok: false, erro: MSG_MUITAS_TENTATIVAS };
  }

  // Extrai e valida o arquivo. File herda de Blob (cropper ou <input file>).
  const value = formData.get(CAMPO_ARQUIVO);
  if (!(value instanceof Blob) || value.size <= 0) {
    return { ok: false, erro: MSG_IMAGEM_INVALIDA };
  }
  const origem = schemaOrigemId.safeParse(formData.get(CAMPO_ORIGEM));
  if (!origem.success) {
    return { ok: false, erro: MSG_IMAGEM_INVALIDA };
  }

  const supabase = await createClient();

  // loja DERIVADA do auth (RLS) — payload do client é ignorado.
  const loja = await buscarLojaDoDono(supabase);
  if (!loja) {
    return { ok: false, erro: MSG_NAO_AUTORIZADO };
  }

  // Blob + posse da origem + upload + schemaStorageUrl + linha-cópia (antes do
  // UPDATE, para o trigger de M4 aceitar a URL).
  const recorte = await subirRecorteDaGaleria({
    client: supabase,
    lojaId: loja.id,
    origemId: origem.data,
    destino: "logo",
    arquivo: value,
    exigirUrlDoStorage: true,
    inserir: (linha) => supabase.from("imagens_loja").insert({ ...linha, loja_id: loja.id }),
    erroGenerico: ERRO_GENERICO,
    rotulo: "salvarLogoLoja",
  });
  if (!recorte.ok) return recorte;
  const logoUrl = recorte.url;

  // UPDATE allowlist `{ logo_url }` sob RLS (lojas_update_proprio), escopado por id.
  const { error: erroUpdate } = await supabase
    .from("lojas")
    .update({ logo_url: logoUrl })
    .eq("id", loja.id);

  if (erroUpdate) {
    console.error("[salvarLogoLoja] falha no UPDATE:", erroUpdate);
    return { ok: false, erro: erroDeEscritaDeImagem(erroUpdate, ERRO_GENERICO) };
  }

  // Best-effort (D5): o helper nunca rejeita; falha vai para o log.
  await processarRemocoesPendentes(supabase, loja.id);
  revalidarVitrine(loja.slug);
  return { ok: true, logo_url: logoUrl };
}

/**
 * Zera `lojas.logo_url` (UPDATE `null` sob RLS, escopado por id). Sem upload.
 * A original continua na galeria; o recorte sem outro uso é apagado (D5).
 */
export async function removerLogoLoja(): Promise<ResultadoLogo> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (!loja) {
    return { ok: false, erro: MSG_NAO_AUTORIZADO };
  }

  const { error } = await supabase
    .from("lojas")
    .update({ logo_url: null })
    .eq("id", loja.id);

  if (error) {
    console.error("[removerLogoLoja] falha no UPDATE:", error);
    return { ok: false, erro: erroDeEscritaDeImagem(error, ERRO_GENERICO) };
  }

  // Best-effort (D5): o helper nunca rejeita; falha vai para o log.
  await processarRemocoesPendentes(supabase, loja.id);
  revalidarVitrine(loja.slug);
  return { ok: true };
}
