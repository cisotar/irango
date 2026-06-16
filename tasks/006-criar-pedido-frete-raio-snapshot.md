# [006] `criarPedido`: recálculo autoritativo com `distanciaKm` + persistência no snapshot

**crítica:** SIM (TDD red-first)
**Mundo:** painel/infra (Server Action autoritativa)
**Depende de:** 002, 003, 005
**Spec:** specs/zonas-entrega-raio-km.md

## Objetivo
Estender `criarPedido` (`lib/actions/pedido.ts`): quando a loja tem coords e o pedido é entrega com CEP, geocodificar o CEP do cliente no servidor, calcular `distanciaKm` por haversine, injetar em `EnderecoEntrega` antes do `calcularFrete` autoritativo, e persistir `distanciaKm` no snapshot `endereco_entrega` (JSONB) do pedido.

## Escopo
- [ ] No ramo `tipo_entrega === "entrega"`, após reconciliar bairro: buscar coords da loja (issue 005). Se houver coords e CEP do cliente → `geocodificarEndereco(cep)` → `haversine` → `endereco.distanciaKm`.
- [ ] Passar o endereço com `distanciaKm` a `calcularFrete` (a função pura **não muda**; já lê `endereco.distanciaKm`).
- [ ] Persistir `distanciaKm` no objeto `endereco_entrega` enviado à RPC `criar_pedido` (apenas quando calculado; ausente caso contrário).
- [ ] Fail-closed: geocoding `null` → `distanciaKm` indefinido → zona `raio_km` simplesmente não casa (fallback/indisponível). Sem regressão no fluxo de bairro/faixa_cep.
- [ ] Não persistir coords do cliente, só `distanciaKm` (spec §`distanciaKm` no snapshot).

## Fora de escopo
- Preview (`calcularFreteAction`, issue 007) — mesma lógica, action diferente.
- Mudar `calcularFrete` (proibido — função pura intacta).
- Migration (JSONB aceita campo novo sem schema change).
- Cache de geocoding (v2).

## Reuso esperado
- `haversine.ts` (issue 002), `geocodificarEndereco.ts` (issue 003), `buscarCoordsLoja` (issue 005) — RN-7 paridade preview↔autoritativo: mesmos utils que o preview.
- `calcularFrete` + `reconciliarBairroCep` + `EnderecoEntrega` já importados na action.
- Não duplicar a sequência geocode→haversine: se ficar idêntica ao preview, considerar extrair um helper neutro em `lib/actions/` (módulo sem `'use server'`). Avaliar na implementação.

## Segurança
- RN-4: frete recalculado do zero; `distanciaKm`/`taxa`/`total` do cliente ignorados; `.strict()` rejeita extras.
- RN-9: `distanciaKm` persistido para auditoria de cobrança (Nominatim pode mudar após recadastro do endereço da loja).
- RN-5: fail-closed total no geocoding do CEP do cliente.
- Bug aqui → cliente paga frete por raio errado ou burla zona → crítica.

## Critério de aceite
- [ ] (teste vermelho primeiro) Testes da action com utils mockados:
  - Loja com coords + CEP + zona `raio_km` que cobre a distância → frete da zona raio; `endereco_entrega.distanciaKm` persistido.
  - Geocoding falha (`null`) → zona `raio_km` não casa → cai no fallback; sem `distanciaKm` no snapshot.
  - Loja sem coords → comportamento atual inalterado (bairro/faixa_cep).
  - `retirada` → frete 0, sem geocoding, sem `distanciaKm`.
- [ ] `next build` roda sem erro (constraint de `'use server'`).
- [ ] `pnpm test` verde após implementação.

---

## Plano Técnico

### Diagnóstico

**Causa raiz:** zonas `tipo='raio_km'` são **letra morta** hoje. `calcularFrete` (`lib/utils/calcularFrete.ts`, `zonaAtende` case `"raio_km"`) só casa quando `endereco.distanciaKm != null`, mas **nenhum caller jamais preenche `distanciaKm`** — nem o preview (`frete.ts`) nem o autoritativo (`pedido.ts`). O lojista configura `raio_max_km`, e o frete por raio nunca dispara. Esta issue conecta o insumo que faltava: no ramo `entrega` de `criarPedido`, geocodificar o CEP do cliente, medir a distância à loja por haversine e injetar `distanciaKm` no `EnderecoEntrega` **antes** do `calcularFrete` autoritativo — sem tocar a função pura. E persistir esse `distanciaKm` no snapshot `endereco_entrega` (JSONB) para auditoria de cobrança (RN-9).

**Por que é complexo (multi-camada + contrato compartilhado):**
- **Valor monetário autoritativo** — `distanciaKm` é o insumo de `taxa_entrega` (seguranca.md §10). Bug aqui = cliente paga frete por raio errado ou burla a zona. `crítica: SIM`.
- **API externa sujeita a ban** — geocoding usa Nominatim, política fail-closed §12-A. A falha precisa colapsar exatamente no mesmo caminho que `reconciliarBairroCep` (064): `distanciaKm` indefinido → zona `raio_km` não casa → fallback. Nunca exceção que derrube o pedido.
- **Contrato de paridade RN-7** — a sequência `buscarCoords → geocode(cep) → haversine` será **idêntica** no preview (issue 007). Se cada action implementar a sua, vira "dois fluxos paralelos divergentes" (sinal de remendo): o preview pode mostrar frete diferente do que `criarPedido` cobra. A correção de raiz é **uma fonte única** dessa sequência — um helper neutro reusado por 006 e 007.
- **Snapshot JSONB** — `distanciaKm` entra no objeto enviado à RPC `criar_pedido`, mudando o **shape persistido** de `endereco_entrega` (campo aditivo, sem migration).

> **Sem remendo:** a alternativa "duplicar geocode→haversine em pedido.ts e em frete.ts" foi rejeitada — é exatamente o anti-padrão de lógica de valor repetida em N caminhos. A verdade vive em UM lugar (o helper neutro), igual `reconciliarBairroCep.ts` e `upload-imagem.ts` já fazem.

### Mapa de Impacto

Árvore de chamadas (ramo `tipo_entrega === "entrega"` de `criarPedido`):

```
criarPedido (actions/pedido.ts, 'use server')
  svc = createServiceClient()                       [service_role, server-only]
  └─ ramo entrega, APÓS reconciliarBairroCep:
       └─→ distanciaDaLojaAoCep(svc, loja_id, endereco.cep)   ← NOVO helper NEUTRO (sem 'use server')
              ├─→ buscarCoordsLoja(svc, loja_id)              [issue 005, done] → {lat,lng} | null
              │      └─ SELECT latitude, longitude FROM lojas  [TABELA base, não a view]
              ├─→ geocodificarEndereco(cep)                   [issue 003, done] → {lat,lng} | null
              │      └─ Nominatim, fail-closed §12-A
              └─→ haversine(lojaLat,lojaLng, cliLat,cliLng)   [issue 002, done] → km (puro)
              ↩ retorna distanciaKm: number | undefined  (undefined = qualquer pré-condição falhou)
       └─ enderecoAutoritativo.distanciaKm = <retorno do helper>   (só atribui quando number)
       └─→ calcularFrete(zonas, enderecoAutoritativo, subtotal, taxaForaZona)   [INTACTO; já lê distanciaKm]
                └─ zonaAtende case 'raio_km': dist != null && dist <= raio_max_km
       └─ monta p_endereco_entrega = { ...endereco_entrega, distanciaKm? }      [só quando number]
       └─→ rpc('criar_pedido', { p_endereco_entrega, p_taxa_entrega, ... })     [JSONB persiste distanciaKm]
                └─ pedidos.endereco_entrega (JSONB)  → UI confirmação / painel lojista (auditoria)

[issue 007] calcularFreteAction (actions/frete.ts) ──→ MESMO helper distanciaDaLojaAoCep(svc, loja_id, cep)
   (paridade RN-7 — não reimplementa; ver "Fora de escopo desta issue")
```

**Onde cada invariante é garantida (camada):**

```
distanciaKm (insumo de taxa_entrega):
  ├── cliente (payload) — [NUNCA enviado; schemaPayloadPedido.strict() rejeita campo extra]
  ├── distanciaDaLojaAoCep (lib/actions/, NEUTRO) — [fonte ÚNICA da sequência geocode→haversine; server-only por transitividade]
  ├── criarPedido (pedido.ts) — [AUTORITATIVO — calcula do zero, ignora qualquer valor do cliente]
  └── calcularFreteAction (frete.ts, 007) — [preview/UX — mesma fonte, não-vinculante]

taxa_entrega (R$ cobrado):
  └── criarPedido → calcularFrete(zonas do BANCO) → RPC criar_pedido [seguranca.md §10, autoritativo]

coords da loja:
  ├── buscarCoordsLoja exige service_role — [lojas sem SELECT anon §19; vitrine_lojas não expõe coords]
  └── helper recebe `svc` por parâmetro — não instancia client, não lê process.env

geocoding Nominatim:
  └── geocodificarEndereco — [fail-closed §12-A: sem trava verificada → null → distanciaKm undefined → fallback]
```

> **Regra cliente↔servidor (atendida):** toda a cadeia é server-side. O cliente envia `cep` (já enviava, ViaCEP) e `bairro`; nunca `distanciaKm` nem coords. `distanciaKm` é derivado server-side e o valor cobrado é recalculado do banco. Não há nenhuma camada-cliente para esta invariante de valor — correto.

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/actions/pedido.ts` | Orquestrador autoritativo do pedido (`'use server'`). Ramo `entrega` (L198-239): busca zonas, reconcilia bairro (L215-226), chama `calcularFrete`. Monta `p_endereco_entrega` na RPC (L285-286). | **Injetar** chamada ao helper logo após o bloco de reconciliação de bairro e **antes** de `calcularFrete`; atribuir `distanciaKm` em `enderecoAutoritativo` quando number. **Montar** `p_endereco_entrega` incluindo `distanciaKm` quando calculado. |
| `src/lib/actions/distanciaFrete.ts` | **não existe** | **CRIAR** — módulo neutro (sem `'use server'`) exportando `distanciaDaLojaAoCep`. Fonte única da sequência `buscarCoords → geocode → haversine`. Reusado por 006 e 007. |
| `src/lib/utils/calcularFrete.ts` | Função pura; `EnderecoEntrega.distanciaKm?: number \| null` (L26-27); `zonaAtende` case `raio_km` (L81-84). | **NÃO tocar** — já lê `distanciaKm`. Proibido alterar (escopo). |
| `src/lib/utils/haversine.ts` | Puro (002). | **NÃO tocar** — consumido pelo helper. |
| `src/lib/utils/geocodificarEndereco.ts` | Server-only, fail-closed §12-A (003). | **NÃO tocar** — consumido pelo helper. |
| `src/lib/supabase/queries/lojas.ts` | `buscarCoordsLoja(svc, lojaId)` (005, L230-244). | **NÃO tocar** — consumido pelo helper. |
| `src/lib/validacoes/pedido.ts` | `schemaPayloadPedido.strict()`; `endereco_entrega` não declara `distanciaKm`. | **NÃO tocar** — `distanciaKm` é server-side, nunca vem do cliente; `.strict()` deve continuar rejeitando se o cliente tentar enviá-lo. |
| RPC `public.criar_pedido` + migration | `p_endereco_entrega jsonb` — aceita campo aditivo. | **NÃO tocar** — JSONB absorve `distanciaKm` sem schema change (spec §Modelos de Dados). |
| `src/lib/actions/pedido.test.ts` | Testes de orquestração com mocks (`buscarLojaParaPedido`, `listarZonasComTaxas`, `reconciliarBairroCep`, etc.). | **+ mock** do helper `distanciaDaLojaAoCep` + **casos** novos (ver Casos de Teste). |
| `src/lib/actions/distanciaFrete.test.ts` | **não existe** | **CRIAR** — testa o helper isolado (mock de `buscarCoordsLoja`/`geocodificarEndereco`/`haversine`). |

### Decisões de Design

**D1 — Extrair o helper neutro `distanciaDaLojaAoCep` (vs. inline em cada action)**
- (a) **Helper neutro em `lib/actions/distanciaFrete.ts`** (módulo SEM `'use server'`, igual `upload-imagem.ts` — architecture.md §8). Importado por `pedido.ts` (006) e `frete.ts` (007). **Escolhida.**
  - Prós: fonte única da sequência → paridade RN-7 garantida por construção (impossível 006 e 007 divergirem); testável isolado; segue convenção `lib/actions/` documentada.
  - Contras: um arquivo novo. Mitigado: ~25 linhas, abaixo do limite de "primitivo artesanal duplicado".
- (b) Inline em cada action. Rejeitada: duplica lógica de valor em 2 caminhos (sinal de remendo); preview e autoritativo podem divergir silenciosamente (RN-7 quebra); 007 teria que copiar.
- (c) Helper em `lib/utils/`. Rejeitada: `lib/utils/` é para funções **puras** (calcularFrete, haversine). Este helper faz I/O (DB via `svc` + rede via Nominatim). A convenção (architecture.md §8) reserva `lib/actions/` exatamente para "helper de I/O compartilhado entre actions, módulo neutro sem `'use server'`". `lib/utils/geocodificarEndereco.ts` é a exceção (server-only puro de I/O externo), mas o **orquestrador** dessa sequência pertence a `lib/actions/`.
- **Localização e nome:** `src/lib/actions/distanciaFrete.ts`. Nome de domínio (português) descrevendo o quê, não o como.

**D2 — Assinatura: `distanciaDaLojaAoCep(svc, lojaId, cep?) → Promise<number | undefined>`**

```ts
// src/lib/actions/distanciaFrete.ts  — MÓDULO NEUTRO (sem 'use server')
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Distância em km (linha reta) entre a loja e o CEP do cliente, para alimentar
 * zonas de frete tipo 'raio_km' em calcularFrete. FONTE ÚNICA da sequência
 * buscarCoords → geocode(CEP) → haversine — reusada pelo autoritativo (criarPedido,
 * issue 006) e pelo preview (calcularFreteAction, issue 007): paridade RN-7.
 *
 * FAIL-CLOSED (RN-5, seguranca.md §12-A): retorna `undefined` em QUALQUER falha ou
 * pré-condição ausente — loja sem coords (RN-3), CEP ausente, geocoding null
 * (Nominatim down / sem trava / sem User-Agent / CEP não resolvido). NUNCA lança.
 * `undefined` propaga para EnderecoEntrega.distanciaKm → zonaAtende('raio_km') não
 * casa → calcularFrete cai no fallback. distanciaKm jamais vem do cliente.
 *
 * EXIGE client service_role (coords não têm SELECT anon §19) — recebido por param,
 * não instancia client nem lê process.env (testabilidade + escolha de role no caller).
 */
export async function distanciaDaLojaAoCep(
  svc: SupabaseClient<Database>,
  lojaId: string,
  cep: string | null | undefined,
): Promise<number | undefined>
```

- **Retorno `number | undefined` (não `number | null`):** alinha com `EnderecoEntrega.distanciaKm?: number | null` mas usa `undefined` como sentinela de "não calculado" — coerente com `reconciliarBairroCep` (que descarta) e com a omissão do campo no JSONB (campo ausente vs. `null` explícito). O caller só atribui/persiste quando `typeof === "number"`.
- **`cep` opcional:** o helper trata `cep` ausente/vazio internamente → `undefined` (não obriga o caller a pré-checar). Casa com `frete.ts` (007) onde `cep` é opcional.
- **Não arredonda:** retorna o km cru do haversine (a função pura não arredonda — comentário em `haversine.ts` L5). `calcularFrete` compara `dist <= raio_max_km` sem precisar de arredondamento. Para o snapshot (auditoria), persistir o valor cru é mais fiel; se houver necessidade de exibição, arredonda-se na UI. **Decisão: não arredondar no helper.**

**D3 — Ponto exato de injeção em `criarPedido`**

Dentro do `else` (ramo entrega), **depois** do bloco de reconciliação de bairro (atual L215-226, que produz `enderecoAutoritativo`) e **antes** da chamada a `calcularFrete` (L230). Sequência fica: reconciliar bairro → calcular distância → calcularFrete.

```ts
// ... após o bloco que define enderecoAutoritativo (reconciliação de bairro) ...

// (006/RN-7) Distância loja→CEP para zonas tipo='raio_km'. MESMA sequência do
// preview (calcularFreteAction) via helper neutro. Fail-closed (RN-5): qualquer
// falha → undefined → zonaAtende('raio_km') não casa → fallback. Só injetamos
// quando há número; nunca confiamos em distanciaKm vindo do cliente (RN-4).
const distanciaKm = await distanciaDaLojaAoCep(svc, dados.loja_id, endereco.cep);
if (typeof distanciaKm === "number") {
  enderecoAutoritativo = { ...enderecoAutoritativo, distanciaKm };
}

frete = calcularFrete(zonas, enderecoAutoritativo, subtotal, loja.taxa_entrega_fora_zona);
```

- **Por que após a reconciliação e não antes:** ordem irrelevante para correção (campos independentes: `bairro` vs `distanciaKm`), mas manter reconciliação primeiro preserva o diff mínimo e a leitura linear. `enderecoAutoritativo` é o mesmo objeto que vai ao `calcularFrete`.
- **`endereco.cep` (não `enderecoAutoritativo.cep`):** ambos têm o mesmo `cep` (a reconciliação só mexe em `bairro`); usar `endereco.cep` deixa explícito que é o CEP cru do cliente.
- **Geocoding também em zona `bairro`?** Sim — o helper roda sempre que há `cep`, independente de quais zonas existem. `calcularFrete` escolhe a de **menor taxa** entre as que atendem (efeito colateral esperado, spec §Efeito colateral). Não otimizar com "só geocodificar se existir zona raio_km": acoplaria o helper às zonas e quebraria a paridade com o preview. Custo (1 chamada Nominatim) é aceitável e protegido pela trava global §12-A. **Decisão: sempre geocodificar quando há CEP no ramo entrega.**

**D4 — `distanciaKm` no JSONB `p_endereco_entrega` (apenas quando calculado)**

Hoje (L285-286): `p_endereco_entrega: dados.tipo_entrega === "retirada" ? null : dados.endereco_entrega`. Muda para incluir `distanciaKm` **só quando number** (campo aditivo, ausente caso contrário — RN-9 + spec §distanciaKm no snapshot). NÃO persistir coords do cliente (não há) nem coords da loja.

```ts
p_endereco_entrega:
  dados.tipo_entrega === "retirada"
    ? null
    : {
        ...dados.endereco_entrega,
        ...(typeof distanciaKm === "number" ? { distanciaKm } : {}),
      },
```

- **`...dados.endereco_entrega` (não `enderecoAutoritativo`):** o snapshot persiste o **endereço declarado pelo cliente** (cep/rua/numero/bairro como informados — LGPD: é o endereço de entrega real). `enderecoAutoritativo.bairro` pode ter sido sobrescrito pelo canônico do ViaCEP ou zerado (`null`) na reconciliação — isso é insumo de **cálculo de zona**, não o endereço de entrega a guardar. `distanciaKm` é a única coisa derivada que persiste (auditoria de cobrança). **Decisão: snapshot = endereço declarado + `distanciaKm` derivado.**
- **`distanciaKm` precisa estar em escopo na montagem da RPC:** declarar `let distanciaKm: number | undefined` no escopo do `try` (ou no topo do ramo entrega, `undefined` no ramo retirada) para uso tanto em `enderecoAutoritativo` quanto na montagem do `p_endereco_entrega`. Em retirada, `p_endereco_entrega` é `null` de qualquer forma → `distanciaKm` nunca é lido.

**D5 — Retirada: sem geocoding, sem `distanciaKm`**
- O ramo `if (dados.tipo_entrega === "retirada")` (L195-197) já força `frete = {taxa:0,...}` e não toca endereço. **Não adicionar nada** nesse ramo: sem chamada ao helper (zero custo Nominatim), sem `distanciaKm`. `p_endereco_entrega = null` (minimização PII §20, já existente). **Decisão: helper só no ramo entrega.**

### Cenários

**Caminho feliz (raio cobre):** loja com coords + CEP válido + zona `raio_km` cujo `raio_max_km >= distanciaKm` → helper retorna número → `calcularFrete` casa a zona raio → `taxa_entrega` = taxa da zona raio → `p_endereco_entrega.distanciaKm` persistido no JSONB.

**Bordas:**
- **Geocoding `null`** (Nominatim down / sem trava / CEP não resolve) → helper `undefined` → `distanciaKm` não atribuído → zona `raio_km` não casa → cai em zona `bairro` (se reconciliada) ou fallback `taxa_entrega_fora_zona` ou "indisponível". `p_endereco_entrega` **sem** `distanciaKm`. Fail-closed (RN-5).
- **Loja sem coords** (`buscarCoordsLoja` → null) → helper `undefined` → comportamento atual 100% inalterado (bairro/faixa_cep). Zero regressão (RN-3).
- **CEP ausente no payload** — impossível em entrega (`schemaEnderecoEntrega.cep` é obrigatório, `validacoes/pedido.ts` L39), mas o helper trata defensivamente (`cep` falsy → `undefined`).
- **Distância > raio** (cliente fora do raio): zona `raio_km` não casa → fallback/indisponível. `distanciaKm` **ainda é persistido** (foi calculado) — auditável por que o pedido não casou o raio.
- **Concorrência Nominatim** (N lambdas, trava 1 req/s): excedentes recebem geocoding `null` → fallback. Transparente (spec §Comportamento sob carga).
- **Retirada com endereço enviado:** sem geocoding; `p_endereco_entrega = null` (já coberto).
- **Race de duplo submit:** inalterado — idempotência via `idempotency_key` + RPC (063); `distanciaKm` não afeta dedupe.
- **Sessão:** N/A (checkout é anon).

**Tratamento de erro:** o helper **nunca lança** (try/catch interno como `geocodificarEndereco`/`reconciliarBairroCep`); falha vira `undefined`. O `try/catch` externo de `criarPedido` (L310-314) continua como rede de segurança final → erro genérico ao cliente + `console.error` no servidor (§14). **Não logar o par (lat,lng) nem o CEP** (spec §Segurança / §21 scrubbing).

### Contratos de Dados

**Sem migration, sem mudança de RLS, sem regen de tipos.** O único contrato que muda é o **shape do JSONB** `pedidos.endereco_entrega`, que ganha o campo aditivo opcional `distanciaKm: number` quando calculado (spec §distanciaKm no snapshot). JSONB absorve sem schema change. `EnderecoEntrega` (calcularFrete.ts) já declara `distanciaKm?: number | null` — nenhuma mudança de tipo.

Shape persistido quando há raio:
```json
{ "cep": "01310-100", "rua": "...", "numero": "...", "bairro": "Bela Vista", "distanciaKm": 4.7 }
```
Quando geocoding falha / loja sem coords: campo `distanciaKm` **ausente** (não `null`).

### Recálculo no Servidor

| O cliente envia | O servidor faz |
|---|---|
| `cep`, `bairro`, `rua`, `numero` (endereço) | usa `cep` para geocodificar **no servidor**; reconcilia `bairro` via ViaCEP |
| (nunca) `distanciaKm` | **deriva** via `buscarCoords`+`geocode`+`haversine`; `.strict()` rejeitaria se enviado (RN-4) |
| (nunca) `taxa_entrega` / `total` | recalcula `calcularFrete` a partir das zonas do **banco** (seguranca.md §10) |

`distanciaKm` é insumo derivado server-side; `taxa_entrega` autoritativo sai de `calcularFrete(zonas do banco)`. Nada monetário vem do cliente.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/lib/actions/distanciaFrete.ts` — helper neutro `distanciaDaLojaAoCep` (~25 linhas), sem `'use server'`. Assinatura em D2.
- `src/lib/actions/distanciaFrete.test.ts` — testes do helper isolado.

**Modificar (nível função):**
- `src/lib/actions/pedido.ts`:
  - import de `distanciaDaLojaAoCep`.
  - `criarPedido`, ramo entrega: declarar `let distanciaKm` no escopo adequado; injetar chamada ao helper após a reconciliação de bairro e antes de `calcularFrete`; atribuir `distanciaKm` a `enderecoAutoritativo` quando number (D3).
  - `criarPedido`, montagem da RPC: incluir `distanciaKm` em `p_endereco_entrega` quando number (D4).
- `src/lib/actions/pedido.test.ts`: `vi.mock` de `@/lib/actions/distanciaFrete` (default resolve `undefined` para não regredir testes existentes) + casos novos (ver abaixo).

**NÃO tocar (com motivo):**
- `src/lib/utils/calcularFrete.ts` — função pura; já lê `distanciaKm` (escopo proíbe alterar).
- `src/lib/utils/haversine.ts`, `geocodificarEndereco.ts`, `queries/lojas.ts` — dependências prontas (002/003/005); consumidas pelo helper.
- `src/lib/validacoes/pedido.ts` — `distanciaKm` nunca vem do cliente; `.strict()` deve continuar rejeitando.
- RPC `criar_pedido` / migrations — JSONB aceita campo aditivo (sem migration).
- `src/lib/actions/frete.ts` — consumo do helper é a **issue 007**, não esta. (Esta issue só garante que o helper exista e a paridade seja possível.)

### Dependências Externas

Nenhuma nova. Reusa `@supabase/supabase-js`, `vitest`, e os utils internos 002/003/005 (já no repo). Helper segue o molde de `upload-imagem.ts` (architecture.md §8) e `reconciliarBairroCep.ts` (fail-closed).

### Ordem de Implementação

Issue `crítica: SIM` → **fase RED primeiro** (agente `tdd`), depois GREEN (agente `executar`).

1. **RED — helper** (`tdd`): criar `distanciaFrete.ts` com stub `throw new Error("TODO: GREEN")`; escrever `distanciaFrete.test.ts` (casos H1-H6 abaixo). Confirmar vermelho.
2. **RED — action** (`tdd`): adicionar `vi.mock` do helper em `pedido.test.ts` + casos A1-A4. Confirmar vermelho. — *Depende do helper existir (import).*
3. **GREEN — helper** (`executar`): implementar `distanciaDaLojaAoCep` conforme D2. — *Depende do RED.*
4. **GREEN — action** (`executar`): injetar chamada (D3) + snapshot JSONB (D4) em `pedido.ts`. — *Depende do helper GREEN + RED da action.*
5. **Validação:** `pnpm test` verde + `next build` (constraint `'use server'`: `pedido.ts` segue exportando só `async`; o helper é neutro, sem `'use server'` — não viola a constraint que quebra só no build, ver MEMORY).

### Casos de Teste (fase RED primeiro)

**Helper isolado — `distanciaFrete.test.ts`** (mock `buscarCoordsLoja`, `geocodificarEndereco`, `haversine`):
- **H1** loja com coords + geocoding ok → chama `haversine(lojaLat,lojaLng,cliLat,cliLng)` e retorna o km dele.
- **H2** `buscarCoordsLoja` → `null` (loja sem coords) → `undefined`; **não** chama `geocodificarEndereco` (curto-circuito, evita Nominatim à toa).
- **H3** coords ok mas `geocodificarEndereco` → `null` → `undefined`; **não** chama `haversine`.
- **H4** `cep` ausente/vazio → `undefined`; não chama nada (nem coords nem geocode).
- **H5** exige `svc` por parâmetro — não instancia client (mock injetado é o usado).
- **H6** nunca lança: se um util mockado rejeitar, o helper resolve `undefined` (fail-closed total).

**Action — `pedido.test.ts`** (mock do helper):
- **A1 (raio cobre + persiste):** helper resolve `4.7`; zonas têm uma `raio_km` com `raio_max_km=5` e taxa menor → `calcularFrete` casa raio → RPC recebe `p_taxa_entrega` = taxa da zona raio **e** `p_endereco_entrega.distanciaKm === 4.7`.
- **A2 (geocoding null → fallback, sem distanciaKm):** helper resolve `undefined` → zona `raio_km` não casa → cai no fallback/bairro → `p_endereco_entrega` **não** tem `distanciaKm` (`expect(args.p_endereco_entrega).not.toHaveProperty("distanciaKm")`).
- **A3 (loja sem coords → inalterado):** helper resolve `undefined` (default do mock) → resultado idêntico ao fluxo bairro atual; nenhum caso existente regride.
- **A4 (retirada → sem geocoding):** `tipo_entrega='retirada'` → helper **não é chamado** (`expect(distanciaDaLojaAoCep).not.toHaveBeenCalled()`) e `p_endereco_entrega === null`.

> **Default do mock do helper em `pedido.test.ts`:** `mockResolvedValue(undefined)` no `beforeEach` — assim todos os testes pré-existentes (que não configuram raio) seguem verdes sem alteração, e só A1 sobrescreve com um número.

### Checklist de Validação Pós-Implementação
- [ ] `next build` sem warnings novos (helper neutro não viola constraint `'use server'`; `pedido.ts` só exporta `async`).
- [ ] `pnpm test` verde (helper + action + suíte existente sem regressão).
- [ ] `distanciaKm` jamais lido do payload: `schemaPayloadPedido.strict()` rejeita; valor sempre derivado server-side (RN-4).
- [ ] Fail-closed comprovado: geocoding `null` → `distanciaKm undefined` → zona `raio_km` não casa → fallback; snapshot sem `distanciaKm` (RN-5).
- [ ] `distanciaKm` persistido no JSONB **só quando calculado** (campo ausente caso contrário) (RN-9).
- [ ] Retirada: helper não chamado, sem `distanciaKm`, `p_endereco_entrega=null`.
- [ ] Helper recebe `svc` por param (service_role), não instancia client nem lê `process.env`; não loga `(lat,lng)`/CEP (§21).
- [ ] Paridade RN-7 preservada: 007 poderá importar o **mesmo** `distanciaDaLojaAoCep` sem reimplementar.
