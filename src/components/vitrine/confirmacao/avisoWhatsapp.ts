// [287] Decisão e contagem do aviso de envio da mensagem no WhatsApp, na
// página de confirmação.
//
// Módulo NEUTRO (sem "use client"/"use server"), mesmo padrão de
// `decisaoModalPromocoes.ts` e de `criarControladorPolling`
// (`StatusPedidoLive.tsx`): storage e timer entram por PARÂMETRO, nada de
// `window` aqui dentro. É o que torna a regra testável em `environment: node`
// (o repo não tem jsdom) — `architecture.md` §8.
//
// Guard §15 (`seguranca.md`): o destino passa por `urlHttpsSegura` — fonte
// ÚNICA do predicado, nunca reimplementado aqui — ANTES de qualquer navegação
// e antes até de agendar o primeiro tick. Destino reprovado não navega por
// caminho nenhum: nem a contagem esgotada, nem o gesto do botão.
//
// O `destino`/`href` NUNCA é logado (precedente [161] de `aberturaWhatsapp.ts`):
// ele carrega PII do comprador na query string.
//
// Vocabulário: a saída do aviso PARA a contagem — o verbo é `parar`, nunca o
// verbo de desistir de um pedido. Quando o aviso aparece o pedido JÁ está
// gravado (RN-W4), então nenhuma copy — e nenhum identificador que possa virar
// copy — pode dar a entender que sair daqui desfaz alguma coisa.

import { urlHttpsSegura } from "@/lib/utils/urlHttpsSegura";

/** Segundos da contagem antes da navegação automática (decisão do usuário). */
export const SEGUNDOS_AVISO_WHATSAPP = 5;

/** Intervalo entre os ticks da contagem. */
const INTERVALO_PADRAO_MS = 1000;

/** Chave do "já avisei neste pedido": `aviso-wpp:<pedidoId>`. */
export function chaveAvisoWhatsapp(pedidoId: string): string {
  return `aviso-wpp:${pedidoId}`;
}

/**
 * O aviso já foi exibido para este pedido? Storage ausente (SSR), bloqueado
 * (aba privativa) ou que LANÇA ⇒ `false`, sem propagar exceção.
 */
export function jaExibiuAvisoWhatsapp(
  storage: Storage | null,
  pedidoId: string,
): boolean {
  if (storage == null) return false;
  try {
    return storage.getItem(chaveAvisoWhatsapp(pedidoId)) != null;
  } catch {
    // Aba privativa / storage bloqueado por política: o aviso volta a aparecer
    // numa revisita, o que é preferível a quebrar a tela de confirmação.
    return false;
  }
}

/**
 * Marca o aviso como exibido. Devolve `true` só quando a marca REALMENTE
 * persistiu.
 *
 * O retorno existe porque o gate "uma vez por pedido" falha ABERTO: sem
 * storage (SSR, política de cookies, WebView restritiva, iframe particionado)
 * a marca some, e um aviso que navega sozinho voltaria a abrir e a navegar a
 * cada revisita da confirmação — laço de redirecionamento. Quem chama usa o
 * `false` para NÃO armar a navegação automática; o envio por gesto continua.
 */
export function marcarAvisoWhatsappExibido(
  storage: Storage | null,
  pedidoId: string,
): boolean {
  if (storage == null) return false;
  try {
    storage.setItem(chaveAvisoWhatsapp(pedidoId), "1");
    return true;
  } catch {
    // Sem persistência do gate: o chamador não pode auto-navegar.
    return false;
  }
}

export type EntradaDecisaoAviso = {
  /** SSR: `loja.whatsapp_envio_automatico === true` (a decisão é do servidor). */
  avisoHabilitado: boolean;
  /** `whatsappHref` montado no SSR; `null` quando a loja não tem WhatsApp. */
  href: string | null;
  /** Resultado de `jaExibiuAvisoWhatsapp` — uma vez por pedido. */
  jaExibido: boolean;
};

/** `true` ⟺ toggle ligado, href aprovado pelo guard §15 e ainda não exibido. */
export function decidirAvisoWhatsapp(entrada: EntradaDecisaoAviso): boolean {
  if (!entrada.avisoHabilitado) return false;
  if (entrada.jaExibido) return false;
  return urlHttpsSegura(entrada.href) !== null;
}

/**
 * Timer INJETADO. `agendar` é one-shot (a contagem se reagenda a cada tick,
 * igual a `criarControladorPolling`) — não é `setInterval`.
 */
export type TimerAviso = {
  agendar: (callback: () => void, ms: number) => number;
  limpar: (id: number) => void;
};

export type DepsContagemAviso = {
  /** Destino cru; o módulo o passa por `urlHttpsSegura` antes de qualquer uso. */
  href: string | null;
  timer: TimerAviso;
  /** Contagem esgotada, sem gesto ⇒ navegação top-level (`location.href`). */
  navegarTopLevel: (destino: string) => void;
  /** Gesto real ⇒ `window.open(destino, "_blank", "noopener")`. */
  abrirNovaAba: (destino: string) => void;
  /** Segundos restantes a cada tick, para o spinner (N-1 … 0). */
  aoContar?: (restante: number) => void;
  /** Default: `SEGUNDOS_AVISO_WHATSAPP`. */
  segundos?: number;
  /** Default: 1000. */
  intervaloMs?: number;
};

export type ContagemAviso = {
  /** Arma a contagem. Destino reprovado no guard ⇒ nada é agendado. */
  iniciar: () => void;
  /** Saída do aviso: PARA a contagem — e ela nunca volta a correr. */
  parar: () => void;
  /** Botão de envio: para a contagem e abre a aba nova (gesto real). */
  enviarAgora: () => void;
};

export function criarContagemAviso(deps: DepsContagemAviso): ContagemAviso {
  const {
    href,
    timer,
    navegarTopLevel,
    abrirNovaAba,
    aoContar,
    segundos = SEGUNDOS_AVISO_WHATSAPP,
    intervaloMs = INTERVALO_PADRAO_MS,
  } = deps;

  // Guard §15 aplicado UMA vez, na criação: um destino reprovado não navega
  // por caminho nenhum e não chega nem a agendar tick.
  const destino = urlHttpsSegura(href);

  let restante = segundos;
  let idTimer: number | null = null;
  /** Fim de linha: a contagem parou (saída, envio ou esgotamento) e não religa. */
  let encerrada = false;

  function limparPendente(): void {
    if (idTimer != null) {
      timer.limpar(idTimer);
      idTimer = null;
    }
  }

  function parar(): void {
    encerrada = true;
    limparPendente();
  }

  function agendarProximo(): void {
    idTimer = timer.agendar(aoTick, intervaloMs);
  }

  function aoTick(): void {
    idTimer = null;
    if (encerrada) return;
    restante -= 1;
    aoContar?.(restante);
    if (restante > 0) {
      agendarProximo();
      return;
    }
    // Contagem esgotada SEM gesto: só navegação top-level sobrevive aqui —
    // `window.open` cairia no bloqueador de popup.
    parar();
    if (destino != null) navegarTopLevel(destino);
  }

  return {
    iniciar() {
      if (destino == null || encerrada || idTimer != null) return;
      agendarProximo();
    },
    parar,
    enviarAgora() {
      // Gesto real do comprador: aba nova com `noopener`, a confirmação fica
      // aberta atrás. Continua valendo depois de `parar()` — é o botão do passo 2.
      parar();
      if (destino != null) abrirNovaAba(destino);
    },
  };
}
