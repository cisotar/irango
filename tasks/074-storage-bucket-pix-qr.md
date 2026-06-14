# [074] Storage bucket `pix-qr` + policies

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Criar o bucket `pix-qr` no Supabase Storage (leitura pública) com escrita restrita à pasta `{loja_id}/` do lojista dono — para QR Code estático do Pix.

## Escopo
- [ ] Criar `supabase/migrations/20260614XXXXXX_storage_pix_qr.sql`
- [ ] Criar bucket `pix-qr` (público para leitura)
- [ ] Policy `storage_pix_qr_leitura_publica` (SELECT) — `bucket_id = 'pix-qr'`
- [ ] Policy `storage_pix_qr_escrita_propria` (INSERT/UPDATE/DELETE) — `bucket_id='pix-qr' AND (storage.foldername(name))[1] IN (SELECT id::text FROM lojas WHERE dono_id = auth.uid())`

## Fora de escopo
- Upload na UI do painel (issue 075).
- Geração dinâmica de QR (fora do escopo v1).

## Reuso esperado
- Padrão idêntico ao bucket `produtos` (issue 003 / seguranca.md §18) — DDL das policies.

## Segurança
- Sem `storage_pix_qr_escrita_propria`, lojista A sobrescreve QR Pix de outra loja → vazamento/fraude de pagamento. Path sempre `{loja_id}/qr.png` — isolamento por pasta.
- Leitura pública é intencional (vitrine exibe o QR).

## Critério de aceite
- [ ] Bucket `pix-qr` existe e é público para leitura.
- [ ] (crítica) Teste vermelho: lojista A NÃO consegue escrever em `{loja_id_B}/qr.png`; lojista escreve na própria pasta; leitura pública de qualquer objeto funciona.
