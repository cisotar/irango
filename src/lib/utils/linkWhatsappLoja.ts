// Link `wa.me` para o cliente falar com a loja ANTES de existir pedido (modal de
// frete indisponível, aviso de endereço fora da área). Função PURA.
//
// - só dígitos do número cadastrado; sem número → `null` e o chamador não
//   renderiza link nenhum (fail-closed);
// - o href passa por `urlHttpsSegura` (seguranca.md §15);
// - a mensagem é genérica: nenhuma PII do cliente vai na query string.
//
// O link do PEDIDO já criado é outro (`montarLinkWhatsappPedido`), com o
// conteúdo do pedido gravado.

import { urlHttpsSegura } from "./urlHttpsSegura";

export function linkWhatsappLoja(
  whatsapp: string | null | undefined,
  mensagem: string,
): string | null {
  const numero = (whatsapp ?? "").replace(/\D/g, "");
  if (!numero) return null;
  return urlHttpsSegura(`https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`);
}
