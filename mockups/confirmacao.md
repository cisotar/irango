# /loja/[slug]/confirmacao — Pedido confirmado

**Rota:** `/loja/[slug]/confirmacao` · **Issue:** 038 · **Mundo:** Vitrine (mobile-first)
**Tema:** "Voltar à loja" usa `--cor-primaria`; ícone de sucesso usa verde de sistema (sucesso é estado, não branding). Total exibido é o **valor final do servidor** (não estimativa).

---

## Mobile — sucesso (pagamento Pix)

```
┌────────────────────────────────────────────┐
│                                              │
│                  ✓                           │  ← ícone sucesso (verde, CheckCircle)
│                                              │
│         Pedido confirmado!                   │  ← h1
│   Pão do Ciso recebeu seu pedido.            │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │ Número do pedido                      │  │
│  │ #A1B2C3                       [copiar]│  │  ← id curto + botão copiar
│  └──────────────────────────────────────┘  │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │ Pague com Pix                         │  │  ← bloco de instrução de pagamento
│  │                                       │  │
│  │ Chave (e-mail):                       │  │
│  │ ┌───────────────────────────┬──────┐ │  │
│  │ │ ciso@paodociso.com.br     │copiar│ │  │  ← chave + copiar
│  │ └───────────────────────────┴──────┘ │  │
│  │                                       │  │
│  │ Valor:               R$ 57,20         │  │  ← total final (servidor)
│  │                                       │  │
│  │ ⓘ Envie o comprovante no WhatsApp     │  │
│  │   da loja para confirmar.             │  │
│  └──────────────────────────────────────┘  │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │ 💬 Enviar comprovante no WhatsApp     │  │  ← Button (se loja tem whatsapp)
│  └──────────────────────────────────────┘  │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │        Voltar à loja                  │  │  ← Button bg=var(--cor-primaria)
│  └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

## Variante — pagamento Dinheiro / Cartão na entrega

```
│  ┌──────────────────────────────────────┐  │
│  │ Pagamento na entrega                  │  │
│  │                                       │  │
│  │ Forma: Dinheiro                       │  │
│  │ Troco para: R$ 100,00                 │  │
│  │ Total:               R$ 57,20         │  │  ← total final (servidor)
│  │                                       │  │
│  │ ⓘ Tenha o valor em mãos na entrega.   │  │
│  └──────────────────────────────────────┘  │
```

## Estado de erro (pedido não encontrado / link inválido)

```
┌────────────────────────────────────────────┐
│                  ⚠                           │
│      Pedido não encontrado                   │
│  O link pode ter expirado ou ser inválido.   │
│        ┌─────────────────────────┐           │
│        │     Voltar à loja       │           │  ← CTA
│        └─────────────────────────┘           │
└────────────────────────────────────────────┘
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Ícone sucesso | `CheckCircle` (lucide) | verde de sistema |
| Container | `Card` | `max-w-md mx-auto` |
| Nº pedido | texto mono + `Button` copiar | `aria-label="Copiar número"` |
| Chave Pix | `Input` read-only + `Button` copiar | `Copy` icon |
| Total | `<dl>` | valor final (servidor) |
| WhatsApp | `<a>` wa.me + `Button` | só se houver |
| Voltar | `Button` | `bg-[var(--cor-primaria)]` |

## Notas UX / Acessibilidade
- Total aqui é o **valor final recalculado pelo servidor**, não "estimado" (já não é preview).
- Botões "copiar" (número e chave Pix) dão feedback (toast sonner "Copiado!") e têm `aria-label`.
- Instrução de pagamento muda conforme a forma escolhida (Pix mostra chave; dinheiro mostra troco).
- Página é o destino final do fluxo — CTA principal "Voltar à loja" sempre presente.
- Ícone de sucesso tem `aria-hidden`; o `<h1>` "Pedido confirmado!" carrega a mensagem.
- Cor verde de sucesso é de sistema (não tema da loja) — estado, não branding.
