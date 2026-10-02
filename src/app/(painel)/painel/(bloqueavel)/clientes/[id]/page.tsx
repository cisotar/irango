import type { ReactElement } from "react";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CabecalhoPagina } from "@/components/painel/CabecalhoPagina";
import { createClient } from "@/lib/supabase/server";
import { buscarLojaDoDono } from "@/lib/supabase/queries/lojas";
import { buscarClienteDaLoja } from "@/lib/supabase/queries/clientes";
import { listarPedidosDoClienteNaLoja } from "@/lib/supabase/queries/pedidos";
import { paraLinhaCliente } from "@/lib/utils/linhaCliente";
import { paraLinhaPedido } from "@/lib/utils/paraLinhaPedido";
import { POR_PAGINA_PEDIDOS_CLIENTE, schemaUuid } from "@/lib/validacoes/paginacao";
import { PedidosDoCliente } from "./PedidosDoCliente";

/**
 * Detalhe do cliente na base da loja (issue 347, spec cliente-base-do-lojista).
 *  - `[id]` não-UUID → 404 sem ir ao banco.
 *  - `cliente_da_loja` (escopo pela loja de auth.uid(), client da SESSÃO) com
 *    0 linhas → 404: id inexistente e cliente de outra loja dão a MESMA resposta
 *    (anti-IDOR).
 *  - Pedidos: RLS `pedidos_acesso_lojista` + `.eq(loja_id da sessão, cliente_id)`.
 *  - Erro de consulta propaga ao error boundary do Next (D6).
 */
export default async function DetalheClientePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const { id } = await params;
  const valido = schemaUuid.safeParse(id);
  if (!valido.success) notFound();
  const clienteId = valido.data;

  const supabase = await createClient();
  const loja = await buscarLojaDoDono(supabase);
  if (loja == null) redirect("/painel");

  const cliente = await buscarClienteDaLoja(supabase, clienteId);
  if (cliente == null) notFound();

  const brutos = await listarPedidosDoClienteNaLoja(supabase, {
    lojaId: loja.id,
    clienteId,
    porPagina: POR_PAGINA_PEDIDOS_CLIENTE,
  });

  const linha = paraLinhaCliente(cliente, loja.timezone);
  const dados: { rotulo: string; valor: ReactElement | string }[] = [
    {
      rotulo: "Telefone",
      valor: linha.telefone.href ? (
        <a
          href={linha.telefone.href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
          aria-label={`Conversar no WhatsApp: ${linha.telefone.texto}`}
        >
          {linha.telefone.texto}
        </a>
      ) : (
        linha.telefone.texto || "—"
      ),
    },
    { rotulo: "Aniversário", valor: linha.aniversario },
    {
      rotulo: "Promoções",
      valor: <Badge variant="outline">{linha.aceitaPromocoes ? "Aceita" : "Não aceita"}</Badge>,
    },
    { rotulo: "Pedidos", valor: linha.pedidos },
    { rotulo: "Último pedido", valor: linha.ultimoPedido },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <CabecalhoPagina voltarHref="/painel/clientes" voltarRotulo="Clientes" titulo={linha.nome} />
      <Card>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {dados.map((d) => (
              <div key={d.rotulo} className="contents">
                <dt className="text-muted-foreground">{d.rotulo}</dt>
                <dd>{d.valor}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pedidos nesta loja</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <PedidosDoCliente
            clienteId={clienteId}
            inicial={brutos.map(paraLinhaPedido)}
            temMaisInicial={brutos.length === POR_PAGINA_PEDIDOS_CLIENTE}
          />
        </CardContent>
      </Card>
    </div>
  );
}
