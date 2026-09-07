# [157] UF nunca aparece no endereço da mensagem de WhatsApp

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** —
**Origem:** finding BAIXA da auditoria da issue 125 (spec 5). Bug pré-existente do spec 3.

## Problema

`formatarEndereco` em `src/lib/utils/whatsappPedido.ts` lê `e.estado` do JSONB
`endereco_entrega`, mas `schemaEnderecoEntrega` (`src/lib/validacoes/pedido.ts`)
grava o campo como `uf`. O schema é `.strict()`, então `estado` nunca existe no
snapshot — a UF some silenciosamente da linha de endereço.

Confirmado por leitura do código em 2026-09-06:
- `src/lib/validacoes/pedido.ts` — `uf: z.string().length(2).optional()`
- `src/lib/utils/whatsappPedido.ts` — `[str(e.bairro), str(e.cidade), str(e.estado)]`

Sem impacto de segurança. Impacto funcional: o entregador recebe o endereço sem UF.
Afeta tanto o botão manual "Avisar a loja no WhatsApp" (spec 3) quanto o envio
automático (spec 5, issue 126).

## Escopo

- [ ] Ler `uf` em vez de `estado` em `formatarEndereco`.
- [ ] Decidir se aceita ambos (`e.uf ?? e.estado`) por causa de pedidos JÁ GRAVADOS.
      Verificar no banco se algum snapshot antigo tem `estado`; se nenhum tiver,
      ler só `uf` e não carregar compatibilidade morta.
- [ ] Teste cobrindo um `endereco_entrega` com `uf` presente, provando que a UF
      aparece na mensagem.

## Fora de escopo

- Qualquer mudança no restante da composição da mensagem (fixa pelo spec 3, RN-W1).

## Critério de aceite

- [ ] Pedido de entrega com UF preenchida gera mensagem com a UF na linha de endereço.
- [ ] Teste novo falha contra o código atual e passa depois do fix.
