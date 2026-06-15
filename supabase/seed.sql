-- ============================================================================
-- seed de desenvolvimento, NÃO usar em produção
-- ============================================================================
-- Roda em `supabase db reset` (após migrations) no banco LOCAL.
-- Executa como postgres (superuser, BYPASSRLS) — por isso o INSERT direto em
-- auth.users e nas tabelas com RLS funciona sem policy permissiva.
--
-- Issue 053. Todos os dados são FICTÍCIOS e marcados como teste:
--   nenhum email/telefone/chave Pix real (seguranca.md §8).
--
-- UUIDs fixos para idempotência e referência cruzada legível.
-- ============================================================================

-- ── user dono fictício ───────────────────────────────────────────────────────
-- seed de desenvolvimento, não usar em produção
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'dono.teste@irango.local',                 -- domínio reservado .local, fictício
  crypt('senha-de-teste-123', gen_salt('bf')),
  now(),
  now(),
  now()
)
on conflict (id) do nothing;

-- ── loja de teste ────────────────────────────────────────────────────────────
-- seed de desenvolvimento, não usar em produção
insert into public.lojas (
  id, dono_id, slug, nome,
  telefone, whatsapp,
  ativo,
  endereco_rua, endereco_numero, endereco_bairro,
  endereco_cidade, endereco_estado, endereco_cep,
  assinatura_status
)
values (
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000001',
  'loja-teste',
  'Loja Teste iRango',
  '+550000000000',                           -- telefone fictício (não real)
  '+550000000000',
  true,
  'Rua de Teste', '100', 'Centro',
  'Cidade Teste', 'SP', '00000-000',
  'trial'
)
on conflict (id) do nothing;

-- ── categorias ───────────────────────────────────────────────────────────────
-- seed de desenvolvimento, não usar em produção
insert into public.categorias (id, loja_id, nome, ordem)
values
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Lanches', 0),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'Bebidas', 1)
on conflict (id) do nothing;

-- ── produtos ─────────────────────────────────────────────────────────────────
-- seed de desenvolvimento, não usar em produção
insert into public.produtos (id, loja_id, categoria_id, nome, descricao, preco, disponivel, ordem)
values
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000020', 'X-Burguer Teste',
   'Pão, hambúrguer, queijo e salada. Produto fictício de seed.', 25.90, true, 0),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000020', 'X-Salada Teste',
   'Versão com mais salada. Produto fictício de seed.', 28.50, true, 1),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000021', 'Refrigerante Lata Teste',
   'Lata 350ml. Produto fictício de seed.', 6.00, true, 0)
on conflict (id) do nothing;

-- ── zona de entrega + bairro + taxa ──────────────────────────────────────────
-- seed de desenvolvimento, não usar em produção
insert into public.zonas_entrega (id, loja_id, nome, tipo, ativo)
values
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010',
   'Centro', 'bairro', true)
on conflict (id) do nothing;

insert into public.bairros_zona (id, zona_id, nome)
values
  ('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000040', 'Centro')
on conflict (id) do nothing;

insert into public.taxas_entrega (id, zona_id, taxa, pedido_minimo_gratis)
values
  ('00000000-0000-4000-8000-000000000060', '00000000-0000-4000-8000-000000000040', 5.00, 50.00)
on conflict (id) do nothing;

-- ── forma de pagamento (pix com chave fictícia) ──────────────────────────────
-- seed de desenvolvimento, não usar em produção
-- Chave Pix aleatória (UUID) FICTÍCIA — não corresponde a nenhuma conta real.
insert into public.formas_pagamento (id, loja_id, tipo, config)
values
  ('00000000-0000-4000-8000-000000000070', '00000000-0000-4000-8000-000000000010',
   'pix',
   '{"tipo_chave":"aleatoria","chave":"00000000-0000-4000-8000-0000000000ff"}')
on conflict (id) do nothing;

-- ── cupom de exemplo ─────────────────────────────────────────────────────────
-- seed de desenvolvimento, não usar em produção
insert into public.cupons (id, loja_id, codigo, tipo, valor, pedido_minimo, usos_maximos, ativo)
values
  ('00000000-0000-4000-8000-000000000080', '00000000-0000-4000-8000-000000000010',
   'TESTE10', 'percentual', 10.00, 0, 100, true)
on conflict (id) do nothing;
