"use server";

/**
 * Variante ADMIN do flip de publicação da vitrine — issue 095 (crítica: SIM).
 * Alterna a coluna `ativo` da LOJA-ALVO (`lojaId` explícito vindo da URL admin),
 * via service_role, escopada pelo wrapper `escopo.atualizarLoja` (eq("id", lojaId)).
 * Gate de publicação dedicado e SEPARADO do salvar-perfil (RN-8): aqui só `ativo`
 * é tocado, NENHUMA coluna de billing/assinatura/dono (`assinatura_status`,
 * `billing_provider`, `plano_id`, `dono_id`, ...) entra no patch (§9). Diferente de
 * `definirPublicacao` do lojista (src/lib/actions/loja.ts), o isolamento NÃO vem de
 * RLS por dono — vem do escopo do wrapper sob service_role (BYPASSRLS).
 *
 * Ordem fail-closed (D-4):
 *  1. validarLojaIdAdmin(lojaId) (z.guid) ANTES de qualquer efeito → inválido =
 *     { ok:false } sem tocar admin/service/update.
 *  2. verificarAdminSaaS() FORA do try → exceção PROPAGA, service só depois.
 *  3. Ao PUBLICAR: gate de perfil mínimo (nome + WhatsApp) revalidado no servidor
 *     (`podePublicarLoja`), paridade com o lojista — o preview do cliente não é
 *     autoridade. Despublicar não passa pelo gate.
 *  4. escopo.atualizarLoja({ ativo: publicar }) — patch EXATAMENTE { ativo }
 *     (RN-8/§9), escopo por id só a loja-alvo (RN-3).
 *  4. revalidatePath admin + vitrine; registrarAcessoAdmin (best-effort: INSERT em admin_acessos); catch genérico.
 *
 * REGRA: arquivo 'use server' só exporta funções async — tipos locais sem export.
 */

import {
  validarLojaIdAdmin,
  registrarAcessoAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
} from "@/lib/actions/admin-loja";
import { buscarLojaAdminPorId } from "@/lib/supabase/queries/lojas";
import {
  podePublicarLoja,
  ERRO_PERFIL_INCOMPLETO,
} from "@/lib/utils/publicacao";

type Resultado = { ok: true } | { ok: false; erro: string };

export async function publicarLojaAdmin(
  lojaId: string,
  publicar: boolean,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  // Fail-closed: prova de admin FORA do try → propaga, service só depois.
  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Gate de perfil mínimo (RN-8), revalidado no SERVIDOR — paridade com o
    // lojista (`definirPublicacao`). O `podePublicar` do cliente é só preview;
    // a autoridade é aqui. Só barra ao PUBLICAR (despublicar sempre pode).
    if (publicar) {
      const alvo = await buscarLojaAdminPorId(svc, loja.lojaId);
      if (alvo == null) return { ok: false, erro: "Loja não encontrada." };
      if (!podePublicarLoja(alvo.nome, alvo.whatsapp)) {
        return { ok: false, erro: ERRO_PERFIL_INCOMPLETO };
      }
    }

    // Patch EXATO { ativo } (RN-8/§9): nenhuma coluna de billing/assinatura/dono.
    // Escopo por id (RN-3) pelo wrapper: só a loja-alvo é tocada.
    const { error } = await escopo.atualizarLoja({ ativo: publicar });
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
