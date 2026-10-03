/**
 * Se o "Finalizar pedido" abre a gaveta "Sua conta" antes do checkout — módulo
 * neutro, testável sem jsdom (mesmo molde de `decisaoModalPromocoes.ts`).
 * "Prosseguir sem login" vale até a aba fechar: `sessionStorage`, chave por loja.
 */

const PREFIXO_CHAVE = "irango:conta-dispensada:";

export function chaveDispensaConta(slug: string): string {
  return `${PREFIXO_CHAVE}${slug}`;
}

/** `window.sessionStorage` pode lançar só de ser lido (storage bloqueado). */
export function sessionStorageSeguro(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Storage ausente ou lançando ⇒ `false`: pior caso a gaveta reaparece. */
export function lerDispensa(storage: Storage | null, slug: string): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(chaveDispensaConta(slug)) === "1";
  } catch {
    return false;
  }
}

export function marcarDispensa(storage: Storage | null, slug: string): void {
  if (storage === null) return;
  try {
    storage.setItem(chaveDispensaConta(slug), "1");
  } catch {
    // Preferência de UX, não permissão: falha é engolida.
  }
}

export function decidirGavetaConta({
  logado,
  dispensado,
}: {
  logado: boolean;
  dispensado: boolean;
}): boolean {
  return !logado && !dispensado;
}
