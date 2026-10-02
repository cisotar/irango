"use client";

import { useState, useTransition, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { TabelaClientes } from "@/components/painel/TabelaClientes";
import { carregarMaisClientes } from "@/lib/actions/clientesDaLoja";
import type { PaginaClientes } from "@/lib/utils/linhaCliente";

/**
 * Acumula as páginas da base de clientes (issue 346, D10): a 1ª vem do Server
 * Component; "Carregar mais" pede SÓ a próxima pelo cursor do último item.
 * `mes` (issue 347): com o filtro de aniversariantes, a próxima página repassa
 * o mesmo mês (revalidado no servidor).
 */
export function ListaClientes({
  inicial,
  mes,
  vazio,
}: {
  inicial: PaginaClientes;
  mes?: number;
  vazio?: ReactNode;
}): ReactElement {
  const [linhas, setLinhas] = useState(inicial.linhas);
  const [cursor, setCursor] = useState(inicial.cursor);
  const [pendente, iniciar] = useTransition();

  function carregar(): void {
    if (cursor == null) return;
    iniciar(async () => {
      const r = await carregarMaisClientes(cursor, mes);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      setLinhas((atuais) => [...atuais, ...r.linhas]);
      setCursor(r.cursor);
    });
  }

  return (
    <>
      <TabelaClientes clientes={linhas} vazio={vazio} />
      {cursor != null && (
        <Button variant="outline" className="min-h-11 self-center" onClick={carregar} disabled={pendente}>
          {pendente ? "Carregando..." : "Carregar mais"}
        </Button>
      )}
    </>
  );
}
