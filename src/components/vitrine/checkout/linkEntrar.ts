import { comNext } from "@/components/cliente/rotas";

/** Mesmo padrão de slug que `LinkVoltarLoja` reconhece no `next`. */
const SLUG = /^[a-z0-9-]{1,80}$/i;

/**
 * `/loja/<slug><subcaminho>` para usar como `next`; slug fora do padrão →
 * `undefined` (o link sai sem `next`). O servidor sanitiza de novo.
 */
export function nextDaLoja(slug: string, subcaminho: "" | "/pedido" = ""): string | undefined {
  return SLUG.test(slug) ? `/loja/${slug}${subcaminho}` : undefined;
}

/**
 * (343, RN-C17) Destino do "Entrar" do checkout: `/conta/entrar` com
 * `next=/loja/<slug>/pedido`. O `next` é sanitizado de novo no servidor
 * (`sanitizarNext`); slug fora do padrão → sem `next`.
 */
export function hrefEntrarCheckout(slug: string): string {
  return comNext("/conta/entrar", nextDaLoja(slug, "/pedido"));
}

/** "Criar conta" do aviso do "Finalizar pedido": mesmo molde do "Entrar". */
export function hrefCadastroCheckout(slug: string): string {
  return comNext("/conta/cadastro", nextDaLoja(slug, "/pedido"));
}

/**
 * (343) Logado com e-mail confirmado e sem perfil: "Complete seu perfil" →
 * `/conta/completar?next=/loja/<slug>/pedido` (sanitizado de novo no servidor).
 */
export function hrefCompletarCheckout(slug: string): string {
  return comNext("/conta/completar", nextDaLoja(slug, "/pedido"));
}
