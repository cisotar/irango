"use server";

// "Carregar mais" da base de clientes do lojista (issue 346, D10).
//  - Escopo pela SESSÃO: client autenticado; `clientes_da_loja` filtra pela loja
//    de auth.uid(). Nunca recebe loja_id do cliente, nunca usa service_role.
//  - O cursor vindo do browser é revalidado com zod (ambos ou nenhum).
//  - Erro interno: só o código vai ao log; a UI recebe mensagem genérica (§14).

import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarClientesDaLoja } from "@/lib/supabase/queries/clientes";
import { paginaDeClientes, type PaginaClientes } from "@/lib/utils/linhaCliente";
import { POR_PAGINA_CLIENTES, schemaCursorClientes } from "@/lib/validacoes/paginacao";

export type ResultadoCarregarClientes = ({ ok: true } & PaginaClientes) | { ok: false; erro: string };

const ERRO_GENERICO = "Não foi possível carregar mais clientes. Tente novamente.";

export async function carregarMaisClientes(cursorBruto: unknown): Promise<ResultadoCarregarClientes> {
  const cursor = schemaCursorClientes.safeParse(cursorBruto);
  if (!cursor.success) return { ok: false, erro: ERRO_GENERICO };
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_GENERICO };
    const brutos = await listarClientesDaLoja(supabase, { limite: POR_PAGINA_CLIENTES, cursor: cursor.data });
    return { ok: true, ...paginaDeClientes(brutos, loja.timezone, POR_PAGINA_CLIENTES) };
  } catch (e) {
    const codigo = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "erro";
    console.error("[painel/clientes] carregar mais", codigo);
    return { ok: false, erro: ERRO_GENERICO };
  }
}
