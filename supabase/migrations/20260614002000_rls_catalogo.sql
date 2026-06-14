-- Issue 005 — RLS de catálogo, entrega e pagamento (políticas)
--
-- Migration ADITIVA. As tabelas `produtos`, `categorias`, `zonas_entrega`,
-- `taxas_entrega`, `bairros_zona`, `formas_pagamento` já tiveram RLS habilitada
-- na 001 (`alter table ... enable row level security`), estado deny-all (zero
-- policies). Esta migration só adiciona as 13 `create policy` de seguranca.md §2
-- — NÃO reabilita RLS e NÃO toca na 001, na 004 (rls_lojas) nem na view (001500).
--
-- Decisões (ver plano da issue 005):
--  - Leitura pública é DIRETA na tabela base (nenhuma das 6 tem coluna sensível;
--    `formas_pagamento.config` guarda a chave Pix que é pública por design). Sem view.
--  - O filtro de loja ativa é aplicado NA POLICY via EXISTS contra `lojas` — o banco
--    é a última linha de defesa: produto/categoria de loja inativa não vaza nem se a
--    query da vitrine esquecer o join.
--  - `taxas_entrega`/`bairros_zona` não têm flag própria nem `loja_id`: visibilidade e
--    propriedade resolvem via zona (`zona.ativo` para leitura; `zona → loja → dono_id`
--    para escrita).
--  - Toda *_escrita_propria usa FOR ALL com USING (gate de UPDATE/DELETE na linha
--    existente) E WITH CHECK (gate de INSERT/UPDATE na linha resultante) — o WITH CHECK
--    impede INSERT forjando `loja_id` de outro dono.
--
-- Conflito resolvido (seguranca.md §2 vs. correção de auditoria 001500):
--   §2 prescreve, para a leitura pública de produtos/categorias,
--   `EXISTS (SELECT 1 FROM lojas WHERE lojas.id = X.loja_id AND lojas.ativo = true)`.
--   Esse DDL assumia a policy `lojas_leitura_publica USING (ativo = true)`, que a
--   migration 001500 DROPOU (a vitrine de lojas virou a view `vitrine_lojas`). Sem
--   SELECT público na base `lojas`, o EXISTS rodando sob a RLS do anon retorna ZERO
--   linhas e o catálogo público fica invisível (quebra o contrato dos testes [1]/[12]).
--   Fix mínimo e localizado: a função `security definer` `public.loja_esta_ativa`
--   responde "a loja está ativa?" sem expor a LINHA de `lojas` (não vaza dono_id/
--   assinatura_*/hotmart_*). Mantém o filtro de loja ativa enforçado no BANCO (§1,
--   última linha de defesa) sem reabrir SELECT público da base. As policies de
--   escrita/leitura própria continuam idênticas a §2 — só dependem de
--   `lojas_leitura_propria`, que a 001500 deixou intacta.

-- Helper SECURITY DEFINER: a loja está ativa? Não expõe a linha de `lojas`.
-- STABLE: resultado não muda dentro da mesma instrução; permite cache do planner.
create function public.loja_esta_ativa(p_loja_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.lojas
    where lojas.id = p_loja_id and lojas.ativo = true
  );
$$;

revoke all on function public.loja_esta_ativa(uuid) from public;
grant execute on function public.loja_esta_ativa(uuid) to anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════ produtos
-- Vitrine: público lê produto DISPONÍVEL de loja ATIVA
create policy "produtos_leitura_publica"
  on public.produtos for select
  using (
    disponivel = true
    and public.loja_esta_ativa(produtos.loja_id)
  );

-- Dono lê os PRÓPRIOS produtos (inclusive indisponíveis). Combinada por OR com a pública.
create policy "produtos_leitura_propria"
  on public.produtos for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = produtos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- Dono faz CRUD só nos próprios produtos (WITH CHECK barra loja_id alheio)
create policy "produtos_escrita_propria"
  on public.produtos for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = produtos.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = produtos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════ categorias
-- Pública se a loja estiver ativa (categoria não tem flag própria — herda do pai)
create policy "categorias_leitura_publica"
  on public.categorias for select
  using (public.loja_esta_ativa(categorias.loja_id));

create policy "categorias_escrita_propria"
  on public.categorias for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = categorias.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = categorias.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ═════════════════════════════════════════════════════════════ zonas_entrega
-- Pública se ATIVA
create policy "zonas_leitura_publica"
  on public.zonas_entrega for select
  using (ativo = true);

create policy "zonas_escrita_propria"
  on public.zonas_entrega for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = zonas_entrega.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = zonas_entrega.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ═════════════════════════════════════════════════════════════ taxas_entrega
-- Visibilidade e propriedade via zona (sem flag/loja_id próprios)
create policy "taxas_leitura_publica"
  on public.taxas_entrega for select
  using (
    exists (
      select 1 from public.zonas_entrega z
      where z.id = taxas_entrega.zona_id and z.ativo = true
    )
  );

create policy "taxas_escrita_propria"
  on public.taxas_entrega for all
  using (
    exists (
      select 1 from public.zonas_entrega z
      join public.lojas l on l.id = z.loja_id
      where z.id = taxas_entrega.zona_id and l.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.zonas_entrega z
      join public.lojas l on l.id = z.loja_id
      where z.id = taxas_entrega.zona_id and l.dono_id = auth.uid()
    )
  );

-- ══════════════════════════════════════════════════════════════ bairros_zona
-- Visibilidade e propriedade via zona (idem taxas)
create policy "bairros_leitura_publica"
  on public.bairros_zona for select
  using (
    exists (
      select 1 from public.zonas_entrega z
      where z.id = bairros_zona.zona_id and z.ativo = true
    )
  );

create policy "bairros_escrita_propria"
  on public.bairros_zona for all
  using (
    exists (
      select 1 from public.zonas_entrega z
      join public.lojas l on l.id = z.loja_id
      where z.id = bairros_zona.zona_id and l.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.zonas_entrega z
      join public.lojas l on l.id = z.loja_id
      where z.id = bairros_zona.zona_id and l.dono_id = auth.uid()
    )
  );

-- ═══════════════════════════════════════════════════════════ formas_pagamento
-- Cliente precisa ver as formas para escolher; config (chave Pix) é pública por design.
-- Divergência deliberada vs seguranca.md §2 (que prescrevia USING(true)): filtra por
-- loja ativa como as demais tabelas. Sem isso, forma de pagamento + jsonb config de
-- loja INATIVA vazaria ao anon (finding MÉDIA da auditoria 005).
create policy "pagamentos_leitura_publica"
  on public.formas_pagamento for select
  using (public.loja_esta_ativa(formas_pagamento.loja_id));

create policy "pagamentos_escrita_propria"
  on public.formas_pagamento for all
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = formas_pagamento.loja_id and lojas.dono_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = formas_pagamento.loja_id and lojas.dono_id = auth.uid()
    )
  );
