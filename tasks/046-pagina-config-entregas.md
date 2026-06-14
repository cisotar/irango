# [046] Página de entregas `/painel/configuracoes/entregas`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 022, 025, 032
**Spec:** specs/spec_irango_mvp.md (Entregas)

## Objetivo
Gestão de zonas de entrega: criar/editar zona (tipo bairro ou raio_km), taxa, frete grátis, bairros, ativar/desativar e remover.

## Escopo
- [ ] Criar `src/app/(painel)/painel/configuracoes/entregas/page.tsx`
- [ ] ListaZonas + FormZona + FormTaxaEntrega + FormBairros (condicional ao tipo)
- [ ] Carregar via `buscarZonasDoLojista` (025); CRUD via actions de entrega (032)
- [ ] Add/remove bairros inline; toggle ativo

## Fora de escopo
Server Actions (032), cálculo de frete (008).

## Reuso esperado
- `schemaZona`/`schemaTaxa`/`schemaBairros` (022), `buscarZonasDoLojista` (025), actions (032), shadcn/ui `Form`/`Input`/`Switch`

## Segurança
- Mutations escopadas à loja no servidor (RN-02)

## Critério de aceite
- [ ] Criar zona bairro com taxa e bairros; criar zona raio_km com raio; ativar/desativar reflete no cálculo da vitrine
