"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ALTURA_SLOT_BARRA } from "@/components/vitrine/layoutVitrine";
import { VAR_ALTURA_BARRA } from "@/components/vitrine/medicaoBarraVitrine";
import {
  criarScrollspy,
  montarRootMargin,
} from "@/components/vitrine/scrollspyCategorias";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ancoraCategoria } from "@/lib/utils/ancoraCategoria";

/** O mínimo que a nav precisa de uma categoria — `CategoriaComProdutos` serve. */
export type CategoriaNavegavel = {
  id: string | null;
  nome: string;
};

type NavCategoriasProps = {
  categorias: CategoriaNavegavel[];
  /**
   * Altura medida da barra sticky, em px (`aoMedir` de `medicaoBarraVitrine`).
   * NÃO é usada como valor: serve de gatilho para o efeito reconstruir o
   * observer — `rootMargin` é congelado na construção do IntersectionObserver e
   * a barra muda de altura ao montar a nav, ao girar o celular e (202) ao
   * trocar trilho↔resumo. O valor lido continua sendo o da CSS var (fonte
   * única, RN-6).
   */
  alturaBarra: number;
};

/** RN-4: com menos que isso o trilho é ruído, não navegação. */
const MINIMO_CATEGORIAS = 3;

// D9 — CSS com vírgula/parêntese NUNCA vira classe Tailwind arbitrária: o
// scanner de texto do Tailwind v4 gera um utilitário órfão em silêncio (bug
// corrigido no commit 4c60783 desta mesma branch). Vai em `CSSProperties`
// hoisted no módulo (mesmo precedente de `ESTILO_ANCORA_CATEGORIA` em
// `SecaoCatalogo.tsx`), o que também evita realocar o objeto a cada render.
const FADE_BORDAS =
  "linear-gradient(90deg, transparent 0, #000 16px, #000 calc(100% - 16px), transparent 100%)";

const ESTILO_TRILHO: CSSProperties = {
  scrollSnapType: "x proximity",
  scrollPaddingInline: "1rem",
  scrollbarWidth: "none",
  // Affordance de "tem mais coisa" sem botão de seta (fora de escopo).
  // `Webkit` além do padrão: Safari iOS ainda exige o prefixo.
  WebkitMaskImage: FADE_BORDAS,
  maskImage: FADE_BORDAS,
};

const ESTILO_CHIP: CSSProperties = { scrollSnapAlign: "center" };

const ESTILO_CHIP_ATIVO: CSSProperties = {
  ...ESTILO_CHIP,
  // WCAG 1.4.1: cor não pode ser o único sinal do chip ativo.
  boxShadow: "inset 0 -3px 0 rgba(255,255,255,.45)",
};

const CLASSES_CHIP =
  "inline-flex min-h-[44px] flex-none items-center justify-center rounded-full border-[1.5px] px-[0.95rem] text-[0.78rem] font-bold tracking-[0.04em] whitespace-nowrap uppercase transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-destaque";

// Ativo = cor da loja com TEXTO BRANCO FIXO (RN-7 / design-system §4: nunca
// derivar do tema, que pode ter fundo escuro).
const CLASSES_CHIP_ATIVO = "border-primaria bg-primaria text-white";
const CLASSES_CHIP_INATIVO =
  "border-borda-nav bg-white text-texto hover:border-primaria";

/**
 * Trilho horizontal de chips da barra sticky da vitrine (issue 203).
 *
 * É `<nav>` + `<ul>` + `<a href="#ancora">` de propósito — não `Tabs`, não
 * carousel de lib: as seções do catálogo não são painéis mutuamente exclusivos
 * e "aba 3 de 7" mentiria para o leitor de tela. Como são links âncora nativos,
 * TOCAR NUM CHIP JÁ ROLA antes da hidratação e com JS desligado.
 *
 * Nenhuma invariante de valor ou permissão vive aqui: o conjunto de produtos
 * veio do SSR sob `anon` + RLS e o preço é recalculado no checkout
 * (seguranca.md §10). Forçar `aria-current` no devtools só pinta chips.
 */
export function NavCategorias({ categorias, alturaBarra }: NavCategoriasProps) {
  // Gate RN-4 antes de qualquer hook — o componente inteiro some (e o observer
  // nem existe) quando o trilho não se justifica.
  if (categorias.length < MINIMO_CATEGORIAS) return null;

  return <TrilhoCategorias categorias={categorias} alturaBarra={alturaBarra} />;
}

function TrilhoCategorias({ categorias, alturaBarra }: NavCategoriasProps) {
  // Âncoras SEMPRE de `ancoraCategoria` (fonte única, 201): uma segunda
  // implementação = links quebrados. A chave derivada do conteúdo mantém a
  // identidade estável entre renders e reconstrói o observer quando o conjunto
  // de seções muda (D5 — a 202 filtra o catálogo).
  const chaveOrdem = categorias
    .map((categoria, indice) => ancoraCategoria(categoria.id, indice))
    .join("|");
  const ancoras = useMemo(() => chaveOrdem.split("|"), [chaveOrdem]);

  const [ativo, setAtivo] = useState(ancoras[0]);
  const chipsRef = useRef(new Map<string, HTMLAnchorElement>());
  // Achado acelerar/200-203: `useMediaQuery` retorna `false` no primeiro
  // paint e só resolve o valor real dentro do próprio efeito — se entrasse
  // nas deps do scrollIntoView abaixo, toda hidratação disparava o
  // scrollIntoView DUAS vezes (uma com o valor errado). Lido por ref (nunca
  // escrito durante o render — só dentro do efeito, como o React exige): a
  // leitura mais recente é usada, sem re-disparar o efeito quando ela muda.
  const aceitaMovimento = useMediaQuery(
    "(prefers-reduced-motion: no-preference)",
  );
  const aceitaMovimentoRef = useRef(aceitaMovimento);
  useEffect(() => {
    aceitaMovimentoRef.current = aceitaMovimento;
  }, [aceitaMovimento]);

  // D3 — `useEffect`, NUNCA `useLayoutEffect`: o React roda os layout effects
  // do FILHO antes do PAI, e `--altura-barra` é publicada no layout effect do
  // pai (`CatalogoVitrine`). Um layout effect aqui leria a var antes de ela
  // existir e montaria o observer deslocado em ~60px, em silêncio. Efeito
  // passivo roda depois de todos os layout effects → var já publicada.
  useEffect(() => {
    // Achado acelerar/200-203: `alturaBarra` nasce 0 e vira > 0 assim que
    // `CatalogoVitrine` mede a barra — sem este guard, TODA hidratação
    // reconstrói o observer duas vezes (0 e depois a altura real), religando
    // N seções à toa. A nav só existe com >=3 categorias (RN-4), e ela só
    // renderiza dentro da barra sticky — ou seja, `temBarra` já é verdade e
    // `medir()` publica altura > 0 antes de qualquer outra troca de estado
    // acontecer aqui. Rotação/troca trilho<->resumo (202) continuam
    // disparando o efeito normalmente, porque a altura muda de novo.
    if (alturaBarra === 0) return;

    const alturaVar = getComputedStyle(document.documentElement)
      .getPropertyValue(VAR_ALTURA_BARRA)
      .trim();

    return criarScrollspy({
      ordem: ancoras,
      obterSecao: (ancora) => document.getElementById(ancora),
      IntersectionObserverCtor:
        typeof IntersectionObserver === "undefined"
          ? undefined
          : IntersectionObserver,
      rootMargin: montarRootMargin(alturaVar),
      aoAtivar: setAtivo,
    });
    // `alturaBarra` não é lida aqui: é o gatilho de reconstrução (rootMargin é
    // congelado no construtor). A altura usada vem sempre da CSS var.
  }, [ancoras, alturaBarra]);

  // Traz o chip ativo ao centro do trilho. `block: "nearest"` é OBRIGATÓRIO:
  // sem ele o scrollIntoView sequestra o scroll vertical e o catálogo pula
  // sozinho. Foco NÃO tem handler (D7): trazer o chip focado para dentro do
  // trilho já é comportamento nativo do browser em `overflow-x: auto`.
  useEffect(() => {
    chipsRef.current.get(ativo)?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: aceitaMovimentoRef.current ? "smooth" : "auto",
    });
  }, [ativo]);

  return (
    <nav
      aria-label="Categorias do cardápio"
      className={`flex items-center px-4 pb-2.5 ${ALTURA_SLOT_BARRA}`}
    >
      <ul
        // w-full: o <nav> virou flex (para centralizar o trilho na altura
        // compartilhada do slot, achado acelerar/202) — sem isso o <ul>
        // encolhe para o conteúdo como filho flex e o overflow-x/scroll-snap
        // do trilho para de fazer sentido.
        className="m-0 flex w-full list-none gap-2 overflow-x-auto overflow-y-hidden p-0 trilho-categorias"
        style={ESTILO_TRILHO}
      >
        {categorias.map((categoria, indice) => {
          const ancora = ancoras[indice];
          const estaAtivo = ancora === ativo;
          return (
            <li key={ancora}>
              <a
                ref={(elemento) => {
                  if (elemento) chipsRef.current.set(ancora, elemento);
                  else chipsRef.current.delete(ancora);
                }}
                href={`#${ancora}`}
                // D6: marca na hora, SEM preventDefault — quem rola continua
                // sendo a navegação âncora nativa (é o que faz o trilho
                // funcionar com JS desligado).
                onClick={() => setAtivo(ancora)}
                aria-current={estaAtivo ? "true" : undefined}
                className={`${CLASSES_CHIP} ${estaAtivo ? CLASSES_CHIP_ATIVO : CLASSES_CHIP_INATIVO}`}
                style={estaAtivo ? ESTILO_CHIP_ATIVO : ESTILO_CHIP}
              >
                {categoria.nome}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
