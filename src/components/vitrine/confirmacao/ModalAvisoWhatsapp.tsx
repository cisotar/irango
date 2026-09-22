"use client";

// [287] Aviso de envio da mensagem pelo WhatsApp, na página de confirmação.
//
// Este componente é só o FIO entre o React e `avisoWhatsapp.ts`: toda a regra
// (quando exibir, o gate de uma vez por pedido, a contagem, o guard §15) vive
// no módulo puro, testável em `environment: node`. Aqui ficam apenas o estado
// da UI e os três efeitos de janela — `sessionStorage`, `setTimeout` e a
// navegação — injetados por parâmetro.
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
  decidirAvisoWhatsapp,
  jaExibiuAvisoWhatsapp,
  marcarAvisoWhatsappExibido,
  type ContagemAviso,
} from "./avisoWhatsapp";

/**
 * Copy do passo 2 — LITERAL, decisão do usuário. Duas razões para não
 * reescrever: (i) instrução no imperativo + benefício manda agir, enquanto
 * aviso de perda deixa a pessoa parada ponderando; (ii) diz "a mensagem", não
 * "o pedido" — o pedido já existe.
 */
export const COPY_ACELERE_PEDIDO =
  "Envie a mensagem no WhatsApp e acelere seu pedido.";

/** `sessionStorage` pode LANÇAR (aba privativa, política de site). */
function lerSessionStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
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
  const [restante, setRestante] = useState(SEGUNDOS_AVISO_WHATSAPP);
  const contagemRef = useRef<ContagemAviso | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- mesmo padrão de
     `ModalPromocoes.tsx`: a decisão é tomada UMA vez, na montagem, e depende de
     `sessionStorage`, que não existe no SSR. Abrir de forma síncrona é o que
     impede o aviso de piscar depois que o comprador já começou a ler a tela. */
  useEffect(() => {
    const storage = lerSessionStorage();
    const exibir = decidirAvisoWhatsapp({
      avisoHabilitado,
      href,
      jaExibido: jaExibiuAvisoWhatsapp(storage, pedidoId),
    });
    if (!exibir) return;

    // Marca ANTES de exibir: voltar do WhatsApp para a confirmação não pode
    // reabrir o aviso e criar laço de redirecionamento. Se a marca NÃO
    // persistiu (storage bloqueado), o gate falhou aberto — e aí a contagem
    // automática é exatamente o que produziria o laço.
    const persistiu = marcarAvisoWhatsappExibido(storage, pedidoId);

    const contagem = criarContagemAviso({
      href,
      timer: {
        agendar: (cb, ms) => window.setTimeout(cb, ms),
        limpar: (id) => window.clearTimeout(id),
      },
      // Contagem esgotada, sem gesto: `window.open` cairia no bloqueador de
      // popup, então a navegação é top-level. O destino já passou pelo guard.
      navegarTopLevel: (destino) => {
        window.location.href = destino;
      },
      // Gesto real: `noopener` de verdade, sem precisar zerar `opener` na mão.
      // Bloqueador de popup devolve `null` — nesse caso cai para top-level
      // (§2.4 do plano), senão o clique não faria nada e ninguém saberia.
      abrirNovaAba: (destino) => {
        const aba = window.open(destino, "_blank", "noopener");
        if (aba == null) {
          window.location.href = destino;
        }
      },
      aoContar: setRestante,
    });
    contagemRef.current = contagem;
    setAberto(true);
    if (persistiu) {
      contagem.iniciar();
    } else {
      // Gate não confiável: nenhum tick pode navegar sozinho. O aviso vira
      // direto o passo 2 — instrução + os dois botões, só gesto navega.
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
  /* eslint-enable react-hooks/set-state-in-effect */

  /** Gesto do comprador: abre o WhatsApp em aba nova e fecha o aviso. */
  function aoEnviar(): void {
    contagemRef.current?.enviarAgora();
    setAberto(false);
  }

  /** Saída do passo 1: PARA a contagem (WCAG 2.2.1) e mostra o passo 2. */
  function aoAdiar(): void {
    contagemRef.current?.parar();
    setPasso(2);
  }

  /** Fecha o aviso sem navegar. Nada é desfeito — o pedido segue gravado. */
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
                type="button"
                className="min-h-11 w-full"
                onClick={aoEnviar}
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
              {/* Copy LITERAL — ver COPY_ACELERE_PEDIDO. */}
              <DialogTitle>{COPY_ACELERE_PEDIDO}</DialogTitle>
              <DialogDescription>
                Seu pedido já está registrado e a loja o vê no painel. A
                mensagem avisa a cozinha na hora.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              <Button
                type="button"
                className="min-h-11 w-full"
                onClick={aoEnviar}
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
