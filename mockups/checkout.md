# /loja/[slug]/pedido — Checkout

**Rota:** `/loja/[slug]/pedido` · **Issue:** 037 · **Mundo:** Vitrine (mobile-first)
**Tema:** "Confirmar pedido" usa `--cor-primaria`. ResumoFinanceiro é **estimativa** — total cobrado é recalculado no servidor (design-system §1.5).
**Composição:** resumo de itens + FormDadosCliente + FormEnderecoEntrega (ver `form-endereco.md`) + SeletorZona + SeletorFormaPagamento + ResumoFinanceiro.

---

## Mobile (fluxo vertical, scroll único)

```
┌────────────────────────────────────────────┐
│ ‹ Voltar à loja                              │  ← link
│ Finalizar pedido                             │  ← h1
├────────────────────────────────────────────┤
│ 1 · Seu pedido                               │  ← h2
│ ┌──────────────────────────────────────┐    │
│ │ 2× Pão fermentação        R$ 36,00   │    │  ← resumo (read-only) + link "editar"
│ │ 1× Focaccia alecrim       R$ 22,00   │    │
│ │                            [Editar]  │    │  ← reabre o Carrinho
│ └──────────────────────────────────────┘    │
├────────────────────────────────────────────┤
│ 2 · Seus dados   [ FormDadosCliente ]        │
│ Nome                                         │
│ ┌──────────────────────────────────────┐    │
│ │ Maria Souza                          │    │  ← Input
│ └──────────────────────────────────────┘    │
│ Telefone (WhatsApp)                          │
│ ┌──────────────────────────────────────┐    │
│ │ (11) 99999-9999                      │    │  ← Input react-imask
│ └──────────────────────────────────────┘    │
├────────────────────────────────────────────┤
│ 3 · Entrega   [ FormEnderecoEntrega ]        │  ← ver form-endereco.md
│ CEP ┌────────────┐ [🔍 Buscar]               │
│ Rua / Bairro / Cidade / Número / Compl.      │
│                                              │
│ Zona de entrega   [ SeletorZona ]            │
│ ┌──────────────────────────────────────┐    │
│ │ Centro — R$ 5,00              ▾       │    │  ← Select; muda o frete estimado
│ └──────────────────────────────────────┘    │
├────────────────────────────────────────────┤
│ 4 · Pagamento  [ SeletorFormaPagamento ]     │
│ ┌──────────────────────────────────────┐    │
│ │ (●) 📱 Pix                            │    │  ← RadioGroup (ícone + texto)
│ │ ( ) 💵 Dinheiro                       │    │
│ │ ( ) 💳 Cartão na entrega              │    │
│ └──────────────────────────────────────┘    │
│ [Pix] → Troco para? (some p/ Pix/cartão)     │  ← campo condicional só no Dinheiro
├────────────────────────────────────────────┤
│ ⓘ Valores estimados. Total confirmado ao     │  ← nota estimativa
│   enviar o pedido.                            │
│ [ ResumoFinanceiro ]                         │
│ Subtotal                          R$ 58,00   │
│ Frete (Centro)                    R$  5,00   │
│ Desconto (PAOCISO10)             − R$  5,80   │
│ ─────────────────────────────────────────── │
│ Total estimado                    R$ 57,20   │  ← text-lg bold
│                                              │
│ ┌──────────────────────────────────────┐   │
│ │        Confirmar pedido               │   │  ← Button bg=var(--cor-primaria), ≥44px
│ └──────────────────────────────────────┘   │
└────────────────────────────────────────────┘
```

## Erro de validação no submit

```
│ ┌──────────────────────────────────────┐    │
│ │ ⚠ Revise os campos destacados.        │    │  ← Alert(destructive) topo, rola até 1º erro
│ └──────────────────────────────────────┘    │
│ Telefone (WhatsApp)                          │
│ ┌──────────────────────────────────────┐    │
│ │ 119                                  │    │  ← aria-invalid
│ └──────────────────────────────────────┘    │
│ ⚠ Telefone incompleto.                       │  ← FormMessage
```

## Erro de rede ao confirmar (retry)

```
│ ┌──────────────────────────────────────┐    │
│ │ ⚠ Não foi possível enviar o pedido.   │    │
│ │   Verifique a conexão.   [Tentar]     │    │  ← retry, não perde os dados
│ └──────────────────────────────────────┘    │
```

## Loading no submit

```
│ │            ◌ Enviando pedido…         │    │  ← Button disabled + spinner
```

---

## Anatomia / primitives

| Parte | Primitive / componente | Token / classe |
|-------|------------------------|----------------|
| Voltar | `<a>` + `ChevronLeft` | — |
| Resumo itens | `Card` read-only + link "Editar" | reabre `Carrinho` |
| Dados cliente | `Form` + `Input` (nome) + react-imask (tel) | label vinculado |
| Endereço | `FormEndereco` | ver `form-endereco.md` |
| Zona | `Select` | recalcula frete estimado |
| Pagamento | `RadioGroup` + `RadioGroupItem` | ícone lucide + texto |
| Troco | `Input` condicional | só visível em "Dinheiro" |
| Resumo financeiro | `<dl>` | total `text-lg font-bold` |
| Confirmar | `Button` | `bg-[var(--cor-primaria)] text-white min-h-11` |

## Notas UX / Acessibilidade
- **Total estimado** com nota explícita "confirmado ao enviar" — preview é estética, servidor é autoridade (§1.5). Servidor revalida itens, frete, cupom e total.
- SeletorFormaPagamento usa `RadioGroup` (Radix) — cada opção tem **ícone + texto** (não só ícone), navegável por teclado (setas).
- Campo "Troco para?" aparece **só** em Dinheiro (condicional).
- Telefone com `react-imask` (apresentação) salvo limpo `5511999999999`.
- No submit com erro: `Alert` no topo + foco/scroll até o primeiro campo inválido (`aria-invalid` + `aria-describedby`).
- Erro de rede tem **retry** preservando o formulário — não refazer tudo.
- Alvo de toque dos radios e do CTA ≥44px.
