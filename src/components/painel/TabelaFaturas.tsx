import type { ReactElement } from "react";
import { ExternalLink, ReceiptText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { FaturaAssinatura } from "@/lib/supabase/queries/pagamentosAssinatura";

/**
 * Histórico de faturas da assinatura (issue 081). Server Component READ-ONLY.
 *
 * `valor` é AUTORITATIVO do servidor (gravado pelo webhook 077) — apenas
 * FORMATADO com `formatarMoeda`, nunca recalculado. As faturas chegam já
 * escopadas por RLS à loja do lojista (query `listarFaturasDaLoja`).
 *
 * Responsivo (mundo painel): tabela densa no desktop, lista de cards no mobile —
 * nunca scroll horizontal em 360px.
 */

const ROTULO_STATUS_FATURA: Record<string, string> = {
  pago: "Pago",
  confirmado: "Pago",
  pendente: "Pendente",
  atrasado: "Em atraso",
  estornado: "Estornado",
  cancelado: "Cancelado",
};

function rotuloStatusFatura(status: string): string {
  return ROTULO_STATUS_FATURA[status] ?? status;
}

function varianteFatura(
  status: string,
): "secondary" | "destructive" | "outline" {
  if (status === "pago" || status === "confirmado") return "secondary";
  if (status === "atrasado") return "destructive";
  return "outline";
}

function formatarCompetencia(fatura: FaturaAssinatura): string {
  const iso = fatura.competencia ?? fatura.criado_em;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function metodoLegivel(metodo: string | null): string {
  if (!metodo) return "—";
  // Métodos chegam normalizados do webhook; nunca expõem dados de cartão.
  const mapa: Record<string, string> = {
    pix: "Pix",
    boleto: "Boleto",
    cartao: "Cartão",
    credit_card: "Cartão",
  };
  return mapa[metodo] ?? metodo;
}

/** Só `https:` vira link clicável — bloqueia `javascript:`/`data:` (seguranca.md §15).
 *  `fatura_url` vem do payload do provider (webhook externo) = não confiável. */
function urlSeguraFatura(url: string | null): string | null {
  return url && url.startsWith("https://") ? url : null;
}

function LinkSegundaVia({ url }: { url: string | null }): ReactElement {
  const href = urlSeguraFatura(url);
  if (!href) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      2ª via
      <ExternalLink className="size-3.5" aria-hidden="true" />
      <span className="sr-only"> (abre em nova aba)</span>
    </a>
  );
}

export function TabelaFaturas({
  faturas,
}: {
  faturas: FaturaAssinatura[];
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico de faturas</CardTitle>
      </CardHeader>
      <CardContent>
        {faturas.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <ReceiptText
              className="size-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              Nenhuma fatura por aqui ainda. Suas cobranças aparecerão nesta
              lista.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile: lista de cards (sem scroll horizontal) */}
            <ul className="space-y-3 md:hidden">
              {faturas.map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {formatarCompetencia(f)}
                    </span>
                    <Badge variant={varianteFatura(f.status)}>
                      {rotuloStatusFatura(f.status)}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-muted-foreground">
                    <span>
                      {formatarMoeda(f.valor)} · {metodoLegivel(f.metodo)}
                    </span>
                    <LinkSegundaVia url={f.fatura_url} />
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: tabela densa */}
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Competência
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Valor
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Método
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Fatura
                  </th>
                </tr>
              </thead>
              <tbody>
                {faturas.map((f) => (
                  <tr key={f.id} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-4 text-foreground">
                      {formatarCompetencia(f)}
                    </td>
                    <td className="py-2.5 pr-4 text-foreground">
                      {formatarMoeda(f.valor)}
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">
                      {metodoLegivel(f.metodo)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge variant={varianteFatura(f.status)}>
                        {rotuloStatusFatura(f.status)}
                      </Badge>
                    </td>
                    <td className="py-2.5">
                      <LinkSegundaVia url={f.fatura_url} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
