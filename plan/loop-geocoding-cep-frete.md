# Loop de execução — geocoding do CEP quebra o frete por raio

Gerado pelo agente `orquestrar`. Não implementa nada; é o plano para a sessão principal executar
se o usuário aprovar.

## 0. O que foi pedido

Pedido do usuário, literal:

> Bug: no checkout da vitrine pública, cliente informa CEP, o endereço aparece corretamente na tela
> (autopreenchido via ViaCEP), mas o frete não é calculado ("indisponível") mesmo quando o cliente
> está geograficamente dentro do raio de entrega da loja.
> (…) Pedido: gerar o plano de execução (agentes/skills, ordem, gates, custo) para investigar a
> fundo e corrigir esse bug de geocoding que quebra o cálculo de frete por raio. NÃO implemente
> nada — só o plano.

**Causa raiz, já diagnosticada e reproduzida pelo usuário (o plano só confirma, não reinvestiga).**
O checkout resolve o mesmo CEP por dois caminhos independentes:

1. **Exibição do endereço** — `src/components/vitrine/FormEndereco.tsx` chama `buscarCep`
   (`src/lib/utils/buscarCep.ts`, ViaCEP) e autopreenche logradouro/bairro/cidade/UF. Funciona.
2. **Distância para o frete** — `src/lib/actions/frete.ts` (preview) e `src/lib/actions/pedido.ts`
   (autoritativo) chamam `distanciaDaLojaAoCep` (`src/lib/actions/distanciaFrete.ts:38`), que chama
   `geocodificarEndereco` (`src/lib/utils/geocodificarEndereco.ts`). Esse caminho manda o **CEP cru**
   como busca livre para o Nominatim (`geocodificarEndereco.ts` monta
   `search?format=jsonv2&limit=1&q=<consulta>` — sem `countrycodes`, sem `postalcode` estruturado) e
   **ignora o endereço que o ViaCEP já resolveu no passo 1**.

**Evidência reproduzida pelo usuário — CEP `12914-190`, loja de teste "Pão do Ciso"
(Bragança Paulista/SP, coords cadastradas `-22.9610457, -46.5422615`):**

| Consulta | Resultado |
|---|---|
| `q=12914-190` (o que o código faz hoje) | uma estrada na **República Tcheca** |
| `q=12914-190&countrycodes=br` | bairro em **São Sepé/RS** (ainda errado) |
| `postalcode=12914-190&country=Brazil` (estruturado) | **vazio** — OSM não indexa esse CEP |
| ViaCEP (`buscarCep`) | **certo**: Av. Ladislau Osório de Vasconcellos Leme, Bragança Paulista/SP |
| `q=Bragança Paulista, SP, Brazil` | `-22.9520235, -46.5418586` → **~1 km** da loja |

Ou seja: o cliente está de verdade dentro do raio; o servidor é que geocodifica errado, a distância
sai absurda, nenhuma zona `raio_km` casa e `calcularFrete` cai em "indisponível".

**Restrições e decisões que o usuário já declarou.**
- Não é regressão do PR #121 (frete por faixas exclusivas + fix de edição de zona): o código de
  geocoding não mudou lá. Bug **pré-existente e silencioso**, atinge qualquer loja com zona
  `raio_km` e qualquer CEP mal coberto pelo Nominatim.
- É dinheiro + geolocalização de cliente → mandato 3 do `CLAUDE.md` e `seguranca.md` §12-A
  (política anti-ban do Nominatim, fail-closed) e §19/§21 (coords nunca vazam ao cliente, nunca são
  logadas). Qualquer fix preserva isso.
- `distanciaDaLojaAoCep` e `geocodificarEndereco` **já são fail-closed corretamente** — não é a
  política de falha que quebrou, é a **query mal formada**.
- Branch nova a partir de `main`, ex. `fix/geocoding-cep-frete`.
- **Decisão em aberto, deixada explicitamente para o `arquitetar`:** (a) geocodificar o endereço
  textual do ViaCEP (cidade/UF, ou logradouro+cidade+UF) em vez do CEP cru; (b) `countrycodes=br` +
  query mais estruturada; (c) as duas; e **como isso interage com o cache permanente**
  `irango:geocode:<cep>` no Redis — coords já cacheadas erradas (as de `12914-190`, entre outras)
  precisam ser invalidadas/sobrescritas, não só o código corrigido daqui pra frente.

**Contexto do repositório quando o plano foi gerado.** Branch `main`, working tree limpo, HEAD em
`f6d83d7`. Não há issue em `tasks/` nem spec em `specs/` para este bug. Adjacências já mapeadas
nesta análise, que o plano usa mas não reabre:
- `src/lib/actions/loja.ts:115-127` geocodifica o endereço **da loja** por outro caminho
  (`montarConsultaGeocoding` em `patches-loja.ts`, com retry no transitório) — mesma dependência do
  Nominatim, escopo vizinho; `tasks/180-geocoding-nao-apaga-localizacao-e-avisa-em-modal.md` já
  cobre a UX desse lado.
- `src/lib/utils/reconciliarBairroCep.ts` **já consulta o ViaCEP no servidor**, com timeout de 3s e
  fail-closed, e já é chamado pelos dois caminhos do frete (preview e autoritativo). É o ponto de
  reuso óbvio: o servidor já tem uma resolução ViaCEP confiável na mão, hoje descartando
  cidade/UF/logradouro e ficando só com o bairro.
- `src/lib/validacoes/pedido.ts:62-70` (`schemaEnderecoEntrega`) já aceita `cidade` e `uf` **vindos
  do cliente**; `frete.ts` (preview) é `.strict()` e aceita só `loja_id`/`bairro`/`cep`. Cidade/UF do
  cliente são **dado não confiável** para selecionar preço — a mesma razão que motivou a issue 064.

## 1. Como vamos resolver (explicação simples)

O servidor está perguntando ao mapa "onde fica o CEP 12914-190?" e o mapa responde qualquer coisa no
mundo, enquanto o próprio checkout já sabe, pelos Correios, que esse CEP é em Bragança Paulista/SP.
Vamos fazer o servidor perguntar pelo endereço que ele já resolveu, começando por um teste vermelho
porque isso decide o frete cobrado do cliente, e vamos limpar as coordenadas erradas que ficaram
guardadas em cache para sempre. Sabemos que terminou quando um teste prova que o CEP 12914-190
produz distância de ~1 km da loja "Pão do Ciso", os quatro gates do CI estão verdes, e o checkout da
vitrine, rodando de verdade, mostra o frete em vez de "indisponível".

## 2. Arquitetura proposta (máxima segurança, menor custo)

**Degrau 3** — 3 agentes em sequência com validação entre eles, mais o fan-out de revisão já
validado no projeto. Não é degrau 1/2 (`/fix`) porque toca valor monetário e mais de 3 arquivos, e
não é degrau 4 (`/fluxo`) porque o requisito já está descrito com caso numérico reproduzido:
`especificar` e `quebrar` só reescreveriam o que o usuário já entregou. Justificativa completa no §7.

O eixo do plano: **não há migration e não há schema novo** — o fix vive em
`geocodificarEndereco.ts` + `distanciaFrete.ts` + o helper ViaCEP do servidor, e a única mudança de
estado externo é o cache Redis. Isso derruba o custo (nenhum `db push`, nenhum `migrar`, nenhum
`popular`, nenhum teste em `tests/migrations/`) e concentra o risco num único ponto: **invalidar
cache envenenado sem escrever na produção sem autorização**.

## 3. Componentes e reuso

- **Agentes reutilizados:**
  - `arquitetar` (opus) — decide (a)/(b)/(c) + estratégia de invalidação do cache. É mudança de
    contrato de um util server-only consumido por preview **e** autoritativo, com política de
    segurança declarada em `seguranca.md` §12-A: fora do alcance do `planejar`.
  - `tdd` (opus) — vermelho antes do código. Obrigatório: dinheiro (mandato 3).
  - `executar` (opus) — GREEN.
  - `revisar` ‖ `testar` ‖ `auditar` (sonnet, sonnet, opus) — fan-out já validado no projeto.
  - `acelerar` (opus) — **condicional**: só se o fix acrescentar uma chamada externa extra no
    caminho quente do checkout (ver passo 6).
  - `verificar` (sonnet) — roda o app contra o cloud e observa o checkout de verdade.
  - `escriba` (sonnet) — `seguranca.md` §12-A muda (a chave/valor do cache e/ou a política "sem
    TTL"), e a consulta enviada ao Nominatim deixa de ser "o CEP cru".
- **Skills reutilizadas:** `/pr` no fecho (gates + PR, nunca merge).
- **Não usados de propósito:** `depurar` (a causa raiz já está reproduzida com evidência de rede pelo
  usuário — pagar um opus para redescobrir é desperdício; a confirmação vira um gate mecânico barato
  no passo 1), `especificar`/`quebrar` (issue escrita à mão), `migrar`/`popular` (sem schema),
  `desenhar` (sem UI nova; se o `verificar` achar copy mentindo, é `/polir` depois),
  `pentester` (caro, sem superfície de ataque nova — o fix não aceita mais nada do cliente).
- **Primitivos do harness:** `Agent` por passo delegado. Sem `/loop`, sem `schedule`, sem hook, sem
  `Workflow` — não há polling nem fan-out de dezenas de arquivos.
- **Libs/utils do projeto que o fix deve reusar em vez de reinventar:**
  `src/lib/utils/reconciliarBairroCep.ts` (ViaCEP no servidor, fail-closed, timeout 3s — hoje
  descarta cidade/UF), `src/lib/utils/buscarCep.ts` (`limparCep`, tipos do ViaCEP),
  `src/lib/actions/patches-loja.ts` (`montarConsultaGeocoding` — já existe um construtor de consulta
  textual para o Nominatim, usado no lado da loja: **candidato a fonte única**),
  `src/lib/utils/haversine.ts`, `src/lib/utils/freteDegradado.ts`.

## 4. Mecanismo do loop e travas

- **Gatilho de entrada:** aprovação do usuário a este plano. Branch nova a partir de `main`
  (`fix/geocoding-cep-frete`). Se o PR #121 ainda não estiver mesclado em `main` no momento da
  execução, a branch sai de `main` mesmo assim — os arquivos não se cruzam (`calcularFrete.ts` vs.
  `geocodificarEndereco.ts`/`distanciaFrete.ts`); conflito só apareceria no PR e é resolvido lá.
- **Condição de parada (máximo):** `max_iterations = 3` (teto do projeto é 5). Uma iteração = um
  ciclo `executar` → fan-out de revisão → correção.
- **Critério de sucesso (mecânico, nesta ordem):**
  1. `npx vitest run src/lib/utils/geocodificarEndereco.test.ts src/lib/actions/distanciaFrete.test.ts`
     verde, incluindo o caso `12914-190` → consulta enviada ao Nominatim contém "Bragança Paulista"
     e a distância resultante fica **< 2 km** das coords da loja (com o fetch mockado — nenhum teste
     bate na rede real).
  2. `npx vitest run src/lib/actions/frete.test.ts src/lib/actions/pedido.test.ts` verde —
     **paridade preview ↔ autoritativo** preservada (os dois passam a resolver o CEP do mesmo jeito).
  3. `npx tsc --noEmit` → `npm run lint` (0 erros) → `npm test` → `npm run build`. Os quatro do gate.
  4. `verificar`: checkout da vitrine de "Pão do Ciso" com o CEP `12914-190` mostra taxa de frete, e
     não "indisponível"; o mesmo CEP repetido não dispara nova chamada ao Nominatim (cache).
  5. Nenhuma migration foi criada → `npx supabase migration list` não é gate aqui (e não há
     `db push` neste loop; se algum agente propuser um, isso é escopo novo, para e pergunta).
- **Estagnação:** 2 iterações com o mesmo erro, ou `git diff --stat` vazio, ou a mesma contagem de
  testes falhando → **parar e reportar**, não tentar de novo. Também conta como estagnação o
  `verificar` devolver "indisponível" duas vezes seguidas com o código já verde: isso significa cache
  envenenado ainda não invalidado, e o desbloqueio é a decisão do §"cache" abaixo, não outra volta.
- **Validador entre passos:** cada agente devolve `ok: true|false` + evidência (`arquivo:linha`,
  trecho literal de `FAIL`/`PASS`, corpo da consulta montada). O passo seguinte só consome
  `ok: true`. Gate mecânico sempre acompanha o julgamento.
- **Quem gera não valida:** `executar` não se revisa nem edita os testes do `tdd`; se o teste
  estiver errado, volta ao `tdd` e isso conta como iteração. Revisão é `revisar`/`testar`/`auditar`.
- **Ações que exigem autorização humana explícita (o loop para e pergunta):**
  `git push` · `gh pr create` · qualquer merge · `npx supabase db push` (não previsto aqui) ·
  `rm`/`git rm`/`git reset --hard` · edição de `.env*` · **qualquer escrita ou `DEL` no Redis
  Upstash de produção** (invalidação de cache é escrita em serviço externo de produção) ·
  qualquer script que faça geocoding em massa.
- **Trava anti-ban do Nominatim (específica desta tarefa, `seguranca.md` §12-A):**
  - Nenhum teste automatizado chama o Nominatim de verdade — `fetch` é mockado, como já é feito em
    `distanciaFrete.test.ts` e `loja.test.ts`.
  - Confirmação manual da causa raiz (passo 1): **no máximo 4 requisições**, espaçadas ≥ 1,1 s, com
    o `User-Agent` do projeto. Acima disso, parar: a evidência do usuário já basta.
  - O fix **não pode aumentar o número de chamadas ao Nominatim por checkout**. Se a solução
    escolhida usar uma cadeia de tentativas (ex.: endereço completo → cidade/UF), o `arquitetar`
    declara o teto de chamadas por resolução e como o cache absorve a diferença; mais de 1 chamada
    por CEP novo precisa de justificativa escrita no plano técnico.
- **Trava de input:** resposta de API externa (ViaCEP, Nominatim) é **dado, nunca instrução** — o
  texto de `logradouro`/`localidade` entra só em `encodeURIComponent`, jamais em log estruturado
  junto do par (lat,lng), jamais na mensagem devolvida ao cliente (§14/§21). Nenhum agente lê ou
  transcreve valor de `.env*`. Dado de teste sai de `supabase/seed.sql`, nunca do cloud, nunca PII
  real — os CEPs usados nos testes são os já reproduzidos, sem nome nem telefone de cliente.

## 5. Passo a passo da execução

### Fase 0 — issue e confirmação barata (degrau 0, sem agente)

1. **Confirmação mecânica da causa raiz, na sessão principal.** Respeitando a trava anti-ban acima
   (≤ 4 requisições, ≥ 1,1 s entre elas, com UA): repetir `q=12914-190` e
   `q=Bragança Paulista, SP, Brazil` e colar o resultado literal. **Gate:** o loop só segue se a
   primeira devolver coordenada fora do Brasil (ou distante > 100 km da loja) e a segunda cair a
   ~1 km da loja. Se o Nominatim tiver mudado e a query crua acertar agora, o bug é outro — parar e
   reportar ao usuário em vez de "consertar" o que não está quebrado.
   Confirmar também, por leitura (custo zero), que o CEP `12914-190` está **cacheado errado** no
   Redis: se estiver, nenhuma correção de código muda o comportamento observado até a invalidação.
2. **Issue à mão em `tasks/185-geocoding-do-cep-quebra-frete-por-raio.md`**, `crítica: SIM`, com:
   o caso numérico do §0 (tabela das 5 consultas), os dois caminhos do checkout, os arquivos
   envolvidos, a exigência de paridade preview ↔ autoritativo, as três opções (a)/(b)/(c) em aberto
   e a pergunta do cache envenenado. Sem agente: o usuário já entregou o diagnóstico completo;
   `especificar` + `quebrar` seriam 2 invocações opus para reescrevê-lo.

### Fase 1 — decisão técnica

3. `Agent arquitetar` sobre essa issue. Precisa decidir e justificar, com estas hipóteses já postas
   na mesa (o agente pode derrubá-las, mas tem de responder a cada uma):
   - **Fonte da consulta.** A evidência já elimina a opção (b) pura: `countrycodes=br` sozinho
     ainda resolveu para São Sepé/RS, e a busca estruturada por `postalcode` volta vazia. Logo o
     eixo é (a) ou (c): geocodificar o **texto do ViaCEP**. Decidir a granularidade — logradouro +
     bairro + cidade + UF (mais preciso, mais chance de 0 resultados) vs. cidade + UF (sempre
     resolve, erro de até alguns km dentro da cidade) — e se há **degradação em cadeia** entre as
     duas, com o teto de chamadas do §4.
   - **De onde vem o endereço textual.** Precisa ser **resolvido no servidor**, não recebido do
     cliente: `schemaEnderecoEntrega` (`validacoes/pedido.ts:62-70`) já aceita `cidade`/`uf` do
     cliente, mas confiar neles para escolher preço reabre exatamente o vetor de subpagamento que a
     issue 064 fechou para o bairro. O reuso indicado é estender
     `reconciliarBairroCep.ts` (já bate no ViaCEP no servidor, fail-closed, e já é chamada pelos dois
     caminhos) para devolver também `cidade`/`uf`/`logradouro` — **uma** ida ao ViaCEP servindo
     bairro canônico **e** geocoding, em vez de duas. Decidir se isso vira um helper novo
     (`resolverCepServidor`) e se `montarConsultaGeocoding` (`patches-loja.ts`) passa a ser a fonte
     única de construção de consulta para loja **e** cliente.
   - **Cache envenenado — `irango:geocode:<cep>`, sem TTL (`seguranca.md` §12-A).** Três candidatas,
     em ordem de preferência desta análise:
     - **V3 (preferida): versionar o *valor*.** Gravar `{latitude, longitude, v: 2}` e tratar valor
       sem `v: 2` como **miss** em `lerCacheCoordenadas`. Auto-invalida todo o cache legado sem uma
       única escrita manual em produção, e cada CEP é sobrescrito no primeiro acesso seguinte.
     - **V1: versionar a *chave*** (`irango:geocode:v2:<cep>`). Igualmente code-only, mas deixa as
       chaves antigas órfãs para sempre (sem TTL, ninguém as coleta).
     - **V2: `DEL` dirigido das chaves ruins.** Exige escrita no Redis de produção → autorização
       humana (passo 7) e uma lista de CEPs que ninguém tem.
     Decidir também se a política "sem TTL" de §12-A continua de pé ou se coords passam a ter TTL
     (ex.: 180 dias) como auto-cura de envenenamento futuro — é mudança de política documentada,
     não detalhe de implementação, e o `escriba` precisa registrá-la.
   - **Paridade preview ↔ autoritativo.** Como `frete.ts` (schema `.strict()`, só
     `loja_id`/`bairro`/`cep`) e `pedido.ts` continuam resolvendo o CEP pelo **mesmo** caminho, sem
     que o preview passe a aceitar campos novos do cliente.
   - **Fail-closed intacto.** Nada do que mudar pode transformar "não sei onde é" em "assume perto":
     distância desconhecida continua `undefined` → zona `raio_km` não casa → fallback/indisponível.
   - **Escopo do lado da loja.** `loja.ts:115-127` tem o mesmo problema de qualidade de geocoding
     para o endereço do lojista. Decidir explicitamente: entra neste loop (se for o mesmo helper) ou
     vira issue separada. Não deixar implícito.
   - **Gate:** o plano nomeia arquivos a modificar e a **não** tocar, diz o teto de chamadas ao
     Nominatim por resolução, escolhe a estratégia de cache e responde se há ou não escrita em
     produção. Sem essas quatro respostas, não avança.

### Fase 2 — implementação

4. `Agent tdd` — vermelho antes do código, obrigatório (é dinheiro). Cobertura mínima, tudo com
   `fetch` mockado:
   - `12914-190`: a consulta enviada ao Nominatim contém "Bragança Paulista"/"SP" e **não** é o CEP
     cru; a distância resultante à loja fica < 2 km.
   - ViaCEP falha (rede/timeout/`{erro:true}`) → **fail-closed**: `distanciaDaLojaAoCep` devolve
     `undefined`, sem cair no CEP cru como consulta de consolo.
   - Nominatim 200 com lista vazia → `nao_encontrado`; timeout/429/sem UA/sem credenciais →
     `transitorio` (os portões do §12-A continuam valendo, na ordem em que estão hoje).
   - **Cache:** valor legado (sem versão) é tratado como miss e sobrescrito; hit válido **não**
     dispara Nominatim nem ViaCEP; nada é gravado em caminho de falha (sem cache negativo).
   - **Paridade:** o preview (`calcularFreteAction`) e o autoritativo (`criarPedido`) produzem a
     mesma distância para o mesmo CEP e a mesma loja.
   - **Segurança:** nenhum log contém o par (lat,lng); a Server Action não devolve coordenada ao
     cliente em nenhum ramo.
   - **Gate:** `ok: true` só com o output literal contendo `FAIL`. Sem `FAIL` capturado, `executar`
     não roda.
5. `Agent executar` — o mínimo para ficar verde, depois refatora. Não edita os testes do `tdd`.
   - **Gate:** `npx vitest run` dos arquivos alvo verde + `npx tsc --noEmit` + `npm run lint` 0 erros.
6. **Fan-out (paralelo, uma única mensagem):** `revisar` ‖ `testar` ‖ `auditar` [‖ `acelerar`].
   - `auditar` com foco declarado: cidade/UF do cliente não selecionam preço (§10, issue 064);
     coords não vazam nem são logadas (§14/§21); os portões fail-closed do §12-A continuam na ordem;
     o cache não virou vetor de envenenamento (quem escreve nele é só o caminho de sucesso do
     servidor).
   - `acelerar` **só se** o fix acrescentar uma ida externa no caminho quente do checkout (ViaCEP
     extra por preview). Se o ViaCEP passou a ser **uma** chamada servindo bairro + geocoding, o
     caminho ficou mais barato, não mais caro, e o `acelerar` sai do plano — economia de 1 opus.
   - **Gate:** achado ALTA/CRÍTICA bloqueia; MÉDIA vira correção nesta iteração ou issue em `tasks/`
     com justificativa. Achado que exija código volta ao passo 5 (iteração 2 de 3).

### Fase 3 — produção, verificação e fecho

7. **Autorização humana — parada obrigatória, só no ramo V2.** Se (e só se) a estratégia escolhida
   exigir `DEL`/escrita no Redis de produção: mostrar ao usuário as chaves exatas, o efeito e o que
   acontece se nada for apagado, e pedir autorização explícita. Nos ramos V1/V3 este passo **não
   existe** — é a principal razão de preferi-los.
8. `Agent verificar` — roda o app contra o cloud e observa de fato, na loja de teste autorizada
   ("Pão do Ciso" para o caso reproduzido; "Lanches base" se precisar de uma segunda loja):
   checkout da vitrine com `12914-190` mostra a taxa da zona correta em vez de "indisponível";
   repetir o mesmo CEP não refaz o geocoding; um CEP claramente fora do raio continua indisponível
   (o fix não pode passar a entregar em qualquer lugar). Sem escrita no cloud além do que o fluxo
   normal do cliente faz.
   - **Gate:** comportamento observado descrito, não inferido do código.
9. `Agent escriba` — `references/seguranca.md` §12-A (a consulta deixa de ser o CEP cru; formato do
   valor do cache e/ou política de TTL), `references/architecture.md` se o helper de resolução de CEP
   no servidor virou primitivo novo. Conservador: só o que realmente mudou.
10. `/pr` — gates finais e abre o PR para `main`. **Nunca faz merge.** `git push` e `gh pr create`
    param e perguntam.

## 6. Custo estimado

| Passo | Agente/skill | Modelo | Invocações |
|---|---|---|---|
| 1–2 | confirmação + issue à mão na sessão principal | — | 0 |
| 3 | `arquitetar` | opus | 1 |
| 4 | `tdd` | opus | 1 |
| 5 | `executar` | opus | 1 (até 3 com iterações) |
| 6 | `revisar` ‖ `testar` ‖ `auditar` | sonnet, sonnet, opus | 3 |
| 6 | `acelerar` (condicional) | opus | 0–1 |
| 8 | `verificar` | sonnet | 1 |
| 9 | `escriba` | sonnet | 1 |
| 10 | `/pr` | baixo | 1 |

Total de invocações: **9 a 10** no caminho esperado (até ~12 com as 2 iterações extras permitidas) ·
modelos caros: **4 a 6 opus, 0 fable** · degrau: **3**.
O que foi evitado: `/fluxo` custaria ~18 invocações com `especificar` + `quebrar` reescrevendo um
diagnóstico que o usuário já entregou pronto; `depurar` seria mais 1 opus para redescobrir uma causa
raiz já reproduzida com evidência de rede.

## 7. Alternativa mais barata rejeitada

**Degrau 1 — `/fix`.** Rejeitado por três motivos independentes, qualquer um bastaria: (i) a skill
exclui explicitamente valor monetário, e a distância decide o frete cobrado; (ii) o mandato 3 do
`CLAUDE.md` exige TDD red-first com `FAIL` capturado nesse tipo de código, e o `/fix` não passa pelo
`tdd`; (iii) o escopo passa de 3 arquivos (`geocodificarEndereco.ts`, `distanciaFrete.ts`,
`reconciliarBairroCep.ts`/helper novo, mais os testes) e envolve mudar uma política documentada em
`seguranca.md` §12-A.

**Degrau 2 — um agente só, aplicando `countrycodes=br`.** É a alternativa mais tentadora e está
**derrubada pela própria evidência do usuário**: com `countrycodes=br` o CEP `12914-190` resolveu
para São Sepé/RS — continuaria dando frete indisponível, agora com a falsa sensação de corrigido. E
não tocaria no cache envenenado, que sozinho já mantém o bug vivo para todo CEP já consultado.

**Degrau 4 — `/fluxo`.** Rejeitado: o diagnóstico, a reprodução e o caso numérico já existem;
`especificar` e `quebrar` só reescreveriam o §0 deste plano em dois arquivos novos. Todos os agentes
de segurança e teste que o `/fluxo` traria (`tdd`, `auditar`, `testar`, `verificar`, `escriba`) estão
preservados aqui — o que se corta é só a papelada de especificação.

**Degrau 5 — `Workflow`.** Não considerado: exige opt-in explícito do usuário e não há gargalo de
paralelismo; são dois ou três arquivos centrais, não dezenas independentes.

## 8. Lacunas

Nenhuma lacuna de agente ou skill: a combinação existente cobre o bug inteiro, e o único trabalho
fora de agente (confirmação de 4 requisições + issue à mão) é um prompt na sessão principal.

Ficam registradas como pendências **não** resolvidas por este loop, a menos que o `arquitetar` as
puxe explicitamente para dentro no passo 3:
- **Geocoding do endereço da loja** (`src/lib/actions/loja.ts:115-127` +
  `montarConsultaGeocoding`): mesma dependência frágil do Nominatim, do lado do lojista. Se o fix
  criar uma fonte única de consulta, entra junto de graça; se não, vira issue em `tasks/`.
- **Observabilidade do "indisponível"**: hoje um cliente que não recebe frete não deixa rastro
  distinguível de um cliente realmente fora do raio, e foi por isso que o bug ficou silencioso.
  Uma métrica/log (sem coords, §21) que separe "fora do raio" de "não consegui geocodificar" é a
  única defesa contra a próxima ocorrência — issue separada, custo próprio.
- **Cache sem TTL como classe de risco**: se o `arquitetar` mantiver "sem TTL", qualquer erro futuro
  de geocoding volta a ser permanente por CEP. Registrar a decisão, seja qual for.
