-- Issue 004 — RLS de `public.lojas` (políticas)
--
-- Migration ADITIVA. A tabela `public.lojas` já teve RLS habilitada na 001
-- (`alter table ... enable row level security`), estado deny-all (zero policies).
-- Esta migration só adiciona as 5 `create policy` de seguranca.md §2 —
-- NÃO reabilita RLS e NÃO toca na 001.
--
-- Limites conhecidos da RLS (filtra LINHA, não COLUNA):
--  - `lojas_leitura_publica` libera a LINHA inteira de lojas ativas ao anon. A
--    seleção de colunas públicas (sem `dono_id`/`assinatura_*`/`hotmart_*`/
--    `consentimento_*`) é responsabilidade da query da vitrine (lista explícita
--    de colunas, nunca `select *`).
--  - `lojas_update_proprio` permite ao dono escrever QUALQUER coluna da própria
--    linha, incluindo `assinatura_*`/`hotmart_*`/`consentimento_*`. O gate dessas
--    colunas é na Server Action de perfil (issue 030/015), que escreve apenas a
--    allowlist de colunas. A RLS garante só o isolamento entre lojas (linha).

-- Vitrine pública: qualquer um lê loja ATIVA (isolamento de linha; colunas escopadas na query)
create policy "lojas_leitura_publica"
  on public.lojas for select
  using (ativo = true);

-- Lojista lê a PRÓPRIA loja mesmo inativa
create policy "lojas_leitura_propria"
  on public.lojas for select
  using (auth.uid() = dono_id);

-- Lojista cria a própria loja (não pode forjar dono_id de outro)
create policy "lojas_insert_proprio"
  on public.lojas for insert
  with check (auth.uid() = dono_id);

-- Lojista edita só a própria. WITH CHECK (divergência intencional vs seguranca.md,
-- que só tem USING) impede transferir a loja trocando `dono_id` num UPDATE.
create policy "lojas_update_proprio"
  on public.lojas for update
  using (auth.uid() = dono_id)
  with check (auth.uid() = dono_id);

-- Lojista deleta só a própria
create policy "lojas_delete_proprio"
  on public.lojas for delete
  using (auth.uid() = dono_id);
