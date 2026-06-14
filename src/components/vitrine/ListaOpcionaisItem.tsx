// Sublista de opcionais escolhidos de UM item — usada no carrinho/checkout
// (PREVIEW, valores estimados) e na confirmação (SNAPSHOT do servidor, final).
//
// É puramente apresentacional: recebe a lista JÁ normalizada ({ nome, preco,
// quantidade }). Quem chama decide a fonte: no carrinho são os opcionais do
// useCarrinho (preview, seguranca.md §10); na confirmação são nome_snapshot /
// preco_snapshot lidos por token (autoritativo, RN-O6). Lista vazia → não
// renderiza nada, então item sem opcionais mantém o layout atual.

import { formatarMoeda } from "@/lib/utils/formatarMoeda";

export type OpcionalExibicao = {
  /** Chave estável para o React (opcionalId/snapshot id). */
  id: string;
  nome: string;
  /** Acréscimo unitário do opcional (R$). Preview ou snapshot, conforme o caller. */
  preco: number;
  quantidade: number;
};

export type ListaOpcionaisItemProps = {
  opcionais: OpcionalExibicao[];
  className?: string;
};

export function ListaOpcionaisItem({
  opcionais,
  className,
}: ListaOpcionaisItemProps) {
  if (opcionais.length === 0) return null;

  return (
    <ul
      className={[
        "mt-0.5 flex flex-col gap-0.5 text-xs text-muted-foreground",
        className ?? "",
      ].join(" ")}
    >
      {opcionais.map((op) => (
        <li key={op.id} className="flex justify-between gap-2">
          <span className="truncate">
            + {op.quantidade}× {op.nome}
          </span>
          <span className="shrink-0 tabular-nums">
            {formatarMoeda(op.preco * op.quantidade)}
          </span>
        </li>
      ))}
    </ul>
  );
}
