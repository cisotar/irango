// /minha-conta/pedidos — histórico do cliente (issue 343, spec cliente-vinculo-pedido).
// Guard repetido com a rota da página; o conteúdo é o mesmo da seção "Pedidos"
// de /minha-conta (`HistoricoPedidos`), lido com o client da SESSÃO.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { carregarHistorico, HistoricoPedidos, type Historico } from "@/components/cliente/HistoricoPedidos";
import { hrefCarregarMais, paginaDoParam } from "@/components/cliente/historicoPedidos";
import { LinkVoltarLoja } from "@/components/cliente/LinkVoltarLoja";
import { comNext } from "@/components/cliente/rotas";
import { sanitizarNext } from "@/lib/utils/sanitizarNext";
import { primeiro } from "../../conta/sessao";
import { exigirCliente } from "../guard";

const ROTA = "/minha-conta/pedidos";

export default async function PedidosClientePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await exigirCliente(ROTA);
  const params = await searchParams;
  const pagina = paginaDoParam(primeiro(params.pagina));
  const next = sanitizarNext(primeiro(params.next));

  let historico: Historico;
  try {
    historico = await carregarHistorico(supabase, user.id, pagina);
  } catch (e) {
    console.error("[minhaConta] pedidos", e instanceof Error ? e.name : "erro");
    redirect("/conta/entrar?erro=sessao");
  }

  return (
    <div className="flex flex-col gap-4">
      <LinkVoltarLoja next={next} className="self-start" />
      <Link
        href={comNext("/minha-conta", next)}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md text-sm font-medium text-texto underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Minha conta
      </Link>
      <h1 className="text-xl font-semibold text-texto">Pedidos</h1>
      <HistoricoPedidos historico={historico} hrefMais={hrefCarregarMais(ROTA, pagina, next)} />
    </div>
  );
}
