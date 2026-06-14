"use client";

import Image from "next/image";
import { MessageCircle } from "lucide-react";

import { BadgeStatus } from "@/components/vitrine/BadgeStatus";
import { useLojaAberta } from "@/hooks/useLojaAberta";

type HeaderLojaProps = {
  nome: string;
  logoUrl?: string;
  horarios: Parameters<typeof useLojaAberta>[0];
  timezone: string;
  whatsapp?: string | null;
};

/** Só `https:` é renderizado como imagem remota — anti-XSS (seguranca.md §15). */
function logoSeguro(url?: string): string | null {
  return url && url.startsWith("https://") ? url : null;
}

/**
 * Cabeçalho da vitrine. Fundo aplica o tema da loja (`--cor-primaria`); o texto
 * é SEMPRE branco (não derivado da luminância do tema — contraste seguro,
 * design-system §4). Apresentação pura — sem lógica de domínio.
 */
export function HeaderLoja({
  nome,
  logoUrl,
  horarios,
  timezone,
  whatsapp,
}: HeaderLojaProps) {
  const logo = logoSeguro(logoUrl);

  return (
    <header className="sticky top-0 z-30 bg-[var(--cor-primaria)] px-4 py-4 text-white">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          {logo ? (
            <Image
              src={logo}
              alt={nome}
              width={56}
              height={56}
              unoptimized
              className="size-14 rounded-lg object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="flex size-14 items-center justify-center rounded-lg bg-[var(--cor-destaque)] text-xl font-bold text-white"
            >
              {nome.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-white">{nome}</h1>
            {whatsapp ? (
              <a
                href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-sm text-white/80 hover:text-white"
              >
                <MessageCircle aria-hidden className="size-4" />
                WhatsApp
              </a>
            ) : null}
          </div>
        </div>

        <div className="md:shrink-0">
          <BadgeStatus horarios={horarios} timezone={timezone} />
        </div>
      </div>
    </header>
  );
}
