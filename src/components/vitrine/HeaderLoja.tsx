"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { MessageCircle } from "lucide-react";

import { BadgeStatus } from "@/components/vitrine/BadgeStatus";
import { fotoSegura } from "@/lib/utils/fotoSegura";
import { useLojaAberta } from "@/hooks/useLojaAberta";

type HeaderLojaProps = {
  nome: string;
  logoUrl?: string;
  horarios: Parameters<typeof useLojaAberta>[0];
  timezone: string;
  whatsapp?: string | null;
  /** Botão do menu da conta, no topo esquerdo; o bloco central não se move. */
  menuCliente?: ReactNode;
};

/** Formata dígitos do WhatsApp em (DD) NNNNN-NNNN (com ou sem DDI 55). */
function formatarWhatsapp(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const nac = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  if (nac.length === 11) return `(${nac.slice(0, 2)}) ${nac.slice(2, 7)}-${nac.slice(7)}`;
  if (nac.length === 10) return `(${nac.slice(0, 2)}) ${nac.slice(2, 6)}-${nac.slice(6)}`;
  return raw;
}

/**
 * Cabeçalho da vitrine — banda na cor da loja (`--cor-primaria`), logo CIRCULAR
 * de 64px, nome em caixa-alta e os contatos em coluna, compacto (~110px no
 * celular). O texto é SEMPRE branco (não derivado da luminância do tema —
 * contraste seguro, design-system §4). Apresentação pura — sem lógica de
 * domínio.
 */
export function HeaderLoja({
  nome,
  logoUrl,
  horarios,
  timezone,
  whatsapp,
  menuCliente,
}: HeaderLojaProps) {
  const logo = fotoSegura(logoUrl);

  return (
    // Com o menu, a folga de 56px fica só à esquerda (o botão de 44px nunca cobre
    // a logo); à direita, 16px — o texto ganha largura e o nome não quebra.
    <header
      className={`relative bg-[var(--cor-primaria)] py-2.5 text-white ${menuCliente ? "pl-14 pr-4" : "px-4"}`}
    >
      {menuCliente ? <div className="absolute top-2 left-2">{menuCliente}</div> : null}
      <div className="mx-auto flex max-w-3xl items-center justify-start gap-3 sm:justify-center sm:gap-4 md:max-w-5xl lg:max-w-6xl xl:max-w-7xl">
        {logo ? (
          <Image
            src={logo}
            alt={nome}
            width={64}
            height={64}
            unoptimized
            className="size-16 shrink-0 rounded-full border-2 border-white/35 object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-white/35 bg-[#4a3a22] text-2xl font-black"
          >
            {nome.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <h1 className="text-balance text-[clamp(1.125rem,6.2vw,1.5rem)] leading-tight font-bold uppercase tracking-wide">
            {nome}
          </h1>

          <BadgeStatus horarios={horarios} timezone={timezone} />

          {whatsapp ? (
            <a
              href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-6 items-center gap-2 whitespace-nowrap text-sm text-white/90 hover:text-white focus-visible:rounded focus-visible:outline-2 focus-visible:outline-white"
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
