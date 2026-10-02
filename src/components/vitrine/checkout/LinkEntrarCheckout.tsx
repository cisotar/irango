import Link from "next/link";
import { hrefCompletarCheckout, hrefEntrarCheckout } from "./linkEntrar";

/**
 * (343, alteração 25) "Entrar" junto do cupom — só renderizado sem sessão de
 * cliente. O carrinho segue no `sessionStorage` (mesma aba, decisão 21).
 */
export function LinkEntrarCheckout({
  lojaSlug,
  acao = "entrar",
}: {
  lojaSlug: string;
  /** (343) "completar": logado com e-mail confirmado e sem perfil. */
  acao?: "entrar" | "completar";
}) {
  return (
    <Link
      href={
        acao === "completar"
          ? hrefCompletarCheckout(lojaSlug)
          : hrefEntrarCheckout(lojaSlug)
      }
      className="inline-flex min-h-11 items-center text-sm font-semibold text-texto underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {acao === "completar" ? "Complete seu perfil" : "Entrar"}
    </Link>
  );
}
