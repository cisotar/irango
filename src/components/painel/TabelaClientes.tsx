import type { ReactElement } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { LinhaCliente } from "@/lib/utils/linhaCliente";

/**
 * Base de clientes do lojista (issue 346) — só apresentação, espelha
 * `TabelaPedidos`. Desktop = tabela; mobile = cards (design-system §9). O nome
 * é o link do detalhe e cobre a linha (`after:absolute after:inset-0`); o link
 * do WhatsApp fica acima dele (`relative z-10`) — nenhum `<a>` dentro de `<a>`.
 */
type TabelaClientesProps = { clientes: LinhaCliente[] };

function Telefone({ telefone }: { telefone: LinhaCliente["telefone"] }): ReactElement {
  if (!telefone.href) return <span>{telefone.texto || "—"}</span>;
  return (
    <a
      href={telefone.href}
      target="_blank"
      rel="noopener noreferrer"
      className="relative z-10 underline underline-offset-4"
      aria-label={`Conversar no WhatsApp: ${telefone.texto}`}
    >
      {telefone.texto}
    </a>
  );
}

export function TabelaClientes({ clientes }: TabelaClientesProps): ReactElement {
  if (clientes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-12 text-center">
        <p className="text-sm text-muted-foreground">Nenhum cliente com conta pediu na sua loja ainda.</p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-lg md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Telefone</th>
              <th className="px-4 py-2 font-medium">Pedidos</th>
              <th className="px-4 py-2 font-medium">Último pedido</th>
              <th className="px-4 py-2 font-medium">Aniversário</th>
              <th className="px-4 py-2 font-medium">Promoções</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} className="relative border-b transition-colors last:border-0 hover:bg-muted/50">
                <td className="px-4 py-3">
                  <Link
                    href={`/painel/clientes/${c.id}`}
                    className="font-medium text-foreground after:absolute after:inset-0"
                  >
                    {c.nome}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Telefone telefone={c.telefone} />
                </td>
                <td className="px-4 py-3 tabular-nums">{c.pedidos}</td>
                <td className="px-4 py-3 text-muted-foreground">{c.ultimoPedido}</td>
                <td className="px-4 py-3 tabular-nums">{c.aniversario}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{c.aceitaPromocoes ? "Aceita" : "Não aceita"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {clientes.map((c) => (
          <li key={c.id}>
            <Card size="sm" className="relative gap-2 transition-colors hover:bg-muted/50">
              <Link
                href={`/painel/clientes/${c.id}`}
                className="font-medium text-foreground after:absolute after:inset-0"
              >
                {c.nome}
              </Link>
              <p className="text-sm">
                <Telefone telefone={c.telefone} />
              </p>
              <p className="text-sm text-muted-foreground">
                {c.pedidos} · último {c.ultimoPedido}
              </p>
              <p className="text-sm text-muted-foreground">Aniversário {c.aniversario}</p>
              <div>
                <Badge variant="outline">
                  {c.aceitaPromocoes ? "Aceita promoções" : "Não aceita promoções"}
                </Badge>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
