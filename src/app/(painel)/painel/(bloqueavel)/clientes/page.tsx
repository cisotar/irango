import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarClientesDaLoja } from "@/lib/supabase/queries/clientes";
import { paginaDeClientes, type PaginaClientes } from "@/lib/utils/linhaCliente";
import { POR_PAGINA_CLIENTES } from "@/lib/validacoes/paginacao";
import { ListaClientes } from "./ListaClientes";

/**
 * Base de clientes do lojista (issue 346, spec cliente-base-do-lojista).
 * Server Component: lê a 1ª página (50) via RPC `clientes_da_loja` com o client
 * da SESSÃO (a função escopa pela loja de `auth.uid()`; sem service_role).
 * "Carregar mais" (keyset, D10) fica em `ListaClientes` → `carregarMaisClientes`.
 */
export default async function ClientesPage(): Promise<ReactElement> {
  const supabase = await createClient();
  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) redirect("/painel");

  let inicial: PaginaClientes | null = null;
  try {
    const brutos = await listarClientesDaLoja(supabase, { limite: POR_PAGINA_CLIENTES });
    inicial = paginaDeClientes(brutos, loja.timezone, POR_PAGINA_CLIENTES);
  } catch (e) {
    // Só o código vai ao log (seguranca.md §14); a UI recebe mensagem genérica.
    const codigo = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "erro";
    console.error("[painel/clientes] listar", codigo);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoPagina voltarHref="/painel" voltarRotulo="Painel" titulo="Clientes" />
      <Card>
        <CardContent className="flex flex-col gap-4">
          {inicial == null ? (
            <p role="alert" className="py-8 text-center text-sm text-muted-foreground">
              Não foi possível carregar os clientes. Tente novamente.
            </p>
          ) : (
            <ListaClientes inicial={inicial} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
