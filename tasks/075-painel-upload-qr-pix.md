# [075] UI painel — upload de QR Pix em `/painel/configuracoes/pagamentos`

**crítica:** NÃO
**Mundo:** painel
**Depende de:** 074
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Estender a tela de pagamentos do painel para o lojista enviar a imagem do QR Code Pix e persistir a URL em `formas_pagamento.config.pix_qr_url`.

## Escopo
- [ ] Estender `FormPix` em `/painel/configuracoes/pagamentos` com upload de imagem (input file)
- [ ] Upload para bucket `pix-qr` na pasta `{loja_id}/qr.png`
- [ ] Persistir URL pública resultante em `formas_pagamento.config.pix_qr_url` (merge no jsonb, preserva `chave`/`tipo_chave`)
- [ ] Validar na Server Action do painel que a URL é do Storage do iRango (`https://<supabase-url>/storage/...`) — rejeita URL externa
- [ ] Preview da imagem enviada; permitir substituir

## Fora de escopo
- Criação do bucket/policies (074).
- Exibição do QR na vitrine (issue 078).

## Reuso esperado
- Padrão de upload da issue 018 (foto de produto) — reusar fluxo de upload e geração de URL pública.
- `schemaFormaPagamento` (lib/validacoes/pagamento.ts), `buscarFormasPagamento`, actions de pagamento existentes.
- shadcn/ui `Card`/`Input`/`Button`, `next/image`.

## Segurança
- Validação de que a URL persistida pertence ao Storage do iRango impede injeção de URL externa arbitrária no jsonb.
- Escrita no bucket é isolada por pasta via RLS (074); o painel só envia para a própria loja.
- A `pix_qr_url` não é secret, mas a chave Pix em `config.chave` continua exposta só via `pagamentos_leitura_publica`.

## Critério de aceite
- [ ] Lojista envia QR; URL persistida em `config.pix_qr_url` e aponta para o bucket `pix-qr`.
- [ ] URL externa (não-Storage) é rejeitada pela action.
- [ ] Substituir o QR atualiza a URL.
