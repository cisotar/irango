# 186 — consulta de geocoding da LOJA inclui o CEP cru

crítica: NÃO (não decide valor monetário diretamente — mas desloca o centro do raio,
logo desloca TODAS as zonas `raio_km`. Severidade MÉDIA.)

## Origem

Decisão **D5** do Plano Técnico da issue 185
(`tasks/185-geocoding-do-cep-quebra-frete-por-raio.md`). A 185 corrigiu o lado do
CLIENTE (CEP do checkout) e deixou o lado da LOJA explicitamente fora de escopo, com os
motivos registrados abaixo. Nada do lado da loja foi tocado no PR da 185.

## Sintoma

`montarConsultaGeocoding` (`src/lib/actions/patches-loja.ts:62`) monta a consulta enviada
ao Nominatim como `"<logradouro>, <numero>, <cidade> - <uf>, <cep>, Brasil"` — ou seja,
**inclui o CEP cru como token de busca livre**. É exatamente o token que a evidência da
185 provou ser envenenador: `q=12914-190` resolveu para uma estrada na República Tcheca,
e `q=12914-190&countrycodes=br` para um bairro em São Sepé/RS. O OSM não indexa CEP
brasileiro; incluir o token só adiciona ruído à pontuação da busca livre.

Consumidores do caminho afetado:
- `src/lib/actions/loja.ts:115-127` (`salvarPerfil`, com retry próprio);
- `src/app/admin/assinantes/actions/admin-perfil.ts:107` (hub admin).

## Impacto

A loja é o **centro** do raio: um erro no ponto da loja desloca todas as zonas
`raio_km` de uma vez. Diferente do caso do cliente, a falha aqui é silenciosa e
persistente (as coords ficam gravadas em `lojas.latitude/longitude`).

Além disso, este caminho hoje:
- **não** envia `countrycodes=br`;
- **não** valida o par retornado contra o bounding box do Brasil — nada impede que uma
  loja brasileira acabe com coords na Europa, como aconteceu do lado do cliente.

## Escopo proposto

1. Remover o token do CEP da consulta em `montarConsultaGeocoding`.
2. Passar `restringirBrasil: true` no caminho da loja — `consultarNominatim`
   (`src/lib/utils/geocodificarEndereco.ts`) já aceita a opção; hoje só o caminho do CEP
   do cliente a usa. Provavelmente via um parâmetro novo em
   `geocodificarEnderecoComMotivo`, ou uma função irmã.
3. Aplicar `dentroDoBrasil` (`src/lib/utils/geocodingCepCliente.ts`, criada na 185 e já
   testada) ao par retornado: fora da caixa ⇒ tratar como `nao_encontrado`, **nunca
   gravar** coords fora do Brasil em `lojas`.

## Por que NÃO virou fonte única com o lado do cliente (D5 da 185)

Registrado para que ninguém "unifique os dois builders" achando que é DRY:

1. **A fonte do dado é diferente.** O lojista **digita** o endereço; o cliente tem o
   endereço **resolvido pelo ViaCEP no servidor**. Um builder comum teria que aceitar
   texto não confiável — exatamente o que a issue 064 proíbe.
2. **O requisito de precisão é oposto.** A loja precisa de precisão de logradouro+número
   e pode pagar o risco de `nao_encontrado` (roda uma vez, no salvamento, fora do caminho
   quente, e já tem retry). O cliente precisa de resolução garantida e roda no caminho
   quente do checkout, sob a trava de 1 req/s — por isso ficou na precisão de bairro.
   Um builder comum rebaixaria a loja ou promoveria o cliente; as duas opções foram
   rejeitadas na 185.
3. **Superfície de blast maior.** `montarConsultaGeocoding` tem 3 consumidores
   (`loja.ts`, `admin-perfil.ts`, `patches-loja.test.ts`), incluindo o hub admin —
   mexer nele arrasta `isolamento-admin.test.ts` e `admin-loja.binding.test.ts`.

Dois builders com requisitos de precisão distintos não são DRY violado: são duas regras
diferentes. O que **é** reuso legítimo aqui é `dentroDoBrasil`.

## Fora de escopo

- Backfill/recorreção das coords já gravadas de lojas existentes (exigiria escrita em
  produção e autorização humana — tratar como issue à parte se algum caso real aparecer).
- Qualquer mudança no caminho do CEP do cliente (fechado pela 185).
- Cache: o caminho da loja não usa cache de coordenadas (removido na 185/D3) e não deve
  passar a usar — endereço de loja é geocodificado uma vez, no salvamento.

## Testes esperados

- A URL enviada ao Nominatim para um endereço de loja **não contém o CEP** e **contém**
  `countrycodes=br`.
- Par fora do bounding box do Brasil ⇒ `nao_encontrado`; `salvarPerfil` **não** grava
  `latitude`/`longitude`.
- `salvarPerfil` e `admin-perfil` continuam com o comportamento de retry e de
  não-apagar-localização já coberto (ver issue 180).
- Nenhum log carrega o par (lat,lng) nem o endereço (§14/§19/§21).
