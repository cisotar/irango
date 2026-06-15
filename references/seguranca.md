# Segurança — iRango

**Versão:** 0.2.9 | **Atualizado:** 2026-06-15

> Decisões de segurança, isolamento multitenant e RLS. Toda nova tabela deve ter política RLS antes de ir pra produção.

---

## Sumário

1. [Princípio Base](#1-princípio-base)
2. [Row Level Security (RLS)](#2-row-level-security-rls)
3. [Server vs Client](#3-server-vs-client)
4. [Autenticação](#4-autenticação)
5. [Proteção DDoS e Abuso](#5-proteção-ddos-e-abuso)
6. [Inputs e Validação](#6-inputs-e-validação)
7. [Variáveis de Ambiente](#7-variáveis-de-ambiente)
8. [Dados Pessoais — Proibição de Hardcode](#8-dados-pessoais--proibição-de-hardcode)
9. [APIs Externas](#9-apis-externas--ocultar-sempre-que-possível)
10. [Recálculo de Valores no Servidor](#10-recálculo-de-valores-no-servidor)
11. [Headers HTTP de Segurança](#11-headers-http-de-segurança)
12. [Rate Limiting](#12-rate-limiting)
13. [Upload de Imagens](#13-upload-de-imagens)
14. [Tratamento de Erros](#14-tratamento-de-erros)
15. [XSS e Renderização](#15-xss-e-renderização)
16. [Dependências e CI](#16-dependências-e-ci)
17. [Confirmação de Email](#17-confirmação-de-email)
18. [Supabase Storage — RLS](#18-supabase-storage--rls)
19. [Views e security_invoker](#19-views-e-security_invoker)
20. [LGPD](#20-lgpd)

---

## 1. Princípio Base

**O banco é a última linha de defesa.** Não confiar em validação feita só no client. Todo acesso a dados passa por RLS — mesmo que o client seja comprometido, o banco recusa operações não autorizadas.

---

## 2. Row Level Security (RLS)

### Habilitar em todas as tabelas

```sql
ALTER TABLE lojas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cupons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_pedido   ENABLE ROW LEVEL SECURITY;
ALTER TABLE zonas_entrega  ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxas_entrega  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bairros_zona   ENABLE ROW LEVEL SECURITY;
ALTER TABLE formas_pagamento           ENABLE ROW LEVEL SECURITY;
ALTER TABLE opcionais_categorias       ENABLE ROW LEVEL SECURITY;
ALTER TABLE opcionais                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE categoria_produto_opcionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE itens_pedido_opcionais     ENABLE ROW LEVEL SECURITY;
```

### Políticas por tabela

#### `lojas`

Leitura pública da tabela `lojas` foi **removida**. Leitura anon é feita pela view `public.vitrine_lojas` (ver §19). A tabela base expõe colunas sensíveis (`dono_id`, `assinatura_*`, `hotmart_*`, `consentimento_*`) que não devem ser acessíveis ao anon.

```sql
-- Lojista lê a própria loja mesmo inativa
CREATE POLICY "lojas_leitura_propria"
  ON lojas FOR SELECT
  USING (auth.uid() = dono_id);

-- Lojista cria sua loja
CREATE POLICY "lojas_insert_proprio"
  ON lojas FOR INSERT
  WITH CHECK (auth.uid() = dono_id);

-- Lojista edita só a própria
-- WITH CHECK obrigatório: sem ele um UPDATE poderia trocar dono_id,
-- transferindo a loja para outro usuário.
CREATE POLICY "lojas_update_proprio"
  ON lojas FOR UPDATE
  USING (auth.uid() = dono_id)
  WITH CHECK (auth.uid() = dono_id);

-- Lojista deleta só a própria
CREATE POLICY "lojas_delete_proprio"
  ON lojas FOR DELETE
  USING (auth.uid() = dono_id);
```

> **Nota sobre RLS vs. colunas de billing:** RLS filtra LINHA, não COLUNA. As policies acima permitem que o lojista autenticado faça UPDATE na própria linha — sem proteção adicional, isso incluiria escrever `assinatura_status`, `assinatura_inicio`, `assinatura_fim_periodo`, `assinatura_atualizada_em`, `hotmart_subscriber_code`, `hotmart_plano` e `dono_id` via PostgREST (vetor de auto-promoção). O gate real de coluna é o trigger abaixo.

#### Trigger `lojas_protege_billing_trg` — gate de coluna de billing

Migration: `20260614004500_lojas_protege_billing.sql`

```sql
-- BEFORE UPDATE TRIGGER: bloqueia qualquer role ≠ service_role/postgres de
-- alterar as colunas de billing ou o dono_id.
-- Fecha o vetor: lojista com JWT válido não consegue escrever
-- assinatura_status='ativa' via PATCH direto no PostgREST.
CREATE TRIGGER lojas_protege_billing_trg
  BEFORE UPDATE ON lojas
  FOR EACH ROW EXECUTE FUNCTION lojas_protege_billing();
```

A função `lojas_protege_billing()` verifica `current_role` e levanta `EXCEPTION` se qualquer uma das colunas protegidas mudar fora de `service_role` ou `postgres`. A allowlist da Server Action de cadastro é camada extra de defesa (filtro no código), não o gate primário — o trigger é o gate primário no banco.

#### Helper `public.loja_esta_ativa(uuid) → boolean`

Migration: `20260614002000_rls_catalogo.sql`

Função `security definer` usada pelas policies de leitura pública de catálogo para verificar se uma loja está ativa sem expor a linha de `lojas` ao anon.

```sql
CREATE FUNCTION public.loja_esta_ativa(p_loja_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.lojas WHERE lojas.id = p_loja_id AND lojas.ativo = true);
$$;

REVOKE ALL ON FUNCTION public.loja_esta_ativa(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.loja_esta_ativa(uuid) TO anon, authenticated, service_role;
```

**Por que não usar `EXISTS (SELECT 1 FROM lojas WHERE ativo = true)` diretamente nas policies:**

A tabela `lojas` não tem SELECT público para anon (§19 — a vitrine usa `vitrine_lojas`). Um `EXISTS` contra `lojas` rodando sob RLS do anon retorna sempre zero linhas, tornando o catálogo inteiro invisível. A função `security definer` contorna esse bloqueio respondendo só o booleano — não expõe `dono_id`, `assinatura_*`, `hotmart_*` nem `consentimento_*`.

**Regra para devs e agentes:** toda policy de leitura pública de catálogo (produtos, categorias, formas de pagamento) que precise verificar se a loja está ativa deve usar `public.loja_esta_ativa(loja_id)`. Nunca copiar o padrão `EXISTS (SELECT 1 FROM lojas WHERE ativo = true)` — quebra silenciosamente para anon.

---

#### Helper `public.pedido_aceita_itens(uuid) → boolean`

Migration: `20260614002500_rls_cupons_pedidos.sql`

Função `security definer` usada pela policy `itens_pedido_insert_publico` para verificar se um pedido aceita novos itens sem expor a tabela `pedidos` ao anon.

```sql
CREATE FUNCTION public.pedido_aceita_itens(p_pedido_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pedidos p
    JOIN public.lojas l ON l.id = p.loja_id
    WHERE p.id = p_pedido_id
      AND p.status = 'pendente'
      AND l.ativo = true
  );
$$;

REVOKE ALL ON FUNCTION public.pedido_aceita_itens(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.pedido_aceita_itens(uuid) TO anon, authenticated, service_role;
```

**Por que não usar `EXISTS (SELECT 1 FROM pedidos …)` diretamente na policy:**

A tabela `pedidos` não tem SELECT público para anon (anti-enumeração de pedidos alheios). Um `EXISTS` contra `pedidos` rodando sob RLS do anon retorna sempre zero linhas, bloqueando todo INSERT de item. A função `security definer` contorna isso respondendo só o booleano — mesmo padrão de `loja_esta_ativa`.

**Regra para devs e agentes:** toda policy de INSERT público em `itens_pedido` deve usar `public.pedido_aceita_itens(pedido_id)`. Nunca `WITH CHECK (true)` — permite anexar item a pedido alheio ou pedido já confirmado/cancelado. Nunca `EXISTS` direto em `pedidos` — quebra silenciosamente para anon.

---

#### Helper `public.item_pedido_aceita_opcionais(uuid) → boolean`

Migration: `20260614007500_opcionais.sql`

Função `security definer` usada pela policy `ipo_insert_publico` em `itens_pedido_opcionais` para verificar se um item de pedido aceita opcionais sem expor `pedidos`/`itens_pedido` ao anon. Mesmo padrão de `pedido_aceita_itens` — reusa `loja_esta_ativa` internamente.

```sql
CREATE FUNCTION public.item_pedido_aceita_opcionais(p_item_pedido_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.itens_pedido ip
    JOIN public.pedidos p ON p.id = ip.pedido_id
    WHERE ip.id = p_item_pedido_id
      AND p.status = 'pendente'
      AND public.loja_esta_ativa(p.loja_id)
  );
$$;

REVOKE ALL ON FUNCTION public.item_pedido_aceita_opcionais(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.item_pedido_aceita_opcionais(uuid) TO anon, authenticated, service_role;
```

**Por que não usar `EXISTS` direto nas policies:**

As tabelas `pedidos` e `itens_pedido` não têm SELECT público para anon (anti-enumeração). Um `EXISTS` rodando sob RLS do anon retorna sempre zero linhas, bloqueando todo INSERT de opcional. A função `security definer` contorna isso respondendo só o booleano — não expõe dados do pedido.

**Regra para devs e agentes:** toda policy de INSERT público em `itens_pedido_opcionais` deve usar `public.item_pedido_aceita_opcionais(item_pedido_id)`. Nunca `WITH CHECK (true)` — permite anexar opcional a item alheio. Nunca `EXISTS` direto em `itens_pedido`/`pedidos` — quebra silenciosamente para anon.

---

#### `produtos`

```sql
-- Leitura pública de produtos disponíveis
-- Usa public.loja_esta_ativa() em vez de EXISTS direto em lojas:
-- a tabela base não tem SELECT público para anon (§19), então um EXISTS
-- rodando sob RLS retornaria zero linhas e o catálogo ficaria invisível.
CREATE POLICY "produtos_leitura_publica"
  ON produtos FOR SELECT
  USING (
    disponivel = true
    AND public.loja_esta_ativa(produtos.loja_id)
  );

-- Lojista vê todos os próprios (disponível ou não)
CREATE POLICY "produtos_leitura_propria"
  ON produtos FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM lojas WHERE lojas.id = produtos.loja_id AND lojas.dono_id = auth.uid())
  );

-- Lojista gerencia os próprios
CREATE POLICY "produtos_escrita_propria"
  ON produtos FOR ALL
  USING (
    EXISTS (SELECT 1 FROM lojas WHERE lojas.id = produtos.loja_id AND lojas.dono_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM lojas WHERE lojas.id = produtos.loja_id AND lojas.dono_id = auth.uid())
  );
```

#### `categorias` — mesmo padrão de `produtos`

```sql
CREATE POLICY "categorias_leitura_publica"
  ON categorias FOR SELECT
  USING (public.loja_esta_ativa(categorias.loja_id));

CREATE POLICY "categorias_escrita_propria"
  ON categorias FOR ALL
  USING (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = categorias.loja_id AND lojas.dono_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = categorias.loja_id AND lojas.dono_id = auth.uid()));
```

#### `cupons`

> ⚠️ **NÃO criar policy de SELECT público em cupons.** Listar cupons ativos no client vaza a estratégia comercial inteira (concorrente baixa a tabela) e expõe cupons secretos/não divulgados.

```sql
-- Cupons: SOMENTE o lojista dono lê e gerencia
CREATE POLICY "cupons_acesso_proprio"
  ON cupons FOR ALL
  USING (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = cupons.loja_id AND lojas.dono_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = cupons.loja_id AND lojas.dono_id = auth.uid()));
```

**Validação de cupom pelo cliente = Server Action**, nunca SELECT aberto:

```ts
// app — Server Action roda com service role ou query escopada por loja_id
// Cliente envia { loja_id, codigo }. Servidor busca UM cupom, valida e retorna só o desconto.
async function validarCupom(loja_id: string, codigo: string, subtotal: number) {
  const cupom = await buscarCupom(loja_id, codigo)  // WHERE loja_id = $1 AND codigo = $2
  if (!cupom || !cupom.ativo) return { valido: false }
  if (cupom.expira_em && cupom.expira_em < agora()) return { valido: false }
  if (subtotal < cupom.pedido_minimo) return { valido: false }
  if (cupom.usos_maximos && cupom.usos_contagem >= cupom.usos_maximos) return { valido: false }
  return { valido: true, desconto: calcularDesconto(cupom, subtotal) }
}
```

O cliente nunca recebe a lista de cupons — só um veredito (`válido` + valor do desconto) para o código que digitou.

#### `pedidos`

> ⚠️ **Problema:** cliente cria pedido sem login mas precisa ler a confirmação (`/loja/[slug]/confirmacao`). SELECT público vazaria nome/telefone/endereço de **todos** os clientes. Solução: **token de acesso por pedido**.

Schema exige coluna nova (ver `schema.md`):

```sql
ALTER TABLE pedidos ADD COLUMN token_acesso uuid NOT NULL DEFAULT gen_random_uuid();
```

Policies:

```sql
-- Cliente cria pedido sem login — só em loja ativa (endurecida: não mais WITH CHECK (true))
CREATE POLICY "pedidos_insert_publico"
  ON pedidos FOR INSERT
  WITH CHECK (public.loja_esta_ativa(loja_id));

-- Lojista vê e gerencia pedidos da própria loja
-- WITH CHECK anti-troca de loja_id: impede UPDATE que mova pedido para outra loja
CREATE POLICY "pedidos_acesso_lojista"
  ON pedidos FOR ALL
  USING  (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = pedidos.loja_id AND lojas.dono_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = pedidos.loja_id AND lojas.dono_id = auth.uid()));
```

**Leitura pela confirmação = Server Component escopado por token**, nunca SELECT público:

```ts
// app/(publica)/loja/[slug]/confirmacao/page.tsx
// URL: /loja/[slug]/confirmacao?pedido=<id>&token=<token_acesso>
// Server Action/Component busca: WHERE id = $1 AND token_acesso = $2
const pedido = await buscarPedidoPorToken(pedidoId, token)
if (!pedido) notFound()
```

O token é gerado no INSERT e funciona como senha do pedido. Sem token + id corretos, ninguém lê o pedido. Não criar policy de SELECT público em `pedidos`.

**Regra para devs e agentes:**
- INSERT anon em `pedidos` não usa `RETURNING` (não há SELECT anon; `RETURNING` exige SELECT policy).
- A Server Action lê o token do pedido **depois** via `service_role` (`WHERE id = $1 AND token_acesso = $2`), nunca via anon.
- Toda leitura de pedido pelo cliente final (confirmação, status) usa `service_role` com o token como segundo fator — nunca SELECT anon.

#### `itens_pedido`

```sql
-- Cliente insere itens (sem login) — só em pedido pendente de loja ativa (endurecida: não mais WITH CHECK (true))
-- Usa helper security definer porque anon não tem SELECT em pedidos (ver helper abaixo)
CREATE POLICY "itens_pedido_insert_publico"
  ON itens_pedido FOR INSERT
  WITH CHECK (public.pedido_aceita_itens(pedido_id));

-- Lojista vê itens dos próprios pedidos
CREATE POLICY "itens_pedido_lojista"
  ON itens_pedido FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pedidos
      JOIN lojas ON lojas.id = pedidos.loja_id
      WHERE pedidos.id = itens_pedido.pedido_id
        AND lojas.dono_id = auth.uid()
    )
  );
```

> A confirmação do cliente lê os itens via Server Component escopado por token do pedido (mesma rota da seção `pedidos`) — não via SELECT público.

#### `zonas_entrega`, `taxas_entrega`, `bairros_zona`, `formas_pagamento`

```sql
-- Leitura pública (vitrine precisa calcular frete e exibir formas de pagamento)
-- Filhas filtram pela zona ativa — consistente com zonas_entrega, não vaza zona inativa
CREATE POLICY "zonas_leitura_publica" ON zonas_entrega FOR SELECT USING (ativo = true);
CREATE POLICY "taxas_leitura_publica" ON taxas_entrega FOR SELECT
  USING (EXISTS (SELECT 1 FROM zonas_entrega z WHERE z.id = taxas_entrega.zona_id AND z.ativo = true));
CREATE POLICY "bairros_leitura_publica" ON bairros_zona FOR SELECT
  USING (EXISTS (SELECT 1 FROM zonas_entrega z WHERE z.id = bairros_zona.zona_id AND z.ativo = true));
-- Filtra por loja ativa (não USING(true)): sem isso, config Pix de loja inativa vaza ao anon.
CREATE POLICY "pagamentos_leitura_publica" ON formas_pagamento FOR SELECT
  USING (public.loja_esta_ativa(formas_pagamento.loja_id));

-- Escrita: só lojista dono
CREATE POLICY "zonas_escrita_propria" ON zonas_entrega FOR ALL
  USING (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = zonas_entrega.loja_id AND lojas.dono_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lojas WHERE lojas.id = zonas_entrega.loja_id AND lojas.dono_id = auth.uid()));

-- (idem taxas_entrega via zona → loja, bairros_zona via zona → loja, formas_pagamento via loja)
```

---

## 3. Server vs Client

| Operação | Onde roda | Por quê |
|----------|-----------|---------|
| Buscar dados da vitrine | Server Component | SSR + RLS garante isolamento |
| Buscar dados do painel | Server Component / Server Action | nunca expor service role no client |
| Criar pedido | Server Action | valida estoque, cupom, frete no servidor |
| Auth check no painel | `middleware.ts` + layout server | double-check: middleware bloqueia, layout confirma |
| Formulários | Client Component (react-hook-form) | UX — validação instantânea |
| Submit de form | Server Action | validação Zod no servidor, nunca confiar no client |

### Chaves Supabase

- `NEXT_PUBLIC_SUPABASE_URL` — pública (ok no client)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — pública, RLS protege os dados
- `SUPABASE_SERVICE_ROLE_KEY` — **nunca no client, nunca no repositório** — só em Server Actions e route handlers internos

---

## 4. Autenticação

- Sessão via cookies HttpOnly gerenciados por `@supabase/ssr`
- `middleware.ts` refresha token em toda request — sem sessão expirada silenciosa
- Painel: guard duplo (middleware + layout server-side)
- Vitrine: sem auth — acesso público lido via anon key + RLS

---

## 5. Proteção DDoS e Abuso

### Por que Supabase e não Firebase

Firebase cobra por leitura — DDoS gera conta ilimitada. Supabase Pro = $25 fixo. Ataque derruba performance, não gera débito.

### Camadas de proteção

1. **Vercel** — rate limiting básico por IP no edge
2. **Supabase** — connection pooling via PgBouncer limita conexões simultâneas
3. **RLS** — queries de bots retornam só dados públicos, nunca dados de outros lojistas

### Abuso de criação de pedido (spam)

INSERT público em `pedidos` sem trava = bot enche a tabela de graça. Mitigar com rate limiting na Server Action de criar pedido (ver seção 12) + validação de payload (seção 6) + recálculo de valores (seção 10).

### Se DDoS virar problema sério

Migrar hosting pra **Cloudflare Pages** — WAF e rate limiting inclusos no plano gratuito. Supabase não muda.

---

## 6. Inputs e Validação

### Regra: validar na borda E no servidor

```ts
// lib/validacoes/produto.ts — schema único
export const schemaProduto = z.object({
  nome: z.string().min(1).max(200),
  preco: z.number().positive(),
  disponivel: z.boolean(),
})

// FormProduto.tsx — valida no client (UX)
const form = useForm({ resolver: zodResolver(schemaProduto) })

// Server Action — valida no servidor (segurança)
const dados = schemaProduto.parse(formData)
```

### Slug da loja

- Apenas `[a-z0-9-]` — validado no Zod e com `UNIQUE` no banco
- Gerado automaticamente a partir do nome, editável pelo lojista

---

## 7. Variáveis de Ambiente

### Regras absolutas — sem exceção

> ❌ **NUNCA commitar qualquer key, secret ou .env no repositório.**
> ❌ **NUNCA expor secret no frontend — inacessível no DevTools do browser.**
> ✅ Secrets vivem APENAS no servidor. Cliente nunca os vê.

### Classificação obrigatória

| Variável | Prefixo `NEXT_PUBLIC_` | Onde pode usar | Visível no DevTools? |
|----------|----------------------|---------------|----------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ sim | client + server | sim — é intencional |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ sim | client + server | sim — RLS protege os dados |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ **jamais** | só Server Actions e Route Handlers | **não — nunca chega ao browser** |
| `HOTMART_WEBHOOK_TOKEN` | ❌ **jamais** | só Route Handler `/api/webhooks/hotmart` | **não** |
| Qualquer outra key/secret | ❌ **jamais** | só servidor | **não** |

### `createServiceClient()` — módulo server-only

`src/lib/supabase/service.ts` exporta `createServiceClient()`, que cria um cliente Supabase com a `SERVICE_ROLE_KEY` (BYPASSRLS). O arquivo tem `import "server-only"` no topo — o build quebra se qualquer código `'use client'` tentar importá-lo.

**Regra:** só usar em Server Action ou Route Handler. Toda query feita com este cliente **deve escopar manualmente** (por `loja_id`, token, etc.) — RLS não protege.

Casos de uso aprovados: validar cupom por código (issue 013), criar pedido via RPC (issue 014), ler pedido por `id + token_acesso` (issues 026/037), checar unicidade de slug (issue 030), webhook Hotmart (issue 057).

### Regra do prefixo Next.js

Next.js expõe pro browser **apenas** variáveis com prefixo `NEXT_PUBLIC_`. Qualquer variável sem esse prefixo é invisível no client — mesmo que o código tente acessar, retorna `undefined`.

```ts
// ✅ seguro — só roda no servidor (Server Action, Route Handler)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // sem NEXT_PUBLIC_ = nunca vai pro browser
)

// ❌ PROIBIDO — nunca fazer isso em Client Component
// process.env.SUPABASE_SERVICE_ROLE_KEY em 'use client' = undefined, mas é um risco arquitetural
```

### Onde ficam os valores

| Ambiente | Onde configurar | Commitar? |
|----------|----------------|-----------|
| Desenvolvimento local | `.env.local` | **NÃO** — está no `.gitignore` |
| Produção (Vercel) | Dashboard Vercel → Environment Variables | **NÃO** — nunca em arquivo |
| CI/CD | GitHub Secrets | **NÃO** — nunca em arquivo |

### .gitignore obrigatório

```
.env
.env.local
.env.*.local
.env.production
```

### Checklist antes de todo commit

- [ ] Nenhum arquivo `.env*` staged
- [ ] Nenhuma key/token hardcoded no código (grep por `eyJ`, `sk_`, `pk_`, `Bearer`)
- [ ] Nenhum `console.log` de variável de ambiente em código de produção

### Se uma key vazar no repositório

1. **Revogar imediatamente** no painel Supabase/provedor — a key está comprometida independente de qualquer outra ação
2. Gerar nova key
3. Atualizar no Vercel e `.env.local`
4. Remover do histórico git (`git filter-repo` ou BFG) — mas revogar vem primeiro

---

## 8. Dados Pessoais — Proibição de Hardcode

> ❌ **NUNCA hardcodar dado pessoal em código, comentário, seed de produção ou arquivo de configuração.**

Dado pessoal = qualquer informação que identifica ou pode identificar uma pessoa: nome, email, CPF, telefone, endereço, WhatsApp, chave Pix.

### O que é proibido

```ts
// ❌ PROIBIDO — email hardcoded
const ADMIN_EMAIL = "joao@minhaloja.com.br"

// ❌ PROIBIDO — telefone hardcoded
const whatsapp = "5511999999999"

// ❌ PROIBIDO — dado pessoal em seed de produção
INSERT INTO lojas (nome, whatsapp) VALUES ('Loja do João', '5511999999999');

// ❌ PROIBIDO — dado pessoal em comentário de código
// lojista teste: fulano@gmail.com senha: 123456
```

### O que é permitido

```ts
// ✅ seed só com dados fictícios e explicitamente marcados como teste
INSERT INTO lojas (nome, slug) VALUES ('Loja Teste', 'loja-teste');

// ✅ dado vem do banco ou variável de ambiente, nunca literal no código
const adminEmail = process.env.SEED_ADMIN_EMAIL
```

### Regra para seeds e dados de teste

- `supabase/seed.sql` usa **apenas dados fictícios** (nomes, emails, telefones inventados)
- Nunca usar email ou telefone real de nenhuma pessoa (nem do próprio dono do projeto)
- Dados de teste de produção (contas reais para smoke test) ficam no `.env.local` — nunca no código

---

## 9. APIs Externas — Ocultar Sempre que Possível

> ✅ **Toda chamada a API externa que exige key deve passar pelo servidor.**
> ❌ **Client nunca chama API externa com credencial diretamente.**

### Regra geral

Se uma API tem key/token → a chamada vai no servidor (Server Action ou Route Handler). O browser só recebe o resultado, nunca a credencial.

```ts
// ❌ PROIBIDO — key exposta no browser, visível no DevTools (Network tab)
const res = await fetch(`https://api.externa.com/dados?key=${process.env.NEXT_PUBLIC_MINHA_KEY}`)

// ✅ correto — Server Action ou Route Handler faz a chamada
// app/api/dados/route.ts (Route Handler — roda no servidor)
export async function GET() {
  const res = await fetch('https://api.externa.com/dados', {
    headers: { Authorization: `Bearer ${process.env.API_KEY_EXTERNA}` }
  })
  const dados = await res.json()
  return Response.json(dados)
}
```

### APIs usadas no iRango e como proteger

| API | Key necessária? | Onde chamar |
|-----|----------------|-------------|
| ViaCEP (autocomplete CEP) | ❌ não | client — API pública sem credencial |
| Supabase anon | ✅ sim (pública por design) | client + server — RLS protege |
| Supabase service role | ✅ sim (secreta) | **só servidor** |
| Qualquer API de notificação futura (ex: WhatsApp Business) | ✅ sim | **só servidor** |
| Qualquer API de pagamento futura | ✅ sim | **só servidor** |

### Variáveis de API externa

```
# .env.local
API_KEY_EXTERNA=sk_...        # sem NEXT_PUBLIC_ = nunca vai pro browser
WEBHOOK_SECRET=whsec_...      # idem
```

### ViaCEP — exceção documentada

ViaCEP é pública, sem autenticação, sem key. Pode ser chamada diretamente do client. Qualquer outra API que adicionar no futuro: avaliar se tem credencial → se sim, mover pro servidor.

### Webhook Hotmart — ÚNICA autoridade de billing

`POST /api/webhooks/hotmart` — Route Handler público, runtime `nodejs`. Hotmart notifica eventos de compra/cancelamento/renovação; este handler é o único caminho pelo qual `assinatura_status` (e campos relacionados) pode mudar para `ativa`/`inadimplente`/`cancelada` — nunca via client, nunca via Server Action do painel.

**Sequência de segurança (todas as etapas obrigatórias na ordem):**

1. **Validação do `hottok` antes de qualquer efeito:** compara o header `x-hotmart-hottok` com `HOTMART_WEBHOOK_TOKEN` usando `timingSafeEqual` (Node.js `crypto`) — protege contra timing attack. Retorna `401` sem nenhum efeito colateral se inválido.
2. **Idempotência via trava de INSERT:** `INSERT INTO webhook_eventos_hotmart (evento_id, ...) ON CONFLICT (evento_id) DO NOTHING`. O `UNIQUE` em `evento_id` garante que replay ou entrega dupla da Hotmart resultem em no-op — o status da loja não é aplicado duas vezes. Evento já visto retorna `200` imediatamente.
3. **Lookup loja → email do comprador:** função SECURITY DEFINER `public.loja_por_email_dono(email text) → uuid` busca a loja pelo email do dono sem expor a tabela `lojas` ao anon. Executada via `service_role`.
4. **Mapeamento de evento para status:** função `eventoParaStatus(tipo)` converte o tipo do evento Hotmart (ex: `'PURCHASE_APPROVED'`) para `assinatura_status` do domínio (`'ativa'`, `'inadimplente'`, `'cancelada'`). Evento desconhecido → log + `200` (não rejeita para evitar retry infinito da Hotmart).
5. **Aplicação via `service_role`:** UPDATE em `lojas` executado com `createServiceClient()` — único role que passa pelo trigger `lojas_protege_billing_trg` (§2). Loja com status `cancelada` **não é reativada** por evento de renovação de assinatura cancelada — a lógica verifica o status atual antes de aplicar.

**Função `public.loja_por_email_dono(email text) → uuid`**

Migration: `20260614004500_lojas_protege_billing.sql`

```sql
-- SECURITY DEFINER: o webhook (service_role) busca a loja pelo email do comprador
-- sem precisar de SELECT público em lojas. Retorna NULL se não encontrar.
CREATE FUNCTION public.loja_por_email_dono(p_email text)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT l.id FROM public.lojas l
  JOIN auth.users u ON u.id = l.dono_id
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.loja_por_email_dono(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loja_por_email_dono(text) TO service_role;
```

**Regra para devs e agentes:** nenhuma Server Action do painel pode alterar `assinatura_status`. Todo update de billing passa exclusivamente por este Route Handler — validação de token + idempotência + trigger de banco. Jamais criar atalho "admin" que escreva status de assinatura diretamente via PostgREST ou Server Action autenticada.

---

## 10. Recálculo de Valores no Servidor

> 🔴 **O risco mais crítico de um marketplace.** O cliente NUNCA define o quanto paga.

### O ataque

O carrinho vive no browser. Cliente malicioso abre o DevTools, intercepta o payload do pedido e edita `total`, `preco`, `taxa_entrega` ou `desconto` antes de enviar:

```
Cliente edita payload → { itens: [...], total: 0.01 } → envia
Server Action ingênua aceita o valor → pedido salvo por R$ 0,01
```

### A regra

A Server Action de criar pedido **ignora todo valor monetário enviado pelo client**. Recalcula tudo a partir do banco:

```ts
// ❌ NUNCA — confia no valor do cliente
const { itens, total, taxa_entrega, desconto } = body

// ✅ SEMPRE — recalcula no servidor a partir da fonte de verdade
async function criarPedido(body) {
  // 1. Só o produto_id e a quantidade vêm do cliente. Nada de preço.
  const ids = body.itens.map(i => i.produto_id)
  const produtos = await buscarProdutos(ids)  // preço REAL do banco

  // 2. Recusa item indisponível ou de outra loja
  for (const item of body.itens) {
    const p = produtos.find(p => p.id === item.produto_id)
    if (!p || !p.disponivel || p.loja_id !== body.loja_id) throw new ErroPedido()
  }

  // 3. Subtotal a partir do preço do banco × quantidade do cliente
  const subtotal = calcularSubtotal(produtos, body.itens)

  // 4. Frete recalculado pelas zonas da loja (banco), não pelo client
  const taxaEntrega = calcularFrete(await buscarZonas(body.loja_id), body.endereco)

  // 5. Cupom validado no servidor (seção 9), desconto recalculado
  const { desconto } = await validarCupom(body.loja_id, body.codigo_cupom, subtotal)

  // 6. Total final = cálculo do servidor. O `total` do client é descartado.
  const total = subtotal - desconto + taxaEntrega

  await inserirPedido({ ...body, subtotal, desconto, taxa_entrega: taxaEntrega, total })
}
```

### O que o cliente PODE enviar

| Campo | Cliente envia? | Servidor confia? |
|-------|---------------|------------------|
| `produto_id` | ✅ | valida que existe, está disponível e é da loja |
| `quantidade` | ✅ | valida `> 0` |
| `loja_id` | ✅ | valida que existe e está ativa |
| `endereco_entrega` | ✅ | usa pra recalcular frete — bairro declarado é reconciliado contra CEP via ViaCEP server-side antes do cálculo (§10-A) |
| `codigo_cupom` | ✅ | revalida no servidor |
| `preco` / `subtotal` / `desconto` / `taxa_entrega` / `total` | ❌ ignorado | **recalculado do zero** |

`itens_pedido.preco` e `itens_pedido.nome` guardam o **snapshot do valor do banco** no momento do pedido — nunca o valor que veio do client.

### §10-A — Reconciliação CEP↔bairro (issue 064)

O bairro declarado pelo cliente no checkout seleciona a zona de frete — é um vetor de subpagamento ("declaro o bairro barato"). A Server Action `criarPedido` reconcilia o bairro contra o CEP via ViaCEP **no servidor** antes do cálculo autoritativo de frete.

**Política fail-closed:** qualquer falha (rede, timeout, CEP inexistente, ViaCEP fora do ar) → `reconciliado: false`, bairro declarado descartado. O caller cai no fallback mais caro ou marca a entrega como indisponível — **nunca aceita o bairro declarado como substituto do canônico.** Isso garante que uma indisponibilidade de ViaCEP não reabre o vetor de subpagamento.

Implementação: `src/lib/utils/reconciliarBairroCep.ts` — I/O isolada, sem estado, fail-closed total (try/catch engole toda exceção). Separada de `calcularFrete` (que permanece pura/sem I/O).

> **Nota sobre ViaCEP:** a tabela de APIs (§12) documenta ViaCEP como chamável do client (sem credencial). Isso continua válido para o autocomplete de endereço no checkout. A reconciliação de frete é um uso distinto e obrigatoriamente server-side — o mesmo endpoint externo, propósitos e contextos de segurança diferentes.

### Payload zod `.strict()` — sem campos monetários

O schema zod do payload recebido pela action usa `.strict()`, que rejeita qualquer campo não declarado. Campos monetários (`subtotal`, `desconto`, `taxa_entrega`, `total`) não são declarados no schema — mesmo que o cliente os envie, o parser os rejeita antes do código rodar.

```ts
// lib/validacoes/pedido.ts
export const schemaCriarPedido = z.object({
  loja_id: z.string().uuid(),
  nome_cliente: z.string().min(1),
  telefone_cliente: z.string().optional(),
  endereco_entrega: z.object({ rua: z.string(), ... }).optional(),
  forma_pagamento: z.string(),
  codigo_cupom: z.string().optional(),
  observacoes: z.string().optional(),
  itens: z.array(z.object({ produto_id: z.string().uuid(), quantidade: z.number().int().positive() })).min(1),
  // NÃO declara preco / subtotal / desconto / taxa_entrega / total — .strict() os rejeita
}).strict()
```

### RPC transacional `public.criar_pedido`

A parte que precisa de atomicidade (trava de cupom + INSERT pedido + INSERT itens) é delegada à função Postgres `public.criar_pedido(...)`. Migration: `20260614003000_rpc_criar_pedido.sql`.

**Garantias da RPC:**
- `SECURITY INVOKER` + `SET search_path = public` — sem elevação de privilégio; proteção contra search_path hijack (mesmo padrão de `loja_esta_ativa`).
- `REVOKE ALL … FROM public, anon, authenticated` + `GRANT EXECUTE … TO service_role` — anon nunca executa diretamente; só a Server Action via `createServiceClient()` pode chamar.
- Trava atômica de cupom: `UPDATE cupons SET usos_contagem = usos_contagem + 1 WHERE … AND usos_contagem < usos_maximos RETURNING id`. Se `NOT FOUND` (esgotado na corrida), anula desconto e recomputa total — não rejeita o pedido (decisão de produto: cupom esgotado simultaneamente não bloqueia a compra).
- INSERT `pedidos` + INSERT `itens_pedido` (snapshot `nome`/`preco`) na mesma transação — atomicidade garantida.

**Regra para devs e agentes:** toda operação multi-tabela com trava de concorrência segue este padrão — função Postgres `SECURITY INVOKER` + REVOKE/GRANT service_role + `SET search_path`. Nunca INSERT direto de pedido sem passar pela RPC.

---

## 11. Headers HTTP de Segurança

Configurar em `next.config.ts` — protege contra clickjacking, MIME sniffing e injeção:

```ts
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },                      // anti-clickjacking
  { key: 'X-Content-Type-Options', value: 'nosniff' },            // anti MIME sniffing
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Content-Security-Policy: começar em report-only, endurecer aos poucos
  { key: 'Content-Security-Policy', value: "default-src 'self'; img-src 'self' https: data:; ..." },
]

// next.config.ts → async headers() { return [{ source: '/:path*', headers: securityHeaders }] }
```

CSP exige ajuste cuidadoso (Next.js usa inline scripts) — iniciar em `Content-Security-Policy-Report-Only` antes de bloquear.

---

## 12. Rate Limiting

Endpoints sensíveis precisam de trava por IP — sem isso, brute force em login e spam de pedidos.

| Endpoint | Limite sugerido | Por quê |
|----------|----------------|---------|
| `/login` (Server Action de auth) | ~5/min por IP | anti brute force de senha |
| Criar pedido | ~10/min por IP | anti spam de pedido |
| Validar cupom | ~20/min por IP | anti enumeração de códigos |

Lib recomendada: **`@upstash/ratelimit`** + Upstash Redis (free tier) no Vercel Edge / Middleware. Supabase Auth já tem rate limit interno de login, mas a camada própria cobre as Server Actions.

---

## 13. Upload de Imagens

Foto de produto vai pro Supabase Storage. Riscos: upload de executável disfarçado, arquivo gigante (custo/DoS).

Regras na Server Action de upload:

- **Validar MIME real** no servidor — não confiar na extensão nem no `Content-Type` do client (checar magic bytes)
- **Whitelist:** `image/jpeg`, `image/png`, `image/webp` apenas
- **Tamanho máximo:** ex. 2 MB por imagem
- **Renomear arquivo** — gerar nome via uuid, nunca usar o nome original do client
- **Servir de bucket dedicado** com policies próprias (ver seção 18)

---

## 14. Tratamento de Erros

Erro interno **nunca** vaza pro client. Stack trace ou mensagem do Postgres expõe estrutura do banco e ajuda o atacante.

```ts
// ❌ NUNCA — vaza detalhe interno
catch (e) { return { erro: e.message } }  // ex: "duplicate key value violates unique constraint pedidos_pkey"

// ✅ — mensagem genérica pro usuário, detalhe só no log do servidor
catch (e) {
  console.error('[criarPedido]', e)        // log servidor (futuro: Sentry)
  return { erro: 'Não foi possível criar o pedido. Tente novamente.' }
}
```

---

## 15. XSS e Renderização

React escapa conteúdo por padrão — nome de produto com `<script>` é renderizado como texto, não executado. Manter assim:

- **Proibido `dangerouslySetInnerHTML`** sem sanitização explícita (DOMPurify). Conteúdo vem do banco preenchido por lojistas — tratar como não confiável.
- Nunca montar HTML por concatenação de string com dado do banco.
- URLs de imagem (`foto_url`): validar protocolo `https:` antes de renderizar — bloquear `javascript:`.

---

## 16. Dependências e CI

- **`npm audit --audit-level=high`** no pipeline de CI — falha o build se dependência tem vulnerabilidade alta/crítica.
- **Dependabot** (GitHub) ativo — PRs automáticos de atualização de segurança.
- Não adicionar dependência sem necessidade real (cada dep é superfície de ataque). Ver princípio "não reinventar a roda" do `architecture.md` — mas preferir libs consolidadas e mantidas.

---

## 17. Confirmação de Email e Fluxo de Cadastro

Supabase permite signup sem confirmar email — qualquer um cria loja com email falso.

- **Ativar "Confirm email"** no painel Supabase Auth — lojista só acessa o painel após confirmar.
- Loja recém-criada fica inativa (`ativo = false`) até confirmação, ou bloquear acesso ao painel via guard que checa `email_confirmed_at`.

### Fluxo de cadastro (Server Action `cadastrar`)

Sequência executada inteiramente no servidor (nunca no cliente):

1. `supabase.auth.signUp(email, senha)` via cliente anon — retorna `user.id`.
2. Criação de loja **delegada** à função `public.garantir_loja_do_dono` (ver abaixo) — `cadastrar` não cria mais loja diretamente.
3. Loja nasce com `ativo = false`. Só vai à vitrine após confirmar email + completar perfil (guard na issue 016).
4. `consentimento_em` e `consentimento_versao` são gravados dentro da função SQL — nunca enviados pelo cliente como campo livre.
5. `assinatura_status = 'trial'` e `assinatura_fim_periodo = now() + interval '14 days'` gravados SERVER-SIDE pela função SQL.

**RN-01 — 1 conta = 1 loja:** garantido via índice único `lojas(dono_id)` + `ON CONFLICT (dono_id) DO NOTHING` na função SQL. A action não precisa de verificação prévia — a função é idempotente.

### `public.garantir_loja_do_dono` — função de auto-cura (issue 065)

Fonte única de criação de loja por auto-cura. Migration: `20260615011500_garantir_loja_do_dono.sql`.

```sql
CREATE OR REPLACE FUNCTION public.garantir_loja_do_dono(
  p_dono_id uuid, p_email text, p_versao_termos text DEFAULT '1.0'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public ...
```

**Garantias:**
- `SECURITY DEFINER` + `SET search_path = public` — sem elevação acidental; proteção contra search_path hijack (mesmo padrão da `loja_por_email_dono` do webhook Hotmart).
- `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role` — só o servidor executa.
- Idempotente: `SELECT` antes do INSERT + `ON CONFLICT (dono_id) DO NOTHING` + handler de `unique_violation` — N chamadas simultâneas produzem exatamente 1 loja.
- Loja nasce `ativo = false`, `assinatura_status = 'trial'`, `consentimento_em = now()` — todos decididos server-side, nunca pelo cliente.
- Slug derivado da parte local do email, sanitizado para `^[a-z0-9-]+$`; colisão resolvida com sufixo hash do `dono_id`.

Usada em dois lugares: Server Action `cadastrar` (no signup) e guard do painel (auto-cura para usuários órfãos pré-existentes).

### Reconciliação pós-confirmação de email (issue 066)

A reconciliação de assinatura Hotmart com o lojista (vincular compra ao `loja_id`) ocorre em `auth/callback/route.ts`, **não** em `cadastrar`. Motivo: só no callback a posse do email está comprovada pela sessão (`data.user` vindo de `exchangeCodeForSession`) — no signup o email ainda não foi confirmado.

- Helper `reconciliarPosConfirmacao(user)` em `src/lib/auth/` — best-effort, engole toda falha, não derruba o redirect.
- Query `buscarLojaPorDono(svc, userId)` — leitura via service_role para resolver `user.id → loja_id`.
- **Regra para devs e agentes:** nunca mover reconciliação de assinatura para o signup (`cadastrar`) — o email não está autenticado naquele ponto, abrindo vetor de sequestro de assinatura por cadastro com email alheio.

### Anti-enumeração no login

A action `entrar` retorna sempre a mesma mensagem genérica independentemente de o email não existir, senha errada ou conta suspensa — impede enumeração de contas por tentativa e erro.

---

## 18. Supabase Storage — RLS

O bucket de imagens tem políticas próprias, separadas das tabelas. Sem elas, qualquer um sobrescreve foto de qualquer loja.

```sql
-- Lojista só escreve na pasta da própria loja: bucket 'produtos', path = '{loja_id}/...'
CREATE POLICY "storage_escrita_propria"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM lojas WHERE dono_id = auth.uid()
    )
  );

-- Leitura pública de imagens de produto (vitrine)
CREATE POLICY "storage_leitura_publica"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'produtos');
```

UPDATE/DELETE seguem o mesmo padrão da pasta `{loja_id}/`.

> **Armadilha:** o path passado ao `.upload(path, buffer)` deve ser **relativo ao bucket** — nunca incluir o nome do bucket como prefixo (ex.: `"produtos/loja_id/..."` quebraria a policy). Com prefixo incorreto, `(storage.foldername(name))[1]` retorna `"produtos"` em vez do `loja_id`, e a policy `storage_escrita_propria` falha silenciosamente — qualquer loja poderia gravar no bucket. Padrão correto: `"${loja.id}/${crypto.randomUUID()}.${ext}"` (loja_id derivado do auth no servidor, nunca do client).

---

## 19. Views e security_invoker

> ⚠️ Armadilha conhecida do Postgres/Supabase.

Views por padrão rodam com permissão do **criador** (postgres), **ignorando RLS** das tabelas-base. Uma view criada pra simplificar a vitrine pode vazar dados de todos os tenants.

Regra geral: toda view sobre tabela com RLS deve declarar `security_invoker`:

```sql
CREATE VIEW vitrine_produtos
  WITH (security_invoker = true)   -- respeita RLS do usuário que consulta
  AS SELECT ... FROM produtos ...;
```

Preferir não criar views pra dados multitenant — usar query direta com RLS. Se criar, `security_invoker = true` é obrigatório.

### Exceção aprovada: `public.vitrine_lojas`

Migration: `20260614001500_vitrine_lojas_view.sql`

```sql
CREATE VIEW public.vitrine_lojas
  WITH (security_invoker = false)   -- deliberado: definer (postgres)
  AS
  SELECT id, slug, nome, telefone, whatsapp, ativo,
         -- endereço público, tema, horarios, timezone
         ...
  FROM lojas
  WHERE ativo = true;
```

**Por que `security_invoker = false` aqui é correto:**

- A view projeta **somente colunas públicas** (sem `dono_id`, `assinatura_*`, `hotmart_*`, `consentimento_*`).
- O filtro `WHERE ativo = true` é o único isolamento relevante — não há isolamento de tenant a preservar.
- Com `security_invoker = true` a view retornaria zero linhas para anon (não existe policy SELECT pública na tabela base, por design — ver §2).
- É uma projeção somente-leitura de dados já intencionalmente públicos.

**Regra para devs e agentes:** toda query da vitrine pública (role `anon`) deve ler `public.vitrine_lojas`, **nunca `public.lojas` diretamente**. Isso se aplica a todas as issues de vitrine (023, 035 e similares). Ler `lojas` como anon falha silenciosamente (zero linhas por RLS) e exporia colunas sensíveis se a policy fosse relaxada no futuro.

---

## 20. LGPD

O iRango coleta dado pessoal de cliente final (nome, telefone, endereço de entrega) — Lei Geral de Proteção de Dados se aplica.

| Requisito | Decisão |
|-----------|---------|
| **Base legal** | execução de pedido (legítimo interesse / execução de contrato) |
| **Minimização** | coletar só o necessário pra entregar — sem CPF, sem data de nascimento na v1 |
| **Retenção** | definir prazo de expurgo de pedidos antigos (ex.: anonimizar dados de cliente após N meses) |
| **Exclusão / portabilidade** | cliente solicita via `privacidade@irango.com.br` (atendimento manual v1); automação é follow-up |
| **Política de privacidade** | `/privacidade` — SSG, issue 062, conteúdo placeholder — revisar com jurídico antes de operar |
| **Termos de uso** | `/termos` — SSG, issue 062, conteúdo placeholder — revisar com jurídico antes de operar |
| **Dados do lojista** | email/telefone do lojista também são pessoais — mesmas regras |

Páginas `/privacidade` e `/termos` implementadas (issue 062) como conteúdo estático. Conteúdo é placeholder — revisão jurídica obrigatória antes de operar comercialmente.

---

## 21. Observabilidade — scrubbing de PII no Sentry

O Sentry é instrumentado com `beforeSend` obrigatório em **todos os três runtimes** (client, server, edge): `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`.

A função canônica é `sentryBeforeSend` em `src/lib/utils/sentryBeforeSend.ts`. Ela roda antes de qualquer evento sair do processo e aplica duas camadas de sanitização:

1. **Por chave (campo):** qualquer chave cujo nome bata em `CAMPOS_PII` (email, telefone, nome_cliente, chave_pix, cpf, cep, buyer, etc.) ou contenha substring de credencial (key, secret, token, password, authorization, cookie) é substituída por `[Filtered]`.
2. **Por valor (string):** a função `redigirString` aplica regex sobre o conteúdo de *toda* string do payload — cobre PII embutida em mensagens de erro, URLs com querystring, breadcrumbs, etc. Padrões: e-mail RFC 5321, telefone BR (+55/DDD), `Bearer <token>`, JWT (`eyJ…`).

Configuração adicional:
- `sendDefaultPii: false` — impede coleta automática de IP, cookies e headers.
- `enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN` — app nunca quebra se DSN ausente (dev local).
- `tracesSampleRate: 0.1` — 10 % das transações enviadas.

Em caso de erro na sanitização o evento é descartado (`return null`) — fail-closed para não vazar PII.

**Regra para devs e agentes:** nunca incluir dados pessoais do comprador (nome, telefone, email, endereço) em `exception.value`, `message` ou `extra` intencionalmente. O scrubber é última linha de defesa, não substituto de boas práticas de logging.
