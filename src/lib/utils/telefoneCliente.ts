// Exibição do telefone do cliente no painel (issue 346, D4): `(DD) NNNNN-NNNN`
// (ou `(DD) NNNN-NNNN` no fixo) + link `wa.me` com 55 prefixado. Função PURA.
//
// Mesmo padrão de `linkWhatsappLoja`: só dígitos, href por `urlHttpsSegura`
// (seguranca.md §15), fail-closed. Telefone legado sem DDD válido → exibido
// como gravado e SEM link (`href: null`). Nenhuma mensagem/PII na query string.

import { digitosNacionais } from "@/lib/validacoes/telefone";
import { urlHttpsSegura } from "./urlHttpsSegura";

export type TelefoneExibicao = { texto: string; href: string | null };

export function telefoneCliente(telefone: string | null | undefined): TelefoneExibicao {
  const gravado = (telefone ?? "").trim();
  const d = digitosNacionais(gravado);
  if (!d) return { texto: gravado, href: null };
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  const corte = resto.length - 4;
  return {
    texto: `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`,
    href: urlHttpsSegura(`https://wa.me/55${d}`),
  };
}
