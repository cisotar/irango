import { comNext } from "@/components/cliente/rotas";
import { nextDaLoja } from "@/components/vitrine/checkout/linkEntrar";

export type ItemMenuCliente = { href: string; rotulo: string };

/**
 * Links da conta no menu da vitrine. Levam `next=/loja/<slug>` para que
 * `/minha-conta/*` mostre "Voltar para <loja>" (`LinkVoltarLoja`).
 */
export function itensMenuCliente(slug: string): ItemMenuCliente[] {
  const next = nextDaLoja(slug);
  return [
    { href: comNext("/minha-conta", next), rotulo: "Minha conta" },
    { href: comNext("/minha-conta/enderecos", next), rotulo: "Endereços" },
    { href: comNext("/minha-conta/pedidos", next), rotulo: "Pedidos" },
  ];
}

/** Destinos de "Entrar com e-mail" e "Criar conta com e-mail" para um `next`. */
export function hrefsConta(next: string | undefined): { entrar: string; cadastro: string } {
  return {
    entrar: comNext("/conta/entrar", next),
    cadastro: comNext("/conta/cadastro", next),
  };
}
