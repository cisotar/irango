// Função PURA de apresentação: formata um timestamp ISO (ex.: `pedido.criado_em`)
// para data/hora legível pt-BR no fuso da LOJA (`lojas.timezone`, issue 351).
// Apenas APRESENTAÇÃO — não é fonte de valor autoritativo.
//
// Delega toda a localização e a conversão de fuso ao Intl.DateTimeFormat nativo
// (sem aritmética de offset artesanal, que quebraria em horário de verão). O
// separador padrão do pt-BR entre data e hora é ", " (vírgula); trocamos só esse
// literal por um espaço para produzir "07/07/2026 14:32". Reusável por qualquer
// comanda/via de impressão (issues 133/134).
//
// O fuso é PARÂMETRO, com São Paulo como padrão para os consumidores que ainda
// não têm a loja em mãos (recibo, comanda, pedidos do cliente logado). Um
// formatter por fuso, memoizado: a tabela de pedidos chama isto dezenas de vezes
// por render.

export const FUSO_PADRAO = "America/Sao_Paulo";

const formatadores = new Map<string, Intl.DateTimeFormat>();

function formatadorDo(timezone: string): Intl.DateTimeFormat {
  let f = formatadores.get(timezone);
  if (f == null) {
    f = new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    formatadores.set(timezone, f);
  }
  return f;
}

/**
 * Formata um timestamp ISO para data/hora pt-BR no fuso informado.
 *
 * @param iso timestamp ISO-8601 (ex.: `2026-07-07T17:32:00Z`).
 * @param timezone IANA (ex.: `lojas.timezone`); padrão `America/Sao_Paulo`.
 * @returns ex.: `07/07/2026 14:32` (dd/MM/aaaa HH:mm, 24h).
 */
export function formatarDataHora(iso: string, timezone: string = FUSO_PADRAO): string {
  return formatadorDo(timezone)
    .formatToParts(new Date(iso))
    .map((parte) => (parte.type === "literal" && parte.value === ", " ? " " : parte.value))
    .join("");
}
