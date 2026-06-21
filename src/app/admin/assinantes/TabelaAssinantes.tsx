"use client";

import { useMemo, useState, type ReactElement } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  apresentarStatus,
  STATUS_ASSINATURA_CONHECIDOS,
  ROTULO_STATUS,
} from "@/lib/utils/statusAssinaturaUI";
import type { AssinanteLinha } from "@/lib/supabase/queries/adminAssinatura";
import { AcoesAssinante } from "./AcoesAssinante";

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

type TabelaAssinantesProps = {
  assinantes: AssinanteLinha[];
};

const TODOS = "todos";

/**
 * Tela admin de assinantes (issue 082). Filtros (status + busca nome/e-mail) em
 * estado local — a fonte é a lista já carregada no servidor; o filtro é só
 * apresentação. Segue o padrão responsivo do `TabelaPedidos`: `<table>` densa no
 * desktop, lista de cards no mobile (sem scroll horizontal — design-system §9).
 */
export function TabelaAssinantes({
  assinantes,
}: TabelaAssinantesProps): ReactElement {
  const [status, setStatus] = useState<string>(TODOS);
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return assinantes.filter((a) => {
      const okStatus = status === TODOS || a.status === status;
      const okBusca =
        termo === "" ||
        a.nome.toLowerCase().includes(termo) ||
        (a.emailDono?.toLowerCase().includes(termo) ?? false);
      return okStatus && okBusca;
    });
  }, [assinantes, status, busca]);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5 sm:w-56">
          <Label htmlFor="filtro-status">Status</Label>
          <select
            id="filtro-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value={TODOS}>Todos os status</option>
            {STATUS_ASSINATURA_CONHECIDOS.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="filtro-busca">Buscar</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="filtro-busca"
              type="search"
              placeholder="Nome da loja ou e-mail do dono"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {filtrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma loja corresponde ao filtro.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop: tabela densa */}
          <div className="hidden overflow-hidden rounded-lg border lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Loja</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Plano</th>
                  <th className="px-4 py-2 font-medium">Vigente até</th>
                  <th className="px-4 py-2 font-medium">Cobrança</th>
                  <th className="px-4 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((a) => {
                  const { rotulo, variante } = apresentarStatus(a.status);
                  return (
                    <tr
                      key={a.id}
                      className="border-b align-top last:border-0"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{a.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.emailDono ?? "e-mail indisponível"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={variante}>{rotulo}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {a.planoNome ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatarData(a.fimPeriodo)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {a.billingProvider ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <AcoesAssinante assinante={a} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile/tablet: lista de cards */}
          <ul className="flex flex-col gap-3 lg:hidden">
            {filtrados.map((a) => {
              const { rotulo, variante } = apresentarStatus(a.status);
              return (
                <li key={a.id}>
                  <Card size="sm" className="gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {a.nome}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.emailDono ?? "e-mail indisponível"}
                        </p>
                      </div>
                      <Badge variant={variante}>{rotulo}</Badge>
                    </div>
                    <dl className="grid grid-cols-2 gap-y-1 text-xs text-muted-foreground">
                      <dt>Plano</dt>
                      <dd className="text-right text-foreground">
                        {a.planoNome ?? "—"}
                      </dd>
                      <dt>Vigente até</dt>
                      <dd className="text-right text-foreground">
                        {formatarData(a.fimPeriodo)}
                      </dd>
                      <dt>Cobrança</dt>
                      <dd className="text-right text-foreground">
                        {a.billingProvider ?? "—"}
                      </dd>
                    </dl>
                    <AcoesAssinante assinante={a} />
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
