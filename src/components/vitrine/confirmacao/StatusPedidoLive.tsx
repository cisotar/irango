"use client";

// Issue 131 — CASCA client do bloco "Acompanhe seu pedido" na confirmação.
//
// Absorve o comportamento de limpeza do antigo `ConfirmacaoClient` (limpa o
// carrinho do sessionStorage ao montar) E faz o polling do status via a Server
// Action `consultarStatusPedido` (128), re-renderizando a `LinhaTempoStatus`
// (130) e parando em estado terminal.
//
// Fronteira cliente/servidor (invariantes):
//   - Status é SEMPRE o autoritativo do servidor; o cliente nunca infere nem
//     adianta. Terminalidade decidida por `ehStatusTerminal` sobre o valor
//     RETORNADO pelo servidor, não sobre suposição do cliente.
//   - O cliente só repassa `(pedidoId, token)` — nenhuma decisão de autorização
//     ou valor vive aqui. Autorização por posse do token e anti-enumeração já
//     vivem na action (128).
//
// Visual (issue 131 §Diretrizes): este componente é só a CASCA (Card + região
// viva `sr-only` + aviso de erro discreto) ao redor da `LinhaTempoStatus`, que
// já renderiza pílula/título/mensagem do passo atual. NÃO duplicamos Badge nem
// título/mensagem aqui — isso duplicaria o status na tela e no leitor.
//
// Timeout por requisição: Server Actions NÃO aceitam `AbortController` via bind
// (o abort não cancela o RPC do servidor). Por isso o teto de 5s é feito com
// `Promise.race` no cliente — se a corrida perde para o timer, conta como erro
// de rede (backoff), mas a chamada real segue solta e é ignorada.

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { consultarStatusPedido } from "@/lib/actions/consultarStatusPedido";
import type { ResultadoStatusPedido } from "@/lib/actions/consultarStatusPedido";
import { copyStatusConfirmacao } from "@/lib/utils/statusConfirmacaoUi";
import { ehStatusTerminal, type StatusPedido } from "@/lib/utils/transicaoStatus";
import { LinhaTempoStatus } from "@/components/vitrine/confirmacao/LinhaTempoStatus";

// ---------------------------------------------------------------------------
// Constantes de agendamento (UX puro — não é regra de segurança).
// ---------------------------------------------------------------------------

const DELAY_BASE_MS = 8_000;
const DELAY_MAX_MS = 30_000;
const TIMEOUT_REQUISICAO_MS = 5_000;

// ---------------------------------------------------------------------------
// Limpeza de sessionStorage (absorvida do ConfirmacaoClient — issue 037/132).
// ---------------------------------------------------------------------------

/**
 * Limpa o carrinho persistido após o pedido criado — best-effort. Chaves
 * espelham `useCarrinho.ts` ("irango:carrinho") e `Carrinho.tsx`
 * ("irango:checkout"). Em modo restrito (sessionStorage indisponível) o
 * `try/catch` mantém a limpeza best-effort, igual ao ConfirmacaoClient atual.
 */
export function limparCarrinhoSessionStorage(): void {
  try {
    window.sessionStorage.removeItem("irango:carrinho");
    window.sessionStorage.removeItem("irango:checkout");
  } catch {
    // sessionStorage indisponível (modo restrito) — limpeza é best-effort.
  }
}

// ---------------------------------------------------------------------------
// Timeout via Promise.race (Server Action não é abortável).
// ---------------------------------------------------------------------------

/**
 * Corre `promessa` contra um timer de `ms`. Se o timer vence, rejeita com
 * `"timeout"` (contabilizado como erro de rede → backoff). Usa os timers
 * globais — sob fake timers do vitest, avança com `advanceTimersByTimeAsync`.
 */
export function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    promessa.then(
      (valor) => {
        clearTimeout(id);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(id);
        reject(erro);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Controlador de polling — framework-agnóstico e testável com fake timers.
//
// Separado do componente para poder ser exercitado sob `vi.useFakeTimers()` sem
// montar React (o ambiente de teste é `node`, sem jsdom). O componente é só o
// fio entre este controlador e o estado do React. Toda a mecânica (8s, backoff
// 8→16→30, timeout 5s, pausa por visibilidade, parada terminal, cleanup) vive
// aqui; nenhuma regra de segurança/valor.
// ---------------------------------------------------------------------------

export interface DepsPolling {
  /** Fonte única do status (Server Action 128). */
  consultar: (
    pedidoId: string,
    token: string,
  ) => Promise<ResultadoStatusPedido>;
  /** Sucesso `{ encontrado: true }`: novo status autoritativo do servidor. */
  aoAtualizar: (status: StatusPedido, tipoEntrega: string | null) => void;
  /** Alterna o aviso de erro discreto (true = mostrar, false = ocultar). */
  aoErro: (temErro: boolean) => void;
  /** Aba visível? (`document.visibilityState === "visible"`). */
  estaVisivel: () => boolean;
  timeoutMs?: number;
  delayBaseMs?: number;
  delayMaxMs?: number;
}

export interface ControladorPolling {
  /** Começa o ciclo a partir do status inicial (do server render). */
  iniciar: (statusInicial: StatusPedido) => void;
  /** Aba voltou a ficar visível → poll imediato se ainda não-terminal. */
  aoFicarVisivel: () => void;
  /** Aba ficou oculta → cancela o agendamento pendente (retoma no foco). */
  aoFicarOculto: () => void;
  /** Cleanup duro no unmount: mata timers e impede novos ticks/callbacks. */
  parar: () => void;
}

export function criarControladorPolling(
  pedidoId: string,
  token: string,
  deps: DepsPolling,
): ControladorPolling {
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_REQUISICAO_MS;
  const delayBase = deps.delayBaseMs ?? DELAY_BASE_MS;
  const delayMax = deps.delayMaxMs ?? DELAY_MAX_MS;

  let ativo = false;
  let statusAtual: StatusPedido | null = null;
  let delayAtual = delayBase;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  // Guarda contra tick concorrente: enquanto uma requisição está em voo,
  // `aoFicarVisivel` não dispara outra (evita resposta velha sobrescrever a
  // nova e backoff dobrado duas vezes).
  let emVoo = false;

  function limparTimer(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function podeAgendar(): boolean {
    return (
      ativo &&
      statusAtual !== null &&
      !ehStatusTerminal(statusAtual) &&
      deps.estaVisivel()
    );
  }

  function agendar(delay: number): void {
    limparTimer();
    if (!podeAgendar()) return;
    timerId = setTimeout(() => {
      void tick();
    }, delay);
  }

  async function tick(): Promise<void> {
    if (!ativo || emVoo) return;
    timerId = null;
    emVoo = true;
    try {
      const resultado = await comTimeout(
        deps.consultar(pedidoId, token),
        timeoutMs,
      );
      if (!ativo) return; // desmontou durante a espera → sem setState pós-unmount

      if (resultado.encontrado) {
        statusAtual = resultado.status;
        delayAtual = delayBase; // 1º sucesso reseta o backoff
        deps.aoErro(false);
        deps.aoAtualizar(resultado.status, resultado.tipo_entrega);
        if (ehStatusTerminal(resultado.status)) {
          // Parada dura: nenhum novo agendamento.
          return;
        }
        agendar(delayBase);
        return;
      }
      // { encontrado: false } é tratado como erro de UX: mantém último status,
      // aviso discreto, backoff. NÃO revela inexistência, NÃO limpa a tela.
      registrarErro();
    } catch {
      // Timeout (Promise.race) ou reject da action → mesmo tratamento.
      if (!ativo) return;
      registrarErro();
    } finally {
      emVoo = false;
    }
  }

  function registrarErro(): void {
    deps.aoErro(true);
    delayAtual = Math.min(delayAtual * 2, delayMax);
    agendar(delayAtual);
  }

  return {
    iniciar(statusInicial: StatusPedido) {
      ativo = true;
      statusAtual = statusInicial;
      delayAtual = delayBase;
      if (ehStatusTerminal(statusInicial)) return; // zero requisições
      agendar(delayBase);
    },
    aoFicarVisivel() {
      if (
        !ativo ||
        emVoo ||
        statusAtual === null ||
        ehStatusTerminal(statusAtual)
      ) {
        return;
      }
      // Retoma com poll imediato (não espera o delay), reiniciando o ciclo.
      limparTimer();
      void tick();
    },
    aoFicarOculto() {
      // Pausa: cancela o agendamento pendente; o estado `ativo` segue vivo para
      // retomar no foco.
      limparTimer();
    },
    parar() {
      ativo = false;
      limparTimer();
    },
  };
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

interface StatusPedidoLiveProps {
  pedidoId: string;
  token: string;
  statusInicial: StatusPedido;
  tipoEntrega: string | null;
}

export function StatusPedidoLive({
  pedidoId,
  token,
  statusInicial,
  tipoEntrega,
}: StatusPedidoLiveProps) {
  const [status, setStatus] = useState<StatusPedido>(statusInicial);
  const [tipoEntregaAtual, setTipoEntregaAtual] = useState<string | null>(
    tipoEntrega,
  );
  const [erroRede, setErroRede] = useState(false);

  // Absorve o ConfirmacaoClient: limpa o carrinho ao montar.
  useEffect(() => {
    limparCarrinhoSessionStorage();
  }, []);

  // Polling + visibilidade. Um único efeito monta o controlador, registra o
  // listener de `visibilitychange` e desmonta tudo no cleanup (timers + listener,
  // sem setState pós-unmount graças ao flag `ativo` interno do controlador).
  useEffect(() => {
    const controlador = criarControladorPolling(pedidoId, token, {
      consultar: consultarStatusPedido,
      aoAtualizar: (novoStatus, novoTipo) => {
        setStatus(novoStatus);
        setTipoEntregaAtual(novoTipo);
      },
      aoErro: (temErro) => setErroRede(temErro),
      estaVisivel: () => document.visibilityState === "visible",
    });
    controlador.iniciar(statusInicial);

    function aoMudarVisibilidade(): void {
      if (document.visibilityState === "visible") {
        controlador.aoFicarVisivel();
      } else {
        controlador.aoFicarOculto();
      }
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    return () => {
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      controlador.parar();
    };
  }, [pedidoId, token, statusInicial]);

  // Anunciador conciso: SÓ o título do status. Server render é silencioso
  // (região polite não anuncia conteúdo inicial); cada troca de status muda a
  // string curta → um único anúncio significativo.
  const tituloStatus = copyStatusConfirmacao(status, tipoEntregaAtual).titulo;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Acompanhe seu pedido</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Região viva dedicada: uma frase concisa, não a trilha inteira. */}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {tituloStatus}
        </p>

        {/* Trilha visível NÃO é região viva — sufixos sr-only da 130 servem só à
            navegação manual. */}
        <div role="region" aria-label="Acompanhamento do pedido">
          <LinhaTempoStatus status={status} tipoEntrega={tipoEntregaAtual} />
        </div>

        {/* Aviso de rede — rodapé, discreto, informativo (não destructive).
            Fora de qualquer região viva (não anuncia a cada backoff). */}
        {erroRede ? (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
            <RefreshCw
              aria-hidden
              className="size-4 motion-safe:animate-spin"
            />
            Não foi possível atualizar agora, tentando de novo…
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
