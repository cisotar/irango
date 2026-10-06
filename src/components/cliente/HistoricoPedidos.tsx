// Histórico de pedidos do cliente (issue 343): seção de /minha-conta e página
// dedicada /minha-conta/pedidos. Server Component; leitura com o client da
// SESSÃO (`listarPedidosDoCliente`, RLS `pedidos_select_cliente`). "Carregar
// mais" acumula páginas de 20 via `?pagina=N` (sem estado no browser).
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { listarPedidosDoCliente } from "@/lib/supabase/queries/pedidos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BadgeStatusPedido } from "@/components/painel/BadgeStatusPedido";
import { montarHistorico } from "@/components/cliente/historicoPedidos";
import { formatarDataHora } from "@/lib/utils/formatarDataHora";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { StatusPedido } from "@/lib/utils/transicaoStatus";

export type Historico = ReturnType<typeof montarHistorico>;

/** Lê as páginas 0..`pagina` em paralelo e achata. Erro sobe para a página decidir. */
export async function carregarHistorico(
  supabase: SupabaseClient<Database>,
  clienteId: string,
  pagina: number,
): Promise<Historico> {
  const paginas = await Promise.all(
    Array.from({ length: pagina + 1 }, (_, i) => listarPedidosDoCliente(supabase, clienteId, i)),
  );
  return montarHistorico(paginas);
}

export function HistoricoPedidos({ historico, hrefMais }: { historico: Historico; hrefMais: string }) {
  return (
    <>
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
                {/* Empilhada em container estreito; linha única a partir de 34rem. */}
                <CardContent className="flex flex-col gap-2 @min-[34rem]:flex-row @min-[34rem]:items-center @min-[34rem]:justify-between @min-[34rem]:gap-6">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-texto">{p.lojaNome}</p>
                    <p className="text-sm text-texto-muted">{formatarDataHora(p.criadoEm)}</p>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-4 @min-[34rem]:justify-end">
                    <BadgeStatusPedido status={p.status as StatusPedido} />
                    <p className="font-semibold text-texto">{formatarMoeda(p.total)}</p>
                    {p.href && (
                      <Link
                        href={p.href}
                        className="inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-texto underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
          className="min-h-11 w-full self-start @min-[34rem]:w-auto"
          nativeButton={false}
          render={
            <Link href={hrefMais} scroll={false}>
              Carregar mais
            </Link>
          }
        />
      )}
    </>
  );
}
