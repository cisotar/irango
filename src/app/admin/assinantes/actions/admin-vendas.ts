"use server";

// Server Action ADMIN do ciclo mensal do relatório de vendas (issue 354), par de
// `salvarCicloVendas`. Escreve na loja-alvo via service_role, molde
// `salvarModalidadesEntregaAdmin`. Ordem fail-closed (D-4):
//   validarLojaIdAdmin → zod (inválido recusado SEM elevar) → prepararContextoAdmin
//   FORA do try (a prova de admin propaga) → escopo.atualizarLoja (eq("id", lojaId))
//   com o patch da MESMA allowlist do painel → registrarAcessoAdmin → revalidatePath.
// Sob service_role não há RLS: o escopo é o `eq("id")` do wrapper e o que entra no
// patch é o que `montarPatchCiclo` deixa passar. Módulo 'use server': só funções async.

import { revalidatePath } from "next/cache";

import {
  prepararContextoAdmin,
  registrarAcessoAdmin,
  validarLojaIdAdmin,
} from "@/lib/actions/admin-loja";
import { montarPatchCiclo } from "@/lib/actions/patches-loja";
import { MSG_CICLO_INVALIDO, schemaCicloVendas } from "@/lib/validacoes/vendas";
import { codigoDoErro } from "@/lib/utils/codigoDoErro";
import type { ResultadoCiclo } from "@/lib/vendas/tipos";

const ERRO_GENERICO = "Não foi possível salvar o ciclo. Tente de novo.";

export async function salvarCicloVendasAdmin(
  lojaId: string,
  payload: unknown,
): Promise<ResultadoCiclo> {
  const loja = validarLojaIdAdmin(lojaId);
  if (!loja.ok) return { ok: false, erro: "Loja inválida." };

  const parsed = schemaCicloVendas.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_CICLO_INVALIDO };

  const { svc, escopo } = await prepararContextoAdmin(loja.lojaId);

  try {
    const { error, count } = await escopo.atualizarLoja(montarPatchCiclo(parsed.data));
    if (error) {
      console.error("[salvarCicloVendasAdmin]", codigoDoErro(error));
      return { ok: false, erro: ERRO_GENERICO };
    }
    if (count !== 1) {
      console.error("[salvarCicloVendasAdmin] linhas afetadas", count);
      return { ok: false, erro: ERRO_GENERICO };
    }

    registrarAcessoAdmin(svc, {
      lojaId: loja.lojaId,
      acao: "salvar_ciclo_vendas",
      metadados: { dia_inicio_ciclo: parsed.data.dia_inicio_ciclo },
    });
    revalidatePath(`/admin/assinantes/${loja.lojaId}/vendas`);
    return { ok: true };
  } catch (e) {
    console.error("[salvarCicloVendasAdmin]", codigoDoErro(e));
    return { ok: false, erro: ERRO_GENERICO };
  }
}
