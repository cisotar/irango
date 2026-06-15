import Link from "next/link";

/**
 * Footer público compartilhado (issue 062). Usado na landing e nas páginas
 * legais (/termos, /privacidade) — links para as políticas obrigatórias da LGPD
 * (seguranca.md §20). Server Component puro, sem estado.
 */
export function FooterPublico() {
  return (
    <footer className="px-6 py-8 text-center text-sm text-texto-muted">
      <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span>🥖 iRango</span>
        <span aria-hidden>·</span>
        <Link href="/termos" className="underline hover:text-texto">
          Termos de Uso
        </Link>
        <span aria-hidden>·</span>
        <Link href="/privacidade" className="underline hover:text-texto">
          Política de Privacidade
        </Link>
      </nav>
    </footer>
  );
}
