"use server";

// Server Action do ciclo mensal do relatório de vendas — lojista (issue 354, RN-V08).
//
// Contrato (seguranca.md §2/§14), molde `salvarModalidadesEntrega`:
//   - zod (`schemaCicloVendas`, `.strict()`) ANTES de qualquer I/O;
//   - client AUTENTICADO (RLS `lojas_update_proprio`), nunca service_role;
//   - a loja é a do dono logado (`buscarLojaDoDono`), NUNCA do payload;
//   - patch pela allowlist `montarPatchCiclo` (só `dia_inicio_ciclo`);
//   - `count !== 1` também é falha: UPDATE que a RLS zerou não é sucesso;
//   - erro interno → log só com o código + mensagem genérica.
// Módulo 'use server': só exporta funções async.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { montarPatchCiclo } from "@/lib/actions/patches-loja";
import { MSG_CICLO_INVALIDO, schemaCicloVendas } from "@/lib/validacoes/vendas";
import { codigoDoErro } from "@/lib/utils/codigoDoErro";
import type { ResultadoCiclo } from "@/lib/vendas/tipos";

const ERRO_GENERICO = "Não foi possível salvar o ciclo. Tente de novo.";

export async function salvarCicloVendas(payload: unknown): Promise<ResultadoCiclo> {
  const parsed = schemaCicloVendas.safeParse(payload);
  if (!parsed.success) return { ok: false, erro: MSG_CICLO_INVALIDO };

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_GENERICO };

    const { error, count } = await supabase
      .from("lojas")
      .update(montarPatchCiclo(parsed.data), { count: "exact" })
      .eq("id", loja.id);
    if (error) {
      console.error("[salvarCicloVendas]", codigoDoErro(error));
      return { ok: false, erro: ERRO_GENERICO };
    }
    if (count !== 1) {
      console.error("[salvarCicloVendas] linhas afetadas", count);
      return { ok: false, erro: ERRO_GENERICO };
    }

    revalidatePath("/painel/vendas");
    return { ok: true };
  } catch (e) {
    console.error("[salvarCicloVendas]", codigoDoErro(e));
    return { ok: false, erro: ERRO_GENERICO };
  }
}
