# Spec: Zonas de Entrega por Raio (km)

**Versão:** 0.2.0 | **Atualizado:** 2026-06-16

> **v0.2 — correções pós-revisão Opus:** resolvida a contradição do preview (coords via
> service_role, não via `vitrine_lojas`); premissa do painel reescrita como CRUD novo;
> nomes de coluna alinhados com o schema real; rate limit 1/s detalhado para serverless;
> risco de ban Nominatim e granularidade de CEP explicitados; `distanciaKm` promovido
> para persistir no snapshot do pedido.

## Visão Geral

Hoje o iRango já modela zonas de entrega do tipo `raio_km` (`zonas_entrega.tipo='raio_km'` + `taxas_entrega.raio_max_km`), mas elas **nunca casam**: `calcularFrete` decide o atendimento de uma zona `raio_km` comparando `endereco.distanciaKm <= raio_max_km`, e `distanciaKm` **nunca é preenchido** em nenhum caller. O lojista pode configurar a zona, mas o frete por raio é letra morta.

Esta feature fecha o ciclo:

1. A loja passa a ter **coordenadas geográficas** (`latitude`/`longitude`), obtidas por geocoding do endereço do lojista no painel.
2. No checkout, quando a loja tem coords e o cliente informa CEP, o servidor geocodifica o CEP do cliente e calcula `distanciaKm` por **haversine**, alimentando o `calcularFrete` que já existe — zonas `raio_km` passam a funcionar automaticamente, sem alterar a função pura.

O geocoding usa **Nominatim (OpenStreetMap)** — gratuito, sem key, mas com política rígida (máx 1 req/s, User-Agent identificado). A distância é **haversine puro** (~10 linhas, sem dependência nova).

**Mundos:** vive em dois — **painel** (lojista cadastra endereço → geocoding server-side persiste coords) e **vitrine pública / checkout** (preview e cálculo autoritativo de frete por distância). Nenhuma UI nova é estritamente obrigatória além de campos de endereço no painel; o cálculo é invisível ao cliente.

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (SaaS)** | fornece o geocoding server-side (Nominatim) com rate limit e User-Agent próprio; o haversine; o recálculo autoritativo de frete |
| **Lojista** | informa o endereço completo da loja no painel; recebe aviso se o geocoding falhar; configura zonas `raio_km` (já existe) |
| **Cliente** | informa o CEP no checkout (já faz, via ViaCEP); recebe preview de frete e paga o valor autoritativo do servidor — nunca define a distância nem o frete |

## Páginas e Rotas

### Configurações › Perfil da Loja — `/painel/configuracoes/perfil`

**Mundo:** painel (auth obrigatório)

**Descrição:** `PerfilClient.tsx` + `salvarPerfil` hoje editam apenas `nome`, `slug`, `telefone`, `whatsapp`. As colunas `endereco_*` já existem na tabela `lojas` mas **nunca foram escritas por nenhuma interface** — nenhum campo de endereço existe no painel. Esta feature adiciona um bloco de **Endereço da Loja** inteiramente novo: CEP, logradouro, número, bairro, cidade, UF. Ao salvar, o servidor geocodifica via Nominatim e persiste `latitude`/`longitude` junto. Se o geocoding falhar, o endereço é salvo **sem coords** e um aviso não-bloqueante é exibido.

**Mapeamento formulário → colunas reais:**

| Campo (form) | Coluna em `lojas`   |
|--------------|---------------------|
| CEP          | `endereco_cep`      |
| Logradouro   | `endereco_rua`      |
| Número       | `endereco_numero`   |
| Bairro       | `endereco_bairro`   |
| Cidade       | `endereco_cidade`   |
| UF           | `endereco_estado`   |
| —            | `latitude` (nova)   |
| —            | `longitude` (nova)  |

**Componentes:**
- `PerfilClient.tsx` (existente) — estender com a seção de endereço; reusar `Input`, `Label`, `Card` (shadcn/ui) e `IMaskInput` (react-imask) para máscara de CEP
- `ViaCEP` (existente, API pública) — autocomplete client-side do endereço a partir do CEP; preenche `endereco_rua/bairro/cidade/estado` automaticamente. Mesmo padrão de `FormEndereco.tsx`
- `schemaPerfil` (existente, `lib/validacoes/loja.ts`) — estender com os 6 campos de endereço. **`latitude`/`longitude` NÃO entram no schema** — são derivados no servidor; qualquer payload com esses campos é rejeitado por `.strict()`
- `salvarPerfil` (existente, `lib/actions/loja.ts`) — estender allowlist com `endereco_*`; após validar, geocodificar e escrever `latitude`/`longitude` via patch separado

**Behaviors:**
- [x] Digitar CEP e autocompletar logradouro/bairro/cidade/UF — ação do lojista. Garantido em: cliente (UX, ViaCEP)
- [x] Editar manualmente qualquer campo de endereço — ação do lojista. Garantido em: cliente (UX) + Server Action (revalida `schemaPerfil.strict()`)
- [x] Salvar perfil com endereço — dispara geocoding server-side e persiste `latitude`/`longitude`. Garantido em: **Server Action `salvarPerfil`** + RLS (`lojas_update_proprio`, `auth.uid()=dono_id`); coords nunca vêm do cliente
- [x] Ver aviso quando o geocoding falha — endereço salvo sem coords. Garantido em: Server Action retorna `{ geocodificado: false }` → toast no cliente ("Não localizamos seu endereço no mapa — zonas por raio ficam inativas até corrigir")
- [x] (Pré-existente) Configurar zona `raio_km` em `/painel/configuracoes/entregas` — sem mudança nesta feature; só passa a ter efeito quando a loja tem coords

---

### Checkout — `/loja/[slug]/pedido` (e preview de frete na vitrine)

**Mundo:** vitrine pública (sem auth)

**Descrição:** nenhuma UI nova. O cliente continua informando CEP como hoje. A mudança é **invisível e server-side**: quando a loja tem `latitude`/`longitude` e o cliente informou CEP, o servidor geocodifica o CEP do cliente, calcula `distanciaKm` por haversine e injeta no `EnderecoEntrega` passado a `calcularFrete`.

**Como o preview obtém as coords:**
`calcularFreteAction` já roda como Server Action (server-only). Para acessar `latitude`/`longitude` sem expor coords na `vitrine_lojas`, usa um **client service_role** exclusivamente para buscar as duas colunas de coordenadas da tabela base `lojas`. Isso é exatamente o mesmo padrão de `criarPedido` — isola o dado sensível no servidor, não regride a postura de privacidade da view pública.

**Componentes:**
- `Carrinho.tsx` / wizard de checkout (existentes) — sem mudança; consomem o preview já retornado por `calcularFreteAction`
- `calcularFrete` (existente, `lib/utils/calcularFrete.ts`) — **não muda**; já lê `endereco.distanciaKm`
- `calcularFreteAction` (existente, `lib/actions/frete.ts`) — estender: buscar coords via service_role + geocodificar CEP do cliente + calcular `distanciaKm` + passar a `calcularFrete`
- `criarPedido` (existente, `lib/actions/pedido.ts`) — estender: mesma lógica de geocoding + haversine; persistir `distanciaKm` no snapshot `endereco_entrega` (JSONB)
- `haversine.ts` (novo, `lib/utils/haversine.ts`) — função pura, ~10 linhas, testável isolado
- `geocodificarEndereco.ts` (novo, `lib/utils/geocodificarEndereco.ts`) — util server-only; encapsula chamada Nominatim com `AbortSignal.timeout`, User-Agent, rate limit e fail-closed. Mesmo molde de `reconciliarBairroCep.ts`

**Behaviors:**
- [x] Informar CEP no checkout — ação do cliente. Garantido em: cliente (UX, ViaCEP)
- [x] Ver preview de frete por raio — estimativa de UX. Garantido em: **Server Action `calcularFreteAction`** (geocoding + haversine no servidor via service_role); cliente nunca envia `distanciaKm` nem `taxa`
- [x] Finalizar pedido com frete por raio — valor cobrado. Garantido em: **Server Action `criarPedido` + RPC `criar_pedido` + RLS** — frete recalculado do zero; `distanciaKm` persistido no snapshot do pedido

---

## Modelos de Dados

### Migration nova — colunas de coordenadas em `lojas`

```sql
-- supabase/migrations/<timestamp>_lojas_coordenadas.sql
ALTER TABLE lojas
  ADD COLUMN latitude  float8,
  ADD COLUMN longitude float8,
  ADD CONSTRAINT lojas_coords_par_check
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT lojas_latitude_range_check
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT lojas_longitude_range_check
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
```

- `float8` (double precision): coordenada não é dinheiro — `numeric(10,2)` não se aplica.
- **Nullable** por design: representa "loja sem coords" → zonas `raio_km` ignoradas silenciosamente.
- **CHECK tudo-ou-nada** + faixas válidas: defesa em profundidade; autoridade real é a Server Action.

### `distanciaKm` no snapshot do pedido

`pedidos.endereco_entrega` (JSONB) já guarda o endereço do cliente. Esta feature adiciona `distanciaKm` ao objeto persistido quando calculado:

```json
{
  "cep": "01310-100",
  "bairro": "Bela Vista",
  "distanciaKm": 4.7
}
```

Motivação: frete é valor monetário. Sem o insumo do cálculo persistido, não há como auditar ou reproduzir a cobrança se o cliente contestar (Nominatim pode retornar valor diferente após recadastro do endereço da loja). Não é uma migration — JSONB aceita o campo novo sem mudança de schema.

### Tabelas afetadas (sem migration)

- `zonas_entrega` / `taxas_entrega` — sem alteração; `tipo='raio_km'` e `raio_max_km` já existem.
- `vitrine_lojas` (view) — **`latitude`/`longitude` NÃO são adicionadas**; coords são internas ao servidor.

### RLS

- `latitude`/`longitude` herdam RLS de linha de `lojas`: leitura/escrita do dono via políticas existentes.
- `vitrine_lojas` não expõe coords — nenhuma mudança na view.
- `salvarPerfil` escreve coords **só a partir do valor geocodificado no servidor**; `schemaPerfil.strict()` não declara `latitude`/`longitude` → injeção pelo cliente é rejeitada.

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| **RN-1** — Coords da loja são derivadas por geocoding **no servidor**; nunca aceitas do payload do cliente | Server Action `salvarPerfil` (allowlist explícita; `schemaPerfil.strict()` rejeita `latitude`/`longitude` do payload) |
| **RN-2** — Geocoding da loja é tudo-ou-nada: salva `(lat, lng)` ambos ou ambos `NULL` | Server Action (escreve par) + CHECK no banco |
| **RN-3** — Loja sem coords → zonas `raio_km` ignoradas **silenciosamente** | `calcularFrete` (já: `dist != null && raio_max_km != null`); caller passa `distanciaKm=undefined` |
| **RN-4** — Frete por raio calculado no servidor; cliente nunca define `distanciaKm` nem o frete | `calcularFreteAction` (preview) e `criarPedido` (autoritativo); coords buscadas via service_role |
| **RN-5** — **Fail-closed** no geocoding do CEP do cliente: qualquer falha → `distanciaKm` indefinido → zona `raio_km` não casa → fallback | Server Action (try/catch total, igual a `reconciliarBairroCep`) |
| **RN-6** — Nominatim: máx **1 req/s global** + **User-Agent identificado** obrigatórios | Util server-side `geocodificarEndereco.ts` com rate limit dedicado (ver Segurança) |
| **RN-7** — Paridade preview ↔ autoritativo: ambos usam o mesmo util `geocodificarEndereco` + `haversine.ts` | Server Actions (ambos chamam os mesmos utils) |
| **RN-8** — Haversine: função **pura, sem I/O**, retorna km | `lib/utils/haversine.ts` (testável isolado) |
| **RN-9** — `distanciaKm` persistido no snapshot do pedido para auditoria de cobrança | `criarPedido` (serializa no JSONB `endereco_entrega`) |

### Efeito colateral esperado

Ativar zonas `raio_km` faz elas **concorrerem com zonas `bairro` existentes** — `calcularFrete` escolhe a de **menor taxa**. Uma zona `raio_km` barata pode passar a ganhar da zona `bairro` correspondente para o mesmo endereço. Comportamento correto e desejado; lojista deve revisar as taxas ao configurar raio.

## Segurança

- **Coords da loja** não expostas via `vitrine_lojas`; acessíveis só server-side via service_role.
- **CEP do cliente**: geocoding adicional é 100% server-side; CEP não é exposto a terceiros além do Nominatim (mesmo padrão do ViaCEP).
- **Recálculo autoritativo**: `criarPedido` recalcula `taxa_entrega` do zero — `distanciaKm`, `taxa`, `total` do cliente são ignorados; `.strict()` rejeita campos extra.
- **Erro não vaza** (`seguranca.md` §14): falha de geocoding → log genérico no servidor; nunca stack trace ao cliente.
- **Sentry**: não logar par `(lat, lng)` do cliente — não é PII de negócio relevante para debug.

### Rate limit Nominatim — decisões explícitas

**Problema:** `LIMITES` em `rateLimit.ts` só aceita janela em minutos (`\`${number} m\``). O Nominatim exige máx 1 req/s (janela em segundos). Além disso, o limite é **global** (protege o serviço externo), não por IP.

**Solução:** criar um limitador Nominatim **fora do `LIMITES` existente**, usando `Ratelimit.fixedWindow(1, "1 s")` do Upstash com identificador fixo `"nominatim-global"`. Não alterar o tipo de `LIMITES` (breaking change desnecessária).

**Comportamento sob falha (Redis indisponível):**
- Diferente dos limitadores por IP (fail-open, `seguranca.md` §12), o limitador Nominatim deve ser **fail-closed**: se Redis cair, não chamar o Nominatim. Razão: em Vercel serverless, N instâncias concorrentes sem trava martelam o Nominatim simultaneamente → **ban de IP** do iRango. Fail-closed aqui é RN-5: a zona `raio_km` simplesmente não casa e cai no fallback — efeito aceitável.

**Comportamento sob carga (concorrência serverless):**
- Com 1 token/s global e N invocações concorrentes: pedidos excedentes recebem `permitido: false` imediatamente (não bloqueiam). Resultado: **frete por raio indisponível para esses pedidos**; caem no fallback (`taxa_entrega_fora_zona`) ou indisponível. Comportamento transparente para o cliente (vê frete normal ou "indisponível"), sem latência adicional.
- Cache de geocoding (v2) reduzirá drasticamente a pressão real sobre o limite.

### Risco de negócio: granularidade de CEP no Nominatim

O Nominatim resolve CEPs brasileiros com **granularidade irregular**: muitos CEPs resolvem no centroide do bairro ou do município (não do logradouro). Para uma loja com raio de 5 km, um centroide pode estar 8-12 km de distância real — **cliente legítimo recusado, ou cliente fora da área aceito**. Isso é limitação estrutural do Nominatim no Brasil, não um bug implementável.

Mitigação v1: o lojista deve calibrar `raio_max_km` com margem (ex.: se quer atender 5 km reais, configurar 7-8 km). Documentar isso no tooltip do campo de raio no painel de entregas.

Mitigação v2 (fora do escopo): cache de geocoding + fallback para bairro quando CEP não resolve precisamente.

## Fora do Escopo (v1)

- **Cache de resultados de geocoding** (CEP→coords) — reduz chamadas ao Nominatim; candidato a v2 (Redis com TTL ou tabela de cache).
- **Mapa visual / ajuste manual do pin pelo lojista** — v1 confia no geocoding automático.
- **Provedor de geocoding pago** (Google, Mapbox) — Nominatim atende a escala projetada (~0,28 req/s); migrar só se o volume exigir.
- **Frete proporcional à distância (R$/km)** — `taxas_entrega` modela taxa fixa por zona; tarifação por distância é mudança de modelo de dados.
- **Cálculo de rota real** (OSRM, Google Directions) — v1 usa distância em linha reta (haversine).

---

## Próximos passos

Quebrar em issues com `/break` passando este spec.

Issues críticas previstas (TDD red-first):
- `geocodificarEndereco.ts` fail-closed + rate limit Nominatim
- `criarPedido` recálculo autoritativo com `distanciaKm` + persistência no snapshot
- `salvarPerfil` allowlist de coords + geocoding na escrita
