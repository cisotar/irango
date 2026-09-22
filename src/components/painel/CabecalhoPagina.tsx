import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

export type CabecalhoPaginaProps = {
  /** Destino do "voltar". Vem de quem conhece a rota, nunca do componente. */
  voltarHref: string;
  /** Rótulo do link de volta. */
  voltarRotulo: string;
  titulo: string;
  /** Selo de estado e ações da página — ficam na MESMA linha do título. */
  children?: ReactNode;
};

/**
 * Cabeçalho de página do painel — `design-system.md` §10.2, regras 4 e 5.
 *
 * Migalha, título e o que mais a rota precisar num bloco só, dentro da mesma
 * superfície dos demais cards. Antes eram um `<Link>` e um `<h1>` soltos
 * direto no creme do fundo, que é exatamente o "parece flutuando" que a §10
 * existe para impedir.
 *
 * `voltarHref` é prop obrigatória e sem default: rota não se adivinha dentro de
 * componente de apresentação, e o hub admin reusa este mesmo cabeçalho com um
 * destino diferente do painel do lojista.
 */
export function CabecalhoPagina({
  voltarHref,
  voltarRotulo,
  titulo,
  children,
}: CabecalhoPaginaProps): ReactElement {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        <Link href={voltarHref} className="w-fit text-sm underline">
          {voltarRotulo}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-heading text-xl font-semibold">{titulo}</h1>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
