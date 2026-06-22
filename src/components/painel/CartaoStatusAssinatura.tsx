import type { ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";
import type { Plano } from "@/lib/supabase/queries/planos";
import {
  ROTULO_STATUS,
  VARIANTE_STATUS,
  ehStatusConhecido,
} from "./rotulosAssinatura";

/**
 * Card de status da assinatura (issue 081, modelo de billing próprio). Server
 * Component READ-ONLY — exibe valores AUTORITATIVOS do servidor:
 *   - status: `lojas.assinatura_status` (gravado só pelo webhook 077).
 *   - plano/valor: linha de `planos` (preço do banco — a UI NUNCA recalcula).
 * Nenhuma mutation aqui (intenções ficam no `GerenciarAssinaturaClient`).
 */

type DadosStatus = {
  status: string;
  inicio: string | null;
  fimPeriodo: string | null;
};

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function diasRestantes(fim: string | null, agora: Date): number {
  if (!fim) return 0;
  const d = new Date(fim);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.ceil((d.getTime() - agora.getTime()) / 86_400_000));
}

export type CartaoStatusAssinaturaProps = {
  assinatura: DadosStatus;
  /** Plano atual da loja (do banco) ou `null` se ainda não assinou. */
  plano: Plano | null;
  /** `agora` injetável (testabilidade); default = render no servidor. */
  agora?: Date;
};

export function CartaoStatusAssinatura({
  assinatura,
  plano,
  agora = new Date(),
}: CartaoStatusAssinaturaProps): ReactElement {
  const { status, inicio, fimPeriodo } = assinatura;
  const conhecido = ehStatusConhecido(status);
  const rotulo = conhecido ? ROTULO_STATUS[status] : "Desconhecida";
  const variante = conhecido ? VARIANTE_STATUS[status] : "outline";

  const ehTrial = conhecido && status === "trial";
  const dias = diasRestantes(fimPeriodo, agora);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Sua assinatura
          {/* Não depende só de cor: badge sempre traz o rótulo textual (WCAG 1.4.1). */}
          <Badge variant={variante}>{rotulo}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {ehTrial && (
          <p className="text-sm text-muted-foreground">
            {dias > 0
              ? `Seu período de teste termina em ${dias} dia(s).`
              : "Seu período de teste terminou."}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Plano</dt>
          <dd className="text-right font-medium text-foreground">
            {plano ? plano.nome : "Nenhum plano ativo"}
          </dd>

          <dt className="text-muted-foreground">Valor</dt>
          <dd className="text-right text-foreground">
            {plano
              ? `${formatarMoeda(plano.preco)} / ${plano.intervalo}`
              : "—"}
          </dd>

          <dt className="text-muted-foreground">Início</dt>
          <dd className="text-right text-foreground">{formatarData(inicio)}</dd>

          <dt className="text-muted-foreground">Período vigente até</dt>
          <dd className="text-right text-foreground">
            {formatarData(fimPeriodo)}
          </dd>
        </dl>

        <Separator />

        <p className="text-xs text-muted-foreground">
          Os valores e o status são confirmados pelo provedor de pagamento e
          atualizados automaticamente. Em caso de divergência, vale o valor da
          fatura.
        </p>
      </CardContent>
    </Card>
  );
}
