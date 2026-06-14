# BadgeStatus — Status de sistema (cor + texto + ícone)

**Componente:** `components/vitrine/BadgeStatus.tsx`
**Mundo:** Vitrine **e** Painel (único componente que cruza os dois mundos — design-system §7)
**Issue:** 028 · **Cores:** **fixas, NÃO vêm do tema da loja** (são tokens de sistema — design-system §8). Sempre **cor + texto** (+ ícone), nunca cor sozinha (WCAG §5).

---

## 8.1 — Status de funcionamento da loja (vitrine)

```
ABERTA                          FECHADA
╭─────────────────────╮         ╭──────────────────────────────────╮
│ ● Aberto agora      │         │ ○ Fechado · abre seg às 08:00    │
╰─────────────────────╯         ╰──────────────────────────────────╯
 verde (bg-green-100              cinza (bg-gray-100
  text-green-800)                  text-gray-700)
 ícone: <Dot/> cheio              ícone: <Clock/>
```

## 8.2 — Status de pedido (painel / TabelaPedidos)

```
╭───────────────╮  pendente      → âmbar   bg-amber-100  text-amber-800   <Clock/>
│ ⏱ Pendente    │
╰───────────────╯

╭───────────────╮  confirmado    → azul    bg-blue-100   text-blue-800    <Check/>
│ ✓ Confirmado  │
╰───────────────╯

╭───────────────╮  em_preparo    → índigo  bg-indigo-100 text-indigo-800  <ChefHat/>
│ 👨‍🍳 Em preparo │
╰───────────────╯

╭────────────────────╮  saiu_entrega → ciano bg-cyan-100  text-cyan-800   <Bike/>
│ 🛵 Saiu pra entrega │
╰────────────────────╯

╭───────────────╮  entregue      → verde   bg-green-100  text-green-800   <PackageCheck/>
│ ✓ Entregue    │
╰───────────────╯

╭───────────────╮  cancelado     → vermelho bg-red-100   text-red-800     <X/>
│ ✕ Cancelado   │
╰───────────────╯
```

---

## Anatomia / primitives

| Parte | Primitive | Token / classe |
|-------|-----------|----------------|
| Container | `Badge` (shadcn) — `variant` por status | `rounded-full px-2.5 py-1 text-xs font-medium` |
| Ícone | lucide-react | 14px, `aria-hidden` (cor não é o único sinal) |
| Texto | `<span>` | sempre presente — é o sinal acessível |

## Props (proposta)

```ts
type StatusLoja = "aberta" | "fechada";
type StatusPedido = "pendente" | "confirmado" | "em_preparo"
                  | "saiu_entrega" | "entregue" | "cancelado";

interface BadgeStatusProps {
  tipo: "loja" | "pedido";
  status: StatusLoja | StatusPedido;
  reaberturaTexto?: string; // só quando loja fechada: "abre seg às 08:00"
}
```

## Notas UX / Acessibilidade
- **Nunca só cor:** rótulo textual é obrigatório; ícone é reforço opcional (`aria-hidden`).
- Cores são **tokens de sistema** (proposta de registrar como `--color-status-*` no `@theme`), **não** CSS custom properties do tema — o status significa o mesmo em qualquer loja.
- Verificar contraste AA de cada par bg/text antes de fixar valores (design-system §8).
- "Fechado" usa cinza (ausência de atividade), **não** vermelho — fechado não é erro.
