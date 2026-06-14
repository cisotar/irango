# [023] Queries de `lojas`

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 004, 017
**Spec:** specs/spec_irango_mvp.md

## Objetivo
Funções de query reusáveis para loja — nunca `.from('lojas')` inline. Centralizam o acesso respeitando RLS.

## Escopo
- [ ] Criar `src/lib/supabase/queries/lojas.ts`
- [ ] `buscarLojaPorSlug(slug)` — vitrine pública (SSR)
- [ ] `buscarLojaDoDono(client)` — a loja do lojista autenticado
- [ ] `slugExiste(slug, exceto?: lojaId)` — checagem de unicidade
- [ ] `contarLojasDoDono(donoId)` — para RN-01 (uma loja por dono)

## Fora de escopo
Server Actions que escrevem (030). Apenas leitura aqui.

## Reuso esperado
- `src/lib/supabase/{server,client}.ts` (já existem)
- Tipos de `src/types/supabase.ts` (017)

## Segurança
- `slugExiste` e `contarLojasDoDono` são base das checagens autoritativas de slug único e RN-01

## Critério de aceite
- [ ] (crítica) Teste vermelho (RLS): `buscarLojaPorSlug` de loja inativa retorna null para anon; `slugExiste` detecta slug ocupado por outra loja; `contarLojasDoDono` retorna a contagem correta
