"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ETAPAS_ASSISTENTE,
  rotaDaEtapa,
  type EtapaAssistente,
} from "@/lib/utils/primeirosPassos";

const TOTAL = ETAPAS_ASSISTENTE.length;

/**
 * Indicador de progresso do assistente (issue 368, D6). Navegação livre: todas
 * as etapas são links. `usePathname` só destaca a etapa atual (UX, não authz).
 * Etapa sem pendência não ganha "concluída": horários, entregas e opcionais
 * nunca têm pendência, e marcar como feito o que não foi aberto seria falso.
 */
export function ProgressoAssistente({
  pendentes,
}: {
  pendentes: EtapaAssistente[];
}): ReactElement {
  const pathname = usePathname();
  const indiceAtual = Math.max(
    0,
    ETAPAS_ASSISTENTE.findIndex((e) => pathname.startsWith(rotaDaEtapa(e.etapa))),
  );
  const atual = ETAPAS_ASSISTENTE[indiceAtual];
  const comPendencia = new Set(pendentes);

  return (
    <Card>
      <CardContent className="space-y-3">
        <nav aria-label="Etapas da configuração" className="space-y-3">
          <p className="text-sm font-medium text-foreground">
            Etapa {indiceAtual + 1} de {TOTAL}
            <span className="lg:hidden"> · {atual.rotulo}</span>
          </p>
          <div aria-hidden className="grid grid-cols-7 gap-1">
            {ETAPAS_ASSISTENTE.map((e, i) => (
              <span
                key={e.etapa}
                className={cn(
                  "h-1.5 rounded-full",
                  i <= indiceAtual ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>

          <details className="lg:hidden">
            <summary className="flex min-h-[44px] cursor-pointer items-center rounded-md px-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              Ver todas as etapas
            </summary>
            <ListaEtapas
              indiceAtual={indiceAtual}
              comPendencia={comPendencia}
              mostrarAqui
            />
          </details>
          <div className="hidden lg:block">
            <ListaEtapas
              indiceAtual={indiceAtual}
              comPendencia={comPendencia}
              mostrarAqui={false}
            />
          </div>
        </nav>
      </CardContent>
    </Card>
  );
}

function ListaEtapas({
  indiceAtual,
  comPendencia,
  mostrarAqui,
}: {
  indiceAtual: number;
  comPendencia: ReadonlySet<EtapaAssistente>;
  mostrarAqui: boolean;
}): ReactElement {
  return (
    <ol className="mt-2 space-y-1">
      {ETAPAS_ASSISTENTE.map((e, i) => {
        const ehAtual = i === indiceAtual;
        return (
          <li key={e.etapa}>
            <Link
              href={rotaDaEtapa(e.etapa)}
              aria-current={ehAtual ? "step" : undefined}
              className={cn(
                "flex min-h-[44px] items-center gap-3 rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                ehAtual && "border-l-4 border-primary bg-muted font-medium",
              )}
            >
              <span className="w-4 shrink-0 text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{e.rotulo}</span>
                {ehAtual && mostrarAqui && (
                  <span className="block text-xs text-muted-foreground">
                    você está aqui
                  </span>
                )}
                {"podePular" in e && e.podePular && (
                  <span className="block text-xs text-muted-foreground">
                    pode pular
                  </span>
                )}
              </span>
              {comPendencia.has(e.etapa) && (
                <Badge
                  variant="outline"
                  className="shrink-0 border-amber-300 bg-amber-50 text-amber-800"
                >
                  <CircleAlert aria-hidden className="size-3" />
                  Falta
                </Badge>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
