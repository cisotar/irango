# [196] Sidebar recolhível no painel

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 194 (redesenho da sidebar)
**Origem:** atrito F11 de `mockups/sidebar-painel.md`, marcado "opcional / fase 2"
no próprio mockup, adiado da issue 194.

## Problema

`NavPainel.tsx` usa `w-60` fixo no desktop. Entre 1024px e 1280px isso disputa
largura com telas que precisam de espaço para tabela densa (`TabelaPedidos`,
`TabelaProdutos`).

## Escopo

- [ ] Modo recolhido `w-16`: ícone com `aria-label` obrigatório por item.
- [ ] Grupo com subitens (Configurações) vira flyout de `ui/menu.tsx` no modo
      recolhido — não some, não empilha sanfona fechada sem acesso.
- [ ] Preferência persistida em `localStorage`, só desktop.
- [ ] O Sheet mobile **nunca** recolhe — este escopo é só `SidebarPainel`
      (`lg:flex`), não `TopbarPainel`.

## Critério de aceite

- [ ] Alternância recolhido/expandido sem perda de navegação (todo item
      continua alcançável, incluindo os 6 subitens de Configurações).
- [ ] Preferência sobrevive a reload.
- [ ] `focus-visible` e alvo de 44px+ mantidos no modo recolhido.
