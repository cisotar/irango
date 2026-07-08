// Função PURA de apresentação: formata um timestamp ISO (ex.: `pedido.criado_em`)
// para data/hora legível pt-BR no fuso horário do Brasil (America/Sao_Paulo).
// Apenas APRESENTAÇÃO — não é fonte de valor autoritativo.
//
// Delega toda a localização e a conversão de fuso ao Intl.DateTimeFormat nativo
// (sem aritmética de offset artesanal, que quebraria em horário de verão). O
// separador padrão do pt-BR entre data e hora é ", " (vírgula); trocamos só esse
// literal por um espaço para produzir "07/07/2026 14:32". Reusável por qualquer
// comanda/via de impressão (issues 133/134).

const formatador = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Formata um timestamp ISO para data/hora pt-BR no fuso America/Sao_Paulo.
 *
 * @param iso timestamp ISO-8601 (ex.: `2026-07-07T17:32:00Z`).
 * @returns ex.: `07/07/2026 14:32` (dd/MM/aaaa HH:mm, 24h).
 */
export function formatarDataHora(iso: string): string {
  return formatador
    .formatToParts(new Date(iso))
    .map((parte) => (parte.type === "literal" && parte.value === ", " ? " " : parte.value))
    .join("");
}
