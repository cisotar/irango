"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verificarAdminSaaS } from "@/lib/auth/admin";
import { createServiceClient } from "@/lib/supabase/service";
import {
  aplicarStatusAdmin,
  excluirLojaPermanente,
} from "@/lib/supabase/queries/adminAssinatura";

/**
 * ÚNICA via não-webhook autorizada a escrever `assinatura_status` (RN-12/13/14).
 * Toda action: (1) valida `lojaId` (UUID) server-side; (2) `verificarAdminSaaS()`
 * ANTES de qualquer efeito — falha de admin propaga (D-4, nunca vira `{ ok:false }`
 * amigável); (3) eleva para service_role só depois da prova; (4) revalida a rota.
 * O cliente envia APENAS `lojaId` — status/datas são constantes literais por
 * action, decididas server-side (Recálculo no Servidor).
 */

type Resultado = { ok: true } | { ok: false; erro: string };

// z.guid() (não z.uuid()): valida formato uuid sem exigir nibbles de versão/variante
// RFC-4122 — alinhado com frete.ts/schemaCheckout do projeto.
const lojaIdSchema = z.guid();

const ROTA_ASSINANTES = "/admin/assinantes";

function lojaNaoEncontrada(): Resultado {
  return { ok: false, erro: "Loja não encontrada." };
}

/** Concede cortesia: acesso pleno sem cobrança. billing_provider/plano_id = NULL (RN-12). */
export async function concederCortesia(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    const { linhasAfetadas } = await aplicarStatusAdmin(
      svc,
      parsed.data,
      "cortesia",
      null,
    );
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    await desvincularBilling(svc, parsed.data);
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[concederCortesia]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/** Revoga cortesia: corte imediato (cancelada, fim_periodo=now()). */
export async function revogarCortesia(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    const { linhasAfetadas } = await aplicarStatusAdmin(
      svc,
      parsed.data,
      "cancelada",
      new Date(),
    );
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[revogarCortesia]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/** Suspende a loja: corte imediato (suspensa, fim_periodo=now()), sem carência. */
export async function suspenderLoja(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    const { linhasAfetadas } = await aplicarStatusAdmin(
      svc,
      parsed.data,
      "suspensa",
      new Date(),
    );
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[suspenderLoja]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/** Reativa a loja: override explícito para `ativa` (não toca fim_periodo). */
export async function reativarLoja(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    const { linhasAfetadas } = await aplicarStatusAdmin(
      svc,
      parsed.data,
      "ativa",
      undefined,
    );
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[reativarLoja]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/**
 * Hard delete irreversível de loja (issue 084). Recebe APENAS `lojaId`. Ordem
 * obrigatória (spec admin-hard-delete-loja.md): valida UUID → prova de admin
 * (FORA do try; propaga, fail-closed) → service_role → limpeza best-effort de
 * storage → DELETE com cascade → revalida. A "palavra de confirmação" da UI
 * (RN-2/RN-3) NÃO trafega: o servidor não a recebe nem revalida.
 */
export async function excluirLoja(lojaId: string): Promise<Resultado> {
  const parsed = lojaIdSchema.safeParse(lojaId);
  if (!parsed.success) return { ok: false, erro: "Loja inválida." };
  await verificarAdminSaaS();
  const svc = createServiceClient();
  try {
    await limparStorageDaLoja(svc, parsed.data);
    const { linhasAfetadas } = await excluirLojaPermanente(svc, parsed.data);
    if (linhasAfetadas === 0) return lojaNaoEncontrada();
    revalidatePath(ROTA_ASSINANTES);
    return { ok: true };
  } catch (e) {
    console.error("[excluirLoja]", e);
    return { ok: false, erro: "Não foi possível concluir a ação." };
  }
}

/**
 * Limpeza best-effort do storage da loja (issue 084). NUNCA aborta o DELETE:
 * qualquer falha é logada e engolida (objetos órfãos são aceitos). Buckets:
 *   - `pix-qr`: plano → `list(lojaId)`.
 *   - `produtos`: fotos na raiz `${lojaId}/` E logo em `${lojaId}/logo/` (subpasta
 *     que `list` da raiz devolve só como entrada de pasta) → listar ambos.
 * Para cada listagem, monta `${prefixo}/${item.name}` e remove (guard p/ vazio).
 */
async function limparStorageDaLoja(
  svc: ReturnType<typeof createServiceClient>,
  lojaId: string,
): Promise<void> {
  // Um remove por bucket: `produtos` agrega a raiz E a subpasta `logo/` (as duas
  // listagens). `pix-qr` é plano.
  const buckets: { bucket: string; prefixos: string[] }[] = [
    { bucket: "pix-qr", prefixos: [lojaId] },
    { bucket: "produtos", prefixos: [lojaId, `${lojaId}/logo`] },
  ];
  for (const { bucket, prefixos } of buckets) {
    try {
      const paths: string[] = [];
      for (const prefixo of prefixos) {
        const { data, error } = await svc.storage.from(bucket).list(prefixo);
        if (error) throw error;
        for (const item of data ?? []) paths.push(`${prefixo}/${item.name}`);
      }
      if (paths.length === 0) continue;
      const { error: erroRemove } = await svc.storage
        .from(bucket)
        .remove(paths);
      if (erroRemove) throw erroRemove;
    } catch (e) {
      console.error("[excluirLoja] storage", { bucket }, e);
    }
  }
}

// `billing_provider` e `plano_id` são colunas reais (migrations 073/074), mas o
// `database.types.ts` ainda não foi regenerado (DB local desligado nesta máquina).
// Tipamos o patch com a forma pós-073 — sem `any` — em vez de aguardar a regen.
type DesvinculoBilling = {
  billing_provider: null;
  plano_id: null;
};

async function desvincularBilling(
  svc: ReturnType<typeof createServiceClient>,
  lojaId: string,
): Promise<void> {
  // Cast localizado e tipado (não `any`): a coluna existe no banco; o tipo gerado
  // é que está defasado. Quando 073 regenerar os tipos, o cast pode sair.
  const patch = { billing_provider: null, plano_id: null } satisfies DesvinculoBilling;
  const { error } = await (svc.from("lojas") as unknown as {
    update: (p: DesvinculoBilling) => {
      eq: (c: string, v: string) => Promise<{ error: unknown }>;
    };
  })
    .update(patch)
    .eq("id", lojaId);
  if (error) throw error;
}
