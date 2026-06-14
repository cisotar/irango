# [041] Página de horários `/painel/configuracoes/horarios`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 011, 019, 023, 030
**Spec:** specs/spec_irango_mvp.md (Horários, RN-09)

## Objetivo
Grade de 7 dias com toggle ativo e horas abre/fecha, com preview de "Aberta agora".

## Escopo
- [ ] Criar `src/app/(painel)/painel/configuracoes/horarios/page.tsx`
- [ ] GradeHorarios + ItemDia (shadcn `Switch` + `Input` time) para seg–dom
- [ ] Carregar via `buscarLojaDoDono` (023); salvar via `salvarHorarios` (030)
- [ ] Preview de status com `lojaAberta` (011)

## Fora de escopo
Validação no servidor (030). Bloqueio de pedido (014).

## Reuso esperado
- `schemaHorarios` (019), `salvarHorarios` (030), `lojaAberta` (011), shadcn/ui `Switch`/`Input`

## Segurança
- Validação `abre < fecha` no servidor (RN-09)

## Critério de aceite
- [ ] Salvar persiste horários; dia desativado marca loja fechada; preview reflete config
