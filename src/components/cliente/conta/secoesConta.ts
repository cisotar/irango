import { MapPin, ShoppingBag, UserRound, type LucideIcon } from "lucide-react";
import { comNext } from "@/components/cliente/rotas";

export const ROTA_MINHA_CONTA = "/minha-conta";

export type IdSecaoConta = "dados-pessoais" | "enderecos" | "pedidos";

export type SecaoConta = {
  id: IdSecaoConta;
  rotulo: string;
  Icone: LucideIcon;
  /** Página dedicada que mostra o mesmo conteúdo (null: só existe na página única). */
  paginaDedicada: string | null;
};

/**
 * Fonte única das seções de /minha-conta: ids das âncoras da página única,
 * rótulos e ícones da navegação lateral (PC e gaveta mobile).
 */
export const SECOES_CONTA: readonly SecaoConta[] = [
  { id: "dados-pessoais", rotulo: "Dados pessoais", Icone: UserRound, paginaDedicada: null },
  { id: "enderecos", rotulo: "Endereços", Icone: MapPin, paginaDedicada: "/minha-conta/enderecos" },
  { id: "pedidos", rotulo: "Pedidos", Icone: ShoppingBag, paginaDedicada: "/minha-conta/pedidos" },
];

/** Link da lateral: sempre a seção na página única, preservando o `next` sanitizado. */
export function hrefSecao(id: IdSecaoConta, next: string | undefined): string {
  return `${comNext(ROTA_MINHA_CONTA, next)}#${id}`;
}

/** Na página dedicada, a seção equivalente fica destacada; na página única, o scroll decide. */
export function secaoDaRota(pathname: string | null): IdSecaoConta | null {
  return SECOES_CONTA.find((s) => s.paginaDedicada !== null && s.paginaDedicada === pathname)?.id ?? null;
}

/**
 * Seção destacada pelo scroll: a última cujo topo já passou da linha de
 * leitura; antes disso, a primeira. No fim da página vale a última presente,
 * porque uma seção curta no rodapé nunca chega à linha.
 */
export function secaoAtiva(
  topos: readonly { id: IdSecaoConta; topo: number }[],
  linha: number,
  noFim: boolean,
): IdSecaoConta | null {
  const presentes = topos.filter((t) => Number.isFinite(t.topo));
  if (presentes.length === 0) return null;
  if (noFim) return presentes[presentes.length - 1].id;
  let ativa = presentes[0].id;
  for (const t of presentes) if (t.topo <= linha) ativa = t.id;
  return ativa;
}
