# Plano técnico — troca de provedor de geocoding (Nominatim → Google Geocoding API)

Produzido pelo `arquitetar` para a issue `tasks/190-precisao-de-geocoding-do-cep-troca-de-provedor.md`.
Este arquivo é o plano TÉCNICO (arquivos, pseudocódigo, schema de request/response, casos de teste).
`plan/loop-geocoding-google.md` continua sendo o plano de ORQUESTRAÇÃO do ciclo inteiro — não foi
sobrescrito.

## Decisões (as 6 que a issue marcava como em aberto)

### 1. Formato da query enviada à Google

**Decisão: endereço completo, montado só com dados do SERVIDOR (ViaCEP) — nunca com dado declarado
pelo cliente.** Cascata do mais específico ao mais genérico:

1. `"<logradouro>, <bairro>, <cidade> - <uf>, Brasil"` (quando há logradouro)
2. `"<bairro>, <cidade> - <uf>, Brasil"` (quando há bairro mas não logradouro, ou como 2º tentativa
   se (1) voltar `ZERO_RESULTS`)
3. `"<cidade> - <uf>, Brasil"` (sempre presente, é o comportamento ATUAL — nunca fica pior que hoje)

**Por quê:** resolve a granularidade (o critério de sucesso exige `12914-190` ≠ `12900-430`, e os dois
têm logradouro/bairro diferentes no ViaCEP) sem abrir a superfície de "cliente influencia o valor
cobrado" que o mandato 1 do `CLAUDE.md` proíbe. O `numero` do checkout (`validacoes/checkout.ts:26`,
`validacoes/pedido.ts:66`) **fica de fora deliberadamente**: é dado do cliente, e mesmo sendo um
deslocamento bounded ao longo de uma rua, é superfície nova de manipulação de zona/frete sem
necessidade — o CEP brasileiro já é granular o bastante (tipicamente 1 CEP = 1 logradouro em área
urbana) para o Google, que tem cobertura de endereço BR muito melhor que o OSM, discriminar as duas
ruas do critério de sucesso. A cascata (não uma tentativa única) existe porque a falha que motivou a
185 foi exatamente um bairro que não existe no OSM (`Jardim Sevilha`) — o Google deve resolver isso na
prática, mas a cascata é defesa em profundidade caso outro bairro/logradouro não exista no índice dele.
A cascata só avança em `nao_encontrado` (ZERO_RESULTS), nunca em `transitorio` — retry num canal já
degradado (rate limit estourado, 5xx) dobraria o gasto sem chance real de sucesso.

### 2. Nova política de rate limit → guarda de custo

**Decisão: duas travas Redis fail-closed, nenhuma delas mais é anti-ban.**

- **Burst global:** `Ratelimit.fixedWindow(10, "1 s")`, prefixo `irango:rl:geocode-google`. Não é
  mais 1/s (isso era exclusivamente anti-ban do Nominatim) — 10/s é só uma cautela de sanidade contra
  picos degenerados (ex.: bug de loop), não uma trava de custo.
- **Teto diário GLOBAL:** `Ratelimit.fixedWindow(N, "1 d")`, prefixo `irango:rl:geocode-google-daily`,
  `N = process.env.GEOCODE_GOOGLE_DAILY_LIMIT` com default **500**. Esta é a guarda de custo real.
  500/dia ≈ 15.000/mês — bate quase exatamente com a projeção do usuário de regime pleno (10
  lojistas × 50 pedidos/dia). No pior caso (zero cache hit) o teto limita o gasto mensal a
  `(15000 − 10000) × $5,00/1000 ≈ $25/mês`, **o mesmo teto que o usuário já aprovou** na issue — o
  guard não é arbitrário, é o próprio orçamento aprovado expresso como trava mecânica.
- **Fail-closed, igual à política anti-ban de hoje:** se o Redis está indisponível, os limitadores não
  podem ser verificados ⇒ **não chama a Google** ⇒ `transitorio`. Gastar dinheiro sem conseguir
  contabilizar o gasto é pior que negar uma resolução (que já degrada de forma segura para
  `fora_zona`/`indisponivel`). O rate limit POR IP existente em `frete.ts` (fail-open) continua
  intocado — ele protege contra abuso de tráfego, não é a guarda de custo; a guarda de custo é
  GLOBAL porque o dano financeiro é global (não por IP: 1000 IPs fazendo 1 request cada custa o mesmo
  que 1 IP fazendo 1000).
- Cascata (decisão 1) conta como múltiplas chamadas contra o MESMO teto diário — não há orçamento
  separado por tentativa.

### 3. TTL do cache

**Decisão: 25 dias (`2_160_000` segundos)**, não os 30 permitidos pelos termos da Google. Margem de
segurança contra deriva de relógio/cron e contra o tempo entre "a coordenada foi gravada" e "a
gravação efetivamente expira" no Redis (TTL é avaliado pelo Redis, não por um job nosso — 30 dias
exatos deixaria zero folga para qualquer imprecisão). 5 dias de margem custam cache-hit-rate
desprezível (CEPs residenciais não mudam de coordenada).

### 4. `VERSAO_CACHE_GEOCODE`

**Decisão: sobe de `2` para `3`.** Motivo inalterado da issue: coordenadas cacheadas hoje são
centroides de cidade (o próprio defeito que esta issue corrige) — têm que virar MISS incondicional na
troca, sem `DEL` manual em produção. Mesmo mecanismo já usado na 185 (2 → de um valor implícito
anterior).

### 5. Escopo do geocoding da loja (issue #186)

**Decisão: ENTRA no escopo desta troca — mas por acidente estrutural, não por esforço extra
deliberado.** `geocodificarEnderecoComMotivo` (caminho da loja) e `geocodificarCepResolvido` (caminho
do cliente) **compartilham a mesma função interna de provedor** (`consultarNominatim`, que vira
`consultarGoogle`). Trocar o provedor por trás dessa função troca os dois caminhos ao mesmo tempo,
salvo que eu bifurcasse deliberadamente em dois provedores simultâneos (um Nominatim só para a loja,
um Google só para o cliente) — o que **piora** a superfície de auditoria em vez de reduzi-la (duas
integrações externas, duas envs de credencial, dois códigos de rate limit a manter e revisar,
justamente o oposto do mandato 2 — não reinventar/duplicar).

Isso reverte a recomendação registrada pelo `orquestrar` (deixar de fora), com evidência concreta
checada nesta sessão: `src/lib/actions/loja.test.ts` mocka o MÓDULO `geocodificarEndereco` inteiro
(`vi.mock("@/lib/utils/geocodificarEndereco", ...)`), não o `fetch` — ou seja, a troca de provedor
**não exige nenhuma mudança em `loja.test.ts`**. O volume da loja é irrisório (like a recomendação já
dizia), mas o custo de INCLUIR é ~zero (mesmo código, zero teste novo no caminho da loja) enquanto o
custo de EXCLUIR seria positivo (manter duas integrações vivas). `loja.ts:115-127` e
`patches-loja.ts::montarConsultaGeocoding` **não são tocados** — continuam chamando
`geocodificarEnderecoComMotivo` com a mesma assinatura; só o interior da função muda de provedor.

### 6. Fronteira/abstração do provedor

**Decisão: uma função interna só, sem interface.** `consultarNominatim` vira `consultarGoogle` dentro
do mesmo módulo `geocodificarEndereco.ts`, com a mesma assinatura de retorno (`ResultadoGeocoding`).
Nenhuma `interface IGeocodingProvider` ou injeção de dependência: só existe 1 provedor de cada vez em
produção (igual ao raciocínio já registrado no `plan/loop-geocoding-google.md` §3 contra o SDK
`@googlemaps/google-maps-services-js` — REST puro com `fetch`, sem dependência nova). Se um dia
existir um SEGUNDO provedor simultâneo (ex.: fallback A/B), a extração de interface se paga sozinha
naquele momento; hoje seria YAGNI.

## Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `src/lib/utils/geocodingCepCliente.ts` | `montarConsultaCepCliente` (retorna 1 string) vira `montarConsultasCepCliente` (retorna `string[]` em cascata). `dentroDoBrasil` intocado. |
| `src/lib/utils/geocodingCepCliente.test.ts` | Casos novos para a cascata (ver §Testes). |
| `src/lib/utils/geocodificarEndereco.ts` | `consultarNominatim` → `consultarGoogle` (Google REST); `VERSAO_CACHE_GEOCODE=3`; `TTL_CACHE_GEOCODE_SEGUNDOS=2_160_000`; troca `userAgent()`/`NOMINATIM_USER_AGENT` por `chaveGoogle()`/`GOOGLE_GEOCODING_API_KEY`; troca a trava única 1/s por burst 10/s + teto diário `GEOCODE_GOOGLE_DAILY_LIMIT` (default 500); `geocodificarCepResolvido` passa a receber `resolverEndereco: () => Promise<EnderecoCepResolvido | null>` (era `() => Promise<string | null>`) e orquestra a cascata internamente. Comentários de cabeçalho reescritos (deixa de ser "anti-ban Nominatim", vira "guarda de custo Google"). |
| `src/lib/utils/geocodificarEndereco.test.ts` | Reescrito para mocks de resposta Google (loja). |
| `src/lib/utils/geocodificarCepResolvido.test.ts` | Reescrito para mocks Google + os dois CEPs do critério de sucesso + cascata + TTL/versão novos. |
| `src/lib/actions/distanciaFrete.ts` | Simplifica: para de importar/chamar `montarConsultaCepCliente` — passa `resolverEndereco` direto para `geocodificarCepResolvido` (o thunk já tem o shape certo, `EnderecoCepResolvido`). |
| `src/lib/actions/distanciaFrete.test.ts` | Ajusta mocks para a nova assinatura do thunk (contrato, não comportamento). |
| `src/lib/actions/frete.ts`, `src/lib/actions/pedido.ts` | Não deveriam precisar de mudança de código — `resolverCep`/`resolverEndereco` já retornam `EnderecoCepResolvido \| null`. Rodar `tsc` para confirmar; se algum tipo explícito nomear `string \| null`, ajustar só a anotação. |
| `src/lib/actions/loja.ts`, `src/lib/actions/patches-loja.ts` | **Não tocados** (decisão 5) — migram de provedor por efeito colateral da troca em `geocodificarEndereco.ts`, sem mudança de código próprio. |
| `.env.example` | Remove `NOMINATIM_USER_AGENT=`; adiciona `GOOGLE_GEOCODING_API_KEY=` e `GEOCODE_GOOGLE_DAILY_LIMIT=` (só os nomes, nunca valor). Fora do escopo de `.env*` proibido pelo CLAUDE.md (esse arquivo é o template versionado). |
| `references/seguranca.md` §12-A/§10-A | Passo do `escriba` (fora deste plano técnico) — deixa de descrever Nominatim/anti-ban, passa a descrever Google + guarda de custo + TTL 25 dias. |
| `references/architecture.md` | Idem, passo do `escriba`. |

## Pseudocódigo das mudanças centrais

### `geocodingCepCliente.ts`

```ts
export function montarConsultasCepCliente(e: EnderecoCepResolvido): string[] {
  const cidade = e.cidade?.trim() ?? "";
  const uf = e.uf?.trim() ?? "";
  if (!cidade || !uf) return [];

  const logradouro = e.logradouro?.trim();
  const bairro = e.bairro?.trim();
  const sufixo = `${cidade} - ${uf}, Brasil`;

  const candidatos: string[] = [];
  if (logradouro) {
    candidatos.push(bairro ? `${logradouro}, ${bairro}, ${sufixo}` : `${logradouro}, ${sufixo}`);
  }
  if (bairro) candidatos.push(`${bairro}, ${sufixo}`);
  candidatos.push(sufixo); // sempre presente — nunca fica pior que o comportamento atual

  return [...new Set(candidatos)]; // dedupe preservando ordem (mais específico → mais genérico)
}
```

### `geocodificarEndereco.ts` — provedor

```ts
export const VERSAO_CACHE_GEOCODE = 3;
export const TTL_CACHE_GEOCODE_SEGUNDOS = 2_160_000; // 25 dias

function chaveGoogle(): string | null {
  const k = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  return k ? k : null;
}

function obterLimitadorBurst(): Ratelimit { /* fixedWindow(10, "1 s"), prefix irango:rl:geocode-google */ }
function obterLimitadorDiario(): Ratelimit {
  const n = Number(process.env.GEOCODE_GOOGLE_DAILY_LIMIT ?? 500);
  /* fixedWindow(n, "1 d"), prefix irango:rl:geocode-google-daily */
}

type RespostaGoogleGeocoding = {
  status: "OK" | "ZERO_RESULTS" | "OVER_QUERY_LIMIT" | "REQUEST_DENIED" | "INVALID_REQUEST" | "UNKNOWN_ERROR" | string;
  results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
};

async function consultarGoogle(
  chave: string,
  consulta: string,
  opcoes: { restringirBrasil: boolean },
): Promise<ResultadoGeocoding> {
  try {
    const burst = await obterLimitadorBurst().limit("geocode-burst");
    if (!burst.success) return { coords: null, motivo: "transitorio" };
    const diario = await obterLimitadorDiario().limit("geocode-daily");
    if (!diario.success) return { coords: null, motivo: "transitorio" };

    const pais = opcoes.restringirBrasil ? "&components=country:BR" : "";
    const url = `https://maps.googleapis.com/maps/api/geocode/json?key=${chave}&address=${encodeURIComponent(consulta)}${pais}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return { coords: null, motivo: "transitorio" };

    const body = (await resp.json()) as RespostaGoogleGeocoding;
    if (body.status === "ZERO_RESULTS") return { coords: null, motivo: "nao_encontrado" };
    if (body.status !== "OK") {
      console.error("[geocodificarEndereco] status Google:", body.status); // NUNCA loga a consulta/coords
      return { coords: null, motivo: "transitorio" };
    }

    const loc = body.results?.[0]?.geometry?.location;
    const latitude = Number(loc?.lat);
    const longitude = Number(loc?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { coords: null, motivo: "nao_encontrado" };
    }
    return { coords: { latitude, longitude } };
  } catch (e) {
    console.error("[geocodificarEndereco]", e);
    return { coords: null, motivo: "transitorio" };
  }
}
```

### `geocodificarCepResolvido` — cascata

```ts
export async function geocodificarCepResolvido(
  cep: string,
  resolverEndereco: () => Promise<EnderecoCepResolvido | null>,
): Promise<ResultadoGeocoding> {
  const chave = chaveGoogle();
  if (!chave) return { coords: null, motivo: "transitorio" };
  if (!credenciaisRedis()) return { coords: null, motivo: "transitorio" };

  const digitos = limparCep(cep);
  if (!/^\d{8}$/.test(digitos)) return { coords: null, motivo: "transitorio" };

  const cacheado = await lerCacheCoordenadas(digitos);
  if (cacheado) return { coords: cacheado };

  let resolvido: EnderecoCepResolvido | null;
  try {
    resolvido = await resolverEndereco();
  } catch (e) {
    console.error("[geocodificarCepResolvido]", e);
    return { coords: null, motivo: "transitorio" };
  }
  if (!resolvido) return { coords: null, motivo: "transitorio" };

  const candidatos = montarConsultasCepCliente(resolvido);
  if (candidatos.length === 0) return { coords: null, motivo: "transitorio" };

  for (const consulta of candidatos) {
    const r = await consultarGoogle(chave, consulta, { restringirBrasil: true });
    if (r.coords == null) {
      if (r.motivo === "transitorio") return r; // não cascateia em falha de canal/orçamento
      continue; // nao_encontrado → tenta o próximo candidato, mais genérico
    }
    if (!dentroDoBrasil(r.coords.latitude, r.coords.longitude)) {
      return { coords: null, motivo: "nao_encontrado" }; // não grava, não cascateia
    }
    await gravarCacheCoordenadas(digitos, r.coords);
    return r;
  }
  return { coords: null, motivo: "nao_encontrado" }; // todos os candidatos exauridos
}
```

### `distanciaFrete.ts` — simplificação

```ts
// antes:
// const cliente = await geocodificarCepResolvido(cep, async () => {
//   const resolvido = await resolverEndereco();
//   return resolvido ? montarConsultaCepCliente(resolvido) : null;
// });

// depois:
const cliente = await geocodificarCepResolvido(cep, resolverEndereco);
```
(remove o import de `montarConsultaCepCliente` em `distanciaFrete.ts` — a cascata passou a ser
responsabilidade do módulo de geocoding, não do caller.)

## Schema de request/response da Google Geocoding API

**Request:**
```
GET https://maps.googleapis.com/maps/api/geocode/json
  ?key=<GOOGLE_GEOCODING_API_KEY>
  &address=<consulta URL-encoded>
  &components=country:BR      (só quando restringirBrasil=true — caminho do cliente)
```
Sem corpo. `AbortSignal.timeout(5000)`, igual ao Nominatim hoje.

**Response (200 OK):**
```json
{
  "status": "OK",
  "results": [
    {
      "geometry": { "location": { "lat": -22.9610457, "lng": -46.5422615 }, "location_type": "ROOFTOP" },
      "formatted_address": "...",
      "place_id": "..."
    }
  ]
}
```
`status` possíveis e mapeamento para `MotivoGeocoding`:

| `status` | Resultado |
|---|---|
| `OK` (com `results[0].geometry.location` finito) | `{ coords }` |
| `OK` mas `results` vazio/coords não-finitas (defensivo — não deveria ocorrer) | `nao_encontrado` |
| `ZERO_RESULTS` | `nao_encontrado` |
| `OVER_QUERY_LIMIT`, `REQUEST_DENIED`, `INVALID_REQUEST`, `UNKNOWN_ERROR`, qualquer outro | `transitorio` (log só do `status`, nunca da consulta/coords/chave) |
| HTTP não-ok (4xx/5xx de rede, não do `status` do corpo) | `transitorio` |
| timeout/exceção de rede | `transitorio` |

`REQUEST_DENIED` (ex.: chave errada/API não habilitada) é tecnicamente permanente, não transitório —
mas o caller (`calcularFreteAction`/`salvarPerfil`) não tem como agir diferente entre "tente de novo
em 1s" e "a configuração está quebrada": os dois só podem degradar para fallback. Mantém-se
`transitorio` por paridade com o comportamento atual (HTTP não-ok também vira `transitorio` hoje) —
quem precisa DE FATO saber que a chave está errada é o alerta de orçamento/log do servidor, não o
fluxo de frete.

## Ordem de implementação

1. `geocodingCepCliente.ts` (função pura, sem I/O) + `geocodingCepCliente.test.ts` — cascata de
   candidatos. Base para tudo abaixo; zero dependência de Redis/fetch.
2. `geocodificarEndereco.ts` (provedor + cache + travas) + os dois arquivos de teste do módulo —
   maior mudança, depende de (1).
3. `distanciaFrete.ts` + `distanciaFrete.test.ts` — simplificação de contrato, depende de (2).
4. Rodar `npx tsc --noEmit` isolando `frete.ts`/`pedido.ts` — confirmar que nenhuma anotação de tipo
   quebrou (não deveria precisar de mudança de código, só de tipos se algum `string | null` explícito
   existir).
5. `loja.ts`/`patches-loja.ts` — NENHUMA mudança de código; só confirmar via `loja.test.ts` (já mocka
   o módulo inteiro) que a suíte segue verde sem edição.
6. `.env.example` — trocar `NOMINATIM_USER_AGENT=` por `GOOGLE_GEOCODING_API_KEY=` e
   `GEOCODE_GOOGLE_DAILY_LIMIT=`.
7. `references/seguranca.md` + `references/architecture.md` (passo do `escriba`, fora deste plano).

## Casos de teste que o `tdd` precisa cobrir (fetch mockado, nunca a API real)

### `geocodingCepCliente.test.ts` — `montarConsultasCepCliente`
1. Logradouro + bairro + cidade + uf → 3 candidatos, do mais específico ao mais genérico; o último é
   exatamente `"<cidade> - <uf>, Brasil"`.
2. Só bairro (sem logradouro) → 2 candidatos.
3. Nem logradouro nem bairro → 1 candidato (`"<cidade> - <uf>, Brasil"`).
4. Sem cidade OU sem uf → `[]`.
5. Bairro igual a um segmento já presente → sem duplicata (dedupe).

### `geocodificarEndereco.test.ts` — caminho da loja (`geocodificarEnderecoComMotivo` → `consultarGoogle`)
6. `status: "OK"` com `results[0]` válido → `{ coords }` com lat/lng corretos.
7. `status: "ZERO_RESULTS"` → `nao_encontrado`.
8. `status: "OVER_QUERY_LIMIT"` → `transitorio`.
9. `status: "REQUEST_DENIED"` → `transitorio`, e o log capturado NUNCA contém a chave nem a consulta.
10. HTTP 500 → `transitorio`.
11. `fetch` rejeita (timeout simulado) → `transitorio`, sem propagar exceção.
12. Sem `GOOGLE_GEOCODING_API_KEY` (ausente/vazia) → `transitorio`, `fetch` **nunca** chamado.
13. Sem credenciais Upstash → `transitorio`, `fetch` **nunca** chamado.
14. Burst limiter nega (`limit` retorna `{success:false}` na 1ª chamada) → `transitorio`, `fetch`
    nunca chamado.
15. Burst ok, diário nega → `transitorio`, `fetch` nunca chamado.
16. URL chamada NÃO contém `components=country:BR` (loja passa `restringirBrasil:false`).
17. Nenhuma chamada a `console.error`/log inclui `(lat,lng)` ou o texto da consulta em nenhum dos
    cenários acima.

### `geocodificarCepResolvido.test.ts` — caminho do cliente (cascata + cache)
18. **Critério de sucesso da issue**: CEP `12914-190` (ViaCEP mock: bairro "Jardim Sevilha",
    logradouro "Rua ..." , cidade "Bragança Paulista", uf "SP") → Google mockada devolve coords A;
    CEP `12900-430` (bairro "Centro", logradouro diferente, mesma cidade/uf) → Google mockada devolve
    coords B ≠ A. Asserta que as duas chamadas de `fetch` usaram `address=` DIFERENTES (contendo o
    logradouro/bairro específico de cada CEP) e que os dois resultados finais têm coordenadas
    diferentes.
19. Cache hit (valor com `v:3`) → nem ViaCEP nem `fetch` são chamados.
20. Cache com `v:2` (formato antigo/centroide) → tratado como MISS, refaz a resolução.
21. Cascata: 1ª consulta (logradouro+bairro+cidade-UF) → `ZERO_RESULTS`; 2ª consulta
    (bairro+cidade-UF) → `OK` → retorna coords; exatamente 2 chamadas de `fetch` (não 3).
22. Cascata completa: logradouro E bairro dão `ZERO_RESULTS` → cai na 3ª consulta (só cidade-UF), que
    dá `OK` → retorna coords; exatamente 3 chamadas de `fetch`.
23. 1ª consulta retorna `transitorio` (`OVER_QUERY_LIMIT`) → retorna `transitorio` IMEDIATAMENTE, com
    exatamente 1 chamada de `fetch` (a cascata não avança em falha de canal/orçamento).
24. Par fora do Brasil vindo do Google → `dentroDoBrasil` barra, retorna `nao_encontrado`, e `set` do
    Redis **não** é chamado (sem cache negativo, sem cache de coordenada inválida).
25. `set` do Redis é chamado com `ex` igual a `2_160_000` (TTL de 25 dias) no caminho de sucesso.
26. Valor gravado no `set` tem `v: 3`.
27. CEP malformado → `transitorio`, zero chamadas de I/O (nem ViaCEP nem `fetch`).
28. `resolverEndereco()` retorna `null` (ViaCEP fora do ar) → `transitorio`, zero chamadas ao Google.
29. Teto diário excedido (limitador diário mockado retornando `success:false`) → `transitorio`, zero
    chamadas de `fetch`, mesmo com cache miss e ViaCEP disponível.

### `distanciaFrete.test.ts`
30. Ajuste de contrato: o mock de `geocodificarCepResolvido` passa a receber o thunk
    `resolverEndereco` (que retorna `EnderecoCepResolvido | null`) diretamente — não mais uma string
    pré-montada. Comportamento observável (paridade preview↔autoritativo) permanece igual.

## Débitos relacionados — o que esta troca resolve de graça e o que não

- **#187** (schema do CEP sem teto de tamanho / bounding box não reaplicado na leitura do cache): **não
  resolvido aqui.** `dentroDoBrasil` já é chamado só no caminho de escrita (após `consultarGoogle`);
  a leitura do cache (`lerCacheCoordenadas`) continua sem reaplicar o guard — fora de escopo, issue
  própria.
- **#188** (sem request-coalescing para resoluções concorrentes do mesmo CEP): **não resolvido aqui**,
  mas fica mais urgente com provedor pago (2 abas do mesmo cliente = 2 chamadas cobradas). Continua
  issue própria — puxar aumentaria o escopo desta migração sem necessidade.
- **#189** (resolvedor de CEP memoizado duplicado entre `frete.ts`/`pedido.ts`): **não tocado.**

## Critério de sucesso (reafirmado, sem mudança)

Dois CEPs distintos da mesma cidade (`12914-190` e `12900-430`, Bragança Paulista/SP) produzem
distâncias DIFERENTES no app rodando de verdade, com `tsc`/`lint`/`test`/`build` verdes e
`grep -iE 'AIza[0-9A-Za-z_-]{10,}'` vazio no diff.
