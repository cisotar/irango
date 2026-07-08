"use server";

/**
 * Server Action ADMIN — issue 142 (crítica: SIM). ÚNICA via legítima de o dono do
 * SaaS ligar/desligar os módulos pagos de impressão de uma loja-alvo: escreve as
 * flags `lojas.modulo_impressao_a4` / `lojas.modulo_impressao_termica` via
 * service_role, FORA de `escopo.atualizarLoja` (que descartaria essas colunas por
 * `CAMPOS_LOJA_SOMENTE_SERVIDOR`, virando no-op silencioso). O gate NÃO é RLS
 * (service_role bypassa) — é o guard admin + `.eq("id", lojaId)`.
 *
 * Ordem fail-closed (D-4, espelha admin-publicar/desvincularBilling):
 *  1. validarLojaIdAdmin(lojaId) (z.guid) ANTES de qualquer efeito → inválido =
 *     { ok:false, erro:"Loja inválida." } sem tocar admin/service/DB.
 *  2. entradaSchema (z.enum fixo) valida `modulo`/`ativo` → fora do union =
 *     { ok:false, erro:"Módulo inválido." } SEM tocar o banco (vetor de injeção
 *     de nome de coluna: o cliente escolhe entre DOIS alvos pré-aprovados, nunca
 *     um identificador arbitrário).
 *  3. prepararContextoAdmin(lojaId) FORA do try → verificarAdminSaaS propaga se
 *     falhar; service client só nasce depois.
 *  4. UPDATE CRU `svc.from("lojas").update(patch, { count:"exact" }).eq("id", …)`
 *     no MESMO statement (escopo cross-tenant + camada 3 do enforcement).
 *  5. error → genérico; count === 0 → "Loja não encontrada."; senão registra o
 *     acesso (no-op hoje) + revalida + { ok:true }.
 *
 * REGRA 'use server': só funções async são exportadas — schema/constante/tipos
 * ficam locais e NÃO-exportados (const exportada quebra só no `next build`).
 */

import { z } from "zod";
import type { Database } from "@/lib/database.types";
import {
  validarLojaIdAdmin,
  prepararContextoAdmin,
  revalidarLojaAdmin,
  registrarAcessoAdmin,
} from "@/lib/actions/admin-loja";

type Resultado = { ok: true } | { ok: false; erro: string };
type LojaUpdate = Database["public"]["Tables"]["lojas"]["Update"];

// Union FIXO: o cliente escolhe entre dois módulos pré-aprovados, nunca um nome de
// coluna cru. Fora do union → falha antes de qualquer efeito.
const entradaSchema = z.object({
  modulo: z.enum(["a4", "termica"]),
  ativo: z.boolean(),
});

// Mapa módulo→coluna materializado server-side (não-exportado): o nome real da
// coluna nunca vem do cliente. Só usado na trilha de auditoria (o UPDATE usa o
// ternário tipado abaixo para dispensar cast de chave computada).
const COLUNA_POR_MODULO = {
  a4: "modulo_impressao_a4",
  termica: "modulo_impressao_termica",
} as const;

export async function alternarModuloImpressao(
  lojaId: string,
  modulo: string,
  ativo: boolean,
): Promise<Resultado> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = entradaSchema.safeParse({ modulo, ativo });
  if (!parsed.success) return { ok: false, erro: "Módulo inválido." };
  const { modulo: mod, ativo: valor } = parsed.data;

  // Fail-closed (D-4): prova de admin FORA do try → propaga; service só depois.
  const { svc } = await prepararContextoAdmin(loja.lojaId);

  try {
    // Ternário = o mapa server-side materializado; nome de coluna nunca vem do
    // cliente. Patch TOTALMENTE TIPADO (colunas já existem em database.types) —
    // sem cast. NÃO usar escopo.atualizarLoja: descartaria modulo_* (RN-1).
    const patch: LojaUpdate =
      mod === "a4"
        ? { modulo_impressao_a4: valor }
        : { modulo_impressao_termica: valor };

    // UPDATE cru com `.eq` no MESMO statement → escopo cross-tenant só à loja-alvo
    // e conformidade com a camada 3 do enforcement-escopo-admin.
    const { error, count } = await svc
      .from("lojas")
      .update(patch, { count: "exact" })
      .eq("id", loja.lojaId);

    if (error) {
      console.error("[alternarModuloImpressao]", error);
      return { ok: false, erro: "Não foi possível alterar o módulo." };
    }
    if (count === 0) return { ok: false, erro: "Loja não encontrada." };

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "alternar_modulo_impressao",
      metadados: { modulo: mod, ativo: valor, coluna: COLUNA_POR_MODULO[mod] },
    });
    revalidarLojaAdmin(loja.lojaId);
    return { ok: true };
  } catch (e) {
    console.error("[alternarModuloImpressao]", e);
    return { ok: false, erro: "Não foi possível alterar o módulo." };
  }
}
