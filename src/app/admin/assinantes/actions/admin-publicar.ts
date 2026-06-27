"use server";

/**
 * Variante ADMIN do flip de publicação da vitrine — issue 095 (crítica: SIM).
 * Alterna a coluna `ativo` da LOJA-ALVO (`lojaId` explícito vindo da URL admin),
 * via service_role, escopada por `eq("id", lojaId)`. Gate de publicação dedicado
 * e SEPARADO do salvar-perfil (RN-8): aqui só `ativo` é tocado, NENHUMA coluna de
 * billing/assinatura/dono (`assinatura_status`, `billing_provider`, `plano_id`,
 * `dono_id`, ...) entra no patch (§9). Diferente de `definirPublicacao` do lojista
 * (src/lib/actions/loja.ts), o isolamento NÃO vem de RLS por dono — vem do escopo
 * manual `eq("id", lojaId)` sob service_role (BYPASSRLS).
 *
 * Ordem fail-closed (D-4):
 *  1. validarLojaIdAdmin(lojaId) (z.guid) ANTES de qualquer efeito → inválido =
 *     { ok:false } sem tocar admin/service/update.
 *  2. verificarAdminSaaS() FORA do try → exceção PROPAGA, service só depois.
 *  3. UPDATE { ativo: publicar } em `lojas` escopado por eq("id", lojaId) —
 *     patch EXATAMENTE { ativo } (RN-8/§9), só a loja-alvo (RN-3).
 *  4. revalidatePath admin + vitrine; registrarAcessoAdmin no-op; catch genérico.
 *
 * REGRA: arquivo 'use server' só exporta funções async — tipos locais sem export.
 */

import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";

type Resultado = { ok: true } | { ok: false; erro: string };

export async function publicarLojaAdmin(
  lojaId: string,
  publicar: boolean,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  // Fail-closed: prova de admin FORA do try → propaga, service só depois.
  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Patch EXATO { ativo } (RN-8/§9): nenhuma coluna de billing/assinatura/dono.
    // Escopo eq("id", lojaId) (RN-3): só a loja-alvo é tocada.
    const { error } = await svc
      .from("lojas")
      .update({ ativo: publicar })
      .eq("id", loja.lojaId);
    if (error) {
      console.error("[publicarLojaAdmin]", error);
      return { ok: false, erro: "Não foi possível publicar a loja." };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "publicar_loja",
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[publicarLojaAdmin]", e);
    return { ok: false, erro: "Não foi possível publicar a loja." };
  }
}
