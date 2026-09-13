"use client";

// Hook de envio do pedido (issue 006) — fonte ÚNICA do submit do checkout,
// compartilhada pelo wizard mobile (EtapaPagamento) e pelo CTA da coluna sticky
// desktop (CheckoutWizard). Extrair evita duplicar a lógica crítica em dois
// lugares (mandato "não reinventar a roda").
//
// CRÍTICO (seguranca.md §10): o payload é montado por montarPayloadPedido —
// SÓ intenção, NUNCA valor monetário. O servidor (criarPedido — 071) revalida
// com schemaPayloadPedido (.strict()) e recalcula tudo: ele é a fronteira.
//
// [163] O gate de schema AQUI é preview de UX best-effort. zod era 42% do JS
// desta rota (63,8 KB gzip de 151 KB) e é o comprador no celular quem pagava
// — então o schema sai do bundle inicial e chega por import() em idle. Se o
// clique acontecer antes de ele chegar, o payload CRU vai para o servidor, que
// o valida como sempre fez (actions/pedido.ts:65, antes de qualquer I/O).
// O caminho do clique permanece SÍNCRONO: nenhum await/then antes da RN-A5.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { criarPedido } from "@/lib/actions/pedido";
import { montarPayloadPedido, type EstadoWizard, type ItemPayload } from "./estado";
import { prepararAbaWhatsapp } from "./aberturaWhatsapp";

// [163] Type-only: `typeof import(...)` é apagado na compilação, não puxa zod
// para o bundle. O valor chega só pelo import() dinâmico abaixo.
type SchemaPedido = typeof import("@/lib/validacoes/pedido").schemaPayloadPedido;

// Escopo de MÓDULO, de propósito — não é useRef/useEffect. Um hook novo aqui
// quebraria o harness de useEnviarPedido.test.ts, que chama este hook como
// função comum fora de componente (environment: node, sem jsdom) e é o único
// guarda da ordem da RN-A5 neste ambiente.
let schemaPedido: SchemaPedido | null = null;
let precarga: Promise<void> | null = null;

/**
 * [163] Busca o schema de preview uma única vez. Idempotente. Falha é
 * silenciosa de propósito: sem schema o cliente só perde o preview, e o
 * servidor segue barrando tudo. Exportada para que o teste alcance o estado
 * "schema carregado" — em `environment: node` a pré-carga automática não roda.
 */
export function precarregarSchemaPedido(): Promise<void> {
  precarga ??= import("@/lib/validacoes/pedido")
    .then((m) => {
      schemaPedido = m.schemaPayloadPedido;
    })
    .catch(() => {
      // Sem preview; o servidor é o gate.
    });
  return precarga;
}

if (typeof window !== "undefined") {
  // Fora do caminho crítico de hidratação: idle, ou o próximo tick onde
  // requestIdleCallback não existe (Safari < 16.4).
  const agendar =
    typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback
      : (cb: () => void) => window.setTimeout(cb, 0);
  agendar(() => {
    void precarregarSchemaPedido();
  });
}

export type UsarEnviarPedidoArgs = {
  lojaId: string;
  lojaSlug: string;
  itens: ItemPayload[];
  estado: EstadoWizard;
  onEstadoChange: (patch: Partial<EstadoWizard>) => void;
  /**
   * [126] Preview de UX vindo do SSR (`whatsapp_envio_automatico` da loja +
   * loja tem WhatsApp): pré-abre uma aba no gesto do clique para o link que o
   * SERVIDOR vai (ou não) devolver. Fail-closed: default `false`. A DECISÃO de
   * enviar é do servidor (RN-A2) — se ele não emitir `whatsappHref`, a aba é
   * fechada e nada é enviado.
   */
  preAbrirWhatsapp?: boolean;
};

export function useEnviarPedido({
  lojaId,
  lojaSlug,
  itens,
  estado,
  onEstadoChange,
  preAbrirWhatsapp = false,
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

    // [163] Preview best-effort: só barra se o schema JÁ chegou. Ausente, o
    // payload cru segue para o servidor — criarPedido(payload: unknown) roda o
    // próprio safeParse antes de qualquer I/O, então nada é enfraquecido.
    const parsed = schemaPedido?.safeParse(payload);
    if (parsed && !parsed.success) {
      toast.error("Confira os dados do pedido (nome, endereço e itens).");
      return;
    }

    // [126] RN-A5: pré-abre a aba AQUI — depois de todos os returns
    // antecipados (nenhuma aba órfã com payload inválido) e FORA do
    // startEnvio, ainda dentro do gesto do clique (o await invalidaria a user
    // activation e o browser bloquearia o popup).
    const aba = prepararAbaWhatsapp(preAbrirWhatsapp);

    startEnvio(async () => {
      let resultado;
      try {
        resultado = await criarPedido(parsed?.success ? parsed.data : payload);
      } catch (e) {
        // [162] Server Action REJEITOU (queda de rede, 500 do RSC) — sem isso a
        // aba pré-aberta ficava órfã em about:blank e o cliente sem aviso.
        console.error("[useEnviarPedido:criarPedido]", e);
        aba.concluir(null);
        toast.error("Não foi possível enviar seu pedido. Tente novamente.");
        return;
      }
      if ("erro" in resultado) {
        aba.concluir(null);
        toast.error(resultado.erro);
        return;
      }
      // [063] Pedido criado: descarta a chave p/ que um próximo carrinho gere
      // uma chave nova e NÃO deduplique com este.
      onEstadoChange({ idempotencyKey: null });
      // [126] Best-effort (RN-A4): href autoritativo do servidor (125) navega a
      // aba; ausente/inválido fecha. O router.push abaixo roda de qualquer jeito.
      aba.concluir(resultado.whatsappHref);
      router.push(
        `/loja/${lojaSlug}/confirmacao?pedido=${resultado.pedidoId}&token=${encodeURIComponent(
          resultado.token_acesso,
        )}`,
      );
    });
  }

  return { enviar, enviando };
}
