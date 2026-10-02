// /minha-conta/pedidos — histórico do cliente (issue 343, spec cliente-vinculo-pedido).
// Guard repetido com a rota da página; leitura com o client da SESSÃO
// (`listarPedidosDoCliente`, RLS `pedidos_select_cliente`). "Carregar mais"
// acumula páginas de 20 via `?pagina=N` (Server Component, sem estado no browser).
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { listarPedidosDoCliente } from "@/lib/supabase/queries/pedidos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BadgeStatusPedido } from "@/components/painel/BadgeStatusPedido";
import { montarHistorico, paginaDoParam } from "@/components/cliente/historicoPedidos";
import { formatarDataHora } from "@/lib/utils/formatarDataHora";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";
import { primeiro } from "../../conta/sessao";
import { exigirCliente } from "../guard";

export default async function PedidosClientePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await exigirCliente("/minha-conta/pedidos");
  const pagina = paginaDoParam(primeiro((await searchParams).pagina));

  let historico: ReturnType<typeof montarHistorico>;
  try {
    const paginas = await Promise.all(
      Array.from({ length: pagina + 1 }, (_, i) => listarPedidosDoCliente(supabase, user.id, i)),
    );
    historico = montarHistorico(paginas);
  } catch (e) {
    console.error("[minhaConta] pedidos", e instanceof Error ? e.name : "erro");
    redirect("/conta/entrar?erro=sessao");
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/minha-conta"
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md text-sm font-medium text-texto underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Minha conta
      </Link>
      <h1 className="text-xl font-semibold text-texto">Pedidos</h1>

      {historico.linhas.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-texto-muted">
            Você ainda não fez pedidos com sua conta.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {historico.linhas.map((p) => (
            <li key={p.id}>
              <Card>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-texto">{p.lojaNome}</p>
                      <p className="text-sm text-texto-muted">{formatarDataHora(p.criadoEm)}</p>
                    </div>
                    <p className="shrink-0 font-semibold text-texto">{formatarMoeda(p.total)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <BadgeStatusPedido status={p.status as StatusPedido} />
                    {p.href && (
                      <Link
                        href={p.href}
                        className="inline-flex min-h-11 items-center text-sm font-semibold text-texto underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Ver pedido
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {historico.temMais && (
        <Button
          variant="outline"
          className="min-h-11"
          nativeButton={false}
          render={
            <Link href={`/minha-conta/pedidos?pagina=${pagina + 1}`} scroll={false}>
              Carregar mais
            </Link>
          }
        />
      )}
    </div>
  );
}
