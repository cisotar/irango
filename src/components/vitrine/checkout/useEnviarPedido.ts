"use client";

// Hook de envio do pedido (issue 006) — fonte ÚNICA do submit do checkout,
// compartilhada pelo wizard mobile (EtapaPagamento) e pelo CTA da coluna sticky
// desktop (CheckoutWizard). Extrair evita duplicar a lógica crítica em dois
// lugares (mandato "não reinventar a roda").
//
// CRÍTICO (seguranca.md §10): o payload é montado por montarPayloadPedido —
// SÓ intenção, NUNCA valor monetário — e validado por schemaPayloadPedido
// (.strict()) ANTES do envio. O servidor (criarPedido — 071) recalcula tudo.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { criarPedido } from "@/lib/actions/pedido";
import { schemaPayloadPedido } from "@/lib/validacoes/pedido";
import { montarPayloadPedido, type EstadoWizard, type ItemPayload } from "./estado";

export type UsarEnviarPedidoArgs = {
  lojaId: string;
  lojaSlug: string;
  itens: ItemPayload[];
  estado: EstadoWizard;
  onEstadoChange: (patch: Partial<EstadoWizard>) => void;
};

export function useEnviarPedido({
  lojaId,
  lojaSlug,
  itens,
  estado,
  onEstadoChange,
}: UsarEnviarPedidoArgs) {
  const [enviando, startEnvio] = useTransition();
  const router = useRouter();

  function enviar() {
    if (estado.formaPagamento == null) {
      toast.error("Escolha uma forma de pagamento.");
      return;
    }

    // [063] Chave de idempotência: reusa a existente (retry/duplo-clique) ou
    // gera uma nova via CSPRNG (crypto.randomUUID). Persiste antes do envio p/
    // que uma 2ª tentativa carregue a MESMA chave → dedupe server-side.
    const idempotencyKey = estado.idempotencyKey ?? crypto.randomUUID();
    if (estado.idempotencyKey == null) {
      onEstadoChange({ idempotencyKey });
    }

    // Monta o payload do CLIENTE — só intenção, NUNCA valores monetários.
    const payload = montarPayloadPedido({
      lojaId,
      itens,
      estado,
      idempotencyKey,
    });

    // Gate de validação no cliente ANTES da Server Action (o servidor revalida).
    const parsed = schemaPayloadPedido.safeParse(payload);
    if (!parsed.success) {
      toast.error("Confira os dados do pedido (nome, endereço e itens).");
      return;
    }

    startEnvio(async () => {
      const resultado = await criarPedido(parsed.data);
      if ("erro" in resultado) {
        toast.error(resultado.erro);
        return;
      }
      // [063] Pedido criado: descarta a chave p/ que um próximo carrinho gere
      // uma chave nova e NÃO deduplique com este.
      onEstadoChange({ idempotencyKey: null });
      router.push(
        `/loja/${lojaSlug}/confirmacao?pedido=${resultado.pedidoId}&token=${encodeURIComponent(
          resultado.token_acesso,
        )}`,
      );
    });
  }

  return { enviar, enviando };
}
