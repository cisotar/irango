"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VarianteAvisoEndereco } from "@/lib/utils/publicacao";
import type { ResultadoLocalizar } from "@/lib/actions/loja";
import { BotaoLocalizarEndereco } from "./BotaoLocalizarEndereco";

/**
 * Aviso persistente D15 (issue 368/193) no topo do painel, para loja já
 * publicada alguma vez sem endereço completo ou sem o par de coordenadas. A
 * loja segue no ar: o aviso não despublica nada. Nunca recebe latitude nem
 * longitude (segurança.md §19) — só a variante, decidida no servidor.
 */
export function AvisoEnderecoLoja({
  variante,
  hrefPerfil,
  onLocalizar,
}: {
  variante: VarianteAvisoEndereco;
  hrefPerfil: string;
  onLocalizar: () => Promise<ResultadoLocalizar>;
}): ReactElement {
  const completar = variante === "completar-endereco";

  return (
    <Card role="status" className="mb-4">
      <CardContent className="flex gap-3">
        <MapPin aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="font-medium">
              {completar ? "Complete o endereço da loja" : "Localize sua loja no mapa"}
            </p>
            <p className="text-sm text-muted-foreground">
              {completar
                ? "Sua loja segue no ar. Preencha o endereço completo no perfil para ativar as zonas de entrega por raio."
                : "Sua loja segue no ar. Toque no botão abaixo para ativar as zonas de entrega por raio."}
            </p>
          </div>
          {completar ? (
            <Link
              href={hrefPerfil}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-[44px] w-full sm:w-auto",
              )}
            >
              Completar endereço
            </Link>
          ) : (
            <BotaoLocalizarEndereco onLocalizar={onLocalizar} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
