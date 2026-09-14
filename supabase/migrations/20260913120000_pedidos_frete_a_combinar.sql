-- ─────────────────────────────────────────────────────────────────────────────
-- Issue 180-B — frete "a combinar" quando o geocoding do CEP do cliente falha.
-- Plano: plan/180-B-geocoding-cep-frete-errado.md §Contratos de Dados.
--
-- FASE EXPAND (esta migration). O contract — `validate constraint` + `drop` do
-- overload de 16 args da RPC — fica para issue própria, DEPOIS do código em
-- produção. Nada aqui é destrutivo.
--
-- Motivação (D6): quando a distância era NECESSÁRIA e não pôde ser conhecida,
-- o servidor não pode inventar preço. Hoje ele cai no `taxa_entrega_fora_zona`
-- (regra sobre o ENDEREÇO) por causa de uma falha de INFRAESTRUTURA nossa, e
-- cobra errado. O pedido passa a ser gravado com o frete indefinido:
--   `taxa_entrega IS NULL` + `frete_a_combinar = true`.
--
-- Por que DUAS marcações e não só o NULL: `NULL` sozinho é ambíguo (não separa
-- "a combinar" de dado legado/faltante) e `taxa_entrega = 0` é frete GRÁTIS
-- legítimo — inferir "a combinar" de zero seria mentir no recibo. O booleano
-- declara a INTENÇÃO; o regen de `src/lib/database.types.ts` (`number | null`)
-- quebra no type-check todo consumidor que esquecer o 3º estado, em vez de
-- exibir R$ 0,00 silencioso.
--
-- Tabela POPULADA em produção. Os três passos são compatíveis com o código
-- ANTIGO, que continua rodando durante toda a janela de deploy:
--   (1) ADD COLUMN com DEFAULT false — nenhuma linha existente muda de
--       semântica (todo pedido histórico tem frete conhecido); no Postgres >= 11
--       o default não reescreve a tabela.
--   (2) DROP NOT NULL só AFROUXA: nenhuma escrita existente passa a falhar, e o
--       código antigo nunca escreve NULL em `taxa_entrega`.
--   (3) CHECK NOT VALID: passa a valer para toda escrita NOVA sem varrer a
--       tabela e sem poder abortar o deploy por uma linha inesperada. A
--       validação retroativa é o passo de contract.
-- Nenhum BACKFILL é necessário — o DEFAULT já cobre 100% das linhas. A
-- verificação está no bloco de VALIDAÇÃO no fim deste arquivo.
--
-- RLS: NENHUMA policy nova, e nenhuma alterada. As duas policies de `pedidos`
--   (`pedidos_insert_publico` WITH CHECK `loja_esta_ativa(loja_id)`;
--   `pedidos_acesso_lojista` FOR ALL por `lojas.dono_id = auth.uid()`) são por
--   LINHA, não por coluna: a coluna nova é coberta automaticamente pelas duas.
--   Continua não existindo policy de SELECT para `anon` (deny-all por design) —
--   a leitura do comprador segue por `id + token_acesso` sob `service_role`.
--   A coluna nova NÃO amplia superfície: é um booleano, não um valor, e o CHECK
--   abaixo ESTREITA o que qualquer escritor pode gravar.
--   Residual PRÉ-EXISTENTE e fora do escopo desta issue: `anon` tem INSERT em
--   `pedidos` (policy + grants amplos de 20260614008500), então quem falar
--   direto com o PostgREST já podia forjar `total`. `frete_a_combinar` não
--   piora isso; revogar esse INSERT é issue separada para o `auditar`.
--
-- Rollback: bloco comentado no fim.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── (1) coluna nova, default seguro ──────────────────────────────────────────
alter table public.pedidos
  add column if not exists frete_a_combinar boolean not null default false;

comment on column public.pedidos.frete_a_combinar is
  'true = o frete NAO pode ser calculado (geocoding do CEP indisponivel) e sera combinado com a loja. Implica taxa_entrega IS NULL. NUNCA inferir "a combinar" de taxa_entrega = 0 (isso e frete gratis legitimo). Agregado de receita deve usar coalesce(taxa_entrega, 0); a ETIQUETA vem sempre desta coluna.';

-- ── (2) afrouxa o NOT NULL de taxa_entrega ───────────────────────────────────
-- O DEFAULT 0 da coluna é MANTIDO de propósito: um INSERT que omita
-- `taxa_entrega` continua gravando 0, e se vier com `frete_a_combinar = true`
-- o CHECK abaixo o rejeita — fail-closed, sem NULL órfão acidental.
alter table public.pedidos
  alter column taxa_entrega drop not null;

comment on column public.pedidos.taxa_entrega is
  'Taxa de entrega cobrada, recalculada no servidor. NULL <=> frete_a_combinar = true (frete indefinido, a combinar com a loja). 0 = frete GRATIS legitimo — jamais confundir os dois.';

-- ── (3) CHECK amarrando o par (NOT VALID: só escrita nova) ───────────────────
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chk_pedidos_frete_a_combinar'
       and conrelid = 'public.pedidos'::regclass
  ) then
    alter table public.pedidos
      add constraint chk_pedidos_frete_a_combinar
      check (
        (frete_a_combinar and taxa_entrega is null)
        or (not frete_a_combinar and taxa_entrega is not null)
      ) not valid;
  end if;
end $$;

-- ── VALIDAÇÃO (não é backfill — é conferência; esperado: 0) ──────────────────
do $$
declare v_invalidas bigint;
begin
  select count(*) into v_invalidas
    from public.pedidos
   where (frete_a_combinar and taxa_entrega is not null)
      or (not frete_a_combinar and taxa_entrega is null);
  if v_invalidas > 0 then
    raise warning 'pedidos fora do invariante frete_a_combinar/taxa_entrega: %', v_invalidas;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, fora da migration — nunca automático)
--
-- Janela segura: ATÉ o primeiro pedido gravado com `frete_a_combinar = true` em
--   produção. Antes disso a reversão é SEM PERDA (toda linha é false/valor).
--   Depois, `drop column` apaga a informação de que aquele frete estava em
--   aberto — e o `set not null` falharia nas linhas com taxa NULL.
--
-- Ordem obrigatória: PRIMEIRO reverter a RPC de 17 args (ver
-- 20260913121000_rpc_criar_pedido_frete_a_combinar.sql), senão ela referencia
-- coluna inexistente e todo pedido novo falha. Depois:
--
--   alter table public.pedidos drop constraint if exists chk_pedidos_frete_a_combinar;
--   -- só se NAO houver linha com taxa_entrega IS NULL:
--   alter table public.pedidos alter column taxa_entrega set not null;
--   alter table public.pedidos drop column if exists frete_a_combinar;
--
-- Rollback PARCIAL preferido (zero perda, zero risco): dropar apenas o CHECK.
--   A coluna fica inerte com default false e nenhum leitor quebra.
-- ─────────────────────────────────────────────────────────────────────────────
