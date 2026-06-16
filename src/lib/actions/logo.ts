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
//   - erro genérico ao client, detalhe só em console.error.

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { extrairIp, verificarRateLimit } from "@/lib/utils/rateLimit";
import { schemaStorageUrl } from "@/lib/validacoes/storage";
import { validarBlobImagem } from "./upload-imagem";
import { CAMPO_ARQUIVO } from "./upload-contrato";
import type { ResultadoLogo, ResultadoSalvarLogo } from "./logo-contrato";

const BUCKET = "produtos";
const ERRO_GENERICO = "Não foi possível salvar a logo. Tente novamente.";

// revalidatePath best-effort. `revalidarVitrine` de loja.ts é PRIVADO daquele
// módulo `'use server'` (não exportável) — reimplementado aqui (mesmo padrão).
function revalidarVitrine(...slugs: string[]): void {
  for (const slug of slugs) {
    try {
      revalidatePath(`/${slug}`);
    } catch (e) {
      console.error("revalidarVitrine:", e);
    }
  }
}

/**
 * Recebe o Blob do crop (campo `CAMPO_ARQUIVO`), valida no servidor, escreve em
 * `{loja_id}/logo/{uuid}.webp` no Storage e persiste `lojas.logo_url` sob RLS.
 * Qualquer `loja_id` no FormData é IGNORADO — a loja vem sempre do auth.
 */
export async function salvarLogoLoja(
  formData: FormData,
): Promise<ResultadoSalvarLogo> {
  // Rate limit por IP (contenção de abuso/custo, fail-open — não é gate).
  const ip = extrairIp(await headers());
  const rl = await verificarRateLimit("salvarLogoLoja", ip);
  if (!rl.permitido) {
    return { ok: false, erro: "Muitas tentativas. Aguarde um instante." };
  }

  // Extrai e valida o arquivo. File herda de Blob (cropper ou <input file>).
  const value = formData.get(CAMPO_ARQUIVO);
  if (!(value instanceof Blob) || value.size <= 0) {
    return { ok: false, erro: "Imagem inválida." };
  }
  const file = value;

  const supabase = await createClient();

  // loja DERIVADA do auth (RLS) — payload do client é ignorado.
  const loja = await buscarLojaDoDono(supabase);
  if (!loja) {
    return { ok: false, erro: "Não autorizado." };
  }

  // Dupla validação server-side (metadado + conteúdo real) + extensão do tipo REAL.
  const validacao = await validarBlobImagem(file);
  if (!validacao.ok) {
    return { ok: false, erro: validacao.erro };
  }
  const { buffer, tipoReal, ext } = validacao;

  // Path escopado por `{loja_id}/logo/` — relativo ao bucket, UUID como nome.
  const path = `${loja.id}/logo/${crypto.randomUUID()}.${ext}`;

  const { error: erroUpload } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: tipoReal });

  if (erroUpload) {
    console.error("[salvarLogoLoja] falha no upload:", erroUpload);
    return { ok: false, erro: ERRO_GENERICO };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // schemaStorageUrl ANTES do UPDATE — URL fora do Storage do iRango NÃO persiste.
  const urlValida = schemaStorageUrl.safeParse(data.publicUrl);
  if (!urlValida.success) {
    console.error("[salvarLogoLoja] URL pública fora do Storage:", data.publicUrl);
    return { ok: false, erro: ERRO_GENERICO };
  }
  const logoUrl = urlValida.data;

  // UPDATE allowlist `{ logo_url }` sob RLS (lojas_update_proprio), escopado por id.
  const { error: erroUpdate } = await supabase
    .from("lojas")
    .update({ logo_url: logoUrl })
    .eq("id", loja.id);

  if (erroUpdate) {
    console.error("[salvarLogoLoja] falha no UPDATE:", erroUpdate);
    return { ok: false, erro: ERRO_GENERICO };
  }

  revalidarVitrine(loja.slug);
  return { ok: true, logo_url: logoUrl };
}

/**
 * Zera `lojas.logo_url` (UPDATE `null` sob RLS, escopado por id). Sem upload.
 */
export async function removerLogoLoja(): Promise<ResultadoLogo> {
  const supabase = await createClient();

  const loja = await buscarLojaDoDono(supabase);
  if (!loja) {
    return { ok: false, erro: "Não autorizado." };
  }

  const { error } = await supabase
    .from("lojas")
    .update({ logo_url: null })
    .eq("id", loja.id);

  if (error) {
    console.error("[removerLogoLoja] falha no UPDATE:", error);
    return { ok: false, erro: ERRO_GENERICO };
  }

  revalidarVitrine(loja.slug);
  return { ok: true };
}
