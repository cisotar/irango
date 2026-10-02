// Linha de apresentação da base de clientes do lojista (issue 346, D4/D9).
// Função PURA: recebe a linha da allowlist (`clientes_da_loja`) e o fuso da
// loja, devolve só strings prontas. Sem e-mail, sem ano de nascimento.

import type { ClienteDaLoja } from "@/lib/supabase/queries/clientes";
import { diaNoFuso } from "./fusoLoja";
import { telefoneCliente, type TelefoneExibicao } from "./telefoneCliente";

export type LinhaCliente = {
  id: string;
  nome: string;
  telefone: TelefoneExibicao;
  /** "N pedidos · M cancelados" (o "· M cancelados" só quando M > 0). */
  pedidos: string;
  /** "dd/mm/aaaa" no fuso da loja, com " (cancelado)" se o último foi cancelado; "—" sem data. */
  ultimoPedido: string;
  /** "dd/mm" ou "—". */
  aniversario: string;
  promocoes: "Aceita" | "Não aceita";
};

const pad = (n: number) => String(n).padStart(2, "0");

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export function paraLinhaCliente(c: ClienteDaLoja, timezone: string): LinhaCliente {
  const validos = c.total_pedidos ?? 0;
  const cancelados = c.total_cancelados ?? 0;
  let pedidos = plural(validos, "pedido", "pedidos");
  if (cancelados > 0) pedidos += ` · ${plural(cancelados, "cancelado", "cancelados")}`;

  let ultimoPedido = "—";
  const instante = c.ultimo_pedido_em ? new Date(c.ultimo_pedido_em) : null;
  if (instante && Number.isFinite(instante.getTime())) {
    const [a, m, d] = diaNoFuso(instante, timezone).split("-");
    ultimoPedido = `${d}/${m}/${a}`;
    if (c.ultimo_pedido_status === "cancelado") ultimoPedido += " (cancelado)";
  }

  const aniversario =
    c.dia_aniversario && c.mes_aniversario ? `${pad(c.dia_aniversario)}/${pad(c.mes_aniversario)}` : "—";

  return {
    id: c.cliente_id,
    nome: c.nome,
    telefone: telefoneCliente(c.telefone),
    pedidos,
    ultimoPedido,
    aniversario,
    promocoes: c.aceita_marketing ? "Aceita" : "Não aceita",
  };
}
