# [027] Hooks `useCarrinho` e `useLojaAberta`

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 011, 017
**Spec:** specs/spec_irango_mvp.md (Vitrine)

## Objetivo
Hooks de client para estado do carrinho (com persistência em `sessionStorage`) e status de abertura da loja.

## Escopo
- [ ] Criar `src/hooks/useCarrinho.ts`: adicionar, incrementar/decrementar, remover (ao zerar), limpar; persistir em `sessionStorage`; subtotal de PREVIEW
- [ ] Criar `src/hooks/useLojaAberta.ts`: usa `lojaAberta` (011) com hora do cliente; atualiza periodicamente
- [ ] Tipos de item de carrinho de `src/types/dominio.ts` (017)

## Fora de escopo
Recálculo autoritativo (014 — servidor). Componentes visuais (028, 029).

## Reuso esperado
- `lojaAberta` (011), tipos (017)

## Segurança
- Carrinho é só estado de UX no client; o valor real é recalculado no servidor (seguranca.md §10)

## Critério de aceite
- [ ] `useCarrinho` persiste em `sessionStorage` e sobrevive a refresh
- [ ] `useLojaAberta` reflete aberta/fechada corretamente
