import type { ReactElement, ReactNode } from "react";
import { exigirAssistente } from "./guard";

/**
 * Layout do assistente de primeiros passos (issue 368). FORA de `(bloqueavel)/`
 * (isenção posicional, D4): o gate de assinatura não roda aqui (D5). O guard
 * `exigirAssistente` manda loja já publicada para `/painel` e falha fechado
 * para `/login?erro=sessao`. O chrome mínimo vem do layout pai.
 */
export default async function PrimeirosPassosLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  await exigirAssistente();
  return <div className="mx-auto w-full max-w-3xl space-y-6">{children}</div>;
}
