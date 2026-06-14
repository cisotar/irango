# [077] Wizard checkout — EtapaEntrega (retirada/entrega, ViaCEP, frete preview)

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** 072, 076
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Criar `EtapaEntrega`: escolha retirada/entrega, formulário de endereço com máscara de CEP, autopreenchimento via ViaCEP e preview de frete via `calcularFreteAction`.

## Escopo
- [ ] Criar `components/vitrine/checkout/EtapaEntrega.tsx`
- [ ] RadioGroup "Retirada" / "Entrega"; se loja sem zonas e sem `taxa_entrega_fora_zona`, exibe só "Retirada" + aviso "Somente retirada disponível" (dado carregado no Server Component da página via `vitrine_lojas`)
- [ ] Retirada → oculta endereço, frete preview = R$ 0,00, avança direto
- [ ] Entrega → formulário (CEP, rua, número, bairro, complemento, cidade, UF)
- [ ] CEP com máscara react-imask; ao completar 8 dígitos chama ViaCEP client-side (`https://viacep.com.br/ws/{cep}/json/`)
- [ ] Autopreenchimento de rua/bairro/cidade/UF; erro inline "CEP não encontrado" se `{erro:true}` ou falha
- [ ] Ao preencher bairro → chama `calcularFreteAction` (072); exibe taxa preview ou "Entrega indisponível para este bairro"
- [ ] Total preview com frete via `calcularTotal` (lib existente)
- [ ] Validação client com zod (campos obrigatórios para entrega); botão "Continuar" só quando válido

## Fora de escopo
- Recálculo autoritativo de frete (071).
- EtapaPagamento e envio (078).
- Reconciliação CEP↔bairro (064).

## Reuso esperado
- `calcularFreteAction` (072), `calcularTotal`/`formatarMoeda` (libs), `schemaPayloadPedido`/`schemaEnderecoEntrega` (069), `useCarrinho`.
- react-imask, react-hook-form + zod, shadcn/ui `RadioGroup`/`Input`/`Button`.

## Segurança
- Frete exibido é PREVIEW — autoritativo é o servidor (071). ViaCEP é API pública sem key (seguranca.md §9).

## Critério de aceite
- [ ] Selecionar Retirada oculta endereço e zera frete preview.
- [ ] CEP válido autopreenche endereço; CEP inválido mostra erro inline.
- [ ] Bairro preenchido dispara frete preview (zona, fora_zona ou indisponível).
- [ ] Loja só-retirada esconde a opção "Entrega".
