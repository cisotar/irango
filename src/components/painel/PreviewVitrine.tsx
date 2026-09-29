"use client";

import type { CSSProperties } from "react";

import type { Tema } from "@/app/(painel)/painel/(bloqueavel)/configuracoes/tema/TemaClient";

/** Largura interna da miniatura (viewport mobile). */
const LARGURA_INTERNA = 375;
/** Fator de escala da miniatura. */
const ESCALA = 0.4;

const PRODUTOS_MOCK = [
  { emoji: "🍽️", nome: "Filé à parmegiana", preco: "R$ 39,90" },
  { emoji: "🥗", nome: "Salada caesar", preco: "R$ 28,90" },
  { emoji: "🍕", nome: "Pizza margherita", preco: "R$ 45,90" },
  { emoji: "🍔", nome: "Smash burger", preco: "R$ 32,90" },
] as const;

const CATEGORIAS_MOCK = [
  { nome: "Pratos do Dia", ativa: true },
  { nome: "Executivos", ativa: false },
  { nome: "Bebidas", ativa: false },
] as const;

type PreviewVitrineProps = {
  tema: Tema;
  nomeLoja: string;
  /** Escala 1x (modal) quando true; 0.4x (miniatura) quando false/omitido. */
  ampliado?: boolean;
};

/**
 * Miniatura fiel da vitrine pública com emojis no lugar de imagens.
 * Usa CSS custom properties para refletir as 3 cores do tema em tempo real.
 *
 * - `ampliado={false}` (padrão): escala 0.4x dentro de container com overflow
 * - `ampliado={true}`: escala 1x, largura 100%, max-width 420px
 */
export function PreviewVitrine({
  tema,
  nomeLoja,
  ampliado = false,
}: PreviewVitrineProps) {
  const variaveis = {
    "--cor-primaria": tema.primaria,
    "--cor-fundo": tema.fundo,
    "--cor-destaque": tema.destaque,
  } as CSSProperties;

  const conteudo = (
    <div
      style={{ ...variaveis, backgroundColor: "var(--cor-fundo)" }}
      className="flex flex-col"
    >
      {/* Header */}
      <header
        className="flex items-center gap-3 px-4 py-2.5 text-white"
        style={{ backgroundColor: "var(--cor-primaria)" }}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-white/35 bg-white/20 text-lg">
          🏪
        </div>
        <span className="min-w-0 truncate text-sm font-semibold">
          {nomeLoja}
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium">
          Aberto agora
        </span>
      </header>

      {/* Barra de busca */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-400">
          <span aria-hidden="true">🔍</span>
          <span>Buscar no cardápio</span>
        </div>
      </div>

      {/* Pills de categoria */}
      <div className="flex gap-2 overflow-hidden px-3 pb-2">
        {CATEGORIAS_MOCK.map((cat) => (
          <span
            key={cat.nome}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium ${
              cat.ativa
                ? "text-white"
                : "border border-gray-200 bg-white text-gray-700"
            }`}
            style={
              cat.ativa
                ? { backgroundColor: "var(--cor-primaria)" }
                : undefined
            }
          >
            {cat.nome}
          </span>
        ))}
      </div>

      {/* Grid de produtos */}
      <div className="grid grid-cols-2 gap-2 px-3 py-2">
        {PRODUTOS_MOCK.map((prod) => (
          <div
            key={prod.nome}
            className="overflow-hidden rounded-lg border border-gray-100 bg-white"
          >
            <div className="flex aspect-[4/3] items-center justify-center bg-gray-50 text-3xl">
              {prod.emoji}
            </div>
            <div className="p-2">
              <p className="truncate text-xs font-medium text-gray-800">
                {prod.nome}
              </p>
              <div className="mt-1 flex items-center justify-between">
                <span
                  className="text-xs font-bold"
                  style={{ color: "var(--cor-destaque)" }}
                >
                  {prod.preco}
                </span>
                <span
                  className="flex size-6 items-center justify-center rounded text-xs font-bold text-white"
                  style={{ backgroundColor: "var(--cor-destaque)" }}
                  aria-hidden="true"
                >
                  +
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Barra de carrinho */}
      <div
        className="flex items-center justify-between px-3 py-2.5 text-white"
        style={{ backgroundColor: "var(--cor-destaque)" }}
      >
        <span className="text-[10px] font-medium uppercase tracking-wide opacity-85">
          1 item
        </span>
        <span className="text-sm font-black">R$ 39,90</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide">
          Ver carrinho 🛒
        </span>
      </div>
    </div>
  );

  /* ── Modo ampliado (modal) ── */
  if (ampliado) {
    return (
      <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-xl">
        {conteudo}
      </div>
    );
  }

  /* ── Miniatura ── */
  const larguraMiniatura = LARGURA_INTERNA * ESCALA;
  const alturaMiniatura = Math.round(larguraMiniatura * (16 / 9));

  return (
    <div
      style={{
        ...variaveis,
        width: larguraMiniatura,
        height: alturaMiniatura,
        backgroundColor: "var(--cor-fundo)",
      }}
      className="relative mx-auto overflow-hidden rounded-xl"
    >
      <div
        className="absolute top-0 left-0"
        style={{
          width: LARGURA_INTERNA,
          transform: `scale(${ESCALA})`,
          transformOrigin: "top left",
        }}
      >
        {conteudo}
      </div>
    </div>
  );
}
