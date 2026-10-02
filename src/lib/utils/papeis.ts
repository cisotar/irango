// Papel explícito da conta (issue 332, ADR plan/tecnico-identidade-cliente.md §2).
// PURO: sem I/O. Admin NÃO é papel — continua sendo a env `SAAS_ADMIN_USER_ID`
// (`ehAdminSaaS`), por isso entra aqui só como booleano já resolvido.

export const PAPEIS = ["lojista", "cliente"] as const;
export type Papel = (typeof PAPEIS)[number];

/** Guard de tipo: só aceita os papéis conhecidos (valor vindo do banco é input). */
export function ehPapel(valor: unknown): valor is Papel {
  return typeof valor === "string" && (PAPEIS as readonly string[]).includes(valor);
}

/**
 * Destino padrão pós-login quando não há `next`: admin → `/admin`;
 * lojista → `/painel`; qualquer outro conjunto → `/` (nunca `/painel`).
 */
export function destinoPadraoPorPapel({
  ehAdmin,
  papeis,
}: {
  ehAdmin: boolean;
  papeis: readonly Papel[];
}): string {
  if (ehAdmin) return "/admin";
  if (papeis.includes("lojista")) return "/painel";
  return "/";
}
