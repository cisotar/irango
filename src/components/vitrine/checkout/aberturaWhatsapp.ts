// Mecânica de abertura automática do WhatsApp no checkout (issue 126, RN-A5).
//
// Módulo NEUTRO (sem "use client"/"use server", igual a `estado.ts`): só
// mecânica de janela, com o abridor INJETADO por parâmetro — mesmo padrão de
// `criarControladorPolling`/`DepsPolling` em `confirmacao/StatusPedidoLive.tsx`.
// Isso permite cobrir a feature em `environment: node` (o repo não tem jsdom).
//
// A DECISÃO de disparar o WhatsApp e o CONTEÚDO do link são do SERVIDOR
// (`criarPedido` §(9), issue 125). Aqui o cliente só reage: pré-abre uma aba em
// branco DENTRO do gesto do clique (senão o browser bloqueia o popup) e, quando
// a Server Action responde, redireciona ou fecha essa aba.
//
// Best-effort por design (RN-A4): qualquer falha é silenciosa — o checkout
// nunca quebra e o botão manual da confirmação (RN-A3) é o caminho de
// recuperação.

import { urlHttpsSegura } from "@/lib/utils/urlHttpsSegura";

/** Superfície mínima de `Window` usada aqui — permite fake no teste. */
export type JanelaWhatsapp = {
  location: { href: string };
  close: () => void;
  /** `window.opener` — anulado antes de navegar (anti reverse tabnabbing). */
  opener?: unknown;
};

/** Abridor de janela injetável. Devolve `null` quando não foi possível abrir. */
export type AbrirJanela = () => JanelaWhatsapp | null;

/** Aba pré-aberta (ou não) aguardando a resposta do servidor. */
export type AbaWhatsapp = {
  /**
   * Conclui a aba com o `whatsappHref` autoritativo do servidor.
   * `href` válido (`https://`) → navega; `null`/inválido → fecha a aba.
   */
  concluir: (href: string | null) => void;
};

/**
 * Abre `about:blank` em nova aba usando o `window` global.
 * SSR (`window` indefinido) ou falha do browser → `null`, sem lançar.
 */
export function abrirAbaEmBranco(): JanelaWhatsapp | null {
  if (typeof window === "undefined") return null;
  try {
    return window.open("", "_blank");
  } catch {
    return null;
  }
}

/**
 * Desapossa a aba (`window.opener = null`) ANTES de ela receber conteúdo de
 * terceiro — mitigação de reverse tabnabbing (OWASP; equivale ao
 * `rel="noopener"` do link manual da confirmação, `confirmacao/page.tsx`).
 * Sem isso, a página aberta em `api.whatsapp.com` mantém uma referência viva
 * à aba do checkout e pode navegá-la (`opener.location = ...`) para um clone
 * de phishing de pagamento. `window.open("", "_blank", "noopener")` devolveria
 * `null` e mataria a mecânica de pré-abertura, então desapossamos aqui,
 * enquanto a aba ainda é `about:blank` (same-origin → `opener` é gravável).
 *
 * Fail-closed (§15): se não for possível desapossar, a aba NÃO navega.
 */
function desapossar(janela: JanelaWhatsapp): boolean {
  try {
    janela.opener = null;
    return true;
  } catch {
    return false;
  }
}

/**
 * Pré-abre (ou não) a aba do WhatsApp — DEVE ser chamada de forma SÍNCRONA
 * dentro do gesto do clique, antes de qualquer `await` (o Safari invalida a
 * user activation depois do await).
 *
 * @param preAbrir preview de UX vindo do SSR (`whatsapp_envio_automatico` +
 *        loja tem WhatsApp). `false` → nenhuma aba é aberta, e `concluir` vira
 *        no-op — jamais abrir janela DEPOIS do await.
 * @param abrir injeção para teste; default = `window.open("", "_blank")`.
 */
export function prepararAbaWhatsapp(
  preAbrir: boolean,
  abrir: AbrirJanela = abrirAbaEmBranco,
): AbaWhatsapp {
  const janela = preAbrir ? abrir() : null;

  return {
    concluir(href: string | null) {
      if (janela == null) return;
      // Guard §15 (seguranca.md): fonte ÚNICA do predicado anti-XSS. Só
      // `https://` navega; `javascript:`/`http:` fecham a aba.
      const destino = urlHttpsSegura(href);
      if (destino && desapossar(janela)) {
        try {
          janela.location.href = destino;
          return;
        } catch {
          // atribuição pode lançar (COOP, aba já fechada) — cai no close.
        }
      }
      try {
        janela.close();
      } catch {
        // best-effort: close pode lançar (aba já fechada pelo usuário).
      }
    },
  };
}
