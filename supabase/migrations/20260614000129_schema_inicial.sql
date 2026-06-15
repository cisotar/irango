  -- Migration: schema inicial do iRango (issue 001)
  -- Fonte autoritativa: references/schema.md §2 + deltas (Hotmart/LGPD/Timezone)
  -- Sem indexes (002), sem policies RLS permissivas (004-006), sem storage (003).
  -- Restrição pglite/cloud: apenas gen_random_uuid() (core). Sem create extension.
  -- Todo valor monetário é numeric(10,2) — nunca float.

  -- ─────────────────────────────────────────────────────────── lojas (raiz)
  create table public.lojas (
    id               uuid primary key default gen_random_uuid(),
    dono_id          uuid not null references auth.users(id) on delete cascade,
    slug             text unique not null check (slug ~ '^[a-z0-9-]+$'),
    nome             text not null,
    telefone         text,
    whatsapp         text,
    ativo            boolean not null default true,

    -- Endereço
    endereco_rua     text,
    endereco_numero  text,
    endereco_bairro  text,
    endereco_cidade  text,
    endereco_estado  text,
    endereco_cep     text,

    -- Tema visual (cores da vitrine)
    tema             jsonb not null default '{"primaria":"#e63946","fundo":"#ffffff","destaque":"#f1a208"}',

    -- Horários de funcionamento por dia da semana
    horarios         jsonb not null default '{
      "seg": {"abre":"08:00","fecha":"22:00","ativo":true},
      "ter": {"abre":"08:00","fecha":"22:00","ativo":true},
      "qua": {"abre":"08:00","fecha":"22:00","ativo":true},
      "qui": {"abre":"08:00","fecha":"22:00","ativo":true},
      "sex": {"abre":"08:00","fecha":"22:00","ativo":true},
      "sab": {"abre":"09:00","fecha":"20:00","ativo":true},
      "dom": {"abre":"00:00","fecha":"00:00","ativo":false}
    }',

    -- DELTA Timezone — fuso por loja (usado por lojaAberta, issue 011)
    timezone         text not null default 'America/Sao_Paulo',

    -- DELTA LGPD — consentimento gravado no cadastro (issue 015), nullable até o aceite
    consentimento_em       timestamptz,
    consentimento_versao   text,

    -- DELTA Hotmart — assinatura / integração
    assinatura_status        text not null default 'trial'
                            check (assinatura_status in ('trial','ativa','inadimplente','cancelada','suspensa')),
    hotmart_subscriber_code  text,
    hotmart_plano            text,
    assinatura_inicio        timestamptz,
    assinatura_fim_periodo   timestamptz,
    assinatura_atualizada_em timestamptz,

    criado_em        timestamptz not null default now(),
    atualizado_em    timestamptz not null default now()
  );

  -- ─────────────────────────────────────────────────────────── categorias
  create table public.categorias (
    id        uuid primary key default gen_random_uuid(),
    loja_id   uuid not null references public.lojas(id) on delete cascade,
    nome      text not null,
    ordem     int not null default 0,
    criado_em timestamptz not null default now()
  );

  -- ─────────────────────────────────────────────────────────── produtos
  create table public.produtos (
    id            uuid primary key default gen_random_uuid(),
    loja_id       uuid not null references public.lojas(id) on delete cascade,
    categoria_id  uuid references public.categorias(id) on delete set null,
    nome          text not null,
    descricao     text,
    preco         numeric(10,2) not null check (preco >= 0),
    disponivel    boolean not null default true,
    ordem         int not null default 0,
    foto_url      text,
    criado_em     timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
  );

  -- ─────────────────────────────────────────────────────────── cupons
  create table public.cupons (
    id            uuid primary key default gen_random_uuid(),
    loja_id       uuid not null references public.lojas(id) on delete cascade,
    codigo        text not null,
    tipo          text not null check (tipo in ('percentual', 'fixo')),
    valor         numeric(10,2) not null check (valor > 0),
    pedido_minimo numeric(10,2) not null default 0,
    usos_maximos  int,
    usos_contagem int not null default 0,
    expira_em     timestamptz,
    ativo         boolean not null default true,
    criado_em     timestamptz not null default now(),
    unique (loja_id, codigo)
  );

  -- ─────────────────────────────────────────────────────────── zonas_entrega
  create table public.zonas_entrega (
    id      uuid primary key default gen_random_uuid(),
    loja_id uuid not null references public.lojas(id) on delete cascade,
    nome    text not null,
    tipo    text not null check (tipo in ('bairro', 'raio_km', 'faixa_cep')),
    ativo   boolean not null default true
  );

  -- ─────────────────────────────────────────────────────────── taxas_entrega
  create table public.taxas_entrega (
    id                   uuid primary key default gen_random_uuid(),
    zona_id              uuid not null references public.zonas_entrega(id) on delete cascade,
    taxa                 numeric(10,2) not null check (taxa >= 0),
    pedido_minimo_gratis numeric(10,2),
    raio_max_km          numeric(5,2)
  );

  -- ─────────────────────────────────────────────────────────── bairros_zona
  create table public.bairros_zona (
    id      uuid primary key default gen_random_uuid(),
    zona_id uuid not null references public.zonas_entrega(id) on delete cascade,
    nome    text not null
  );

  -- ─────────────────────────────────────────────────────────── formas_pagamento
  create table public.formas_pagamento (
    id      uuid primary key default gen_random_uuid(),
    loja_id uuid not null references public.lojas(id) on delete cascade,
    tipo    text not null check (tipo in ('pix', 'dinheiro', 'link', 'cartao')),
    config  jsonb not null default '{}'
  );

  -- ─────────────────────────────────────────────────────────── pedidos
  create table public.pedidos (
    id               uuid primary key default gen_random_uuid(),
    loja_id          uuid not null references public.lojas(id),
    -- Token de acesso: "senha" do pedido para leitura sem login (seguranca.md §pedidos)
    token_acesso     uuid not null default gen_random_uuid(),
    nome_cliente     text not null,
    telefone_cliente text,
    endereco_entrega jsonb,
    subtotal         numeric(10,2) not null,
    desconto         numeric(10,2) not null default 0,
    taxa_entrega     numeric(10,2) not null default 0,
    total            numeric(10,2) not null,
    status           text not null default 'pendente'
                    check (status in ('pendente','confirmado','em_preparo','saiu_entrega','entregue','cancelado')),
    forma_pagamento  text,
    cupom_codigo     text,
    observacoes      text,
    criado_em        timestamptz not null default now()
  );

  -- ─────────────────────────────────────────────────────────── itens_pedido
  create table public.itens_pedido (
    id         uuid primary key default gen_random_uuid(),
    pedido_id  uuid not null references public.pedidos(id) on delete cascade,
    produto_id uuid references public.produtos(id) on delete set null,
    nome       text not null,            -- snapshot do nome no momento do pedido
    preco      numeric(10,2) not null,   -- snapshot do preço
    quantidade int not null check (quantidade > 0)
  );

  -- ─────────────────────────────────────────────────── webhook_eventos_hotmart
  -- DELTA Hotmart — tabela de PII (e-mail comprador). RLS habilitada SEM policy:
  -- deny-all para anon/authenticated; só service_role (BYPASSRLS) acessa.
  create table public.webhook_eventos_hotmart (
    id            uuid primary key default gen_random_uuid(),
    evento_id     text not null unique,   -- idempotência no banco
    evento_tipo   text,
    loja_id       uuid references public.lojas(id) on delete set null,
    email_comprador text,
    payload       jsonb not null,
    processado_em timestamptz not null default now()
  );

  -- ─────────────────────────────────────────────────── RLS (enable em todas)
  -- Sem policy permissiva nesta migration: deny-all até as issues 004-006.
  -- webhook_eventos_hotmart permanece sem policy (estado final).
  alter table public.lojas                   enable row level security;
  alter table public.categorias              enable row level security;
  alter table public.produtos                enable row level security;
  alter table public.cupons                  enable row level security;
  alter table public.zonas_entrega           enable row level security;
  alter table public.taxas_entrega           enable row level security;
  alter table public.bairros_zona            enable row level security;
  alter table public.formas_pagamento        enable row level security;
  alter table public.pedidos                 enable row level security;
  alter table public.itens_pedido            enable row level security;
  alter table public.webhook_eventos_hotmart enable row level security;
