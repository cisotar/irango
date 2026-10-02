import type { ReactElement } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";
import { TabelaClientes } from "@/components/painel/TabelaClientes";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { listarClientesDaLoja, type ClienteDaLoja } from "@/lib/supabase/queries/clientes";
import { paraLinhaCliente } from "@/lib/utils/linhaCliente";
import { POR_PAGINA_CLIENTES, schemaPaginaClientes } from "@/lib/validacoes/paginacao";

/**
 * Base de clientes do lojista (issue 346, spec cliente-base-do-lojista).
 * Server Component: lê via RPC `clientes_da_loja` com o client da SESSÃO (a
 * função escopa pela loja de `auth.uid()`; sem service_role). "Carregar mais"
 * acumula páginas de 50 via `?pagina=N`, como `/minha-conta/pedidos`.
 */
export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const supabase = await createClient();
  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) redirect("/painel");

  const bruto = (await searchParams).pagina;
  const pagina = schemaPaginaClientes.parse(Array.isArray(bruto) ? bruto[0] : bruto);

  let paginas: ClienteDaLoja[][] = [];
  let falhou = false;
  try {
    paginas = await Promise.all(
      Array.from({ length: pagina + 1 }, (_, i) =>
        listarClientesDaLoja(supabase, { limite: POR_PAGINA_CLIENTES, offset: i * POR_PAGINA_CLIENTES }),
      ),
    );
  } catch (e) {
    // Só o código vai ao log (seguranca.md §14); a UI recebe mensagem genérica.
    const codigo = typeof e === "object" && e !== null && "code" in e ? String(e.code) : "erro";
    console.error("[painel/clientes] listar", codigo);
    falhou = true;
  }

  const linhas = paginas.flat().map((c) => paraLinhaCliente(c, loja.timezone));
  const temMais = (paginas.at(-1)?.length ?? 0) === POR_PAGINA_CLIENTES;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoPagina voltarHref="/painel" voltarRotulo="Painel" titulo="Clientes" />
      <Card>
        <CardContent className="flex flex-col gap-4">
          {falhou ? (
            <p role="alert" className="py-8 text-center text-sm text-muted-foreground">
              Não foi possível carregar os clientes. Tente novamente.
            </p>
          ) : (
            <TabelaClientes clientes={linhas} />
          )}
          {!falhou && temMais && (
            <Button
              variant="outline"
              className="min-h-11 self-center"
              nativeButton={false}
              render={
                <Link href={`/painel/clientes?pagina=${pagina + 1}`} scroll={false}>
                  Carregar mais
                </Link>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
