# [019] Validação zod `loja` (perfil, slug, horários, tema)

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** 017
**Spec:** specs/spec_irango_mvp.md (RN-07)

## Objetivo
Schemas zod reusados no form (client) e nas Server Actions (servidor) para perfil, slug, horários e tema da loja.

## Escopo
- [ ] Criar `src/lib/validacoes/loja.ts`
- [ ] `schemaPerfil`: nome 1+, slug regex `^[a-z0-9-]{3,60}$`, telefone/whatsapp opcionais (whatsapp formato `55\d{10,11}`)
- [ ] `schemaHorarios`: cada dia `{ abre, fecha, ativo }`, `HH:MM` válido, e se `ativo` então `abre < fecha`
- [ ] `schemaTema`: três cores hex `^#[0-9a-fA-F]{6}$`
- [ ] Helper `sanitizarSlug(nome): string` (sugestão UX a partir do nome)

## Fora de escopo
Checagem de unicidade do slug (é query + Server Action — 022/030). Validação só de formato aqui.

## Reuso esperado
- `zod` (já instalado)
- Mesmo schema no `FormPerfil`/`FormHorarios`/`FormTema` e nas actions

## Segurança
- Slug validado no servidor por regex (seguranca.md §6); tema hex evita CSS malicioso (spec Tema)

## Critério de aceite
- [ ] (crítica) Teste vermelho: slug `Burger Do Zé` rejeitado, `burger-do-ze` aceito; horário `ativo` com `abre >= fecha` rejeitado; cor `red` rejeitada, `#e63946` aceita
