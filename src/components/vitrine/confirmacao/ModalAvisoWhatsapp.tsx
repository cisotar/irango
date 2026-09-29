"use client";

// [287] Aviso de envio da mensagem pelo WhatsApp, na página de confirmação.
//
// Este componente é só o FIO entre o React e `avisoWhatsapp.ts`: toda a regra
// (quando exibir, o gate de uma vez por pedido, a contagem, o guard §15) vive
// no módulo puro, testável em `environment: node`. Aqui ficam apenas o estado
// da UI e os três efeitos de janela — `sessionStorage`, `setTimeout` e a
// abertura/navegação da contagem esgotada — injetados por parâmetro. O envio
// por gesto não passa pelo módulo: os botões de envio são links
// `<a target="_blank">` declarativos, com o `destino` aprovado pelo guard.
//
// Quando este modal aparece, o PEDIDO JÁ EXISTE (RN-W4): a confirmação só
// renderiza porque `criarPedido` devolveu id + token, e o pedido já está no
// painel do lojista. A mensagem do WhatsApp é AVISO, nunca a fonte de verdade.
// Por isso nenhuma copy daqui pode falar em desfazer, desistir ou pedido não
// feito: quem saísse acreditando nisso iria embora, e o pedido chegaria na
// cozinha do mesmo jeito. Sair aqui não desfaz nada — o botão manual "Avisar a
// loja no WhatsApp" (RN-A3) continua na tela por trás.
//
// O `destino`/`href` NUNCA é logado (precedente [161]): ele carrega nome,
// telefone e endereço do comprador na query string.

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SEGUNDOS_AVISO_WHATSAPP,
  criarContagemAviso,
  decidirEMarcarAvisoUmaVez,
  type ContagemAviso,
  type MemoDecisaoAviso,
} from "./avisoWhatsapp";

/**
 * Copy do passo 2 — LITERAL, decisão do usuário. Duas razões para não
 * reescrever: (i) instrução no imperativo + benefício manda agir, enquanto
 * aviso de perda deixa a pessoa parada ponderando; (ii) diz "a mensagem", não
 * "o pedido" — o pedido já existe.
 */
export const COPY_ACELERE_PEDIDO =
  "Envie a mensagem no WhatsApp e acelere seu pedido.";

/**
 * Copy do passo 2 quando o navegador BLOQUEOU a abertura automática no
 * computador (desfecho `"bloqueada-sem-navegar"`). Decisão de produto do
 * usuário: o spec deixava isto fora do escopo v1 ("copy nova exige decisão de
 * produto"); agora o passo 2 explicita o bloqueio e chama o gesto. Segue as
 * mesmas duas amarras da copy do projeto: verbo no imperativo manda agir (o
 * título é a instrução, não o aviso de perda) e nada sugere que o pedido não
 * foi feito — ele já está gravado (RN-W4). LITERAIS, travadas por teste.
 */
export const COPY_POPUP_BLOQUEADO_TITULO =
  "Clique em “Enviar mensagem” para abrir o WhatsApp";
export const COPY_POPUP_BLOQUEADO_DESC =
  "Seu navegador bloqueou a abertura automática. O pedido já está registrado — clique para avisar a loja, ou libere os pop-ups deste site.";

/** `sessionStorage` pode LANÇAR (aba privativa, política de site). */
function lerSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * PC com mouse: `wa.me` abre `web.whatsapp.com` na MESMA aba, substituindo a
 * confirmação — no celular o link é interceptado pelo app e a aba original
 * sobrevive. A contagem é armada em QUALQUER dispositivo; esta heurística só
 * decide o fallback quando o navegador bloqueia a aba nova da contagem
 * esgotada: no toque, navegação top-level; no computador, passo 2 (a aba da
 * confirmação nunca troca sem gesto — RN-AN1).
 */
function ehComputadorComMouse(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return false;
  }
}

export type ModalAvisoWhatsappProps = {
  /** Escopo do gate "uma vez por pedido". */
  pedidoId: string;
  /**
   * Decidido no SSR: `loja.whatsapp_envio_automatico === true` E a loja tem
   * link montado. A DECISÃO é do servidor (RN-A2) — o cliente só reage.
   */
  avisoHabilitado: boolean;
  /** `whatsappHref` do SSR. O guard §15 é aplicado dentro de `avisoWhatsapp`. */
  href: string | null;
};

export function ModalAvisoWhatsapp({
  pedidoId,
  avisoHabilitado,
  href,
}: ModalAvisoWhatsappProps) {
  const [aberto, setAberto] = useState(false);
  const [passo, setPasso] = useState<1 | 2>(1);
  /* Passo 2 alcançado porque o navegador BLOQUEOU a abertura automática
     (desfecho "bloqueada-sem-navegar"). Só então a copy explica o bloqueio; o
     passo 2 por "Agora não" ou por gate de storage não persistido mantém a copy
     de incentivo (COPY_ACELERE_PEDIDO). */
  const [bloqueado, setBloqueado] = useState(false);
  const [restante, setRestante] = useState(SEGUNDOS_AVISO_WHATSAPP);
  /* `href` dos links de envio: o `destino` já aprovado pelo guard §15 dentro
     da contagem. Fica em estado (e não lido da ref no render) para o React
     re-renderizar quando a contagem é criada. */
  const [destinoEnvio, setDestinoEnvio] = useState<string | null>(null);
  const contagemRef = useRef<ContagemAviso | null>(null);
  /* A decisão e a marca valem por INSTÂNCIA, não por execução do efeito: o
     remount do Strict Mode rodaria o efeito de novo e leria a marca que a
     primeira passada acabou de gravar, decidindo "não exibir" com o modal já
     aberto — spinner sem contagem. */
  const decisaoRef = useRef<MemoDecisaoAviso["current"]>(null);

  /* Mesmo padrão de `ModalPromocoes.tsx`: a decisão é tomada UMA vez, na
     montagem, e depende de `sessionStorage`, que não existe no SSR. Abrir de
     forma síncrona é o que impede o aviso de piscar depois que o comprador já
     começou a ler a tela. */
  useEffect(() => {
    // Se a marca NÃO persistiu (storage bloqueado), o gate falhou aberto — e aí
    // a contagem automática é exatamente o que produziria laço de redirecionamento.
    const { exibir, persistiu } = decidirEMarcarAvisoUmaVez(decisaoRef, {
      storage: lerSessionStorage(),
      pedidoId,
      avisoHabilitado,
      href,
    });
    if (!exibir) return;

    const contagem = criarContagemAviso({
      href,
      timer: {
        agendar: (cb, ms) => window.setTimeout(cb, ms),
        limpar: (id) => window.clearTimeout(id),
      },
      // Contagem esgotada: tenta aba nova. Sem 3º argumento de propósito —
      // com "noopener" o `window.open` devolve `null` SEMPRE e não daria para
      // distinguir bloqueio de sucesso. O `opener` é zerado na
      // mesma tarefa, antes de a página de terceiro carregar (§15-A).
      tentarAbrirNovaAba: (destino) => {
        const aba = window.open(destino, "_blank");
        if (aba == null) return "bloqueada";
        aba.opener = null;
        return "aberta";
      },
      // Só alcançado com popup bloqueado em tela de toque. O destino já
      // passou pelo guard.
      navegarTopLevel: (destino) => {
        window.location.href = destino;
      },
      // Avaliado UMA vez, na montagem.
      podeNavegarTopLevel: !ehComputadorComMouse(),
      // O desfecho só mexe na UI; quem navega é o módulo.
      aoEsgotar: (desfecho) => {
        if (desfecho === "bloqueada-sem-navegar") {
          setBloqueado(true);
          setPasso(2);
        } else {
          setAberto(false);
        }
      },
      aoContar: setRestante,
    });
    contagemRef.current = contagem;
    setDestinoEnvio(contagem.destino);
    setAberto(true);
    if (persistiu) {
      contagem.iniciar();
    } else {
      // Gate não confiável: nenhum tick pode abrir o WhatsApp sozinho. O aviso
      // vira direto o passo 2 — instrução + os dois botões, só gesto abre.
      setPasso(2);
    }

    return () => {
      // Desmontagem não pode deixar timer pendente nem navegar depois do fato.
      contagem.parar();
      contagemRef.current = null;
    };
    // Deps `[]` de propósito: nenhuma mudança de prop reabre o aviso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Saída do passo 1: PARA a contagem (WCAG 2.2.1) e mostra o passo 2. */
  function aoAdiar(): void {
    contagemRef.current?.parar();
    setPasso(2);
  }

  /**
   * Para a contagem e fecha o aviso; quem navega, se for o caso, é o próprio link.
   */
  function aoFechar(): void {
    contagemRef.current?.parar();
    setAberto(false);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        {passo === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>Avise a loja pelo WhatsApp</DialogTitle>
              <DialogDescription>
                Você será direcionado para o envio do pedido pelo WhatsApp.
                Envie a mensagem para notificar o restaurante.
              </DialogDescription>
            </DialogHeader>

            <div
              className="flex flex-col items-center justify-center gap-2 py-4"
              aria-live="polite"
            >
              <Loader2
                className="size-10 animate-spin text-[var(--cor-destaque)]"
                aria-hidden
              />
              <p className="text-sm text-muted-foreground">
                Abrindo o WhatsApp em {restante}s…
              </p>
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button
                nativeButton={false}
                className="min-h-11 w-full"
                onClick={aoFechar}
                render={
                  <a
                    href={destinoEnvio ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                Enviar agora
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full"
                onClick={aoAdiar}
              >
                Agora não
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              {/* Copy LITERAL — ver COPY_ACELERE_PEDIDO / COPY_POPUP_BLOQUEADO_*.
                  Só o passo 2 por bloqueio de popup troca a copy; os demais
                  caminhos ("Agora não", gate sem storage) mantêm o incentivo. */}
              {bloqueado ? (
                <>
                  <DialogTitle>{COPY_POPUP_BLOQUEADO_TITULO}</DialogTitle>
                  <DialogDescription>
                    {COPY_POPUP_BLOQUEADO_DESC}
                  </DialogDescription>
                </>
              ) : (
                <>
                  <DialogTitle>{COPY_ACELERE_PEDIDO}</DialogTitle>
                  <DialogDescription>
                    Seu pedido já está registrado e a loja o vê no painel. A
                    mensagem avisa a cozinha na hora.
                  </DialogDescription>
                </>
              )}
            </DialogHeader>

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button
                nativeButton={false}
                className="min-h-11 w-full"
                onClick={aoFechar}
                render={
                  <a
                    href={destinoEnvio ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
              >
                Enviar mensagem
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full"
                onClick={aoFechar}
              >
                Sair mesmo assim
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
