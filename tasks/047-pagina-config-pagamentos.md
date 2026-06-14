# [047] Página de pagamentos `/painel/configuracoes/pagamentos`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 022, 025, 032
**Spec:** specs/spec_irango_mvp.md (Pagamentos)

## Objetivo
Configuração das formas de pagamento aceitas (Pix, Dinheiro, Link, Cartão) com toggle e campos por tipo.

## Escopo
- [ ] Criar `src/app/(painel)/painel/configuracoes/pagamentos/page.tsx`
- [ ] ListaFormasPagamento com cards por tipo (FormPix, FormDinheiro, FormLink, FormCartao)
- [ ] Carregar via `buscarFormasPagamento` (025); ativar/atualizar/remover via actions (032)
- [ ] Validar chave Pix por tipo no client (telefone `55...`, email) — `schemaFormaPagamento` (022)

## Fora de escopo
Server Actions (032). Exibição na vitrine (035).

## Reuso esperado
- `schemaFormaPagamento` (022), `buscarFormasPagamento` (025), actions (032), shadcn/ui `Card`/`Switch`/`Input`

## Segurança
- Chave Pix nunca é processada — só exibida; validação de formato no servidor (spec Pagamentos)

## Critério de aceite
- [ ] Ativar/desativar cada forma; salvar config por tipo; chave Pix inválida bloqueada
