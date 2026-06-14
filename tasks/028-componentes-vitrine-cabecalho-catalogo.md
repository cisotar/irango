# [028] Componentes de vitrine: HeaderLoja, BadgeStatus, CardProduto

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 007, 027
**Spec:** specs/spec_irango_mvp.md (Vitrine)

## Objetivo
Componentes de apresentação do topo e do catálogo da vitrine, aplicando o tema da loja via CSS custom properties.

## Escopo
- [ ] Criar `src/components/vitrine/HeaderLoja.tsx` (nome, logo, BadgeStatus; consome tema via CSS custom properties)
- [ ] Criar `src/components/vitrine/BadgeStatus.tsx` ("Aberto agora"/"Fechado" + reabertura; usa `useLojaAberta` 027)
- [ ] Criar `src/components/vitrine/CardProduto.tsx` (foto, nome, descrição, preço via `formatarMoeda`, botão "Adicionar")
- [ ] Validar `foto_url` protocolo `https:` antes de renderizar (seguranca.md §15)

## Fora de escopo
Carrinho (029), página da vitrine (035). Lógica de horário (011).

## Reuso esperado
- `formatarMoeda` (007), `useLojaAberta` (027), `references/design-system.md`, mockups em `design-claude/vitrine/`, shadcn/ui `Badge`/`Card`/`Button`

## Segurança
- React escapa texto por padrão; `foto_url` só `https:` (anti-XSS, seguranca.md §15)

## Critério de aceite
- [ ] Componentes renderizam com props mockadas
- [ ] Tema aplicado via CSS custom properties; preço formatado em BRL
