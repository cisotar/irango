# Schema — iRango

**Versão:** 0.1.3 | **Atualizado:** 2026-06-14

> Schema Postgres completo. Todo campo novo passa por migration em `supabase/migrations/`. Nunca alterar banco manualmente.

---

## Sumário

1. [Diagrama de Entidades](#1-diagrama-de-entidades)
2. [Tabelas](#2-tabelas)
3. [Indexes](#3-indexes)
4. [RLS — Visão Geral](#4-rls--visão-geral)
5. [Tipos Customizados (Enums)](#5-tipos-customizados-enums)
6. [Convenções](#6-convenções)

---

## 1. Diagrama de Entidades

```
auth.users (Supabase)
    │
    └── lojas (dono_id → auth.users.id)
            │
            ├── produtos
            │       └── itens_pedido
            ├── categorias
            ├── cupons
            ├── zonas_entrega
            │       └── taxas_entrega
            │           └── bairros_zona
            ├── formas_pagamento
            └── pedidos
                    └── itens_pedido
```

---

## 2. Tabelas

### `lojas`

```sql
CREATE TABLE lojas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dono_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug             text UNIQUE NOT NULL,
  nome             text NOT NULL,
  telefone         text,
  whatsapp         text,                    -- formato: 5511999999999
  ativo            boolean NOT NULL DEFAULT true,

  -- Endereço
  endereco_rua     text,
  endereco_numero  text,
  endereco_bairro  text,
  endereco_cidade  text,
  endereco_estado  text,
  endereco_cep     text,

  -- Tema visual (cores da vitrine)
  -- { "primaria": "#e63946", "fundo": "#ffffff", "destaque": "#f1a208" }
  tema             jsonb NOT NULL DEFAULT '{"primaria":"#e63946","fundo":"#ffffff","destaque":"#f1a208"}',

  -- Horários de funcionamento por dia da semana
  -- { "seg": {"abre":"08:00","fecha":"22:00","ativo":true}, ... }
  horarios         jsonb NOT NULL DEFAULT '{
    "seg": {"abre":"08:00","fecha":"22:00","ativo":true},
    "ter": {"abre":"08:00","fecha":"22:00","ativo":true},
    "qua": {"abre":"08:00","fecha":"22:00","ativo":true},
    "qui": {"abre":"08:00","fecha":"22:00","ativo":true},
    "sex": {"abre":"08:00","fecha":"22:00","ativo":true},
    "sab": {"abre":"09:00","fecha":"20:00","ativo":true},
    "dom": {"abre":"00:00","fecha":"00:00","ativo":false}
  }',

  -- Fuso horário da loja (exibição de horários, cálculo "loja aberta")
  timezone         text NOT NULL DEFAULT 'America/Sao_Paulo',

  -- LGPD — consentimento de uso dos dados
  consentimento_em      timestamptz,
  consentimento_versao  text,

  -- Assinatura Hotmart
  assinatura_status          text NOT NULL DEFAULT 'trial'
                             CHECK (assinatura_status IN ('trial','ativa','inadimplente','cancelada')),
  hotmart_subscriber_code    text,
  hotmart_plano              text,
  assinatura_inicio          timestamptz,
  assinatura_fim_periodo     timestamptz,
  assinatura_atualizada_em   timestamptz,

  -- Slug: apenas letras minúsculas, dígitos e hífens (defesa em profundidade)
  CONSTRAINT lojas_slug_formato CHECK (slug ~ '^[a-z0-9-]+$'),

  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
```

### `categorias`

```sql
CREATE TABLE categorias (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id   uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome      text NOT NULL,
  ordem     int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);
```

### `produtos`

```sql
CREATE TABLE produtos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id      uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  categoria_id uuid REFERENCES categorias(id) ON DELETE SET NULL,
  nome         text NOT NULL,
  descricao    text,
  preco        numeric(10,2) NOT NULL CHECK (preco >= 0),
  disponivel   boolean NOT NULL DEFAULT true,
  ordem        int NOT NULL DEFAULT 0,
  foto_url     text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
```

### `cupons`

```sql
CREATE TABLE cupons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id         uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  codigo          text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('percentual', 'fixo')),
  valor           numeric(10,2) NOT NULL CHECK (valor > 0),
  pedido_minimo   numeric(10,2) NOT NULL DEFAULT 0,
  usos_maximos    int,                      -- NULL = ilimitado
  usos_contagem   int NOT NULL DEFAULT 0,
  expira_em       timestamptz,              -- NULL = sem expiração
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loja_id, codigo)
);
```

### `zonas_entrega`

```sql
CREATE TABLE zonas_entrega (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id  uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome     text NOT NULL,
  tipo     text NOT NULL CHECK (tipo IN ('bairro', 'raio_km', 'faixa_cep')),
  ativo    boolean NOT NULL DEFAULT true
);
```

### `taxas_entrega`

```sql
CREATE TABLE taxas_entrega (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zona_id               uuid NOT NULL REFERENCES zonas_entrega(id) ON DELETE CASCADE,
  taxa                  numeric(10,2) NOT NULL CHECK (taxa >= 0),
  pedido_minimo_gratis  numeric(10,2),      -- NULL = sem frete grátis
  raio_max_km           numeric(5,2)        -- só pra tipo 'raio_km'
);
```

### `bairros_zona`

```sql
-- Bairros vinculados a zonas do tipo 'bairro'
CREATE TABLE bairros_zona (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zona_id  uuid NOT NULL REFERENCES zonas_entrega(id) ON DELETE CASCADE,
  nome     text NOT NULL
);
```

### `formas_pagamento`

```sql
CREATE TABLE formas_pagamento (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  tipo    text NOT NULL CHECK (tipo IN ('pix', 'dinheiro', 'link', 'cartao')),
  -- config varia por tipo:
  -- pix:     { "chave": "11999999999", "tipo_chave": "telefone" }
  -- dinheiro: { "troco_ate": 100 }
  -- link:    { "instrucoes": "..." }
  -- cartao:  { "instrucoes": "..." }
  config  jsonb NOT NULL DEFAULT '{}'
);
```

### `pedidos`

```sql
CREATE TABLE pedidos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id           uuid NOT NULL REFERENCES lojas(id),
  -- Token de acesso: funciona como "senha" do pedido. Cliente sem login lê a
  -- confirmação via id + token. Ver references/seguranca.md §pedidos.
  token_acesso      uuid NOT NULL DEFAULT gen_random_uuid(),
  nome_cliente      text NOT NULL,
  telefone_cliente  text,
  -- { "rua":"...", "numero":"...", "bairro":"...", "cidade":"...", "cep":"..." }
  endereco_entrega  jsonb,
  subtotal          numeric(10,2) NOT NULL,
  desconto          numeric(10,2) NOT NULL DEFAULT 0,
  taxa_entrega      numeric(10,2) NOT NULL DEFAULT 0,
  total             numeric(10,2) NOT NULL,
  status            text NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','confirmado','em_preparo','saiu_entrega','entregue','cancelado')),
  forma_pagamento   text,
  cupom_codigo      text,
  observacoes       text,
  criado_em         timestamptz NOT NULL DEFAULT now()
);
```

### `itens_pedido`

```sql
CREATE TABLE itens_pedido (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id  uuid REFERENCES produtos(id) ON DELETE SET NULL,
  nome        text NOT NULL,    -- snapshot do nome no momento do pedido
  preco       numeric(10,2) NOT NULL,  -- snapshot do preço
  quantidade  int NOT NULL CHECK (quantidade > 0)
);
```

### `webhook_eventos_hotmart`

```sql
-- Registro imutável de todos os eventos recebidos da Hotmart.
-- RLS: deny-all permanente — acesso exclusivo via service_role (backend/function).
-- Idempotência: UNIQUE em evento_id evita reprocessamento de eventos duplicados.
CREATE TABLE webhook_eventos_hotmart (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id   text UNIQUE NOT NULL,   -- ID único fornecido pela Hotmart
  tipo        text NOT NULL,          -- ex: 'PURCHASE_APPROVED'
  payload     jsonb NOT NULL,
  processado  boolean NOT NULL DEFAULT false,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
```

---

## 3. Indexes

```sql
-- Lookup de loja por slug (rota pública /loja/[slug])
CREATE UNIQUE INDEX ON lojas(slug);

-- Produtos por loja (listagem do painel e vitrine)
CREATE INDEX ON produtos(loja_id, disponivel, ordem);

-- Categorias por loja
CREATE INDEX ON categorias(loja_id, ordem);

-- Pedidos por loja ordenados por data (dashboard)
CREATE INDEX ON pedidos(loja_id, criado_em DESC);

-- Cupons: busca por código dentro da loja
CREATE UNIQUE INDEX ON cupons(loja_id, codigo);

-- Zonas de entrega por loja
CREATE INDEX ON zonas_entrega(loja_id);

-- Bairros por zona
CREATE INDEX ON bairros_zona(zona_id);
```

---

## 4. RLS — Visão Geral

Ver detalhes completos em `references/seguranca.md`.

Regra geral:
- **Vitrine pública** (produtos, categorias) → SELECT público onde `ativo = true`; loja: leitura anon via `public.vitrine_lojas` (view — nunca `public.lojas` diretamente)
- **Dados do lojista** (cupons, pedidos, formas_pagamento, zonas) → somente `auth.uid() = lojas.dono_id`
- **INSERT de pedido** → público (cliente não precisa de login)
- **`webhook_eventos_hotmart`** → deny-all permanente; acesso exclusivo via `service_role`

---

## 5. Tipos Customizados (Enums)

Preferimos `CHECK` inline nas colunas ao invés de `CREATE TYPE` — mais simples de alterar em migrations futuras.

Valores válidos:

| Coluna | Valores |
|--------|---------|
| `zonas_entrega.tipo` | `bairro`, `raio_km`, `faixa_cep` |
| `cupons.tipo` | `percentual`, `fixo` |
| `formas_pagamento.tipo` | `pix`, `dinheiro`, `link`, `cartao` |
| `pedidos.status` | `pendente`, `confirmado`, `em_preparo`, `saiu_entrega`, `entregue`, `cancelado` |
| `lojas.assinatura_status` | `trial`, `ativa`, `inadimplente`, `cancelada` |

---

## 6. Convenções

- Todo campo de data usa `timestamptz` (com fuso) — nunca `timestamp`
- Todo `id` é `uuid` gerado pelo Postgres (`gen_random_uuid()`)
- Campos de valor monetário: `numeric(10,2)` — nunca `float` (arredondamento)
- `ON DELETE CASCADE` em dados filhos da loja — deletar loja limpa tudo
- `ON DELETE SET NULL` em produto referenciado em pedido — histórico preservado
- Snapshots em `itens_pedido.nome` e `itens_pedido.preco` — pedido não muda se produto for editado
- Tipos gerados automaticamente: `pnpm supabase gen types typescript --local > src/types/supabase.ts`
- **Operações multi-tabela atômicas com trava de concorrência** usam função Postgres `SECURITY INVOKER` + `SET search_path = public` + `REVOKE ALL FROM public, anon, authenticated` + `GRANT EXECUTE TO service_role`. Exemplo: `public.criar_pedido(...)` (migration `20260614003000_rpc_criar_pedido.sql`). Nunca INSERT direto da action quando atomicidade ou trava de linha for necessária.
