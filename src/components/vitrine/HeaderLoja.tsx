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
export function logoSeguro(url?: string): string | null {
  return url && url.startsWith("https://") ? url : null;
}

/** Formata dígitos do WhatsApp em (DD) NNNNN-NNNN (com ou sem DDI 55). */
function formatarWhatsapp(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const nac = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  if (nac.length === 11) return `(${nac.slice(0, 2)}) ${nac.slice(2, 7)}-${nac.slice(7)}`;
  if (nac.length === 10) return `(${nac.slice(0, 2)}) ${nac.slice(2, 6)}-${nac.slice(6)}`;
  return raw;
}

/**
 * Cabeçalho da vitrine — espelha design-claude/vitrine/header-loja.html: banda
 * na cor da loja (`--cor-primaria`), logo CIRCULAR, nome em caixa-alta e os
 * contatos em coluna; o conjunto é centralizado. O texto é SEMPRE branco (não
 * derivado da luminância do tema — contraste seguro, design-system §4).
 * Apresentação pura — sem lógica de domínio.
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
    <header className="bg-[var(--cor-primaria)] px-4 py-2.5 text-white">
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-4 md:max-w-5xl lg:max-w-6xl xl:max-w-7xl">
        {logo ? (
          <Image
            src={logo}
            alt={nome}
            width={80}
            height={80}
            unoptimized
            className="size-[80px] shrink-0 rounded-full border-[3px] border-white/35 object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex size-[80px] shrink-0 items-center justify-center rounded-full border-[3px] border-white/35 bg-[#4a3a22] text-3xl font-black"
          >
            {nome.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0">
          <h1 className="mb-2 text-2xl font-black uppercase tracking-wide">
            {nome}
          </h1>

          <div className="mb-2">
            <BadgeStatus horarios={horarios} timezone={timezone} />
          </div>

          {whatsapp ? (
            <a
              href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-6 items-center gap-2 text-sm text-white/90 hover:text-white focus-visible:rounded focus-visible:outline-2 focus-visible:outline-white"
            >
              <MessageCircle aria-hidden className="size-4 shrink-0" />
              {formatarWhatsapp(whatsapp)}
            </a>
          ) : null}
        </div>
      </div>
    </header>
  );
}
