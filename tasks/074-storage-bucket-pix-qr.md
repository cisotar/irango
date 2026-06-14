# [074] Storage bucket `pix-qr` + policies

**crítica:** SIM (TDD red-first)
**Mundo:** infra
**Depende de:** —
**Spec:** specs/spec_checkout_pagamento.md

## Objetivo
Criar o bucket `pix-qr` no Supabase Storage (leitura pública) com escrita restrita à pasta `{loja_id}/` do lojista dono — para QR Code estático do Pix.

## Escopo
- [x] Criar `supabase/migrations/20260614006500_storage_pix_qr.sql`
- [x] Criar bucket `pix-qr` (público para leitura)
- [x] Policy `storage_pix_qr_leitura_publica` (SELECT) — `bucket_id = 'pix-qr'`
- [x] Policy `storage_pix_qr_insert_propria` / `storage_pix_qr_update_propria` / `storage_pix_qr_delete_propria` (INSERT/UPDATE/DELETE) — `bucket_id='pix-qr' AND (storage.foldername(name))[1] IN (SELECT id::text FROM lojas WHERE dono_id = auth.uid())`

## Fora de escopo
- Upload na UI do painel (issue 075).
- Geração dinâmica de QR (fora do escopo v1).

## Reuso esperado
- Padrão idêntico ao bucket `produtos` (issue 003 / seguranca.md §18) — DDL das policies.

## Segurança
- Sem `storage_pix_qr_escrita_propria`, lojista A sobrescreve QR Pix de outra loja → vazamento/fraude de pagamento. Path sempre `{loja_id}/qr.png` — isolamento por pasta.
- Leitura pública é intencional (vitrine exibe o QR).

## Critério de aceite
- [x] Bucket `pix-qr` existe e é público para leitura (SQL em _sync_cloud_pendente.sql).
- [x] (crítica) Teste proxy pglite: lojista A NÃO consegue escrever em `{loja_id_B}/qr.png` (subquery de isolamento confirmada — 7 testes em tests/migrations/storage_pix_qr.test.ts). Validação real em cloud via _sync_cloud_pendente.sql bloco 074.

## Decisão de arquitetura (pglite x storage)
Abordagem escolhida: **guard SQL** (`DO $$ BEGIN IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF; ... END $$`).
- A migration versionada existe em `supabase/migrations/` e aplica no Supabase cloud/local.
- Em pglite (harness de testes), a ausência de `storage.objects` dispara NOTICE e pula — sem EXCEPTION.
- Os testes pglite validam a **lógica de isolamento** (subquery `WHERE dono_id = auth.uid()`), não a policy em si.
- O SQL raw (sem guard) está em `_sync_cloud_pendente.sql` para aplicação manual no cloud.
