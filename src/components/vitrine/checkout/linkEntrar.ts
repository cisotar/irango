import { comNext } from "@/components/cliente/rotas";

/** Mesmo padrão de slug que `LinkVoltarLoja` reconhece no `next`. */
const SLUG = /^[a-z0-9-]{1,80}$/i;

/**
 * (343, RN-C17) Destino do "Entrar" do checkout: `/conta/entrar` com
 * `next=/loja/<slug>/pedido`. O `next` é sanitizado de novo no servidor
 * (`sanitizarNext`); slug fora do padrão → sem `next`.
 */
export function hrefEntrarCheckout(slug: string): string {
  return comNext("/conta/entrar", SLUG.test(slug) ? `/loja/${slug}/pedido` : undefined);
}

/**
 * (343) Logado com e-mail confirmado e sem perfil: "Complete seu perfil" →
 * `/conta/completar?next=/loja/<slug>/pedido` (sanitizado de novo no servidor).
 */
export function hrefCompletarCheckout(slug: string): string {
  return comNext("/conta/completar", SLUG.test(slug) ? `/loja/${slug}/pedido` : undefined);
}
