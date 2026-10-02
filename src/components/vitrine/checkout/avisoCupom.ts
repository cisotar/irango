import {
  MSG_CUPOM_ENTRAR_NA_CONTA,
  MSG_CUPOM_LIMITE_ATINGIDO,
} from "@/lib/utils/cupomPorCliente";

/**
 * (343) Aviso de cupom na confirmação. Trafega na URL como código curto e fixo
 * (`?aviso=entrar|limite`) e volta a texto por tabela fixa — nunca reflete
 * texto livre vindo da URL.
 */
export type CodigoAvisoCupom = "entrar" | "limite";

const TEXTOS: Readonly<Record<CodigoAvisoCupom, string>> = {
  entrar: MSG_CUPOM_ENTRAR_NA_CONTA,
  limite: MSG_CUPOM_LIMITE_ATINGIDO,
};

export function codigoAvisoCupom(mensagem: string | undefined): CodigoAvisoCupom | null {
  if (mensagem === MSG_CUPOM_ENTRAR_NA_CONTA) return "entrar";
  if (mensagem === MSG_CUPOM_LIMITE_ATINGIDO) return "limite";
  return null;
}

export function textoAvisoCupom(codigo: unknown): string | null {
  if (codigo === "entrar" || codigo === "limite") return TEXTOS[codigo];
  return null;
}
