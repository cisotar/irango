# [030] Server Actions de configuração da loja (perfil, horários, tema)

**crítica:** SIM (TDD red-first)
**Mundo:** painel
**Depende de:** 019, 023
**Spec:** specs/spec_irango_mvp.md (Perfil, Horários, Tema, RN-07, RN-09)

## Objetivo
Server Actions de UPDATE da loja para perfil/slug, horários e tema, com validação zod no servidor e checagem de slug único.

## Escopo
- [ ] Criar `src/lib/actions/loja.ts` (`'use server'`)
- [ ] `salvarPerfil(dados)`: valida `schemaPerfil` (019); checa slug único via `slugExiste` (023) exceto a própria loja → erro "Este endereço já está em uso"; UPDATE em `lojas`
- [ ] `salvarHorarios(horarios)`: valida `schemaHorarios`; UPDATE `lojas.horarios`
- [ ] `salvarTema(tema)`: valida `schemaTema` (hex); UPDATE `lojas.tema`
- [ ] Sempre escopado à loja do `auth.uid()` (RLS `lojas_update_proprio`)
- [ ] `revalidatePath` da vitrine após salvar

## Fora de escopo
UI dos forms (040, 041, 042). Validações de formato (019).

## Reuso esperado
- `schemaPerfil`/`schemaHorarios`/`schemaTema` (019), `slugExiste`/`buscarLojaDoDono` (023)

## Segurança
- Slug validado por regex + unicidade no servidor (RN-07); UNIQUE no banco como rede final
- Horários validados no servidor (RN-09); tema hex evita injeção CSS (spec Tema)

## Critério de aceite
- [ ] (crítica) Teste vermelho: slug já usado por outra loja → erro; slug inválido `Ab C` → rejeitado; horário `abre >= fecha` em dia ativo → rejeitado; tema com cor não-hex → rejeitado
