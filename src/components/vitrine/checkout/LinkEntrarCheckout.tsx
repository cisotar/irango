import Link from "next/link";
import { hrefEntrarCheckout } from "./linkEntrar";

/**
 * (343, alteração 25) "Entrar" junto do cupom — só renderizado sem sessão de
 * cliente. O carrinho segue no `sessionStorage` (mesma aba, decisão 21).
 */
export function LinkEntrarCheckout({ lojaSlug }: { lojaSlug: string }) {
  return (
    <Link
      href={hrefEntrarCheckout(lojaSlug)}
      className="inline-flex min-h-11 items-center text-sm font-semibold text-texto underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Entrar
    </Link>
  );
}
