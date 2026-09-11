# 190 — precisão de geocoding do CEP: trocar Nominatim por Google Geocoding API

crítica: SIM (valor monetário — decide se o frete é calculado e qual taxa — mandato 3 do CLAUDE.md;
introduz vetor financeiro novo — endpoint público que passa a gastar dinheiro real por chamada)

## Origem

Continuação da issue #185 (`fix: resolve CEP via ViaCEP antes de geocodificar`, PR #122, **fechado
sem merge**). O fix da #185 corrigiu o bug original (CEP cru geocodificado, resolvendo em lugares
absurdos do mundo), mas testando a preview do Vercel o usuário descobriu um problema novo, mais grave
na prática, que essa issue existe para resolver.

## Causa raiz do problema atual (não é o bug da #185, é um novo)

A consulta que o servidor manda ao Nominatim hoje é sempre `"<cidade> - <UF>, Brasil"` — sem bairro,
sem logradouro, sem CEP. Ela foi reduzida a esse formato porque a versão anterior (com bairro) falhava
para o CEP `12914-190` (bairro "Jardim Sevilha" não existe no OpenStreetMap para Bragança Paulista).

Só que dois CEPs diferentes da MESMA cidade produzem a consulta **byte a byte idêntica**, então o
Nominatim devolve **a mesma coordenada** para os dois — não importa se o cliente está a 500m ou a 7km
da loja, os dois caem na mesma distância calculada e na mesma faixa de frete. A granularidade real que
sobrou é "cidade", não "km".

**Evidência reproduzida na preview do Vercel** (loja "Pão do Ciso", Bragança Paulista/SP, coords
`-22.9610457, -46.5422615`, zonas `raio_km` de 1 a 8 km ativas):

| CEP | Bairro (ViaCEP) | Distância real esperada | Resultado observado |
|---|---|---|---|
| `12914-190` | Jardim Sevilha | ~1 km (relato original da #185) | zona "3km" |
| `12900-430` | Centro | < 1 km (confirmado em produção com bairro na consulta) | mesma zona "3km" — deveria ser diferente de `12914-190` |

Isso anula na prática o propósito da issue #181 (faixas exclusivas de km, PR #121, ainda aberto): o
recurso de precificar por faixa de distância não tem efeito se todo CEP da cidade cai na mesma faixa.

## Restrição de cache dos Termos de Serviço da Google (crítica pra migração)

Confirmado com fonte oficial: coordenadas (lat/lng) geocodificadas pela Google só podem ficar em cache
por até **30 dias consecutivos**, depois têm que ser apagadas
(https://developers.google.com/maps/documentation/geocoding/policies). `place_id` pode ser cacheado
indefinidamente, mas resolver `place_id` → coords de novo consome outra chamada.

O cache atual (`geocodificarEndereco.ts`, issue #185) usa `TTL_CACHE_GEOCODE_SEGUNDOS` de 180 dias —
precisa cair pra ≤30 dias na troca. `VERSAO_CACHE_GEOCODE` precisa subir (as coords cacheadas hoje são
centroides de cidade — têm que virar MISS, não podem sobreviver à troca).

## Preço (fonte oficial, não estimativa de terceiro)

Google Geocoding API, SKU Essentials, pay-as-you-go
(https://developers.google.com/maps/billing-and-pricing/pricing):

| Faixa mensal | Preço por 1.000 requisições |
|---|---|
| até 10.000 | grátis |
| 10.001 – 100.000 | $5,00 |
| 100.001 – 500.000 | $4,00 |
| 500.001 – 1.000.000 | $3,00 |

Projeção do usuário: objetivo de 10 lojistas em até 4 meses, ~50 pedidos/dia cada, todos com entrega →
15.000 pedidos/mês em regime pleno. Pior caso (zero cache hit, todo pedido = CEP novo): 5.000 chamadas
pagas/mês × $5,00/1.000 = **$25/mês (~R$127/mês)**. Abaixo de 10.000 chamadas/mês: **$0**.

**Orçamento aprovado pelo usuário** ("pay as you go funciona para mim").

Alternativa descartada: OpenCage — free tier proibido em produção pelos próprios termos, plano pago
mínimo de produção $50/mês (mais caro que Google nesse volume). Não reavaliar sem motivo novo.

## O que muda de propósito, não só de provedor

A trava `Ratelimit.fixedWindow(1, "1 s")` (`geocodificarEndereco.ts`) hoje é política anti-ban do
Nominatim, fail-closed. Com API paga ela vira **guarda de custo** — sem uma política equivalente, o
endpoint público `calcularFreteAction` (sem login, alcançável por qualquer anônimo) vira um vetor de
dano financeiro direto. O rate limit por IP já existente em `frete.ts` é **fail-open** (Redis cai →
libera). Essa é a decisão de segurança central que o `arquitetar` precisa resolver.

## Arquivos envolvidos

- `src/lib/utils/geocodificarEndereco.ts` — dono do cache Redis, da trava, de `consultarNominatim` e
  `geocodificarCepResolvido`. É o módulo que fala com o provedor externo hoje; a função que fala com o
  provedor precisa ficar atrás de uma fronteira trocável.
- `src/lib/utils/geocodingCepCliente.ts` — `montarConsultaCepCliente`, `dentroDoBrasil` (guard de
  bounding box, continua válido com qualquer provedor).
- `src/lib/utils/resolverCepServidor.ts` — resolve CEP → `{bairro, logradouro, cidade, uf}` via ViaCEP
  no servidor. Fonte do texto da consulta, não muda de propósito.
- `src/lib/actions/distanciaFrete.ts`, `src/lib/actions/frete.ts`, `src/lib/actions/pedido.ts` —
  paridade preview ↔ autoritativo, não deveria precisar mudar de contrato externo.
- `references/seguranca.md` §12-A/§10-A, `references/architecture.md` — desatualizam com a troca.

## Decisão de escopo em aberto — issue #186

`src/lib/actions/loja.ts:115-127` + `patches-loja.ts::montarConsultaGeocoding` fazem geocoding do
endereço da LOJA pelo mesmo módulo (`geocodificarEndereco.ts`), hoje via Nominatim. Essa issue não
decide sozinha se isso entra no escopo — é para o `arquitetar` responder explicitamente: entra junto
(se o provedor trocar por trás de uma fronteira comum) ou fica separado como #186.

**Recomendação registrada pelo `orquestrar`** (não é decisão final): deixar de fora — volume irrisório
(endereço de loja muda raramente) e incluir dobra a superfície de auditoria desta issue.

## Débitos relacionados, não resolvidos aqui a menos que o `arquitetar` decida puxar

- `tasks/187` — schema do CEP no preview sem teto de tamanho + guard de bounding box não reaplicado na
  leitura do cache.
- `tasks/188` — sem request-coalescing pra resoluções concorrentes do mesmo CEP. Fica mais relevante
  com provedor pago (2 abas do mesmo cliente = 2 chamadas cobradas), mas continua issue própria.
- `tasks/189` — resolvedor de CEP memoizado duplicado entre `frete.ts`/`pedido.ts`.

## Pré-condições humanas (fora do alcance de qualquer agente)

1. Orçamento aprovado (ver acima).
2. Projeto GCP, billing, ativar Geocoding API, gerar chave **restrita** (por API e IP), alerta de
   orçamento, gravar em `.env.local` sem prefixo `NEXT_PUBLIC_`. Ação exclusiva do usuário — nenhum
   agente deve tentar, assumir ou pedir credenciais da Google Cloud. Todo teste usa `fetch` mockado.

## Critério de sucesso

Dois CEPs distintos da mesma cidade da loja "Pão do Ciso" (`12914-190` e `12900-430`, Bragança
Paulista/SP) produzem **distâncias diferentes** no app rodando de verdade (não só no teste), com
`tsc`/`lint`/`test`/`build` verdes, e sem chave literal no diff (`grep -iE 'AIza[0-9A-Za-z_-]{10,}'`
vazio).
