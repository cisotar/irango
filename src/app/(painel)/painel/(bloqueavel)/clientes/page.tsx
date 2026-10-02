import type { ReactElement } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarClientesDaLoja } from "@/lib/supabase/queries/clientes";
import { paginaDeClientes, type PaginaClientes } from "@/lib/utils/linhaCliente";
import { mesDeReferencia, nomeDoMes } from "@/lib/utils/mesDeReferencia";
import { POR_PAGINA_CLIENTES, schemaFiltroAniversariantes } from "@/lib/validacoes/paginacao";
import { ListaClientes } from "./ListaClientes";

/**
 * Base de clientes do lojista (issues 346/347, spec cliente-base-do-lojista).
 * Server Component: lê a 1ª página (50) via RPC `clientes_da_loja` com o client
 * da SESSÃO (a função escopa pela loja de `auth.uid()`; sem service_role).
 * Filtro `?aniversariantes=1` (347): o mês sai de `mesDeReferencia` no fuso da
 * loja, no servidor, e vai como `p_mes`. "Carregar mais" (keyset, D10) fica em
 * `ListaClientes` → `carregarMaisClientes`, repassando o mesmo mês.
 */
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { aniversariantes } = await searchParams;
  const filtrar = schemaFiltroAniversariantes.parse(aniversariantes);

  const supabase = await createClient();
  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) redirect("/painel");

  const mesAtual = mesDeReferencia(new Date(), loja.timezone);
  const mes = filtrar ? mesAtual : undefined;

  let inicial: PaginaClientes | null = null;
  try {
    const brutos = await listarClientesDaLoja(supabase, {
      ...(mes != null ? { mes } : {}),
      limite: POR_PAGINA_CLIENTES,
    });
    inicial = paginaDeClientes(brutos, loja.timezone, POR_PAGINA_CLIENTES);
  } catch (e) {
    // Só o código vai ao log (seguranca.md §14); a UI recebe mensagem genérica.
    const codigo = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "erro";
    console.error("[painel/clientes] listar", codigo);
  }

  const vazioAniversariantes = (
    <>
      <p className="text-sm text-muted-foreground">Nenhum aniversariante neste mês.</p>
      <Button
        variant="outline"
        className="min-h-11"
        nativeButton={false}
        render={<Link href="/painel/clientes" />}
      >
        Ver todos os clientes
      </Button>
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoPagina voltarHref="/painel" voltarRotulo="Painel" titulo="Clientes" />
      <Card>
        <CardHeader>
          <nav aria-label="Filtro de clientes" className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={filtrar ? "outline" : "default"}
              className="min-h-11"
              aria-current={filtrar ? undefined : "page"}
              nativeButton={false}
        render={<Link href="/painel/clientes" />}
            >
              Todos
            </Button>
            <Button
              size="sm"
              variant={filtrar ? "default" : "outline"}
              className="min-h-11"
              aria-current={filtrar ? "page" : undefined}
              nativeButton={false}
              render={<Link href="/painel/clientes?aniversariantes=1" />}
            >
              Aniversariantes de {nomeDoMes(mesAtual)}
            </Button>
          </nav>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {inicial == null ? (
            <p role="alert" className="py-8 text-center text-sm text-muted-foreground">
              Não foi possível carregar os clientes. Tente novamente.
            </p>
          ) : (
            <ListaClientes
              key={mes ?? "todos"}
              inicial={inicial}
              mes={mes}
              vazio={filtrar ? vazioAniversariantes : undefined}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
