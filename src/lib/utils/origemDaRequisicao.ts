/**
 * Origem absoluta do app para os links do GoTrue. Vem dos headers da própria
 * requisição (a Redirect Allow List do Supabase é a barreira contra host
 * forjado); nunca do payload.
 */
export function origemDaRequisicao(h: Headers): string {
  const origin = h.get("origin");
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      // cai no host abaixo
    }
  }
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
