"use server";

// Server Actions de ENTREGA (zonas + taxa 1:1 + bairros 1:N) — issue 032/046.
//
// Contrato (seguranca.md §2/§14):
//   - valida `schemaZona`/`schemaTaxa`/`schemaBairro` ANTES de qualquer I/O;
//   - usa o client AUTENTICADO (RLS `zonas_escrita_propria` / `taxas_escrita_propria`),
//     nunca service_role;
//   - loja_id é DERIVADO da loja do dono (buscarLojaDoDono), NUNCA do payload —
//     não dá pra criar/editar zona de outra loja;
//   - zona_id de taxa/bairro é re-checado contra a loja do dono antes do I/O;
//   - erro genérico no catch (sem vazar e.message).

import { revalidatePath } from "next/cache";
import {
  schemaZona,
  schemaTaxa,
  schemaZonaCompleta,
} from "@/lib/validacoes/entrega";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";

export type ResultadoEntrega = { ok: true } | { ok: false; erro: string };

const ROTA = "/painel/configuracoes/entregas";

// ──────────────────────────────────────────────────────────────────────────
// Primitivas de baixo nível (issue 032) — usadas pelos testes e reutilizáveis.
// salvarZona insere SÓ a zona; salvarTaxa insere SÓ a taxa escopada por zona.

export async function salvarZona(payload: unknown): Promise<ResultadoEntrega> {
  const parsed = schemaZona.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Zona inválida." };
  }
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }
    const { error } = await supabase
      .from("zonas_entrega")
      .insert({ ...parsed.data, loja_id: loja.id });
    if (error) {
      console.error("[salvarZona]", error);
      return { ok: false, erro: "Não foi possível salvar a zona." };
    }
    return { ok: true };
  } catch (e) {
    console.error("[salvarZona]", e);
    return { ok: false, erro: "Não foi possível salvar a zona." };
  }
}

export async function salvarTaxa(
  zonaId: string,
  payload: unknown,
): Promise<ResultadoEntrega> {
  const parsed = schemaTaxa.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Taxa inválida." };
  }
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("taxas_entrega")
      .insert({ ...parsed.data, zona_id: zonaId });
    if (error) {
      console.error("[salvarTaxa]", error);
      return { ok: false, erro: "Não foi possível salvar a taxa." };
    }
    return { ok: true };
  } catch (e) {
    console.error("[salvarTaxa]", e);
    return { ok: false, erro: "Não foi possível salvar a taxa." };
  }
}

/**
 * Cria zona + taxa (1:1) + bairros (1:N) numa transação lógica. `loja_id`
 * derivado do dono; `zona_id` da taxa/bairros vem da própria inserção.
 */
export async function criarZona(payload: unknown): Promise<ResultadoEntrega> {
  const parsed = schemaZonaCompleta.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Zona inválida." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }

    const { data: zona, error: erroZona } = await supabase
      .from("zonas_entrega")
      .insert({
        nome: parsed.data.nome,
        tipo: parsed.data.tipo,
        ativo: parsed.data.ativo,
        loja_id: loja.id,
      })
      .select("id")
      .single();
    if (erroZona || zona == null) {
      console.error("[criarZona]", erroZona);
      return { ok: false, erro: "Não foi possível salvar a zona." };
    }

    const { error: erroTaxa } = await supabase
      .from("taxas_entrega")
      .insert({ ...parsed.data.taxa, zona_id: zona.id });
    if (erroTaxa) {
      console.error("[criarZona/taxa]", erroTaxa);
      return { ok: false, erro: "Não foi possível salvar a taxa." };
    }

    if (parsed.data.bairros.length > 0) {
      const { error: erroBairros } = await supabase
        .from("bairros_zona")
        .insert(parsed.data.bairros.map((nome) => ({ nome, zona_id: zona.id })));
      if (erroBairros) {
        console.error("[criarZona/bairros]", erroBairros);
        return { ok: false, erro: "Não foi possível salvar os bairros." };
      }
    }

    revalidatePath(ROTA);
    return { ok: true };
  } catch (e) {
    console.error("[criarZona]", e);
    return { ok: false, erro: "Não foi possível salvar a zona." };
  }
}

/**
 * Atualiza zona + taxa + bairros. Escopo por `id` da zona; a RLS
 * `zonas_escrita_propria` rejeita zona de outra loja. Bairros são substituídos
 * (delete + insert) para refletir adições/remoções inline.
 */
export async function atualizarZona(
  id: string,
  payload: unknown,
): Promise<ResultadoEntrega> {
  const parsed = schemaZonaCompleta.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, erro: "Zona inválida." };
  }

  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) {
      return { ok: false, erro: "Loja não encontrada." };
    }

    // loja_id reafirmado como o do dono — WITH CHECK rejeitaria troca; escopo por id.
    const { error: erroZona } = await supabase
      .from("zonas_entrega")
      .update({
        nome: parsed.data.nome,
        tipo: parsed.data.tipo,
        ativo: parsed.data.ativo,
        loja_id: loja.id,
      })
      .eq("id", id);
    if (erroZona) {
      console.error("[atualizarZona]", erroZona);
      return { ok: false, erro: "Não foi possível salvar a zona." };
    }

    // Upsert da taxa (1:1 por zona_id).
    const { error: erroTaxa } = await supabase
      .from("taxas_entrega")
      .upsert({ ...parsed.data.taxa, zona_id: id }, { onConflict: "zona_id" });
    if (erroTaxa) {
      console.error("[atualizarZona/taxa]", erroTaxa);
      return { ok: false, erro: "Não foi possível salvar a taxa." };
    }

    // Bairros: substitui o conjunto (RLS escopa por zona → loja do dono).
    const { error: erroDel } = await supabase
      .from("bairros_zona")
      .delete()
      .eq("zona_id", id);
    if (erroDel) {
      console.error("[atualizarZona/bairros-del]", erroDel);
      return { ok: false, erro: "Não foi possível salvar os bairros." };
    }
    if (parsed.data.bairros.length > 0) {
      const { error: erroIns } = await supabase
        .from("bairros_zona")
        .insert(parsed.data.bairros.map((nome) => ({ nome, zona_id: id })));
      if (erroIns) {
        console.error("[atualizarZona/bairros-ins]", erroIns);
        return { ok: false, erro: "Não foi possível salvar os bairros." };
      }
    }

    revalidatePath(ROTA);
    return { ok: true };
  } catch (e) {
    console.error("[atualizarZona]", e);
    return { ok: false, erro: "Não foi possível salvar a zona." };
  }
}

/** Liga/desliga a zona sem reabrir o form. Escopo por `id` (RLS). */
export async function alternarZonaAtiva(
  id: string,
  ativo: boolean,
): Promise<ResultadoEntrega> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("zonas_entrega")
      .update({ ativo })
      .eq("id", id);
    if (error) {
      console.error("[alternarZonaAtiva]", error);
      return { ok: false, erro: "Não foi possível atualizar a zona." };
    }
    revalidatePath(ROTA);
    return { ok: true };
  } catch (e) {
    console.error("[alternarZonaAtiva]", e);
    return { ok: false, erro: "Não foi possível atualizar a zona." };
  }
}

/** Remove a zona (cascata de taxa/bairros pelo FK). Escopo por `id` (RLS). */
export async function removerZona(id: string): Promise<ResultadoEntrega> {
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("zonas_entrega")
      .delete()
      .eq("id", id);
    if (error) {
      console.error("[removerZona]", error);
      return { ok: false, erro: "Não foi possível remover a zona." };
    }
    revalidatePath(ROTA);
    return { ok: true };
  } catch (e) {
    console.error("[removerZona]", e);
    return { ok: false, erro: "Não foi possível remover a zona." };
  }
}
