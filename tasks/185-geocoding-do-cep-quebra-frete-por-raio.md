# 185 — geocoding do CEP quebra o cálculo de frete por raio

crítica: SIM (valor monetário — decide se o frete é calculado e qual taxa — mandato 3 do CLAUDE.md)

## Origem

Achado do usuário durante a verificação do PR #121, testando o checkout real de "Pão do Ciso" com o
CEP `12914-190`. Plano de execução em `plan/loop-geocoding-cep-frete.md` (gerado pelo `orquestrar`).
Não é regressão do #121 — bug pré-existente, silencioso, em código que o #121 não tocou.

## Sintoma

No checkout da vitrine pública, cliente informa CEP, o endereço aparece corretamente na tela
(autopreenchido via ViaCEP), mas o frete não é calculado ("indisponível") mesmo quando o cliente está
geograficamente dentro do raio de entrega da loja.

## Causa raiz (reproduzida, não é hipótese)

O checkout resolve o mesmo CEP por dois caminhos independentes:

1. **Exibição do endereço** — `src/components/vitrine/FormEndereco.tsx` chama `buscarCep`
   (`src/lib/utils/buscarCep.ts`, ViaCEP) e autopreenche logradouro/bairro/cidade/UF. Funciona.
2. **Distância para o frete** — `src/lib/actions/frete.ts` (preview) e `src/lib/actions/pedido.ts`
   (autoritativo) chamam `distanciaDaLojaAoCep` (`src/lib/actions/distanciaFrete.ts:38`), que chama
   `geocodificarEndereco` (`src/lib/utils/geocodificarEndereco.ts`). Esse caminho manda o **CEP cru**
   como busca livre para o Nominatim (monta `search?format=jsonv2&limit=1&q=<consulta>` — sem
   `countrycodes`, sem `postalcode` estruturado) e **ignora o endereço que o ViaCEP já resolveu no
   passo 1**.

## Evidência reproduzida — CEP `12914-190`, loja "Pão do Ciso" (Bragança Paulista/SP, coords
cadastradas `-22.9610457, -46.5422615`)

| Consulta | Resultado |
|---|---|
| `q=12914-190` (o que o código faz hoje) | uma estrada na **República Tcheca** |
| `q=12914-190&countrycodes=br` | bairro em **São Sepé/RS** (ainda errado) |
| `postalcode=12914-190&country=Brazil` (estruturado) | **vazio** — OSM não indexa esse CEP |
| ViaCEP (`buscarCep`) | **certo**: Av. Ladislau Osório de Vasconcellos Leme, Bragança Paulista/SP |
| `q=Bragança Paulista, SP, Brazil` | `-22.9520235, -46.5418586` → **~1 km** da loja |

O cliente está de verdade dentro do raio; o servidor geocodifica errado, a distância sai absurda,
nenhuma zona `raio_km` casa e `calcularFrete` cai em "indisponível" (sem `taxa_entrega_fora_zona`
configurada em "Pão do Ciso", não há nem o fallback).

## Cache envenenado (suspeita lógica, não verificada diretamente)

`geocodificarEndereco.ts` cacheia coordenadas de CEP no Redis **sem TTL**
(`irango:geocode:<cep>`, gravação só no caminho de sucesso). Se algum cliente real já disparou esse
CEP (ou outro mal resolvido) antes desta investigação, a coordenada errada fica cacheada **para
sempre** — nenhuma correção de código muda o comportamento observado até a chave ser invalidada. Não
foi possível confirmar diretamente (sem acesso às credenciais Upstash), mas qualquer fix precisa tratar
isso como certo, não como possibilidade.

## Restrições e decisões já declaradas

- É dinheiro + geolocalização de cliente → mandato 3 do `CLAUDE.md` e `seguranca.md` §12-A (política
  anti-ban do Nominatim, fail-closed) e §19/§21 (coords nunca vazam ao cliente, nunca são logadas).
  Qualquer fix preserva isso.
- `distanciaDaLojaAoCep` e `geocodificarEndereco` **já são fail-closed corretamente** — não é a
  política de falha que quebrou, é a **query mal formada**.
- `schemaEnderecoEntrega` (`validacoes/pedido.ts:62-70`) já aceita `cidade`/`uf` do cliente, mas
  confiar neles para escolher preço reabriria o vetor de subpagamento que a issue 064 fechou para o
  bairro — o endereço textual usado para geocodificar tem que vir de uma fonte resolvida no servidor
  (ViaCEP), não do payload do cliente.
- `src/lib/utils/reconciliarBairroCep.ts` já consulta o ViaCEP no servidor (fail-closed, timeout 3s) e
  já é chamado pelos dois caminhos do frete — hoje descarta cidade/UF/logradouro, ficando só com o
  bairro. É o ponto de reuso natural.
- `src/lib/actions/patches-loja.ts::montarConsultaGeocoding` já constrói consulta textual para o
  Nominatim do lado da loja — candidato a fonte única de construção de consulta.

## Decisões em aberto para o `arquitetar`

Ver `plan/loop-geocoding-cep-frete.md` §5 passo 3 para os critérios completos:

1. **Fonte da consulta ao Nominatim**: geocodificar o texto resolvido pelo ViaCEP (logradouro+bairro+
   cidade+UF vs. só cidade+UF) em vez do CEP cru. `countrycodes=br` sozinho já foi descartado pela
   evidência (resolveu errado mesmo assim).
2. **Estratégia de invalidação do cache envenenado** — três candidatas, nesta ordem de preferência:
   versionar o valor (`{lat,lng,v:2}`, sem `v:2` = miss), versionar a chave (`irango:geocode:v2:<cep>`),
   ou `DEL` dirigido (exige autorização humana e escrita em produção — última opção).
3. **Paridade preview ↔ autoritativo** — `frete.ts` e `pedido.ts` continuam resolvendo o CEP pelo mesmo
   caminho, sem que o preview aceite campos novos do cliente.
4. **Teto de chamadas ao Nominatim por resolução** — o fix não pode aumentar o número de chamadas por
   checkout; se usar cadeia de tentativas, declarar o teto e como o cache absorve a diferença.
5. **Escopo do lado da loja** (`src/lib/actions/loja.ts:115-127`, mesmo padrão de geocoding frágil do
   endereço do lojista) — decidir explicitamente se entra neste loop ou vira issue separada.

## Fora de escopo desta issue

- Observabilidade do "indisponível" (distinguir "fora do raio" de "não consegui geocodificar" em
  log/métrica, sem coords) — issue separada, mencionada no plano §8.
- Geocoding do endereço da própria loja (`loja.ts`) — só entra aqui se o `arquitetar` decidir que é o
  mesmo helper; senão, issue separada.
