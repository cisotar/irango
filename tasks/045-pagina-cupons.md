# [045] Componente FormCupom + página `/painel/cupons`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 021, 025, 032
**Spec:** specs/spec_irango_mvp.md (Cupons)

## Objetivo
Componente de formulário de cupom e página de gestão (listar, criar, editar, ativar/desativar, remover).

## Escopo
- [ ] Criar `src/components/painel/FormCupom.tsx` (react-hook-form + `schemaCupom` 021)
- [ ] Criar `src/app/(painel)/painel/cupons/page.tsx` (TabelaCupons + dialog do form)
- [ ] Listar via `buscarCuponsDoLojista` (025); CRUD via actions (032)
- [ ] Exibir erro "Este código já existe" quando a action recusar duplicado

## Fora de escopo
Validação no servidor / unicidade (032). `validarCupom` da vitrine (013).

## Reuso esperado
- `schemaCupom` (021), `buscarCuponsDoLojista` (025), actions de cupom (032), shadcn/ui `Table`/`Form`/`Dialog`/`Switch`

## Segurança
- Mutations validadas no servidor; código único no banco (RN-06)

## Critério de aceite
- [ ] Criar/editar/ativar/remover cupom funciona; código duplicado mostra erro; percentual inválido bloqueado
