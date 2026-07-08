# [126] Mecânica client: abertura automática do WhatsApp no confirmar pedido

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [125]
**Spec:** specs/5-whatsapp-envio-automatico-toggle.md

## Objetivo
No clique de "Confirmar pedido", abrir o WhatsApp automaticamente quando o servidor emitir
`whatsappHref`, usando o padrão anti-bloqueio de popup (RN-A5). Best-effort: nunca falha o checkout.

## Escopo
- [ ] `useEnviarPedido.ts` (`src/components/vitrine/checkout/`): dentro de `enviar`, ANTES do
  `await criarPedido` — e só quando o SSR indica envio automático + loja tem WhatsApp —
  abrir `const janela = window.open("", "_blank")` (preserva o gesto do usuário).
- [ ] Após `await criarPedido`: em sucesso com `whatsappHref` e `janela` → `janela.location.href
  = whatsappHref`; caso contrário → `janela?.close()`.
- [ ] `router.push(confirmacao...)` na mesma aba, inalterado (não depende do `window.open`).
- [ ] `page.tsx` do checkout (`src/app/(publica)/loja/[slug]/pedido/page.tsx`): expor ao
  `CheckoutWizard` a flag `whatsapp_envio_automatico` (de `buscarLojaPorSlug`/`vitrine_lojas`,
  após 121) + presença de WhatsApp, propagando até `useEnviarPedido`.
- [ ] Confirmação (spec 3): garantir que o botão manual "Avisar a loja no WhatsApp" continua
  SEMPRE visível quando a loja tem WhatsApp (RN-A3) — não remover.

## Fora de escopo
- Decisão/conteúdo do link (issue 125 — servidor é a verdade).
- Envio server-side real / WhatsApp Business API (fora do escopo v1).

## Reuso esperado
- `useEnviarPedido` existente — estender o handler, não duplicar submit.
- `whatsappHref` autoritativo devolvido por `criarPedido` (125).

## Segurança
- A flag no cliente é só preview para pré-abrir a aba; se divergir do servidor
  (`whatsappHref: null`), a aba em branco é fechada e nada é enviado (RN-A5).
- Best-effort (RN-A4): popup bloqueado / `href` null / aba não abre → pedido segue salvo e o
  cliente vai à confirmação normalmente.
- `janela.location.href` recebe uma string `https://api.whatsapp.com/...` pronta do servidor;
  sem `dangerouslySetInnerHTML`.

## Critério de aceite
- [ ] Loja com envio automático + WhatsApp: ao confirmar, o WhatsApp abre sozinho com o
  resumo do pedido (aba pré-aberta redirecionada).
- [ ] Loja sem envio automático (ou `whatsappHref` null): pedido confirmado, aba em branco
  fechada, cliente na confirmação com o botão manual.
- [ ] Popup bloqueado não quebra o checkout (`router.push` acontece de qualquer forma).
- [ ] Botão manual visível na confirmação sempre que a loja tem WhatsApp.
