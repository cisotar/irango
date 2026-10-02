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
import { listarPedidosDoClienteNaLoja } from "@/lib/supabase/queries/pedidos";
import { paraLinhaPedido } from "@/lib/utils/paraLinhaPedido";
import type { PedidoLinha } from "@/components/painel/TabelaPedidos";
import {
  POR_PAGINA_CLIENTES,
  POR_PAGINA_PEDIDOS_CLIENTE,
  schemaCursorClientes,
  schemaMes,
  schemaPaginaPedidosCliente,
  schemaUuid,
} from "@/lib/validacoes/paginacao";

export type ResultadoCarregarClientes = ({ ok: true } & PaginaClientes) | { ok: false; erro: string };

const ERRO_GENERICO = "Não foi possível carregar mais clientes. Tente novamente.";

function codigoDoErro(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e ? String(e.code) : "erro";
}

/**
 * `mesBruto` (issue 347): o mês do filtro de aniversariantes da 1ª página, para
 * a próxima página continuar no mesmo conjunto. Ausente (`undefined`/`null`) =
 * sem filtro; presente, tem de ser inteiro 1..12 (zod; o banco repete a regra).
 */
export async function carregarMaisClientes(
  cursorBruto: unknown,
  mesBruto?: unknown,
): Promise<ResultadoCarregarClientes> {
  const cursor = schemaCursorClientes.safeParse(cursorBruto);
  if (!cursor.success) return { ok: false, erro: ERRO_GENERICO };
  let mes: number | undefined;
  if (mesBruto != null) {
    const m = schemaMes.safeParse(mesBruto);
    if (!m.success) return { ok: false, erro: ERRO_GENERICO };
    mes = m.data;
  }
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_GENERICO };
    const brutos = await listarClientesDaLoja(supabase, {
      ...(mes != null ? { mes } : {}),
      limite: POR_PAGINA_CLIENTES,
      cursor: cursor.data,
    });
    return { ok: true, ...paginaDeClientes(brutos, loja.timezone, POR_PAGINA_CLIENTES) };
  } catch (e) {
    console.error("[painel/clientes] carregar mais", codigoDoErro(e));
    return { ok: false, erro: ERRO_GENERICO };
  }
}

export type ResultadoCarregarPedidosCliente =
  | { ok: true; pedidos: PedidoLinha[]; temMais: boolean }
  | { ok: false; erro: string };

const ERRO_PEDIDOS = "Não foi possível carregar mais pedidos. Tente novamente.";

/**
 * "Carregar mais" dos pedidos do detalhe do cliente (issue 347, D3). A loja sai
 * da SESSÃO (`buscarLojaDoDono`); o `clienteId` e a `pagina` vindos do browser
 * são revalidados. A RLS de pedidos é a barreira; o `.eq` só restringe.
 */
export async function carregarMaisPedidosDoCliente(
  clienteIdBruto: unknown,
  paginaBruta: unknown,
): Promise<ResultadoCarregarPedidosCliente> {
  const clienteId = schemaUuid.safeParse(clienteIdBruto);
  const pagina = schemaPaginaPedidosCliente.safeParse(paginaBruta);
  if (!clienteId.success || !pagina.success) return { ok: false, erro: ERRO_PEDIDOS };
  try {
    const supabase = await createClient();
    const loja = await buscarLojaDoDono(supabase);
    if (loja == null) return { ok: false, erro: ERRO_PEDIDOS };
    const brutos = await listarPedidosDoClienteNaLoja(supabase, {
      lojaId: loja.id,
      clienteId: clienteId.data,
      pagina: pagina.data,
      porPagina: POR_PAGINA_PEDIDOS_CLIENTE,
    });
    return {
      ok: true,
      pedidos: brutos.map(paraLinhaPedido),
      temMais: brutos.length === POR_PAGINA_PEDIDOS_CLIENTE,
    };
  } catch (e) {
    console.error("[painel/clientes] carregar mais pedidos", codigoDoErro(e));
    return { ok: false, erro: ERRO_PEDIDOS };
  }
}
