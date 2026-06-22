import type { ReactElement } from "react";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  apresentarStatus,
  ehStatusAssinaturaConhecido,
} from "@/lib/utils/statusAssinaturaUI";

// Portal do assinante Hotmart (gestão de pagamento/cancelamento). Identificador
// `hotmart_subscriber_code` não é credencial — pode ser exibido ao próprio dono.
const URL_PORTAL_HOTMART = "https://consumer.hotmart.com/";

type DadosAssinatura = {
  status: string;
  inicio: string | null;
  fimPeriodo: string | null;
  subscriberCode: string | null;
};

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

/** Dias restantes até `fim` a partir de `agora`, nunca negativo. */
function diasRestantes(fim: string | null, agora: Date): number {
  if (!fim) return 0;
  const d = new Date(fim);
  if (Number.isNaN(d.getTime())) return 0;
  const ms = d.getTime() - agora.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export type StatusAssinaturaProps = {
  assinatura: DadosAssinatura;
  /** `agora` injetado (testabilidade); default = momento do render no servidor. */
  agora?: Date;
};

/**
 * Card READ-ONLY de status da assinatura (issue 060). Server Component puro —
 * NENHUMA mutation. O billing é gravado só pelo webhook Hotmart (057) via
 * service_role. Reusa o union de status de `assinatura.ts` (não recria a regra).
 */
export function CardStatusAssinatura({
  assinatura,
  agora = new Date(),
}: StatusAssinaturaProps): ReactElement {
  const { status, inicio, fimPeriodo, subscriberCode } = assinatura;
  const conhecido = ehStatusAssinaturaConhecido(status);
  const { rotulo, variante } = apresentarStatus(status);

  const exigeAcao =
    conhecido && (status === "inadimplente" || status === "suspensa");
  const ehTrial = conhecido && status === "trial";
  const dias = diasRestantes(fimPeriodo, agora);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Assinatura
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

        {exigeAcao && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
            {status === "inadimplente"
              ? "Identificamos um pagamento pendente. Regularize na Hotmart para manter sua loja no ar."
              : "Sua assinatura está suspensa. Regularize o pagamento na Hotmart para reativar sua loja."}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Início</dt>
          <dd className="text-right text-foreground">{formatarData(inicio)}</dd>
          <dt className="text-muted-foreground">Período vigente até</dt>
          <dd className="text-right text-foreground">
            {formatarData(fimPeriodo)}
          </dd>
          {subscriberCode && (
            <>
              <dt className="text-muted-foreground">Código do assinante</dt>
              <dd className="text-right font-mono text-xs text-foreground">
                {subscriberCode}
              </dd>
            </>
          )}
        </dl>

        <Separator />

        <BotaoGerenciarHotmart />
      </CardContent>
    </Card>
  );
}

/**
 * Link externo para o portal do assinante Hotmart (issue 060). Abre em nova aba.
 * Não dispara nenhuma mutation no iRango — o billing vive na Hotmart.
 */
export function BotaoGerenciarHotmart(): ReactElement {
  return (
    <Button
      className="w-full"
      nativeButton={false}
      render={
        <a href={URL_PORTAL_HOTMART} target="_blank" rel="noopener noreferrer">
          Gerenciar pagamento na Hotmart
          <ExternalLink className="size-4" aria-hidden="true" />
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
      }
    />
  );
}
