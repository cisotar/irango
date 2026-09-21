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

-- ── [2026-06-21] seed: produtos.oculto (migration 083) ───────────────────────
-- Produto disponível=true e oculto=true: cobre o caso que a policy
-- `produtos_leitura_publica` passou a filtrar por `oculto = false` (antes
-- filtrava só por `disponivel`). Sem esta linha, o `verificar` não teria como
-- distinguir "sumiu da vitrine por indisponível" de "sumiu por oculto" — os
-- outros produtos do seed têm oculto=false (default) e não exercitam o novo
-- predicado. Dono continua vendo este produto no painel via
-- `produtos_leitura_propria` (dono_id = auth.uid()).
-- seed de desenvolvimento, não usar em produção
insert into public.produtos (id, loja_id, categoria_id, nome, descricao, preco, disponivel, ordem, oculto)
values
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000020', 'X-Tudo Oculto Teste',
   'Disponível mas oculto da vitrine. Produto fictício de seed.', 32.90, true, 2, true)
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

-- ── [2026-06-21] seed: billing — pagamentos_assinatura ───────────────────────
-- Cobre as tabelas/colunas adicionadas pelas migrations 070–073 (planos,
-- pagamentos_assinatura, lojas billing expand).
--
-- planos: a migration 20260621090000_planos.sql já faz o seed do "Plano Mensal"
-- inline (WHERE NOT EXISTS) — não duplicamos aqui.
--
-- lojas.billing_provider / provider_subscription_id / plano_id: colunas NULLABLE;
-- o INSERT existente acima continua funcionando sem alteração. Nenhuma coluna
-- nova é NOT NULL, portanto não há risco de falha silenciosa no reset.
--
-- webhook_eventos_billing: deny-all RLS, dados chegam apenas via webhook;
-- não adicionar seed (instrução da issue 071).
--
-- pagamentos_assinatura: 2 registros fictícios para cobrir:
--   - 1 pagamento "pago" (fluxo feliz / TabelaFaturas)
--   - 1 pagamento "falhou" (fluxo de inadimplência)
-- provider_payment_id fixo garante idempotência via UNIQUE (provider, provider_payment_id).
-- seed de desenvolvimento, não usar em produção
insert into public.pagamentos_assinatura (
  id,
  loja_id,
  provider,
  provider_payment_id,
  valor,
  status,
  metodo,
  fatura_url,
  competencia
)
values
  (
    '00000000-0000-4000-8000-000000000090',
    '00000000-0000-4000-8000-000000000010',   -- loja-teste
    'asaas',
    'pay_test_001',                            -- id fictício de pagamento no provider
    49.00,
    'pago',
    'pix',
    'https://exemplo.com.br/fatura/pay_test_001',  -- URL fictícia
    now() - interval '30 days'
  ),
  (
    '00000000-0000-4000-8000-000000000091',
    '00000000-0000-4000-8000-000000000010',   -- loja-teste
    'asaas',
    'pay_test_002',                            -- id fictício de pagamento no provider
    49.00,
    'falhou',
    'boleto',
    'https://exemplo.com.br/fatura/pay_test_002',  -- URL fictícia
    now() - interval '60 days'
  )
on conflict (provider, provider_payment_id) do nothing;

-- ── [2026-09-07] seed: itens_pedido.observacao (migration 20260907120000) ────
-- Até aqui o seed não populava `pedidos`/`itens_pedido` — nenhum dos dois é
-- tocado por policy nova nem por outro delta, então não havia necessidade.
-- A issue 166 adiciona `itens_pedido.observacao` (nullable, CHECK <= 200) e
-- exige cenário próprio: 2 pedidos fictícios cobrindo
--   - maioria dos itens SEM observação (NULL) — caso comum;
--   - observação curta realista ("sem cebola", "ponto da carne mal passada");
--   - observação com quebra de linha (textarea multi-linha, spec v0.2.0);
--   - observação perto do limite de 200 chars (borda do CHECK).
-- Inserido direto (sem passar pela RPC criar_pedido) como superuser/BYPASSRLS,
-- igual ao resto do seed — não exercita a RPC, só o shape de dado da coluna.
-- seed de desenvolvimento, não usar em produção
insert into public.pedidos (
  id, loja_id, nome_cliente, telefone_cliente, endereco_entrega,
  subtotal, desconto, taxa_entrega, total, forma_pagamento,
  status, tipo_entrega, observacoes
)
values
  (
    '00000000-0000-4000-8000-000000000100',
    '00000000-0000-4000-8000-000000000010',   -- loja-teste
    'Cliente Teste 1',
    '+550000000000',                          -- telefone fictício (não real)
    '{"rua":"Rua de Teste","numero":"200","bairro":"Centro","cidade":"Cidade Teste","cep":"00000-000"}',
    66.40, 0, 5.00, 71.40, 'pix', 'pendente', 'entrega', null
  ),
  (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000010',   -- loja-teste
    'Cliente Teste 2',
    '+550000000000',                          -- telefone fictício (não real)
    '{"rua":"Rua de Teste","numero":"201","bairro":"Centro","cidade":"Cidade Teste","cep":"00000-000"}',
    80.30, 0, 5.00, 85.30, 'dinheiro', 'pendente', 'entrega', null
  )
on conflict (id) do nothing;

insert into public.itens_pedido (id, pedido_id, produto_id, nome, preco, quantidade, observacao)
values
  -- pedido 1: caso comum (sem observação) + uma observação curta
  ('00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000030', 'X-Burguer Teste', 25.90, 1, null),
  ('00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000031', 'X-Salada Teste', 28.50, 1, 'sem cebola'),
  ('00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000100',
   '00000000-0000-4000-8000-000000000032', 'Refrigerante Lata Teste', 6.00, 2, null),
  -- pedido 2: observação curta, multi-linha e perto do limite de 200 chars
  ('00000000-0000-4000-8000-000000000113', '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000030', 'X-Burguer Teste', 25.90, 1, 'ponto da carne mal passada'),
  ('00000000-0000-4000-8000-000000000114', '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000031', 'X-Salada Teste', 28.50, 1, E'sem cebola\nmolho à parte'),
  ('00000000-0000-4000-8000-000000000115', '00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000030', 'X-Burguer Teste', 25.90, 1,
   'Por favor, capriche no ponto da carne, sem sal em excesso, embalar os molhos separados para nao amolecer o pao, e se possivel cortar o sanduiche ao meio antes de embalar. Obrigado desde ja mesmo!')
on conflict (id) do nothing;

-- ── [2026-09-21] seed: produto com desconto ativo (onda 1, migration 20260920120000) ─
-- O seed nunca ganhou uma linha com desconto_ativo=true — os produtos existentes
-- (030..033) valem o default (desconto_ativo=false, os quatro campos NULL), que
-- já cobre "produto SEM desconto". Faltava o outro lado do par que o `verificar`
-- precisa observar (plan/loop-implementacao-descontos-promocoes-cardapio-sazonal.md
-- §Forma do loop): "produto com e sem desconto". Percentual VIGENTE agora
-- (desconto_inicio no passado, desconto_fim no futuro) — os CHECKs de
-- 20260920120000 exigem tipo+valor quando ativo=true e 0 < percentual <= 100.
-- seed de desenvolvimento, não usar em produção
insert into public.produtos (
  id, loja_id, categoria_id, nome, descricao, preco, disponivel, ordem,
  desconto_ativo, desconto_tipo, desconto_valor, desconto_inicio, desconto_fim
)
values (
  '00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020', 'X-Duplo Promo Teste',
  'Dois hambúrgueres e queijo em dobro. Produto fictício de seed, com desconto vigente.',
  34.90, true, 3,
  true, 'percentual', 20.00, now() - interval '1 day', now() + interval '30 days'
)
on conflict (id) do nothing;

-- ── [2026-09-21] seed: cardápio sazonal — onda 3 (issues 242/243/244/245/250) ─
-- Cobre os quatro estados que o plano exige para o `verificar` observar
-- (§Forma do loop): produto EM janela e FORA de janela recorrente; cardápio de
-- PRAZO FIXO EXPIRADO com um produto 'cardapio' (some da vitrine) e um 'menu'
-- (segue vendendo) dentro; um cardápio ABERTO AGORA com dois produtos, um deles
-- de categoria que também tem produto fora do cardápio.
--
-- "Some da vitrine" é comportamento da CAMADA DE VIGÊNCIA (vigenciaCardapio.ts,
-- avaliada no servidor com relógio+fuso reais), NÃO da view `vitrine_produtos`:
-- por RN-06 (20260920132000) a view só sabe "existe vínculo com cardápio
-- ATIVO" e não avalia prazo/janela, então o produto 038 abaixo CONTINUA
-- saindo de `public.vitrine_produtos` mesmo com o prazo vencido — é a camada
-- de vigência, lida a partir desses mesmos dados, que o esconde do cliente.
--
-- Um produto `visibilidade = 'cardapio'` PRECISA nascer com pelo menos um
-- vínculo em `cardapio_produtos` NA MESMA TRANSAÇÃO: o trigger
-- `produtos_exclusivo_tem_cardapio` (20260920131000) é DEFERRABLE INITIALLY
-- DEFERRED e só valida no COMMIT — mas cada statement deste arquivo roda em
-- autocommit (não há BEGIN implícito entre eles). Por isso os INSERTs de
-- `produtos` (visibilidade='cardapio') e de `cardapio_produtos` abaixo estão
-- dentro de um BEGIN/COMMIT explícito.
-- seed de desenvolvimento, não usar em produção
begin;

-- cardápios: um sempre aberto, um recorrente fora de janela na quase
-- totalidade do tempo, um de prazo fixo já expirado.
insert into public.cardapios (
  id, loja_id, nome, ativo, ordem, modo,
  dias_semana, hora_inicio, hora_fim,
  prazo_inicio, prazo_fim, prazo_preset
)
values
  -- SEMPRE ABERTO: todos os 7 dias, sem restrição de hora (os dois campos
  -- NULL) — dentroDaJanela=true em qualquer instante, para sempre. É o
  -- cardápio "aberto agora" que o plano pede.
  ('00000000-0000-4000-8000-000000000120', '00000000-0000-4000-8000-000000000010',
   'Cardápio Sempre Aberto Teste', true, 0, 'recorrente',
   array[0,1,2,3,4,5,6]::smallint[], null, null,
   null, null, null),
  -- FORA DE JANELA na quase totalidade do tempo em que alguém roda o
  -- `verificar`: todos os dias, mas só 03:00–04:00 (madrugada). Recorrente NÃO
  -- tem estado "nunca abre" (o CHECK cardapios_recorrente_tem_eixo exige um
  -- eixo, e um eixo recorrente sempre volta a valer, vigenciaCardapio.ts
  -- voltaAAbrir) — este é o equivalente prático, o mesmo desenho que um
  -- "Cardápio de Café da Madrugada" real teria.
  ('00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000010',
   'Cardápio Madrugada Teste', true, 1, 'recorrente',
   array[0,1,2,3,4,5,6]::smallint[], '03:00', '04:00',
   null, null, null),
  -- PRAZO FIXO EXPIRADO: janeiro/2026, antes de qualquer `hoje` real deste
  -- projeto (a onda 3 é de 2026-09). prazo_fixo NUNCA "volta a abrir"
  -- (voltaAAbrir, vigenciaCardapio.ts) — o produto exclusivo vinculado a ele
  -- fica fora da vitrine PARA SEMPRE, exatamente o estado que o `verificar`
  -- precisa observar.
  ('00000000-0000-4000-8000-000000000122', '00000000-0000-4000-8000-000000000010',
   'Cardápio de Verão Expirado Teste', true, 2, 'prazo_fixo',
   null, null, null,
   '2026-01-01 00:00:00+00', '2026-02-01 00:00:00+00', 'customizado')
on conflict (id) do nothing;

-- produtos com visibilidade='cardapio' — cada um ganha o vínculo abaixo antes
-- do COMMIT deste bloco.
insert into public.produtos (
  id, loja_id, categoria_id, nome, descricao, preco, disponivel, ordem, visibilidade
)
values
  -- categoria Lanches: a MESMA categoria de 030/031/033/034, que continuam
  -- 'menu' e fora de qualquer cardápio — cobre "categoria que também tem
  -- produto fora do cardápio".
  ('00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000020', 'Prato do Dia Sempre Teste',
   'Só existe pelo Cardápio Sempre Aberto Teste. Produto fictício de seed.',
   29.90, true, 4, 'cardapio'),
  ('00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000021', 'Suco Especial Sempre Teste',
   'Segundo produto do Cardápio Sempre Aberto Teste. Produto fictício de seed.',
   12.00, true, 1, 'cardapio'),
  ('00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000020', 'Prato da Madrugada Teste',
   'Só existe pelo Cardápio Madrugada Teste (03:00-04:00). Produto fictício de seed.',
   22.00, true, 5, 'cardapio'),
  ('00000000-0000-4000-8000-000000000038', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000020', 'Ceia de Verão Teste',
   'Só existe pelo Cardápio de Verão Expirado Teste — some da vitrine pois o prazo já passou. Produto fictício de seed.',
   45.00, true, 6, 'cardapio')
on conflict (id) do nothing;

-- vínculos produto↔cardápio. O último liga o produto 'menu' 030 (X-Burguer
-- Teste) ao cardápio expirado: como visibilidade='menu' curto-circuita
-- avaliarVigenciaDoProduto (RN-05), ele segue vendendo mesmo com o cardápio
-- vencido — é o par que a issue pede ("um 'menu' que segue vendendo").
insert into public.cardapio_produtos (id, loja_id, cardapio_id, produto_id)
values
  ('00000000-0000-4000-8000-000000000140', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000120', '00000000-0000-4000-8000-000000000035'),
  ('00000000-0000-4000-8000-000000000141', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000120', '00000000-0000-4000-8000-000000000036'),
  ('00000000-0000-4000-8000-000000000142', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000121', '00000000-0000-4000-8000-000000000037'),
  ('00000000-0000-4000-8000-000000000143', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000122', '00000000-0000-4000-8000-000000000038'),
  ('00000000-0000-4000-8000-000000000144', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000122', '00000000-0000-4000-8000-000000000030')
on conflict (id) do nothing;

commit;
