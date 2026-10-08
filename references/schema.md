# Schema — iRango

**Versão:** 0.7.0 | **Atualizado:** 2026-10-07

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
    ├── papeis_usuario (usuario_id → auth.users.id, CASCADE)
    │
    ├── clientes (id → auth.users.id, CASCADE) — perfil de cliente final, 1:1
    │       ├── clientes_enderecos (cliente_id → clientes.id, CASCADE) — até 3
    │       └── pedidos (cliente_id → clientes.id, SET NULL) — pedido de cliente logado; null = convidado
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
            ├── opcionais_categorias
            │       └── opcionais
            │               └── itens_pedido_opcionais
            ├── categoria_produto_opcionais (categorias ⋈ opcionais_categorias)
            ├── produto_opcionais_ocultos (produtos ⋈ opcionais_categorias — exceção por produto)
            ├── imagens_loja (original; recorte aponta para a original via origem_id, mesma loja)
            └── pedidos
                    └── itens_pedido
                            └── itens_pedido_opcionais
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

  -- Preferência de notificação (spec 5): quando true, o checkout abre o WhatsApp
  -- automaticamente ao confirmar o pedido, sem o segundo clique do cliente. O
  -- botão manual da confirmação independe desta flag. NÃO é billing nem PII —
  -- fica fora de CAMPOS_LOJA_SOMENTE_SERVIDOR e é gravável pelo lojista (RLS
  -- lojas_update_proprio) e pelo admin SaaS (escopo.atualizarLoja).
  whatsapp_envio_automatico boolean NOT NULL DEFAULT true,

  -- Ciclo mensal do relatório de vendas (RN-V08): dia 1..28 em que o ciclo
  -- começa (fevereiro sempre tem o dia). NÃO é billing nem PII — fora de
  -- CAMPOS_LOJA_SOMENTE_SERVIDOR e do trigger lojas_protege_billing; gravável
  -- pelo lojista (lojas_update_proprio) e pelo admin (escopo.atualizarLoja).
  -- Fora de vitrine_lojas. Migration: 20261007123000_lojas_dia_inicio_ciclo.sql.
  dia_inicio_ciclo smallint NOT NULL DEFAULT 1 CHECK (dia_inicio_ciclo BETWEEN 1 AND 28),

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
                             CHECK (assinatura_status IN ('trial','ativa','inadimplente','cancelada','suspensa','cortesia')),
  hotmart_subscriber_code    text,
  hotmart_plano              text,
  assinatura_inicio          timestamptz,
  assinatura_fim_periodo     timestamptz,
  assinatura_atualizada_em   timestamptz,

  -- Módulos pagos de impressão de pedido (entitlement por feature, billing-controlled).
  -- DEFAULT false = fail-closed: loja nasce sem nenhum módulo contratado; só o
  -- servidor de billing liga. Nunca editável pelo lojista — protegido pelo mesmo
  -- trigger de billing e por CAMPOS_LOJA_SOMENTE_SERVIDOR (seguranca.md §2).
  -- Migration: 20260707120000_lojas_modulos_impressao.sql (issue 127)
  modulo_impressao_a4         boolean NOT NULL DEFAULT false,
  modulo_impressao_termica    boolean NOT NULL DEFAULT false,

  -- Logo da loja (exibida na vitrine pública — dado público, não PII)
  -- NULL = loja sem logo. CHECK de defesa-em-profundidade; autoridade real é a Server Action.
  -- Migration: 20260615013000_logo_url_lojas.sql
  -- Só URL de imagem registrada em `imagens_loja` da mesma loja (trigger BEFORE, migration 20261006123000)
  logo_url         text CHECK (logo_url IS NULL OR logo_url LIKE 'https://%'),

  -- Frete fallback quando o bairro/CEP não casa nenhuma zona configurada.
  -- NULL = entrega fora de zona indisponível; valor numérico = taxa fixa cobrada.
  -- Exposto na view vitrine_lojas (dado público — não é PII).
  -- Migration: 20260614006000_lojas_taxa_fora_zona_view.sql
  taxa_entrega_fora_zona  numeric(10,2),

  -- Coordenadas geográficas da loja (geocoding do endereço — issue 008 salvarPerfil)
  -- float8 por design (coord não é dinheiro). Nullable: loja sem coords → zonas raio_km ignoradas (RN-3).
  -- CHECKs de defesa-em-profundidade; autoridade real é a Server Action. A view vitrine_lojas NÃO expõe coords.
  -- Migration: 20260616194631_lojas_coordenadas.sql
  latitude         float8,
  longitude        float8,
  CONSTRAINT lojas_coords_par_check      CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT lojas_latitude_range_check  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT lojas_longitude_range_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),

  -- Slug: apenas letras minúsculas, dígitos e hífens (defesa em profundidade)
  CONSTRAINT lojas_slug_formato CHECK (slug ~ '^[a-z0-9-]+$'),

  -- Modalidades de entrega (spec modalidades-entrega-loja). Default = comportamento
  -- de hoje (ambas ligadas, frete automático). Exposto em vitrine_lojas.
  -- Migration: 20260925120000_lojas_modalidades_entrega.sql
  aceita_retirada  boolean NOT NULL DEFAULT true,
  aceita_entrega   boolean NOT NULL DEFAULT true,
  modo_frete       text    NOT NULL DEFAULT 'automatico'
                   CHECK (modo_frete IN ('automatico', 'a_combinar')),
  CONSTRAINT lojas_ao_menos_uma_modalidade CHECK (aceita_retirada OR aceita_entrega),

  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
```

### `categorias`

```sql
-- Frequência de exibição (issue 320, spec `frequencia-exibicao.md`, migration
-- 20260928130000): 5 eixos combináveis com os da MESMA linha de `produtos`
-- (RN-1, interseção AND). NULL em um eixo = sem restrição nesse eixo; os 5 NULL
-- = permanente. `dias_semana = '{}'` é valor válido e significa "nunca" (RN-8),
-- não "todo dia" — não confundir com NULL. A janela NUNCA é avaliada em SQL:
-- função pura em TS, no fuso da loja (`src/lib/utils/frequencia.ts`).
CREATE TABLE categorias (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id        uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  ordem          int NOT NULL DEFAULT 0,
  oculta         boolean NOT NULL DEFAULT false,  -- oculta = some da vitrine com seus produtos (RN-2); dono segue vendo
  dias_semana    smallint[],   -- 0=dom..6=sab; NULL=sem restrição; '{}'=nunca (RN-8)
  hora_inicio    time,         -- INCLUSIVO, fuso da loja; par com hora_fim
  hora_fim       time,         -- EXCLUSIVO, fuso da loja; par com hora_inicio
  periodo_inicio date,         -- INCLUSIVO
  periodo_fim    date,         -- INCLUSIVO; depois dele a categoria some da vitrine com seus produtos (RN-7)
  criado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categorias_dias_semana_dominio
    CHECK (dias_semana IS NULL OR dias_semana <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  CONSTRAINT categorias_hora_par CHECK ((hora_inicio IS NULL) = (hora_fim IS NULL)),
  CONSTRAINT categorias_hora_ordem CHECK (hora_inicio IS NULL OR hora_fim > hora_inicio),
  CONSTRAINT categorias_periodo_ordem
    CHECK (periodo_inicio IS NULL OR periodo_fim IS NULL OR periodo_fim >= periodo_inicio)
);
```

### `produtos`

```sql
-- Frequência de exibição (issue 320): mesmos 5 eixos e mesma semântica de
-- `categorias`, acima (NULL = sem restrição; `dias_semana = '{}'` = nunca,
-- RN-8; avaliação em TS, nunca em SQL).
CREATE TABLE produtos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id        uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  categoria_id   uuid REFERENCES categorias(id) ON DELETE SET NULL,
  nome           text NOT NULL,
  descricao      text,
  preco          numeric(10,2) NOT NULL CHECK (preco >= 0),
  disponivel     boolean NOT NULL DEFAULT true,   -- comprável vs. esgotado (esgotado ainda aparece na vitrine, marcado)
  oculto         boolean NOT NULL DEFAULT false,  -- oculto = nunca aparece na vitrine, independente de `disponivel`
  ordem          int NOT NULL DEFAULT 0,
  foto_url       text,         -- só URL de imagem registrada em `imagens_loja` da mesma loja (trigger BEFORE, M4)
  dias_semana    smallint[],   -- 0=dom..6=sab; NULL=sem restrição; '{}'=nunca (RN-8)
  hora_inicio    time,         -- INCLUSIVO, fuso da loja; par com hora_fim
  hora_fim       time,         -- EXCLUSIVO, fuso da loja; par com hora_inicio
  periodo_inicio date,         -- INCLUSIVO
  periodo_fim    date,         -- INCLUSIVO; depois dele o produto some da vitrine (RN-7)
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT produtos_dias_semana_dominio
    CHECK (dias_semana IS NULL OR dias_semana <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  CONSTRAINT produtos_hora_par CHECK ((hora_inicio IS NULL) = (hora_fim IS NULL)),
  CONSTRAINT produtos_hora_ordem CHECK (hora_inicio IS NULL OR hora_fim > hora_inicio),
  CONSTRAINT produtos_periodo_ordem
    CHECK (periodo_inicio IS NULL OR periodo_fim IS NULL OR periodo_fim >= periodo_inicio)
);
```

Escrita em lote da frequência: RPCs `public.aplicar_frequencia_em_produtos(p_loja_id, p_ids,
p_frequencia)` (mesma frequência em N produtos) e `public.salvar_grade_de_dias(p_loja_id, p_itens)`
(grade produto × dia, só `dias_semana`) — migration `20260928131000_rpc_frequencia_produtos.sql`.
`SECURITY INVOKER` com `p_loja_id` explícito no `WHERE`, usada por lojista **e** admin — desvio D6
do padrão de §6/`seguranca.md`, ver lá o racional.

`vitrine_produtos` (view pública, `security_invoker = false`, `security_barrier = true`) ganhou as
5 colunas de frequência no fim da projeção (20..20, ordem fixa, 20 colunas ao todo — eram 15) e
passou a excluir produto de categoria `oculta = true` (`not exists` explícito, a view não passa
pela RLS de `categorias`). A janela de frequência (dias/hora/período) **não** é filtrada na view —
só o TS decide (`src/lib/utils/frequencia.ts`). Ver `seguranca.md` §19 para o padrão geral de view
definer.

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
  -- NULL = sem limite por cliente (só usos_maximos global). 1..1000 = pedidos por cliente logado
  -- na loja; com valor preenchido o cupom NÃO dá desconto a convidado (seguranca.md §10 regra 9-A).
  -- Migration: 20261003121000_cupons_limite_por_cliente.sql
  limite_por_cliente int CHECK (limite_por_cliente IS NULL OR limite_por_cliente BETWEEN 1 AND 1000),
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
  raio_max_km           numeric(5,2),       -- só pra tipo 'raio_km'
  cep_inicio            integer,            -- só pra tipo 'faixa_cep' (8 dígitos como inteiro)
  cep_fim               integer,            -- idem; NULL ↔ NULL (par tudo-ou-nada)
  CONSTRAINT taxas_faixa_cep_coerente CHECK (
    (cep_inicio IS NULL AND cep_fim IS NULL)
    OR (
      cep_inicio IS NOT NULL AND cep_fim IS NOT NULL
      AND cep_inicio BETWEEN 0 AND 99999999
      AND cep_fim    BETWEEN 0 AND 99999999
      AND cep_inicio <= cep_fim
    )
  )
);
-- Migration: 20260615011000_taxas_faixa_cep.sql
```

Escrita em lote da tela de faixas de km: RPC `public.salvar_faixas_entrega(p_loja_id, p_incremento,
p_faixas)` (migrations `20260929120000_rpc_salvar_faixas_entrega.sql` e
`20260930120000_rpc_salvar_faixas_entrega_ativo.sql`, issue 326) — **zonas por
faixa**: apaga TODAS as zonas da loja (qualquer `tipo`, cascata em `taxas_entrega`/`bairros_zona`) e
grava uma zona `raio_km` + taxa por faixa, numa só transação. O cliente manda só `incremento` (1 ou 2
km) e, por faixa, `taxa`/`pedido_minimo_gratis`/`ativo`; o servidor deriva o resto — teto
`raio_max_km` = posição da faixa × `incremento`, `nome` = `"<de>–<até> km"` (en dash). As faixas
ativas formam um prefixo: faixa ativa depois de uma desligada é recusada (zod e RPC), então a área de
entrega nunca tem buraco; o limite é o teto da última ativa. `SECURITY INVOKER`,
`SET search_path = public, pg_temp`, `GRANT EXECUTE TO authenticated, service_role` — chamada pelos
dois mundos (lojista e admin), filtro `loja_id = p_loja_id` explícito no corpo — ver `seguranca.md`
§2, quinta instância do padrão.

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
  loja_id           uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  -- ON DELETE CASCADE (migration 20260621096000): o hard delete administrativo de
  -- loja (admin /admin/assinantes) cascateia pedidos → itens_pedido → itens_pedido_opcionais.
  -- Token de acesso: funciona como "senha" do pedido. Cliente sem login lê a
  -- confirmação via id + token. Ver references/seguranca.md §pedidos.
  token_acesso      uuid NOT NULL DEFAULT gen_random_uuid(),
  nome_cliente      text NOT NULL,
  telefone_cliente  text,
  -- { "rua":"...", "numero":"...", "bairro":"...", "cidade":"...", "cep":"...", "distanciaKm"?: number }
  -- distanciaKm: calculado server-side (haversine loja↔CEP cliente, issue 006); ausente quando geocoding falha ou tipo_entrega=retirada. Nunca vem do client (.strict() rejeita extras).
  endereco_entrega  jsonb,
  subtotal          numeric(10,2) NOT NULL,
  desconto          numeric(10,2) NOT NULL DEFAULT 0,
  taxa_entrega      numeric(10,2),                   -- NULL <=> frete_a_combinar = true (nunca 0, que é frete grátis legítimo)
  total             numeric(10,2) NOT NULL,
  -- true = frete não pôde ser calculado (geocoding do CEP indisponível) e será
  -- combinado com a loja; implica taxa_entrega IS NULL. Registro autoritativo
  -- pela Server Action registrarFreteCombinado (seguranca.md §10-B).
  -- Migration: 20260913120000_pedidos_frete_a_combinar.sql
  frete_a_combinar  boolean NOT NULL DEFAULT false,
  CONSTRAINT chk_pedidos_frete_a_combinar CHECK (
    (frete_a_combinar AND taxa_entrega IS NULL)
    OR (NOT frete_a_combinar AND taxa_entrega IS NOT NULL)
  ),
  status            text NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','confirmado','em_preparo','saiu_entrega','entregue','cancelado')),
  forma_pagamento   text,
  cupom_codigo      text,
  observacoes       text,
  -- Idempotência: chave gerada pelo client (crypto.randomUUID()) por carrinho/sessão.
  -- A RPC criar_pedido retorna o mesmo pedido_id/token sem 2º INSERT nem 2º consumo de cupom.
  -- Migration: 20260614009000_pedidos_idempotency_key.sql
  idempotency_key   uuid,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  -- Pedido de cliente logado. Null = convidado (todo pedido anterior ao Marco C, sem backfill).
  -- Gravado só na criação, pela RPC criar_pedido (p_cliente_id = auth.uid() da Server Action,
  -- nunca do payload). Vira null na anonimização. Migration: 20261003120000_pedidos_cliente_id.sql
  cliente_id        uuid REFERENCES clientes(id) ON DELETE SET NULL
);
```

**Trigger `pedidos_cliente_id_imutavel_trg`** (BEFORE UPDATE, `SECURITY INVOKER`): recusa
(`42501`) troca de `cliente_id` para autor que não é `service_role`/`postgres`/`supabase_admin`.
Fecha o lojista reescrevendo o vínculo (`pedidos_acesso_lojista` é `FOR ALL`) e o cliente se
apropriando de pedido de convidado. Mesmo molde de `pedidos_transicao_status_trg`.

**Funções de pedido e cliente** (`SECURITY DEFINER`, `search_path = ''`, EXECUTE só `service_role`;
migration `20261003123000_anonimizar_cliente_pedidos.sql`):

| Função / trigger | Faz |
|------------------|-----|
| `clientes_anonimizar_pedidos` (BEFORE DELETE em `clientes`, função `anonimizar_pedidos_do_cliente`) | Em qualquer caminho de exclusão do perfil: `nome_cliente = 'Cliente removido'`; `telefone_cliente`, `endereco_entrega`, `observacoes` e `cliente_id` = null; `itens_pedido.observacao` = null. Valores, status, itens e `cupom_codigo` ficam |
| `anonimizar_cliente(p_usuario)` | Recusa `pedido_em_aberto` se há pedido do cliente fora de `entregue`/`cancelado` criado há menos de 7 dias; senão apaga o perfil (o trigger acima anonimiza os pedidos) |
| `anonimizar_clientes_inativos()` | Idem, pulando quem tem pedido em aberto nos últimos 7 dias (o lote não aborta) |
| `expurgar_pedidos_antigos()` | Apaga pedido `entregue`/`cancelado` com `criado_em` > 5 anos, de cliente ou convidado (itens e opcionais por cascade); devolve a contagem. Sem agendador |

**RPC `criar_pedido`** (`SECURITY INVOKER`, EXECUTE só `service_role`): **uma única versão, 18 argumentos**
(os 17 anteriores + `p_cliente_id uuid` por último, obrigatório, sem default; null explícito para convidado).
As versões de 16 e 17 args foram removidas na migration `20261003122000_rpc_criar_pedido_cliente.sql`. Ordem:
dedupe por `idempotency_key`; `cliente_inexistente` se `p_cliente_id` não existe em `clientes`; cupom com
`limite_por_cliente` (convidado → desconto 0 e cupom descartado; cliente → `pg_advisory_xact_lock` por
(cupom, cliente) + `count(pedidos)` por `loja_id`+`cliente_id`+`cupom_codigo`, todos os status; limite atingido →
desconto 0); trava global de `usos_contagem`; INSERT com `cliente_id`. Desde `20261007121000_rpc_criar_pedido_categoria_snapshot.sql`
grava também `categoria_id_snapshot`/`categoria_nome_snapshot` em cada item (resolvidos no banco; assinatura inalterada).

**Trigger `pedidos_protege_valor_trg`** (BEFORE UPDATE, `SECURITY INVOKER`): defesa em
profundidade contra reescrita direta de `subtotal`/`desconto`/`taxa_entrega`/`total`/
`frete_a_combinar` via PostgREST (a RLS filtra linha, não coluna). Libera `service_role`/
`postgres`/`supabase_admin` e a única transição legítima do dono — registro de frete
combinado (`frete_a_combinar` true→false) com `total` recalculado no próprio trigger.
Qualquer outra escrita de valor é rejeitada. Ver seguranca.md §10-B.
Migration: `20260925130000_pedidos_protege_valor.sql`.

**Trigger `pedidos_transicao_status_trg`** (BEFORE UPDATE, `SECURITY INVOKER`, issue 299):
impõe no banco a máquina de status (RN-08 com o atalho para `saiu_entrega`) e a
imutabilidade de `tipo_entrega` para autor que não é sistema. Libera `service_role`/
`postgres`/`supabase_admin`; recusa troca de `tipo_entrega` ("tipo de entrega do pedido é
imutável") e troca de `status` fora do grafo ("transição de status não permitida"). Status
reescrito com o mesmo valor e UPDATE sem `status` passam. O grafo SQL espelha `TRANSICOES`
(`src/lib/utils/transicaoStatus.ts`); a paridade dos 30 pares é travada por
`tests/migrations/pedidos_transicao_status.test.ts`, que deriva o esperado de
`transicaoPermitida` — mudou o grafo no TS, precisa de migration nova. Dispara depois de
`pedidos_protege_valor_trg` (ordem alfabética). Migration: `20260930130000_pedidos_transicao_status.sql`.

### `itens_pedido`

```sql
CREATE TABLE itens_pedido (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id  uuid REFERENCES produtos(id) ON DELETE SET NULL,
  nome        text NOT NULL,    -- snapshot do nome no momento do pedido
  preco       numeric(10,2) NOT NULL,  -- snapshot do preço
  quantidade  int NOT NULL CHECK (quantidade > 0),
  -- Observação livre do cliente para ESTE item (ex.: "sem cebola"). NULL = sem
  -- observação. Snapshot imutável, mesma família de nome/preco. Autoridade de
  -- tamanho é o zod da Server Action; o CHECK é defesa em profundidade.
  -- Migration: 20260907120000_itens_pedido_observacao.sql (issue 166).
  observacao  text CHECK (observacao IS NULL OR char_length(observacao) <= 200),
  -- Preço de tabela no momento do pedido, quando houve desconto no produto. NULL =
  -- sem desconto (gatilho do "de/por"). Snapshot imutável; sempre >= preco
  -- (itens_pedido_preco_original_check). Derivado do banco, nunca do payload.
  -- Migration: 20260920126000_itens_pedido_preco_original.sql (issue 221).
  preco_original numeric(10,2) CHECK (preco_original IS NULL OR preco_original >= preco),
  -- Categoria do produto NO MOMENTO da venda (RN-V14), para o relatório de vendas.
  -- SEM FK de propósito: renomear/mover/apagar a categoria não muda pedido. NULL no par
  -- = "Sem categoria" (item sem produto, produto sem categoria ou cadeia que cruza loja).
  -- Gravado pela RPC criar_pedido a partir de produto_id + p_loja_id, nunca do payload.
  -- Migrations: 20261007120000 (colunas + CHECK de par), 20261007121000 (RPC),
  -- 20261007122000 (backfill dos itens antigos).
  categoria_id_snapshot   uuid,
  categoria_nome_snapshot text,
  CONSTRAINT itens_pedido_categoria_snapshot_par_check
    CHECK ((categoria_id_snapshot IS NULL) = (categoria_nome_snapshot IS NULL))
);
```

### `opcionais_categorias`

```sql
-- Agrupador da biblioteca de opcionais por loja (ex: Laticínios, Doces)
CREATE TABLE opcionais_categorias (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id   uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome      text NOT NULL,
  -- Ordem da Biblioteca de opcionais no painel. Desde a issue 208, NÃO é mais a
  -- ordem da vitrine — isso é `categoria_produto_opcionais.ordem` (ver abaixo).
  ordem     int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);
```

### `opcionais`

```sql
-- Item da biblioteca de opcionais; preço autoritativo do servidor
CREATE TABLE opcionais (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id               uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  categoria_opcional_id uuid NOT NULL REFERENCES opcionais_categorias(id) ON DELETE CASCADE,
  nome                  text NOT NULL,
  preco                 numeric(10,2) NOT NULL CHECK (preco >= 0),
  ativo                 boolean NOT NULL DEFAULT true,
  -- Posição do item DENTRO do grupo de opcional (0-based). Escrita só em dois
  -- pontos: criação (INSERT com max(ordem)+1 do grupo) e reordenação, só por
  -- public.reordenar_itens_do_grupo_opcional (issue 215/216) — nunca por
  -- update/upsert direto. A edição de nome/preço NÃO manda `ordem` (fix issue
  -- 216: mandar o índice da linha corrompia a posição de itens nunca
  -- reordenados, todos nascidos com `ordem` no default 0).
  ordem                 int NOT NULL DEFAULT 0,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);
```

### `categoria_produto_opcionais`

```sql
-- Associação: categoria de produto ⋈ categoria de opcional (M:N)
-- loja_id redundante para RLS direta por loja (convenção do schema)
CREATE TABLE categoria_produto_opcionais (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id               uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  categoria_id          uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  categoria_opcional_id uuid NOT NULL REFERENCES opcionais_categorias(id) ON DELETE CASCADE,
  -- Posição do grupo de opcional DENTRO desta categoria de produto (0-based).
  -- Autoridade da ordem na VITRINE (não confundir com `opcionais_categorias.ordem`,
  -- que só ordena a Biblioteca no painel). Escrita só por
  -- public.reordenar_opcionais_da_categoria — nunca direto por update/upsert.
  -- Migration: 20260917120000_ordem_em_categoria_produto_opcionais.sql (issue 208).
  ordem                 int NOT NULL DEFAULT 0,
  UNIQUE (categoria_id, categoria_opcional_id)
);
```

### `produto_opcionais_ocultos`

```sql
-- Exceção por produto (issue 331): linha existe = o grupo de opcionais herdado
-- da categoria do produto fica OCULTO neste produto; ausência = exibe.
-- Regra (única cópia: src/lib/utils/opcionais-do-produto.ts):
--   visiveis(produto) = grupos da categoria (na ordem de categoria_produto_opcionais.ordem) − ocultos(produto)
-- Subtrativa: a linha só esconde, nunca libera. Não associa grupo a produto —
-- a associação continua sendo categoria_produto_opcionais (categoria ⋈ grupo).
-- D3: se o produto muda de categoria, a linha persiste; se a nova categoria não
-- tem o grupo (ou o grupo é desassociado), a linha é órfã e INERTE — nada a limpar.
-- Migration: 20260930140000_produto_opcionais_ocultos.sql
CREATE TABLE produto_opcionais_ocultos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id               uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  produto_id            uuid NOT NULL,
  categoria_opcional_id uuid NOT NULL,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  -- FKs compostas com loja_id: produto e grupo precisam ser da MESMA loja da linha
  -- (vale também sob service_role, que é por onde o hub admin escreve).
  CONSTRAINT produto_opcionais_ocultos_produto_fk
    FOREIGN KEY (produto_id, loja_id) REFERENCES produtos (id, loja_id) ON DELETE CASCADE,
  CONSTRAINT produto_opcionais_ocultos_grupo_fk
    FOREIGN KEY (categoria_opcional_id, loja_id) REFERENCES opcionais_categorias (id, loja_id) ON DELETE CASCADE,
  UNIQUE (produto_id, categoria_opcional_id)   -- alvo do upsert idempotente em lote
);
-- RLS: leitura pública só de loja ativa E produto publicado na vitrine (EXISTS em
--      vitrine_produtos); leitura própria do dono (inclusive loja inativa);
--      INSERT e DELETE só pelo dono; SEM UPDATE (alternar = INSERT/DELETE).
-- GRANTs: anon=SELECT / authenticated=SELECT,INSERT,DELETE / service_role=ALL
```

### `itens_pedido_opcionais`

```sql
-- Snapshot dos opcionais escolhidos por item do pedido
-- nome_snapshot/preco_snapshot: histórico imutável mesmo se opcional for editado/removido
CREATE TABLE itens_pedido_opcionais (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_pedido_id uuid NOT NULL REFERENCES itens_pedido(id) ON DELETE CASCADE,
  opcional_id    uuid REFERENCES opcionais(id) ON DELETE SET NULL,  -- NULL preserva histórico
  nome_snapshot  text NOT NULL,
  preco_snapshot numeric(10,2) NOT NULL CHECK (preco_snapshot >= 0),
  quantidade     int NOT NULL CHECK (quantidade > 0)
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

### `admin_acessos`

```sql
-- Trilha de auditoria das ações admin (service_role) sobre lojas de assinantes.
-- RLS: deny-all permanente — acesso exclusivo via service_role (BYPASSRLS).
-- SEM FK em loja_id (deliberado, revisão de auditoria da issue 146): audit log
-- sobrevive ao hard-delete da loja (excluirLojaPermanente, issue 084) — a evidência
-- da própria exclusão não pode desaparecer junto com a loja. Integridade referencial
-- fica na aplicação: o único writer (registrarAcessoAdmin) sempre recebe um loja_id
-- já validado por validarLojaIdAdmin/verificarAdminSaaS antes de logar.
-- Migration: 20260707122000_admin_acessos.sql (issues 146/147)
CREATE TABLE admin_acessos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,   -- id do dono do SaaS (sem FK: sem semântica de cascade)
  loja_id       uuid NOT NULL,   -- loja-alvo; SEM FK — sobrevive ao hard-delete (ver nota acima)
  acao          text NOT NULL,   -- ex: 'criar_loja', 'salvar_tema', 'alternar_modulo'
  entidade_id   uuid,            -- id da entidade tocada, quando houver (path de Storage NÃO entra aqui — não é uuid, vai em metadados)
  metadados     jsonb,           -- payload contextual (ex: { modulo, ativo, coluna }); só metadado operacional, nunca PII de comprador
  criado_em     timestamptz NOT NULL DEFAULT now()
);
```

### `papeis_usuario`

```sql
-- Papel explícito da conta. PK composta: uma conta pode ter mais de um papel.
-- RLS: SELECT só das próprias linhas; escrita só por service_role via
-- atribuir_papel_inicial(p_usuario_id uuid, p_papel text) RETURNS text[]
-- (SECURITY DEFINER; grava só se a conta não tem papel; devolve os papéis atuais).
-- Trigger lojas_exige_dono_lojista_trg em lojas (BEFORE INSERT OR UPDATE OF dono_id):
-- recusa dono sem papel lojista (conta só-cliente); conta sem papel recebe 'lojista'.
-- Backfill: toda conta pré-existente sem papel virou 'lojista'.
-- Migration: 20261001120000_papel_cliente.sql
CREATE TABLE papeis_usuario (
  usuario_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  papel      text NOT NULL CHECK (papel IN ('lojista', 'cliente')),
  criado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, papel)
);
```

### `clientes`

```sql
-- Perfil do cliente final (conta única iRango; spec cliente-identidade). 1:1 com auth.users.
-- E-mail NÃO é duplicado aqui: vive em auth.users. O papel 'cliente' vive em papeis_usuario.
-- Só existe depois da confirmação do e-mail: nada do perfil é guardado antes (RN-06).
-- RLS: SELECT/UPDATE só da própria linha (id = (select auth.uid())). INSERT e DELETE só via
-- funções abaixo (service_role). Grants: SELECT para authenticated; UPDATE só em
-- (nome, telefone, data_nascimento, aceita_marketing) — id, criado_em, ultimo_acesso_em e
-- consentimento_* não são graváveis pelo usuário.
-- Trigger clientes_valida_idade_trg (BEFORE INSERT OR UPDATE OF data_nascimento): >= 18 anos em
-- current_date, não futura, <= 120 anos (CHECK não serve: current_date não é imutável).
-- Migration: 20261002120000_clientes.sql
CREATE TABLE clientes (
  id                  uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  nome                text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  telefone            text NOT NULL CHECK (telefone ~ '^\+?[\d\s()-]{8,20}$'),
  data_nascimento     date NOT NULL,
  aceita_marketing    boolean NOT NULL DEFAULT false,         -- opt-in, desmarcado por padrão
  consentimento_em    timestamptz NOT NULL,                   -- aceite dos termos (servidor)
  consentimento_versao text NOT NULL CHECK (char_length(consentimento_versao) BETWEEN 1 AND 50),  -- VERSAO_TERMOS
  criado_em           timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso_em    timestamptz NOT NULL DEFAULT now()      -- base da retenção de 24 meses
);
```

**Funções (todas `SECURITY DEFINER`, `search_path = ''`, EXECUTE só `service_role`):**

| Função | Faz |
|--------|-----|
| `adicionar_papel_cliente(p_usuario uuid)` | Acrescenta `cliente` em `papeis_usuario` (`ON CONFLICT DO NOTHING`, mesmo advisory lock de `atribuir_papel_inicial`). Nunca grava `lojista`; nenhuma função remove papel |
| `criar_perfil_cliente(p_usuario, p_nome, p_telefone, p_data_nascimento, p_aceita_marketing, p_versao_termos, p_endereco jsonb)` | Papel + `clientes` + 1º endereço (`padrao = true`) na mesma transação. Recusa sem versão de termos, sem endereço ou com perfil já existente (`23505`) |
| `anonimizar_cliente(p_usuario uuid)` | Apaga o perfil (CASCADE nos endereços). Não toca `papeis_usuario`, `lojas` nem `auth.users` |
| `anonimizar_clientes_inativos()` | Chama `anonimizar_cliente` para cada perfil com `ultimo_acesso_em` há mais de 24 meses; devolve a contagem. Sem agendador: execução manual/futura |

### `clientes_enderecos`

```sql
-- Até 3 endereços salvos por cliente (mínimo 1 enquanto houver perfil, só para o usuário final).
-- RLS: SELECT/INSERT/UPDATE/DELETE só com cliente_id = (select auth.uid()) (USING e WITH CHECK).
-- Triggers (valem também para service_role, exceto o mínimo):
--   clientes_enderecos_teto_trg    BEFORE INSERT OR UPDATE OF cliente_id — advisory lock por cliente, recusa o 4º (23514)
--   clientes_enderecos_minimo_trg  BEFORE DELETE — recusa remover o último endereço quando auth.role() é anon/authenticated;
--                                  o CASCADE de anonimizar_cliente (service_role) passa
-- Migration: 20261002120000_clientes.sql
CREATE TABLE clientes_enderecos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  uuid NOT NULL REFERENCES clientes (id) ON DELETE CASCADE,
  rotulo      text NOT NULL CHECK (char_length(rotulo) BETWEEN 1 AND 30 AND rotulo !~ '[\n\r]'),
  cep         text NOT NULL CHECK (cep ~ '^\d{5}-?\d{3}$'),
  rua         text NOT NULL CHECK (char_length(rua) BETWEEN 1 AND 200),
  numero      text NOT NULL CHECK (char_length(numero) BETWEEN 1 AND 20),
  bairro      text NOT NULL CHECK (char_length(bairro) BETWEEN 1 AND 100),
  cidade      text NOT NULL CHECK (char_length(cidade) BETWEEN 1 AND 100),
  uf          text NOT NULL CHECK (char_length(uf) = 2),
  complemento text CHECK (complemento IS NULL OR char_length(complemento) <= 100),
  padrao      boolean NOT NULL DEFAULT false,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
-- Índices: clientes_enderecos(cliente_id); UNIQUE parcial (cliente_id) WHERE padrao — um padrão por cliente.
```

**Leitura pelo lojista (`SECURITY DEFINER`, `STABLE`, `search_path = ''`, EXECUTE só `authenticated`; migration `20261003124000_clientes_da_loja.sql`):** a RLS de `clientes` não é ampliada; o lojista lê a base só por estas funções, escopadas pela loja de `auth.uid()` (`lojas.dono_id`), sem parâmetro de loja. Só entra cliente com ao menos 1 pedido na loja.

| Função | Faz |
|--------|-----|
| `clientes_da_loja(p_mes smallint = null, p_limite int = 50, p_apos_ultimo timestamptz = null, p_apos_id uuid = null)` | Lista paginada por keyset: ordem `(ultimo_pedido_em, cliente_id) DESC`, cursor = último exibido (os dois nulos na 1ª página; só um deles → `22023`). `p_limite` com teto 100; `p_mes` fora de 1..12 → `22023` (filtro por mês de aniversário) |
| `cliente_da_loja(p_cliente_id uuid)` | Uma linha, mesma allowlist; 0 linhas se o cliente não tem pedido na loja do usuário |

`RETURNS TABLE` fechado = allowlist de 10 colunas: `cliente_id, nome, telefone, dia_aniversario, mes_aniversario, aceita_marketing, total_pedidos, total_cancelados, ultimo_pedido_em, ultimo_pedido_status`. Sem `email`, ano ou `data_nascimento`. `total_pedidos` exclui cancelados; `total_cancelados` os conta; `ultimo_pedido_em`/`ultimo_pedido_status` vêm do pedido mais recente de qualquer status.

### Funções do relatório de vendas

Spec `specs/arquivo/relatorio-vendas.md`. Migrations `20261007124000_relatorio_vendas_funcoes.sql` (financeiras) e `20261007125000_ranking_clientes_fieis.sql` (clientes). Nenhum índice novo (reusa `pedidos(loja_id, criado_em)` e `itens_pedido(pedido_id)`). `revoke` de `public`/`anon` obrigatório em todas.

| Função | Modo | Faz |
|--------|------|-----|
| `status_faturamento(p_so_concluidos bool)` → `text[]` | `IMMUTABLE STRICT` | Fonte única do conjunto de status que fatura: `confirmado, em_preparo, saiu_entrega, entregue` (ou só `entregue`). `null` não casa nada (fail-closed). Lida também pelo ranking |
| `vendas_preparar_consulta(p_loja_id, p_inicio, p_fim, p_tipo_entrega, p_so_concluidos)` → `text` | `INVOKER` | Valida forma (`22023`: loja/faixa obrigatória, `p_fim > p_inicio`, teto de 367 dias, `tipo_entrega` em `entrega`/`retirada`), trava de posse (`42501 'vendas: sem posse da loja'`) e devolve o fuso da loja |
| `vendas_por_dia(...)` | `INVOKER` | Faturamento por dia local da loja: pedidos, bruto, descontos, líquido, frete e `qtd_frete_a_combinar`, somados em `numeric` sobre os valores já gravados |
| `vendas_itens_por_categoria(...)` | `INVOKER` | Itens por categoria congelada (snapshot); valor da linha espelha `totalDaLinha` (`calcularTotal.ts`) incluindo opcionais. Desconto do pedido não é rateado |
| `ranking_clientes_da_loja(p_inicio, p_fim, p_ordem = 'pedidos', p_limite = 20)` | `DEFINER`, `search_path = ''`, EXECUTE só `authenticated` | Ranking de clientes fiéis da loja de `auth.uid()`; `p_ordem` em `pedidos`/`total`/`ultimo`, `p_limite` 1..20, `p_fim` obrigatório (`22023`); ordena e corta no banco; `itens_top` (3 itens) só para o corte. Allowlist: `cliente_id, nome, total_pedidos, total_gasto, ultimo_pedido_em, itens_top` (sem telefone/email) |
| `pedidos_convidados_da_loja(p_inicio, p_fim)` → `integer` | `DEFINER` | Pedidos faturáveis com `cliente_id` NULL (convidado ou anonimizado) no mesmo escopo e período |

As quatro primeiras recebem `p_loja_id` e dependem da trava de posse no corpo (admin entra por `service_role`, escopado por `WHERE loja_id`); as duas de clientes não têm parâmetro de loja. Racional em `seguranca.md` §2.

### `taxas_entrega_duplicadas_182`

```sql
-- Arquivo das duplicatas de taxas_entrega removidas ao criar o índice único em
-- zona_id (issue 182). Por zona_id, sobreviveu a linha de menor ctid (a que a
-- vitrine já lia via taxa[0]); as demais foram arquivadas aqui antes do DELETE.
-- RLS: deny-all permanente — acesso exclusivo via service_role (BYPASSRLS).
-- SEM FK em taxa_id/zona_id (deliberado): o arquivo sobrevive ao delete da linha
-- original e ao delete da própria zona.
-- Migration: 20260909120000_taxas_entrega_zona_id_unique.sql (issue 182)
CREATE TABLE taxas_entrega_duplicadas_182 (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxa_id               uuid NOT NULL,   -- id original em taxas_entrega
  zona_id               uuid NOT NULL,
  taxa                  numeric(10,2) NOT NULL,
  pedido_minimo_gratis  numeric(10,2),
  raio_max_km           numeric(5,2),
  cep_inicio            integer,
  cep_fim               integer,
  arquivado_em          timestamptz NOT NULL DEFAULT now()
);
```

### `cardapios`

> **Função morta desde a issue 320/323** (spec `frequencia-exibicao.md`): substituída pela
> frequência de exibição de `produtos`/`categorias`, acima. `cardapios`, `cardapio_produtos` e a
> coluna `produtos.visibilidade` **permanecem no schema** (não apagar — fora do escopo da spec),
> mas sem leitor no caminho de compra/vitrine: `criarPedido`, `revisarCarrinho` e
> `vitrine_produtos` já não consultam `cardapios`. A migration `20260928132000` converteu todo
> produto `visibilidade='cardapio'` para `'menu'` (permanente); depois dela `visibilidade` só é
> gravável como `'menu'` pelo app (as rotas `/painel/cardapios/*` e o equivalente admin continuam
> existindo e gravando `cardapio_produtos`, só saíram da navegação — não são inatingíveis).

```sql
-- Cardápio sazonal do lojista. Vigência por modo: 'recorrente' (dias_semana/
-- dias_mes/hora_*) ou 'prazo_fixo' (prazo_*). CHECKs impedem configuração
-- incoerente; a AVALIAÇÃO da janela (relógio + fuso da loja) é função pura TS.
-- Migration: 20260920128000_cardapios_checks_vigencia_rls.sql
-- Spec: specs/arquivo/cardapio-sazonal.md
CREATE TABLE cardapios (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id       uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  ordem         int NOT NULL DEFAULT 0,       -- ordem das seções na vitrine
  modo          text NOT NULL CHECK (modo IN ('recorrente','prazo_fixo')),
  -- RECORRENTE
  dias_semana   smallint[],   -- 0=dom..6=sab
  dias_mes      smallint[],   -- 1..31
  hora_inicio   time,         -- INCLUSIVO
  hora_fim      time,         -- EXCLUSIVO
  -- PRAZO FIXO
  prazo_inicio  timestamptz,  -- INCLUSIVO
  prazo_fim     timestamptz,  -- EXCLUSIVO
  prazo_preset  text CHECK (prazo_preset IN ('diario','semanal','mensal','customizado')),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cardapios_id_loja_unico UNIQUE (id, loja_id)  -- alvo das FKs compostas
);
-- RLS: leitura_publica (ativo+loja_esta_ativa), leitura_propria, escrita_propria
-- GRANTs: anon=SELECT / authenticated=CRUD / service_role=ALL
```

### `cardapio_produtos`

```sql
-- Vínculo produto↔cardápio. FKs compostas impedem cross-tenant.
-- Migration: issues 243/244 (spec cardapio-sazonal)
CREATE TABLE cardapio_produtos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id       uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  cardapio_id   uuid NOT NULL,
  produto_id    uuid NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cardapio_id, loja_id) REFERENCES cardapios (id, loja_id) ON DELETE CASCADE,
  FOREIGN KEY (produto_id,  loja_id) REFERENCES produtos  (id, loja_id) ON DELETE CASCADE,
  UNIQUE (cardapio_id, produto_id)
);
-- RLS: mesmas policies da tabela pai (cardapios)
-- GRANTs: anon=SELECT / authenticated=CRUD / service_role=ALL
```

### `modais_sazonais`

```sql
-- Modal de divulgação sazonal curado pelo lojista. A janela exibicao_inicio/
-- exibicao_fim é do OVERLAY (separada da vigência do cardápio — RN-08);
-- a avaliação é do SSR, nunca da policy (RN-02).
-- Invariante: só UM modal ativo por loja (índice único parcial WHERE ativo=true).
-- Toggle mostrar_promocoes_junto: com este modal ativo, o ModalPromocoes também
-- abre? Mora aqui (por modal), não em lojas.
-- Migration: 20260925140000_modais_sazonais_rls.sql
-- mensagem + CHECKs: 20260927120000_modais_sazonais_mensagem.sql (issue 312).
-- Spec: specs/modal-divulgacao-sazonal.md, specs/modal-sazonal-mensagem-formatada.md
CREATE TABLE modais_sazonais (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id                 uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  titulo                  text NOT NULL,
  ativo                   boolean NOT NULL DEFAULT false,
  exibicao_inicio         timestamptz NOT NULL,   -- INCLUSIVO
  exibicao_fim            timestamptz NOT NULL,   -- EXCLUSIVO
  mensagem                jsonb NULL,             -- NULL = sem mensagem; contrato versao 1, RN-M08
  mostrar_promocoes_junto boolean NOT NULL DEFAULT false,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modais_sazonais_id_loja_unico UNIQUE (id, loja_id),
  CONSTRAINT modais_sazonais_janela_ordem CHECK (exibicao_fim > exibicao_inicio),
  -- octet_length(mensagem::text) <= 65536 (RN-M08, CWE-770)
  CONSTRAINT modais_sazonais_mensagem_tamanho CHECK (...),
  -- topo = {versao:1, paragrafos: array 1..20} (RN-M08); validação semântica é do zod (lerMensagemModal)
  CONSTRAINT modais_sazonais_mensagem_forma CHECK (...),
  CONSTRAINT modais_sazonais_titulo_tamanho CHECK (char_length(titulo) BETWEEN 1 AND 120),
  -- backstop de banco contra Trojan Source (CVE-2021-42574) — mesmo conjunto de normalizarObservacao
  CONSTRAINT modais_sazonais_titulo_sem_invisiveis CHECK (...)
);
-- Índice único parcial (invariante um ativo por loja):
--   CREATE UNIQUE INDEX modais_sazonais_um_ativo_por_loja ON modais_sazonais(loja_id) WHERE ativo=true
-- RLS: leitura_publica (ativo+loja_esta_ativa), leitura_propria, escrita_propria
-- GRANTs: anon=SELECT / authenticated=CRUD / service_role=ALL
```

### `modal_sazonal_categorias`

```sql
-- Junção modal sazonal ↔ categoria. FKs compostas impedem cross-tenant.
-- Migration: 20260925140000_modais_sazonais_rls.sql
CREATE TABLE modal_sazonal_categorias (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id          uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  modal_sazonal_id uuid NOT NULL,
  categoria_id     uuid NOT NULL,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (modal_sazonal_id, loja_id) REFERENCES modais_sazonais (id, loja_id) ON DELETE CASCADE,
  FOREIGN KEY (categoria_id,     loja_id) REFERENCES categorias       (id, loja_id) ON DELETE CASCADE,
  UNIQUE (modal_sazonal_id, categoria_id)
);
-- RLS: mesmas policies de modais_sazonais
-- GRANTs: anon=SELECT / authenticated=CRUD / service_role=ALL
```

### `modal_sazonal_cardapios`

```sql
-- Junção modal sazonal ↔ cardápio. FKs compostas impedem cross-tenant.
-- Migration: 20260925140000_modais_sazonais_rls.sql
CREATE TABLE modal_sazonal_cardapios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id          uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  modal_sazonal_id uuid NOT NULL,
  cardapio_id      uuid NOT NULL,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (modal_sazonal_id, loja_id) REFERENCES modais_sazonais (id, loja_id) ON DELETE CASCADE,
  FOREIGN KEY (cardapio_id,      loja_id) REFERENCES cardapios        (id, loja_id) ON DELETE CASCADE,
  UNIQUE (modal_sazonal_id, cardapio_id)
);
-- RLS: mesmas policies de modais_sazonais
-- GRANTs: anon=SELECT / authenticated=CRUD / service_role=ALL
```

### `imagens_loja`

```sql
-- Galeria de imagens da loja: registro de todo objeto do bucket `produtos`.
-- Original (origem_id NULL) aparece na grade; cópia recortada (origem_id preenchido) fica oculta.
-- Migration: 20261006120000_imagens_loja.sql (spec galeria-imagens-loja)
CREATE TABLE imagens_loja (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id             uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  origem_id           uuid NULL,
  caminho             text NOT NULL,   -- relativo ao bucket `produtos`, nunca prefixado por "produtos/"
  miniatura_caminho   text NULL,       -- só da original; NULL em cópia e em legada
  bytes               integer NULL CHECK (bytes IS NULL OR bytes BETWEEN 1 AND 2097152),  -- medido no servidor
  remocao_pendente_em timestamptz NULL,  -- marcada antes de apagar do Storage (banco antes do Storage)
  criado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT imagens_loja_id_loja_unico UNIQUE (id, loja_id),
  CONSTRAINT imagens_loja_caminho_unico UNIQUE (caminho),
  -- FK composta: cópia e original da mesma loja; apagar a original apaga as cópias
  CONSTRAINT imagens_loja_origem_fk FOREIGN KEY (origem_id, loja_id)
    REFERENCES imagens_loja (id, loja_id) ON DELETE CASCADE,
  -- Prefixo = pasta da loja; recusa `..`, `%`, `?`, `#`, `\` e `//`
  CONSTRAINT imagens_loja_caminho_da_loja
    CHECK (starts_with(caminho, loja_id::text || '/') AND position('..' in caminho) = 0 AND caminho !~ '[%?#\\]|//'),
  CONSTRAINT imagens_loja_miniatura_da_loja
    CHECK (miniatura_caminho IS NULL OR (starts_with(miniatura_caminho, loja_id::text || '/')
           AND position('..' in miniatura_caminho) = 0 AND miniatura_caminho !~ '[%?#\\]|//')),
  CONSTRAINT imagens_loja_recorte_sem_miniatura CHECK (origem_id IS NULL OR miniatura_caminho IS NULL)
);
```

- **RLS:** 4 policies para `authenticated` (`imagens_loja_{leitura,insert,update,delete}_propria`), todas por `EXISTS` em `lojas.dono_id = (select auth.uid())`. `anon` sem acesso (a vitrine não lê esta tabela).
- **GRANTs:** `REVOKE ALL FROM public, anon, authenticated`; `authenticated` = `SELECT, INSERT, DELETE` + `UPDATE (remocao_pendente_em)` (grant de coluna, precedente: `clientes`); `service_role` = ALL.
- **Funções** (todas com `REVOKE ALL ... FROM public, anon`, `EXECUTE` a `authenticated` e `service_role`, exceto onde indicado):
  - `caminho_storage_produtos(url text) → text` (`IMMUTABLE`): extrai o caminho relativo ao bucket de uma URL pública `.../storage/v1/object/public/produtos/<caminho>`; ignora o host; `NULL` para outra forma. Fonte única do casamento URL ↔ registro.
  - `uso_imagens_loja(p_loja_id, p_ids uuid[])` (`STABLE`, INVOKER): produtos (até 5, mais o total) e logo que usam a original ou qualquer cópia. Lote 1..50.
  - `remover_imagens_loja(p_loja_id, p_ids uuid[]) → jsonb` (INVOKER): limpa `foto_url`/`logo_url` que usam a original ou cópias, marca todas como pendentes e devolve os caminhos (com miniaturas) para a action apagar do Storage. Lote 1..50 distintos; ids inválidos/alheios são ignorados e contados.
  - `limpar_recortes_sem_uso(p_loja_id) → text[]` (INVOKER): marca recorte sem uso há mais de 24 h e devolve até 50 caminhos pendentes.
  - `importar_imagens_do_storage() → integer` (`SECURITY DEFINER`, backfill M3): registra como original todo objeto do bucket cujo primeiro segmento é id de loja existente (jpeg/png/webp); idempotente (`ON CONFLICT (caminho) DO NOTHING`). Sem `EXECUTE` para `authenticated`.
- **Triggers:**
  - `imagens_loja_origem_disponivel_trg` (BEFORE INSERT, quando `origem_id` não é nulo, INVOKER): recusa cópia de origem pendente ou que já é cópia (23503); `FOR KEY SHARE` serializa com a remoção.
  - `produtos_foto_na_galeria_trg` / `lojas_logo_na_galeria_trg` (BEFORE INSERT/UPDATE de `foto_url`/`loja_id`, `logo_url`; INVOKER): URL nova não nula só passa se o caminho for de linha da mesma loja sem remoção pendente; senão `imagem_fora_da_galeria` (P0001). Reenviar a mesma URL passa (produto legado segue editável).
  - `produtos_recorte_sem_uso_trg` / `lojas_recorte_sem_uso_trg` (AFTER UPDATE/DELETE, `SECURITY DEFINER`): recorte antigo sem outra referência (produto ou logo) é marcado pendente. Nunca toca original nem outra loja. Racional BEFORE INVOKER × AFTER DEFINER em `seguranca.md` §2.

---

## 3. Indexes

```sql
-- Lookup de loja por slug (rota pública /loja/[slug])
CREATE UNIQUE INDEX ON lojas(slug);

-- RN-01: 1 conta = 1 loja (reforça contarLojasDoDono na action de cadastro)
-- Migration: 20260614003500_unique_loja_por_dono.sql
CREATE UNIQUE INDEX lojas_dono_unico ON lojas(dono_id);

-- Produtos por loja (listagem do painel e vitrine)
CREATE INDEX ON produtos(loja_id, disponivel, ordem);

-- Categorias por loja
CREATE INDEX ON categorias(loja_id, ordem);

-- Pedidos por loja ordenados por data (dashboard)
CREATE INDEX ON pedidos(loja_id, criado_em DESC);

-- Idempotência: deduplicação de pedido por loja + chave (NULL excluído do índice)
-- Migration: 20260614009000_pedidos_idempotency_key.sql
CREATE UNIQUE INDEX ON pedidos(loja_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Cupons: busca por código dentro da loja
CREATE UNIQUE INDEX ON cupons(loja_id, codigo);

-- Zonas de entrega por loja
CREATE INDEX ON zonas_entrega(loja_id);

-- Bairros por zona
CREATE INDEX ON bairros_zona(zona_id);

-- taxas_entrega: cardinalidade 1:1 zona→taxa, agora imposta pelo schema (era só
-- convenção do código). Sem isso, `.upsert(..., { onConflict: "zona_id" })` em
-- src/lib/actions/entrega.ts e src/app/admin/assinantes/actions/admin-entrega.ts
-- falha com 42P10 ao EDITAR (não ao criar) zona.
-- Migration: 20260909120000_taxas_entrega_zona_id_unique.sql (issue 182)
CREATE UNIQUE INDEX taxas_entrega_zona_id_key ON taxas_entrega(zona_id);

-- Opcionais por loja/categoria (vitrine e painel)
CREATE INDEX ON opcionais_categorias(loja_id, ordem);
CREATE INDEX ON opcionais(loja_id, categoria_opcional_id, ativo, ordem);
CREATE INDEX ON categoria_produto_opcionais(loja_id, categoria_id);
-- Ordem dos grupos de opcional na vitrine, por categoria de produto (issue 208).
-- Migration: 20260917120000_ordem_em_categoria_produto_opcionais.sql
CREATE INDEX ON categoria_produto_opcionais(loja_id, categoria_id, ordem);
CREATE INDEX ON itens_pedido_opcionais(item_pedido_id);
-- Ocultos da loja (vitrine/painel) e por produto (pedido) — issue 331.
-- Migration: 20260930140000_produto_opcionais_ocultos.sql
CREATE INDEX ON produto_opcionais_ocultos(loja_id, produto_id);

-- Itens de um pedido (embed `itens_pedido(*)` de SELECT_PEDIDO_COM_ITENS).
-- FK sem indice = Seq Scan na tabela inteira a cada leitura de pedido.
-- Migration: 20260906120000_itens_pedido_pedido_id_idx.sql
CREATE INDEX ON itens_pedido(pedido_id);

-- Clientes: retenção (anonimizar_clientes_inativos filtra por ultimo_acesso_em) e endereços por cliente;
-- no máximo um endereço padrão por cliente.
-- Migration: 20261002120000_clientes.sql
CREATE INDEX clientes_ultimo_acesso_em_idx ON clientes(ultimo_acesso_em);
CREATE INDEX clientes_enderecos_cliente_id_idx ON clientes_enderecos(cliente_id);
CREATE UNIQUE INDEX clientes_enderecos_um_padrao_idx ON clientes_enderecos(cliente_id) WHERE padrao;

-- Histórico do cliente e contagem de cupom por cliente; parcial porque a maioria das linhas é convidado (null).
-- Migration: 20261003120000_pedidos_cliente_id.sql
CREATE INDEX pedidos_cliente_id_criado_em_idx ON pedidos(cliente_id, criado_em DESC) WHERE cliente_id IS NOT NULL;

-- Agregação da base de clientes por loja (clientes_da_loja / cliente_da_loja).
-- Migration: 20261003124000_clientes_da_loja.sql
CREATE INDEX pedidos_loja_cliente_idx ON pedidos(loja_id, cliente_id) WHERE cliente_id IS NOT NULL;

-- Auditoria admin por loja, mais recentes primeiro
-- Migration: 20260707122000_admin_acessos.sql
CREATE INDEX ON admin_acessos(loja_id, criado_em DESC);

-- Galeria: grade (originais visíveis, keyset por criado_em, id) e família de uma original (uso, remoção, cascata).
-- Migration: 20261006120000_imagens_loja.sql
CREATE INDEX imagens_loja_grade_idx ON imagens_loja(loja_id, criado_em DESC, id DESC) WHERE origem_id IS NULL AND remocao_pendente_em IS NULL;
CREATE INDEX imagens_loja_origem_idx ON imagens_loja(origem_id) WHERE origem_id IS NOT NULL;
```

---

## 4. RLS — Visão Geral

Ver detalhes completos em `references/seguranca.md`.

Regra geral:
- **Vitrine pública** (produtos, categorias) → SELECT público onde `ativo = true`; loja: leitura anon via `public.vitrine_lojas` (view — nunca `public.lojas` diretamente); projeta `logo_url` entre as colunas públicas
- **Dados do lojista** (cupons, pedidos, formas_pagamento, zonas) → somente `auth.uid() = lojas.dono_id`
- **INSERT de pedido** → só pela RPC `criar_pedido` sob `service_role` (Server Action de checkout;
  cliente sem login); `anon`/`authenticated` sem INSERT direto (migration `20260923060457`)
- **`papeis_usuario`** → SELECT só das próprias linhas (`usuario_id = auth.uid()`); escrita só via `service_role` (`atribuir_papel_inicial`)
- **`clientes`** → SELECT e UPDATE só da própria linha (`id = auth.uid()`), UPDATE com grant só nas colunas editáveis; INSERT/DELETE só via `criar_perfil_cliente`/`anonimizar_cliente` (`service_role`). Lojista e anon não leem
- **`clientes_enderecos`** → CRUD só dos próprios (`cliente_id = auth.uid()`); teto de 3 e mínimo de 1 impostos por trigger, não só pela action
- **`pedidos` / `itens_pedido` / `itens_pedido_opcionais`** → além do lojista, `authenticated` lê os próprios com policy só SELECT (`pedidos_select_cliente`: `cliente_id = auth.uid()`; `itens_pedido_select_cliente` e `itens_pedido_opcionais_select_cliente` via `EXISTS` até `pedidos`). Nenhuma escrita para o cliente; `anon` continua sem SELECT (convidado só por `token_acesso`)
- **`webhook_eventos_hotmart`** → deny-all permanente; acesso exclusivo via `service_role`
- **`admin_acessos`** → deny-all permanente; acesso exclusivo via `service_role` (trilha de auditoria de acesso admin, issues 146/147)
- **`imagens_loja`** → dono lê/insere/atualiza/apaga só da própria loja (`EXISTS` em `lojas.dono_id`); UPDATE com grant só em `remocao_pendente_em`; `anon` sem acesso. Admin opera sob `service_role` com `loja_id` explícito
- **`taxas_entrega_duplicadas_182`** → deny-all permanente; acesso exclusivo via `service_role` (arquivo de dedup do índice único de `taxas_entrega.zona_id`, issue 182)

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
| `lojas.assinatura_status` | `trial`, `ativa`, `inadimplente`, `cancelada`, `suspensa`, `cortesia` |
| `lojas.modo_frete` | `automatico`, `a_combinar` |

---

## 6. Convenções

- Todo campo de data usa `timestamptz` (com fuso) — nunca `timestamp`
- Todo `id` é `uuid` gerado pelo Postgres (`gen_random_uuid()`)
- Campos de valor monetário: `numeric(10,2)` — nunca `float` (arredondamento)
- `ON DELETE CASCADE` em dados filhos da loja — deletar loja limpa tudo
- `ON DELETE SET NULL` em produto referenciado em pedido — histórico preservado
- Snapshots em `itens_pedido.nome` e `itens_pedido.preco` — pedido não muda se produto for editado (`itens_pedido.observacao`, `preco_original` e `categoria_*_snapshot` são da mesma família; categoria sem FK de propósito)
- Tipos gerados automaticamente: `npx supabase gen types typescript > src/lib/database.types.ts`
- **Operações multi-tabela atômicas com trava de concorrência** usam função Postgres `SECURITY INVOKER` + `SET search_path = public` + `REVOKE ALL FROM public, anon, authenticated` + `GRANT EXECUTE TO service_role`. Exemplo: `public.criar_pedido(...)` (migration `20260614003000_rpc_criar_pedido.sql`). Nunca INSERT direto da action quando atomicidade ou trava de linha for necessária.
- **Escrita em lote com valor diferente por linha** (PostgREST não faz `update-many` heterogêneo) tem duas variantes, não uma regra só — ver `seguranca.md` §2 para o racional completo e as sete travas da segunda:
  - **`SECURITY INVOKER`** quando só o lojista escreve e a RLS avaliada sob o invoker é a autoridade única. Exemplo: `public.reordenar_categorias(...)` (migration `20260908120000_rpc_reordenar_categorias.sql`, permutação é da loja inteira), `SET search_path = public` + `GRANT EXECUTE TO authenticated`. Segundo exemplo, estruturalmente diferente (não é permutação, é escrita atômica de linha + junções): `public.salvar_modal_sazonal(...)` (migration `20260927121000_rpc_salvar_modal_sazonal.sql`, issue 312/314) — grava `modais_sazonais` + `modal_sazonal_categorias` + `modal_sazonal_cardapios` numa única transação; as policies `*_escrita_propria` continuam a autoridade, com posse da loja (`lojas.dono_id = auth.uid()`) reconferida explicitamente no corpo como segunda camada — ver `seguranca.md` §2.
  - **`SECURITY DEFINER` + travas T1–T7 no corpo** (`SET search_path = public, pg_temp` + `GRANT EXECUTE TO authenticated, service_role`) quando a mesma função precisa servir também a via admin sob `service_role`, que tem `BYPASSRLS` e por isso nunca foi coberta pela RLS em nenhum dos dois modos. Exemplos: `public.reordenar_opcionais_da_categoria(...)` (migration `20260917121000_rpc_reordenar_opcionais_da_categoria.sql`, issue 208 — permutação do **par** loja+categoria de produto, `categoria_id` como escopo extra vindo do cliente; convertida de invoker para definer pela migration `20260918121000_rpc_reordenar_opcionais_da_categoria_definer.sql`, issue 215) e `public.reordenar_itens_do_grupo_opcional(...)` (migration `20260918120000_rpc_reordenar_itens_do_grupo_opcional.sql`, issue 215/216 — nova, permutação do **par** loja+grupo de opcional, inclusive itens `ativo = false`). Fail-open de `auth.role()` sem JWT corrigido por `20260918130000_rpc_ordem_t2_fail_closed.sql`. Terceira instância: `public.aplicar_cardapio_em_categoria(...)` (migration `20260921120000_rpc_aplicar_cardapio_em_categoria_definer.sql`, issue 269 — convertida de invoker, `20260920134000`), estruturalmente diferente das duas anteriores: não é reordenação, é `insert … select` idempotente (`on conflict do nothing`), sem T4 (permutação completa) nem comparação de `row_count` — ver `seguranca.md` §2.
