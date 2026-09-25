"use client";

// Modal do frete que não pôde ser calculado (issue 180-B).
//
// O que ele NUNCA faz: dizer que o endereço do cliente é o problema quando a
// causa é o nosso serviço de endereços. "Entrega não disponível para o seu
// bairro" faz o comprador trocar de endereço sem resolver nada — e abandonar a
// compra achando que a loja não atende ele.
//
// O modal NÃO cria pedido e NÃO decide valor: o pedido a-combinar nasce quando o
// comprador conclui o checkout normalmente, e `criarPedido` reclassifica do
// zero (mandato 1). Aqui só há texto, retry de PREVIEW e saídas.
//
// WhatsApp é `<a href>`, NUNCA `window.open` (§D9): depois de até 20s de
// spinner a user activation já morreu e o popup cairia no bloqueador. O href
// passa por `urlHttpsSegura` (§15) e, sem número, o link simplesmente não é
// renderizado (fail-closed). Nenhuma PII vai na query string — o pedido ainda
// nem existe.

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
import { linkWhatsappLoja } from "@/lib/utils/linkWhatsappLoja";
import {
  VEREDITO_A_COMBINAR_CEP,
  VEREDITO_A_COMBINAR_RETRIAVEL,
  type VereditoACombinar,
} from "@/lib/utils/freteDegradado";
import { ATRASOS_RETRY_MS, type EstadoRetry } from "./retryFrete";

/** Total de tentativas: a que abriu o modal + as agendadas (10s e 20s). */
const TOTAL_TENTATIVAS = ATRASOS_RETRY_MS.length + 1;

const MENSAGEM_GENERICA = "Mensagem enviada pelo cardápio digital.";

export type ModalFreteIndisponivelProps = {
  aberto: boolean;
  /** Veredito que ABRIU o modal — decide o texto e se há spinner. */
  veredito: VereditoACombinar;
  /** Estado do relógio de retry (null enquanto não há retry em curso). */
  estadoRetry: EstadoRetry | null;
  /** WhatsApp da loja (já público na vitrine). `null` ⇒ oferece retirada. */
  whatsappLoja: string | null;
  nomeLoja: string;
  /**
   * (modalidades) false se a loja desligou a retirada: o modal não oferece
   * "Retirar no balcão" (o servidor recusaria o pedido). Default true.
   */
  aceitaRetirada?: boolean;
  onFechar: () => void;
  /** Segue com o pedido, combinando o frete no chat com a loja. */
  onContinuar: () => void;
  /** Troca o wizard para retirada — o MESMO caminho de `aceitaEntrega=false`. */
  onEscolherRetirada: () => void;
};

/** Título/corpo por veredito — uma invariante, três textos (§D4). */
function textos(veredito: VereditoACombinar): { titulo: string; corpo: string } {
  if (veredito === VEREDITO_A_COMBINAR_CEP) {
    return {
      titulo: "Não localizamos esse CEP",
      corpo:
        "Confira o número do CEP e tente de novo. Se estiver certo, você pode seguir com o pedido e combinar a entrega com a loja.",
    };
  }
  if (veredito === VEREDITO_A_COMBINAR_RETRIAVEL) {
    return {
      titulo: "Calculando a entrega…",
      corpo:
        "Nosso serviço de endereços não respondeu agora. Estamos tentando de novo — não é problema no seu endereço.",
    };
  }
  // esgotado: pode ser NAT corporativo/CGNAT móvel — nunca culpar o cliente.
  return {
    titulo: "Não conseguimos calcular a entrega agora",
    corpo:
      "Isso pode acontecer em redes compartilhadas (Wi-Fi de empresa, internet móvel). Você pode seguir com o pedido e combinar a entrega com a loja.",
  };
}

export function ModalFreteIndisponivel({
  aberto,
  veredito,
  estadoRetry,
  whatsappLoja,
  nomeLoja,
  aceitaRetirada = true,
  onFechar,
  onContinuar,
  onEscolherRetirada,
}: ModalFreteIndisponivelProps) {
  const { titulo, corpo } = textos(veredito);
  // Spinner só enquanto o relógio ainda tem tentativa pela frente.
  const tentando =
    veredito === VEREDITO_A_COMBINAR_RETRIAVEL &&
    estadoRetry != null &&
    estadoRetry.fase !== "esgotado" &&
    estadoRetry.fase !== "sucesso";

  const href = linkWhatsappLoja(
    whatsappLoja,
    `Olá, ${nomeLoja}! Quero fazer um pedido e combinar a entrega. ${MENSAGEM_GENERICA}`,
  );

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{corpo}</DialogDescription>
        </DialogHeader>

        {tentando && (
          <p
            className="flex items-center gap-2 text-sm text-texto-muted"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Tentativa {estadoRetry.tentativa} de {TOTAL_TENTATIVAS}…
          </p>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {href != null && (
            // Navegação iniciada pelo próprio clique: sem `await` no meio e sem
            // window.open — é o que sobrevive aos 20s de spinner.
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--cor-destaque)] px-4 text-sm font-bold text-white hover:bg-[var(--cor-destaque)]/90"
            >
              Falar com a loja no WhatsApp
            </a>
          )}

          <Button
            type="button"
            variant={href == null ? "default" : "outline"}
            className="min-h-11 w-full"
            onClick={onContinuar}
          >
            Continuar e combinar o frete no pedido
          </Button>

          {href == null && aceitaRetirada && (
            // Loja sem WhatsApp: a saída é retirada, pelo MESMO caminho que o
            // wizard já usa quando a loja não aceita entrega.
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full"
              onClick={onEscolherRetirada}
            >
              Retirar no balcão
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
