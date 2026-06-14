# Índice de Mockups — iRango

Mockups ASCII das telas e componentes. Mobile-first na vitrine; painel desktop-friendly mas responsivo. Stack: Tailwind v4 + shadcn/ui + lucide-react + sonner + react-hook-form/zod + react-imask. Ler `references/design-system.md` antes de implementar.

**Convenções nos mockups:**
- `[ Componente ]` = componente de domínio (`components/vitrine|painel/`)
- `[Primitive]` = primitivo shadcn (`Button`, `Card`, `Sheet`, `Badge`, `Select`, `RadioGroup`, `Table`, `AlertDialog`, `Form`…)
- `var(--cor-primaria | --cor-fundo | --cor-destaque)` = CSS custom property do tema da loja (só na **vitrine**)
- Painel e páginas de produto (login/cadastro/landing) usam **tokens iRango**, não o tema da loja

---

## Slice 1 — Componentes da vitrine (issues 028, 029)

| Arquivo | Componente | Mundo | Destaques |
|---------|-----------|-------|-----------|
| [header-loja.md](header-loja.md) | `HeaderLoja` | Vitrine | nome/logo + `BadgeStatus`; fundo `--cor-primaria`, texto branco fixo |
| [badge-status.md](badge-status.md) | `BadgeStatus` | Vitrine **e** Painel | cor+texto+ícone; cores de sistema (não tema); loja aberta/fechada + 6 status de pedido |
| [card-produto.md](card-produto.md) | `CardProduto` | Vitrine | foto 4:3, preço BRL, "Adicionar" `--cor-primaria`, stepper, indisponível |
| [carrinho.md](carrinho.md) | `Carrinho` (Sheet) | Vitrine | itens +/-, cupom, zona, preview **estimado**, vazio/erro/loading |
| [form-endereco.md](form-endereco.md) | `FormEndereco` | Vitrine | CEP react-imask + buscar + auto-preenchimento |

## Slice 2 — Páginas públicas (issues 034–038 + landing)

| Arquivo | Rota | Mundo | Destaques |
|---------|------|-------|-----------|
| [login.md](login.md) | `/login` | Produto | e-mail/senha, Google, erro genérico |
| [cadastro.md](cadastro.md) | `/cadastro` | Produto | e-mail/senha + aceite Termos, Google |
| [vitrine-loja.md](vitrine-loja.md) | `/loja/[slug]` | Vitrine | HeaderLoja + categorias + grid + FAB/sidebar carrinho + WhatsApp |
| [checkout.md](checkout.md) | `/loja/[slug]/pedido` | Vitrine | dados cliente, endereço, zona, pagamento (radio), resumo **estimado** |
| [confirmacao.md](confirmacao.md) | `/loja/[slug]/confirmacao` | Vitrine | sucesso, nº pedido, instrução Pix/dinheiro, total **final** |
| [landing.md](landing.md) | `/` | Produto | hero + CTA "Crie sua loja grátis" + 3 benefícios + CTA rodapé |

## Slice 3 — Painel do lojista (issues 039, 048, 050)

| Arquivo | Tela/Componente | Mundo | Destaques |
|---------|-----------------|-------|-----------|
| [layout-painel.md](layout-painel.md) | Layout `/painel/*` | Painel | sidebar desktop + topbar/Sheet mobile; item ativo `aria-current` |
| [dashboard.md](dashboard.md) | `/painel` | Painel | 3 cards de métrica + `TabelaPedidos` recentes; card-list no mobile |
| [tabela-pedidos.md](tabela-pedidos.md) | `TabelaPedidos` | Painel | badge por status, ações da máquina de estados, card-list mobile, cancelar com AlertDialog |

---

## Decisões de design não-óbvias

1. **Mundo de login/cadastro/landing = Produto, não Vitrine.** Essas telas **não** consomem `--cor-*` da loja (o tema é exclusivo da vitrine pública). Usam tokens iRango. O brief lista login/cadastro fora de `/loja/[slug]`, e o design-system §2 define só `/loja/[slug]` como vitrine.
2. **Texto sobre `--cor-primaria` é branco fixo.** Não derivar a cor do texto da luminância do tema do lojista — protege contra cor de marca clara que falharia contraste AA (design-system §4, risco conhecido). Vale para HeaderLoja, CardProduto, CTAs.
3. **Carrinho: Sheet no mobile, sidebar fixa no desktop.** Mesmo componente `Carrinho`, dois containers. Mantém "carrinho sempre acessível" (§6) sem ocupar a tela pequena.
4. **"Valores estimados" explícito** no Carrinho e no ResumoFinanceiro do checkout; na confirmação o total já é **valor final do servidor** (não "estimado"). Preview é estética, servidor é autoridade (§1.5).
5. **Status sempre cor + texto + ícone.** `BadgeStatus` nunca comunica só por cor (WCAG §5). Cores são tokens de sistema, propostas como `--color-status-*` no `@theme`, independentes do tema da loja (§8).
6. **TabelaPedidos vira card-list no mobile** (não scroll horizontal, §9), e a ação principal da máquina de estados vira botão visível no card; menu só transições válidas da RN-08.
7. **Loja fechada na vitrine:** banner persistente, permitir montar pedido e (proposta) bloquear só no checkout — marcado como decisão de negócio a confirmar no spec.
8. **Cancelamento com AlertDialog** dizendo o que acontece e que é irreversível; demais avanços de status são diretos (não destrutivos) via DropdownMenu.

## Pendências para a revisão (já sinalizadas no design-system como "proposta")
- Nomes/valores exatos dos tokens `--color-status-*` e dos fallbacks de tema.
- Comportamento de "Adicionar" com loja fechada (montar agora vs. bloquear).
- Aviso de contraste na tela de tema do lojista (fora deste conjunto de mockups).
