"use client";

import { SearchX, Search, X } from "lucide-react";
import { useId, type KeyboardEvent, type RefObject } from "react";

import { Input } from "@/components/ui/input";
import { ALTURA_SLOT_BARRA } from "@/components/vitrine/layoutVitrine";
import { textoResumoBusca } from "@/components/vitrine/resumoBusca";

/**
 * Campo de busca da vitrine (issue 202) e os dois acessórios do modo-busca:
 * `ResumoBusca` (ocupa o lugar do trilho na barra sticky) e `EstadoVazioBusca`
 * (ocupa o lugar do catálogo no `<main>`).
 *
 * Os três são CONTROLADOS e SEM ESTADO PRÓPRIO: `termo` e o `inputRef` moram em
 * `CatalogoVitrine` (D1), porque três dos quatro caminhos de limpar nascem fora
 * daqui — é o que garante estruturalmente que o foco sempre volta ao input e
 * nunca cai no `<body>`.
 *
 * Nenhuma invariante de valor ou de permissão vive aqui: a filtragem é
 * estritamente subtrativa sobre o payload que o SSR já limitou por RLS +
 * `vitrine_lojas` (RN-1), e o preço continua recalculado no checkout
 * (seguranca.md §10). O termo fica em memória do componente: não vai para a
 * URL, para `sessionStorage`, para log nem para a rede.
 */

// Foco visível único dos três controles (critério de aceite): 3px da cor de
// destaque com 2px de folga, mesmo precedente dos chips de `NavCategorias`.
const FOCO_VISIVEL =
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-destaque";

// 44px LITERAL, nunca `min-h-11`: a base do projeto é 120%, onde `min-h-11`
// vira 52,8px — mais folgado que a régua, e portanto não é a régua.
const ALVO_44 = "min-h-[44px]";

// Overrides do `Input` do shadcn sem tocar em `ui/input.tsx` (D7):
//  - `h-auto` derruba o `h-8` (26,6px na base 120%);
//  - `text-[16px] md:text-[16px]` — o `md:text-[16px]` é OBRIGATÓRIO, senão o
//    `md:text-sm` do componente reintroduz o zoom do Safari iOS no desktop;
//  - `focus-visible:ring-0` remove o anel padrão, que duplicaria o outline.
const CLASSES_INPUT_BUSCA = `h-auto ${ALVO_44} rounded-full border-[1.5px] border-borda-nav bg-white py-0 pr-11 pl-10 text-[16px] text-texto placeholder:text-texto-muted focus-visible:border-borda-nav focus-visible:ring-0 md:text-[16px] ${FOCO_VISIVEL}`;

type BuscaProdutosProps = {
  termo: string;
  aoMudar: (termo: string) => void;
  /** Os quatro caminhos de limpar convergem para a MESMA função do pai (D1). */
  aoLimpar: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Id da região viva única, que mora fora da barra medida (D3). */
  idRegiaoViva: string;
};

export function BuscaProdutos({
  termo,
  aoMudar,
  aoLimpar,
  inputRef,
  idRegiaoViva,
}: BuscaProdutosProps) {
  // D6: nenhum id literal — o mockup usa ids fixos porque é HTML estático.
  const idCampo = useId();

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>): void {
    if (evento.key !== "Escape") return;
    // Gate por `termo !== ""`, não por `normalizarBusca`: aqui a pergunta é "há
    // algo escrito para limpar?". Um campo com só espaços tem o que limpar,
    // mesmo não estando em modo busca.
    if (termo === "") return; // Sem texto: propaga, senão o Esc não fecha o Sheet.
    evento.preventDefault();
    // O Sheet do carrinho (Base UI) fecha no Escape que sobe — com texto no
    // campo, o Esc é da busca e não pode fechar o carrinho por baixo.
    evento.stopPropagation();
    aoLimpar();
  }

  return (
    <form
      role="search"
      // D8: sem action e sem navegação — Enter no campo não recarrega a página.
      onSubmit={(evento) => evento.preventDefault()}
      className="relative flex items-center px-4 pt-3 pb-2"
    >
      <label htmlFor={idCampo} className="sr-only">
        Buscar produto no cardápio
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-[29px] size-[18px] text-texto-muted"
      />
      <Input
        ref={inputRef}
        id={idCampo}
        type="search"
        inputMode="search"
        autoComplete="off"
        enterKeyHint="search"
        placeholder="Buscar no cardápio…"
        aria-describedby={idRegiaoViva}
        // Achado auditar/202 (BAIXA): sem teto, colar um texto muito grande
        // faz `filtrarCatalogo`/`ResumoBusca` processar e renderizar a string
        // inteira sem truncar. Auto-infligido (não é vetor de servidor), mas
        // custo zero evitar. Nome de produto real não passa disso.
        maxLength={80}
        value={termo}
        onChange={(evento) => aoMudar(evento.target.value)}
        onKeyDown={aoTeclar}
        className={CLASSES_INPUT_BUSCA}
      />
      {termo === "" ? null : (
        <button
          type="button"
          onClick={aoLimpar}
          aria-label="Limpar busca"
          // `<button>` cru, nunca `Button size="icon-sm"` (33,6px — abaixo da
          // régua). O alvo tem os 44px nas duas direções.
          className={`absolute right-4 inline-flex ${ALVO_44} min-w-[44px] items-center justify-center rounded-full text-texto-muted ${FOCO_VISIVEL}`}
        >
          <X aria-hidden className="size-[18px]" strokeWidth={2.2} />
        </button>
      )}
    </form>
  );
}

type ResumoBuscaProps = { total: number; termo: string; aoLimpar: () => void };

/**
 * Linha de resumo na barra sticky. Ocupa exatamente o lugar do trilho de
 * categorias (RN-5) — `NavCategorias` é DESMONTADA em modo busca (D2), o que
 * também muda a altura da barra e faz `medirEObservarBarra` republicar
 * `--altura-barra`.
 */
export function ResumoBusca({ total, termo, aoLimpar }: ResumoBuscaProps) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 pb-2.5 ${ALTURA_SLOT_BARRA}`}
    >
      <p className="text-sm font-semibold text-texto-muted">
        {textoResumoBusca(total, termo)}
      </p>
      <button
        type="button"
        onClick={aoLimpar}
        className={`inline-flex ${ALVO_44} flex-none items-center rounded-full border-[1.5px] border-borda-nav bg-white px-3.5 text-xs font-bold tracking-wide uppercase text-texto ${FOCO_VISIVEL}`}
      >
        Limpar
      </button>
    </div>
  );
}

type EstadoVazioBuscaProps = { termo: string; aoLimpar: () => void };

/**
 * Nunca tela em branco: sem nenhum produto casando, o `<main>` mostra isto no
 * lugar do catálogo. O CTA limpa a busca e devolve o foco ao input (D1).
 */
export function EstadoVazioBusca({ termo, aoLimpar }: EstadoVazioBuscaProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <SearchX aria-hidden className="size-10 text-texto-muted" />
      <p className="font-medium text-texto">
        Nenhum produto encontrado para {"“"}
        {termo}
        {"”"}.
      </p>
      <p className="text-sm text-texto-muted">
        Tente outro termo ou veja o cardápio completo.
      </p>
      <button
        type="button"
        onClick={aoLimpar}
        className={`mt-1 inline-flex ${ALVO_44} items-center rounded-xl bg-destaque px-5 text-sm font-bold tracking-wide uppercase text-white ${FOCO_VISIVEL}`}
      >
        Ver cardápio completo
      </button>
    </div>
  );
}
