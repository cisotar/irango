-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 331 — `public.produto_opcionais_ocultos`: ocultar, POR PRODUTO, um grupo
-- de opcionais herdado da categoria do produto.
-- Plano: plan/loop-ocultar-opcionais-por-produto.md (§Desenho, §Risco por fatia F1).
--
-- Tabela de EXCEÇÃO: a existência da linha significa "este grupo está oculto
-- neste produto"; a ausência, "exibe". Regra de leitura (util pura em
-- `src/lib/utils/opcionais-do-produto.ts`):
--   visiveis(produto) = grupos(categoria do produto, na ordem da categoria) − ocultos(produto)
-- Semântica subtrativa: uma linha só consegue esconder, nunca libera nada. Linha
-- órfã (produto trocou de categoria, grupo desassociado) é inerte (D3).
--
-- Alternar é INSERT ou DELETE. NÃO existe UPDATE: sem policy e sem grant.
--
-- ADITIVA E REVERSÍVEL. Tabela nova, nasce vazia. Não toca em policy existente,
-- em `categoria_produto_opcionais` nem na RPC `reordenar_opcionais_da_categoria`.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════ 1) produto_opcionais_ocultos
-- `loja_id` é a coluna que as duas FKs COMPOSTAS amarram (molde de
-- `cardapio_produtos`, 20260920129000): produto e grupo precisam ser da MESMA
-- loja que a linha declara. O vetor cross-tenant da action em lote (pares vindos
-- do cliente) fica impossível por construção — e vale sob `service_role`
-- (BYPASSRLS), que é por onde o hub admin escreve. FK não é RLS.
-- Alvos: `produtos_id_loja_unico` (20260920128000) e `opcionais_categorias
-- unique (id, loja_id)` (20260614007500).
create table public.produto_opcionais_ocultos (
  id                    uuid primary key default gen_random_uuid(),
  loja_id               uuid not null references public.lojas (id) on delete cascade,
  produto_id            uuid not null,
  categoria_opcional_id uuid not null,
  criado_em             timestamptz not null default now(),

  -- Nomes LITERAIS: o teste (F1) afirma o nome da constraint na mensagem do
  -- erro, não só o SQLSTATE `23503`. Renomear quebra o RED de propósito.
  constraint produto_opcionais_ocultos_produto_fk
    foreign key (produto_id, loja_id)
    references public.produtos (id, loja_id) on delete cascade,
  constraint produto_opcionais_ocultos_grupo_fk
    foreign key (categoria_opcional_id, loja_id)
    references public.opcionais_categorias (id, loja_id) on delete cascade,

  -- Alvo do `on conflict do nothing` (upsert com ignoreDuplicates) que torna o
  -- lote idempotente.
  unique (produto_id, categoria_opcional_id)
);

comment on table public.produto_opcionais_ocultos is
  'Excecao por produto (issue 331): linha existe = grupo de opcionais herdado da categoria fica OCULTO neste produto. Sem UPDATE (alternar e INSERT/DELETE). FKs COMPOSTAS com loja_id tornam o par cross-tenant impossivel, inclusive sob service_role. Linha orfa (produto mudou de categoria, grupo desassociado) e inerte.';

-- Consulta quente: ocultos da loja (vitrine e painel) e por produto (pedido).
create index on public.produto_opcionais_ocultos (loja_id, produto_id);

-- ═══════════════════════════════════════════════════════════════════════ 2) RLS
alter table public.produto_opcionais_ocultos enable row level security;

-- Leitura pública: ocultação de PRODUTO PUBLICADO em loja ativa (a vitrine já
-- revela quais grupos cada produto mostra). `loja_esta_ativa()` é security
-- definer — um EXISTS direto em `lojas` sob o anon devolveria zero linhas.
-- O EXISTS em `vitrine_produtos` (view definer, SELECT concedido a anon e
-- authenticated) fecha o achado A2 da auditoria: sem ele, o anon enumerava por
-- `loja_id` os ids de produto oculto, em categoria oculta ou de cardápio inativo
-- — ids que a própria view nega. Mesma classe e mesmo desenho da 20260920133000
-- (`cardapio_produtos`): policy de outra relação não restringe esta. O dono
-- segue lendo tudo pela `prod_opc_ocultos_leitura_propria` (OR).
create policy "prod_opc_ocultos_leitura_publica"
  on public.produto_opcionais_ocultos for select
  using (
    public.loja_esta_ativa(produto_opcionais_ocultos.loja_id)
    and exists (
      select 1
        from public.vitrine_produtos vp
       where vp.id = produto_opcionais_ocultos.produto_id
         and vp.loja_id = produto_opcionais_ocultos.loja_id
    )
  );

-- Dono lê as PRÓPRIAS ocultações (painel), inclusive com a loja inativa — como
-- em `categoria_produto_opcionais` (FOR ALL) e `cardapio_produtos`. OR com a pública.
create policy "prod_opc_ocultos_leitura_propria"
  on public.produto_opcionais_ocultos for select
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = produto_opcionais_ocultos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- Escrita do dono: só INSERT e DELETE (não há FOR ALL, para não abrir UPDATE).
-- O predicado valida só `loja_id`; quem garante produto e grupo da MESMA loja
-- são as FKs compostas acima (valem também sob service_role).
create policy "prod_opc_ocultos_insercao_propria"
  on public.produto_opcionais_ocultos for insert
  with check (
    exists (
      select 1 from public.lojas
      where lojas.id = produto_opcionais_ocultos.loja_id and lojas.dono_id = auth.uid()
    )
  );

create policy "prod_opc_ocultos_remocao_propria"
  on public.produto_opcionais_ocultos for delete
  using (
    exists (
      select 1 from public.lojas
      where lojas.id = produto_opcionais_ocultos.loja_id and lojas.dono_id = auth.uid()
    )
  );

-- ════════════════════════════════════════════════════════════════════ 3) GRANTs
-- Obrigatório: a 20260702150000 reduziu os DEFAULT PRIVILEGES de
-- `anon`/`authenticated` a SELECT-only. `authenticated` SEM update, de
-- propósito: negar a OPERAÇÃO é mais forte do que não ter policy.
grant select on public.produto_opcionais_ocultos to anon;
grant select, insert, delete on public.produto_opcionais_ocultos to authenticated;
grant all    on public.produto_opcionais_ocultos to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: TOTAL enquanto nenhum lojista tiver ocultado grupo no cloud.
-- Depois disso, o `drop table` PERDE as escolhas do lojista (dump antes).
--
--   drop table if exists public.produto_opcionais_ocultos;  -- leva policies, índice e grants
-- ─────────────────────────────────────────────────────────────────────────────
