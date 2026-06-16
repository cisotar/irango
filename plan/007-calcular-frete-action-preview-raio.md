## Plano Técnico

### Análise do Codebase

O que já existe e será reusado (NÃO criar nada novo — esta issue é só patch + teste):

- `src/lib/actions/distanciaFrete.ts` → `distanciaDaLojaAoCep(svc, lojaId, cep)` — helper NEUTRO (issue 006, done). FONTE ÚNICA da sequência `buscarCoordsLoja → geocodificarEndereco(CEP) → haversine`. Recebe o client `service_role` por parâmetro, é fail-closed total (retorna `undefined` em qualquer falha/pré-condição ausente, nunca lança). É exatamente o que `criarPedido` chama. **Reusar literalmente** — garante RN-7 (paridade preview↔autoritativo) por construção.
- `src/lib/supabase/service.ts` → `createServiceClient()` — factory do client service_role, `import "server-only"`. Mesmo padrão usado em `pedido.ts:66` (`const svc = createServiceClient()`). É o ponto onde o preview obtém o client de coords.
- `src/lib/actions/frete.ts` → `calcularFreteAction` — a action atual (preview anon). Já busca zonas+loja via anon, reconcilia bairro↔CEP, monta `EnderecoEntrega` e chama `calcularFrete` intacto. O patch insere **um único passo** entre a reconciliação (linha ~114) e a chamada a `calcularFrete` (linha ~118).
- `src/lib/utils/calcularFrete.ts` → `calcularFrete` + tipo `EnderecoEntrega` (já tem o campo `distanciaKm`). **Não tocar.**
- `src/lib/actions/pedido.ts:200-244` — referência de paridade: ordem exata (reconciliar bairro → `distanciaDaLojaAoCep(svc, loja_id, endereco.cep)` → injeta `distanciaKm` no endereço só quando é `number`). O preview deve seguir o MESMO contrato de chamada.

O que precisa ser criado: **nada de produção novo.** Só edição de `frete.ts` + atualização de `frete.test.ts` (a fase RED ajusta os mocks/expectativas de coords). Sem migration, sem nova query, sem novo schema zod (o `schemaFretePreview` já aceita `cep` opcional).

### Cenários

**Caminho Feliz (loja com coords + CEP + zona `raio_km` cobre):**
1. Rate limit OK, `schemaFretePreview.safeParse` passa (`loja_id`, `cep`, `bairro?`).
2. Client anon `createClient()` → `listarZonasComTaxas` + `buscarLojaPublicaPorId` (inalterado).
3. Reconciliação bairro↔CEP (inalterada) monta `endereco: EnderecoEntrega`.
4. **NOVO:** `const svc = createServiceClient()`; `const distanciaKm = await distanciaDaLojaAoCep(svc, loja_id, cep)`.
5. **NOVO:** `if (typeof distanciaKm === "number") endereco.distanciaKm = distanciaKm;`
6. `calcularFrete(zonas, endereco, 0, loja?.taxa_entrega_fora_zona)` — agora a zona `raio_km` casa.
7. Retorno `{ ok:true, taxa_preview: <taxa da zona raio>, zona_nome: <nome da zona> }`.

**Casos de Borda:**
- **Geocoding null / ViaCEP do geocode fora / CEP inexistente:** `distanciaDaLojaAoCep` → `undefined` → `distanciaKm` não injetado → zona `raio_km` não casa → cai no fallback fora-de-zona (ou indisponível). Idêntico ao autoritativo (RN-5, §12-A fail-closed).
- **Loja sem coords (RN-3):** `buscarCoordsLoja` retorna `null` dentro do helper → `undefined` → comportamento ATUAL preservado (zonas `bairro`/`faixa_cep` seguem funcionando).
- **Sem CEP (só bairro):** helper recebe `cep` ausente → curto-circuita em `undefined` (não bate em coords nem Nominatim). Reconciliação já descarta o bairro declarado sem CEP → fallback. Inalterado.
- **CEP presente mas sem zona raio_km configurada:** helper roda mesmo assim (paridade com autoritativo — `pedido.ts` roda sempre que há CEP), `distanciaKm` é injetado mas nenhuma zona `raio_km` o consome → resultado o mesmo de hoje. Custo do Nominatim protegido pelo rate limit (§12-A).
- **Campo extra / loja_id não-uuid / bairro vazio:** rejeitado por `.strict()` ANTES de qualquer I/O — `createServiceClient` nem é chamado.
- **Falha de rede no Nominatim/PostgREST de coords:** engolida pelo try/catch interno do helper → `undefined`. Nunca derruba o preview.

**Tratamento de Erros:** mantém o `try/catch` existente da action — erro interno → `console.error("[calcularFreteAction]", e)` + retorno genérico `{ ok:false, erro:"Não foi possível calcular o frete." }` (§14). O helper já é fail-closed, então a única exceção possível adicional é `createServiceClient()` lançar por env ausente — cai no catch genérico (não vaza).

### Schema de Banco

Nenhuma mudança. A coluna `lojas.latitude/longitude` (migration da issue 005) e `zonas_entrega.raio_max_km` (schema.md:192) já existem. RLS de coords: `lojas` NÃO tem SELECT anon (§19) — por isso o acesso a coords passa obrigatoriamente por `service_role` via `buscarCoordsLoja`. Nada a alterar.

### Validação (zod)

`schemaFretePreview` em `frete.ts` já é suficiente: `loja_id` (guid), `bairro?`, `cep?`, `.strict()`, `.refine(bairro || cep)`. **Não alterar.** `distanciaKm` NUNCA é campo do schema — é derivado 100% no servidor (RN-4). Se o cliente tentar enviá-lo, `.strict()` rejeita.

### Recálculo no Servidor (regra cliente ↔ servidor)

| Invariante | Camada que garante |
|-----------|-------------------|
| `distanciaKm` (entra na escolha de zona `raio_km` → afeta valor monetário) | **Derivado server-side** via `distanciaDaLojaAoCep` (coords do banco + geocode do CEP). Cliente nunca envia; `.strict()` rejeita injeção. |
| Coords da loja | `service_role` (`buscarCoordsLoja`) — sem SELECT anon (§19). Usado SÓ para as 2 colunas de coords; zonas/loja seguem anon (não regredir privacidade). |
| `taxa_preview` | Recalculada por `calcularFrete` a partir das zonas do banco. Não-vinculante; autoridade de cobrança é `criarPedido`. |

Cliente envia: `loja_id`, `bairro?`, `cep?`. Servidor recalcula/deriva: `distanciaKm`, bairro canônico (reconciliação), taxa e zona.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/lib/actions/frete.ts` — adicionar import `createServiceClient`; inserir entre a reconciliação (~linha 114) e `calcularFrete` (~linha 118): instanciar `svc`, chamar `distanciaDaLojaAoCep(svc, loja_id, cep)`, injetar `distanciaKm` no `endereco` só quando `number`. Atualizar o comentário de cabeçalho que hoje diz "NUNCA service_role nesta action" → registrar a exceção documentada (coords via service_role, zonas/loja seguem anon).
- `src/lib/actions/frete.test.ts` — **fase RED primeiro.** Hoje há o teste `"NÃO usa service_role"` (linha 314) que vai conflitar — convertê-lo: service_role passa a ser USADO só para coords; mockar `distanciaDaLojaAoCep` (como `pedido.test.ts:91`) e `createServiceClient`. Adicionar os casos de raio (abaixo). Os testes anon/bairro/faixa_cep existentes devem continuar verdes (regressão).

**NÃO tocar:**
- `src/lib/actions/distanciaFrete.ts` (helper pronto, reuso literal).
- `src/lib/utils/calcularFrete.ts` (`calcularFrete` + `EnderecoEntrega`) — intacto (fora de escopo).
- `src/lib/supabase/queries/lojas.ts` (`buscarCoordsLoja` pronto).
- `Carrinho.tsx`/wizard (consomem o shape de retorno inalterado).
- Schema zod, migrations, seed.

### Dependências Externas

Nenhuma nova. Transitivamente: Nominatim/geocode (via `geocodificarEndereco`, issue 003) e Supabase service_role — ambos já encapsulados no helper. ViaCEP da reconciliação já existe na action.

### Casos de Teste (RED → GREEN)

Mockar `@/lib/actions/distanciaFrete` (`distanciaDaLojaAoCep`) e `@/lib/supabase/service` (`createServiceClient` retorna sentinela `{__role:"service"}`), no padrão de `pedido.test.ts`.

1. **Loja com coords + CEP + zona `raio_km` cobre:** `distanciaDaLojaAoCep` → `4.7`; zona `raio_km` com `raio_max_km` ≥ 4.7 e taxa X → `{ ok:true, taxa_preview: X, zona_nome: <nome zona raio> }`. Assert `distanciaDaLojaAoCep` chamado com `(svcSentinel, LOJA_ID, cep)`.
2. **Geocoding null → fallback:** `distanciaDaLojaAoCep` → `undefined`; zona `raio_km` presente mas não casa → `taxa_preview` = fallback fora-de-zona (mesmo do autoritativo).
3. **Loja sem coords → inalterado:** `distanciaDaLojaAoCep` → `undefined`; só zonas `bairro` → resultado idêntico aos testes atuais de bairro.
4. **PARIDADE preview ↔ criarPedido:** mesmo input (coords + CEP + zona raio) → `taxa_preview` do preview == `taxa` que `criarPedido` calcularia (ambos chamam o MESMO helper com os MESMOS args e o MESMO `calcularFrete`). Verificar via `toHaveBeenCalledWith` que os args do helper são idênticos aos de `pedido.test.ts`.
5. **service_role escopado:** `createServiceClient` chamado (substitui o teste antigo "NÃO usa service_role"); `listarZonasComTaxas`/`buscarLojaPublicaPorId` ainda recebem o client ANON (zonas/loja não regridem para service_role).
6. **Regressão:** todos os testes existentes de bairro/faixa_cep/reconciliação/strict/rate-limit continuam verdes.

### Ordem de Implementação

Issue **crítica** (dinheiro: a distância altera a zona e a taxa). Começar pela fase RED:
1. **RED (`/tdd`):** atualizar `frete.test.ts` — adicionar casos 1–5 + converter o teste "NÃO usa service_role". Confirmar falha real (action ainda não injeta `distanciaKm`).
2. **GREEN (`/execute`):** patch mínimo em `frete.ts` (import + 3 linhas + comentário de cabeçalho). Rodar `pnpm test` (`npx`, nunca `pnpm` para supabase) e `next build` (MEMORY: const exportada em `'use server'` só quebra no build).
