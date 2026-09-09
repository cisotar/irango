# 181 — frete por faixas exclusivas de km

crítica: SIM (valor monetário cobrado do cliente — mandato 3 do CLAUDE.md)

## Origem

Pedido literal do usuário, registrado em `plan/loop-frete-faixas-e-edicao-de-zona.md` §0:

> 1 - resolver o cálculo do frete. Exemplo: prete por zonas. Até 1 km frete = X. de 1,1 km até 2 km
> frete = Y. Cliente informa endereço a 1,3 km paga Y (paga o maior valor).

Leitura confirmada pelo usuário (não é ambígua): **faixa exclusiva**. Cada distância pertence a uma
única faixa; "paga o maior valor" no exemplo descreve o resultado de 1,3 km cair na faixa de fora, não
uma regra de escolher o maior preço entre faixas que atendem.

## Bug atual

`src/lib/utils/calcularFrete.ts:81-84` testa apenas `dist <= raio_max_km` (cada zona é um círculo
desde 0 km, não um anel) e `calcularFrete.ts:129-138` escolhe a zona de **menor taxa** entre todas as
que atendem (RN-C4). Com `até 2km = R$ 6` e `até 3km = R$ 5`, um cliente a 1,5 km paga R$ 5 — errado.

## Regra correta (validada numericamente pelo usuário)

Faixas de 1 em 1 km, anel exclusivo: piso da faixa = teto da faixa anterior + 0,01 km. Exemplo
validado: `0–1 km = R$ 4`, `1,1–2 km = R$ 6`, `2,1–3 km = R$ 8`. Cliente a **1,5 km** cai só na faixa
1,1–2 km e paga **R$ 6**, sem comparação com nenhuma outra faixa (não é "a mais barata que atende").

Casos de borda a cobrir no teste:
- 1,0 km → faixa 0–1 (R$ 4); 1,1 km → faixa 1,1–2 (R$ 6); 2,0 km → faixa 1,1–2 (R$ 6);
  2,1 km → faixa 2,1–3 (R$ 8); 3,1 km → fora de todas as faixas.
- Preço fora de ordem (`até 2km = R$ 6`, `até 3km = R$ 5`) não pode mais dar o frete mais barato —
  é a regressão que motivou o item.
- `taxaForaZona` (`lojas.taxa_entrega_fora_zona`) continua sendo o fallback acima da última faixa
  cadastrada; `taxaForaZona = null` deve continuar indicando "fora da área de entrega".
- Frete grátis por `pedido_minimo_gratis` avaliado **na faixa escolhida** (não em qualquer faixa que
  atenda).
- O valor autoritativo calculado na Server Action de criar pedido precisa bater com o preview de frete
  mostrado na vitrine — mesma função, `calcularFrete.ts` é fonte única de verdade.

## Fora de escopo desta issue

- Zonas `bairro` e `faixa_cep`: o `arquitetar` decide e documenta se a regra de "menor taxa" continua
  valendo para elas (não são zonas por raio, não têm noção natural de "anel").
- Refatoração de layout da tela `/painel/configuracoes/entregas` (item 3 do pedido original) — adiada
  por decisão explícita do usuário, mockup pronto em `mockups/entregas-faixas-km.html`, intocado.
- `schemaTaxa` não validar `cep_inicio`/`cep_fim` (achado colateral do diagnóstico do #182) — registrar
  como issue separada, não corrigir aqui.

## Arquivos prováveis

- `src/lib/utils/calcularFrete.ts` — regra de seleção de faixa.
- `src/lib/utils/calcularFrete.test.ts` — testes novos (TDD red-first).
- Possíveis consumidores a conferir sem alterar comportamento fora do escopo: Server Action de criar
  pedido, preview de frete na vitrine.

## Decisão de arquitetura — RESOLVIDA: Opção A, SEM MIGRATION

Decisão do usuário, confirmada viável pela leitura do código real (evidência no Plano Técnico abaixo):
**Opção A** — manter `taxas_entrega` como está, derivar o anel exclusivo ordenando as zonas `raio_km`
que atendem por `raio_max_km` crescente dentro da função pura `calcularFrete`. **Nenhuma migration,
nenhum `db push`, nenhum `supabase gen types`, nenhum backfill.** A Opção B (coluna `raio_min_km`)
está descartada por decisão explícita do usuário e não é reavaliada aqui.

Esta issue está agrupada na mesma branch (`fix/frete-faixas-exclusivas`) do item #182. Como a #181 não
traz migration, a única autorização humana de `db push` desta branch, se houver, é a do #182.

---

# Plano Técnico

## Diagnóstico

**Causa raiz.** `calcularFrete` modela cada zona `raio_km` como um **disco a partir de 0 km**
(`calcularFrete.ts:81-84`, `dist <= raio_max_km`) e depois resolve a ambiguidade resultante — várias
zonas cobrindo a mesma distância — com uma heurística **comercial** ("menor taxa vence, melhor pro
cliente", `calcularFrete.ts:131-138`). A invariante violada é geométrica, não comercial: uma faixa de
frete por distância é um **anel** `(teto anterior, teto]`, e cada distância pertence a **exatamente
uma**. Como o modelo perdeu o piso, o código precisou inventar um critério de desempate — e qualquer
critério de desempate aqui é errado, porque não deveria haver empate. Trocar "menor taxa" por "maior
taxa" seria o remendo: continuaria comparando faixas que não competem entre si. A correção é
**restaurar o piso**, derivando-o da ordenação (`teto da faixa anterior`), e com isso a comparação
por preço entre faixas de raio simplesmente deixa de existir.

**Por que é complexo.** (a) É valor monetário cobrado do cliente — `crítica: SIM`, mandato 3; (b) a
função é consumida por dois call sites com níveis de confiança diferentes (preview público e valor
autoritativo do pedido) que **precisam** concordar; (c) a ordem em que as zonas chegam à função é
**não determinística** (a query não tem `ORDER BY` — ver Mapa de Impacto), então a nova regra depende
de uma ordenação que hoje ninguém garante; (d) toca uma regra de negócio documentada (RN-C4) que
`bairro` e `faixa_cep` também consomem, e mudar demais quebraria os dois.

## Mapa de Impacto

Onde o valor do frete é decidido e por qual camada é garantido:

```
Seleção de zona / valor do frete
├── src/lib/utils/calcularFrete.ts::calcularFrete   [FONTE ÚNICA DE VERDADE — função pura, sem I/O]
│   ├── ← src/lib/actions/frete.ts:136 (calcularFreteAction)
│   │     [Server Action PÚBLICA — PREVIEW, só UX, NÃO vinculante]
│   │     └── ← src/components/vitrine/checkout/EtapaEntrega.tsx:115 (client, exibe taxa_preview)
│   └── ← src/lib/actions/pedido.ts:288 (criarPedido)
│         [Server Action — AUTORITATIVO; p_taxa_entrega/p_total vão pra RPC criar_pedido]
│         └── calcularTotal(pedido.ts:321) → p_taxa_entrega:358 → RPC criar_pedido
│
├── Entradas de calcularFrete e quem as garante:
│   ├── zonas ← listarZonasComTaxas(entregaPagamento.ts:39-59) ← tabela zonas_entrega + taxas_entrega
│   │          [RLS de leitura pública + .eq("loja_id") — escopo por loja é do caller]
│   │          ⚠ SEM .order() — a ordem das linhas do PostgREST é NÃO DETERMINÍSTICA
│   ├── endereco.distanciaKm ← distanciaDaLojaAoCep(distanciaFrete.ts:25) — DERIVADO 100% no servidor
│   │          (buscarCoordsLoja[service_role] → geocodificarEndereco(CEP) → haversine); fail-closed
│   │          → `undefined`. NUNCA vem do cliente (RN-4).
│   ├── endereco.bairro ← reconciliarBairroCep (ViaCEP server-side, fail-closed) — não muda aqui
│   └── taxaForaZona ← lojas.taxa_entrega_fora_zona (banco), lido em frete.ts:140 e pedido.ts:292
│
└── Classificação da causa de "indisponível" (NÃO decide taxa):
    └── src/lib/utils/freteDegradado.ts::lojaTemRaioSemCoords ← frete.ts:151
        [só responde "a loja tem zona raio ativa e não tem coords?" — não lê raio_max_km]
```

**Assimetria cliente ↔ servidor:** nenhuma. Nenhum componente de cliente calcula frete; `EtapaEntrega`
apenas **exibe** o que a Server Action devolveu. A invariante desta issue é garantida **inteiramente
no servidor**, em uma função pura chamada pelos dois lados — por isso o plano não tem arquivo de
cliente, e isso é a justificativa exigida pela regra cliente↔servidor, não uma omissão.

**Reuso (não reinventar a roda):** a mudança é ~15 linhas dentro de uma função que já existe. Nenhum
arquivo novo, nenhuma lib nova, nenhuma dependência externa. `Array.prototype.sort` com comparador
explícito resolve a ordenação; não há motivo para lodash/orderBy nem para um "seletor de faixa" em
módulo separado (seria exatamente o "componente novo que medeia uma divergência que não deveria
existir" da lista de sinais de remendo).

## Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/utils/calcularFrete.ts` | Fonte única do frete. `zonaAtende:72-99` (predicado por tipo) + laço de seleção `131-138` (menor taxa global) + grátis/arredondamento `153-163` | **Só o laço de seleção (131-138) e a docstring (101-120).** `zonaAtende` fica **intacta** — o predicado `dist <= raio_max_km` continua correto: é o *teto* da faixa. O piso passa a ser expresso pela ordenação, não pelo predicado |
| `src/lib/utils/calcularFrete.test.ts` | 471 linhas, ~45 casos | Ganha o bloco de faixas exclusivas (fase RED do `tdd`). Nenhum caso existente é removido — ver "Regressões esperadas: nenhuma" |
| `src/lib/supabase/queries/entregaPagamento.ts:39-59` | Hidrata as zonas; sem `ORDER BY` | **Não muda** — decisão D3 |
| `src/lib/actions/frete.ts:136` | Preview público | **Não muda** — herda a regra nova pela função |
| `src/lib/actions/pedido.ts:288` | Valor autoritativo | **Não muda** — herda a regra nova pela função |
| `src/lib/utils/freteDegradado.ts` | Classifica a causa do "indisponível" | **Não muda** — decisão D4 |
| `src/lib/actions/distanciaFrete.ts` | Deriva `distanciaKm`, fail-closed | **Não muda** — decisão D4 |
| `src/lib/validacoes/entrega.ts:17-25` (`schemaTaxa`) | Valida `taxa`, `pedido_minimo_gratis`, `raio_max_km` | **Não muda** — sobreposição/duplicidade de faixa é issue separada (D2) |
| `supabase/migrations/*` | `raio_max_km numeric(5,2)` nullable (`20260614000129_schema_inicial.sql:114`) | **Nada. Sem migration.** |

## Decisões de Design

### D1 — Como a faixa exclusiva é derivada (o coração da mudança)

O laço único de `131-138` vira duas etapas:

1. **Candidatas** = zonas com `ativo && taxa != null && zonaAtende(zona, endereco)` (predicado
   inalterado).
2. **Faixa de raio** = entre as candidatas com `tipo === "raio_km"`, a de **menor `raio_max_km`**.
   Como toda candidata já satisfaz `dist <= raio_max_km`, a de menor teto é, por construção, a única
   cujo piso implícito (`teto da faixa anterior`) é `< dist`. Não é preciso materializar o piso.
3. **Escolhida** = entre `{faixa de raio (0 ou 1)} ∪ {candidatas bairro/faixa_cep}`, a de **menor
   `taxa`** (regra atual preservada — ver D2).
4. Grátis e arredondamento seguem como estão (`153-163`), aplicados **sobre a escolhida**.

- **Opção considerada:** ordenar a lista inteira por `raio_max_km` e pegar a primeira que atende
  (leitura literal do §5 passo 4 do plano). *Contra:* zonas `bairro`/`faixa_cep` têm `raio_max_km`
  null e ficariam ordenadas arbitrariamente junto com as de raio, misturando dois critérios num único
  `sort`; e a ordenação global paga custo mesmo quando não há zona de raio.
- **Escolhida:** particionar por tipo e ordenar só as de raio. *Prós:* o "menor teto entre as que
  atendem" é um `reduce` O(n) — não precisa nem de `sort`; mantém `bairro`/`faixa_cep` fora da regra
  nova por construção (não por `if` espalhado); e o resultado é idêntico ao "primeira em ordem
  crescente cujo teto cobre a distância" do enunciado. Equivalência: para `S = {z : dist <= tetoᶻ}`,
  `min(teto)` sobre `S` = primeiro elemento de `S` na ordem crescente de teto.

### D2 — `bairro` e `faixa_cep`: a regra de menor taxa **continua valendo** (decisão firme)

**Decisão: sim, continua valendo, sem alteração.** A troca de regra é **específica de `raio_km`**.

Justificativa lida no código, não assumida:
- `zonaAtende` (`calcularFrete.ts:74-98`) usa três predicados de natureza diferente: `bairro` é
  **pertencimento a conjunto** (`zona.bairros.some(...)`, linhas 76-80), `faixa_cep` é **intervalo
  numérico já explícito no dado** (`cep_inicio`/`cep_fim`, linhas 85-95) e só `raio_km` é
  **comparação contra um teto sem piso** (linha 83). Ou seja: **`raio_km` é o único tipo cujo dado
  perdeu o limite inferior** — `faixa_cep` já tem piso e teto no banco, e `bairro` não tem eixo a
  ordenar. A assimetria que causa o bug existe só em `raio_km`.
- Não há ordem natural entre dois bairros: se "Centro" está em duas zonas, nenhuma delas é "a de
  fora"; a única regra defensável continua sendo a atual (menor taxa, empate → primeira), que é
  também o comportamento coberto pelos testes existentes (`calcularFrete.test.ts:180-195`, ambos
  construídos com `zonaBairro`).
- Duas zonas `faixa_cep` sobrepostas são uma **misconfiguração** do lojista, não um anel; e o campo
  `cep_inicio`/`cep_fim` hoje **nem é gravado** (`schemaTaxa`, `entrega.ts:17-25`, não valida esses
  dois campos — achado colateral já registrado como issue separada) e nenhuma loja usa CEP em
  produção. Mexer nisso agora seria escopo inventado.

Consequência documentada: **entre a faixa de raio escolhida e uma zona `bairro`/`faixa_cep` que
também atenda, continua vencendo a de menor taxa** (etapa 3 do D1). Isso preserva o comportamento
atual para lojas que misturam tipos de zona e mantém RN-C8 intacta. O bug da issue não depende disso:
ele é a comparação **entre faixas de raio**, que deixa de existir.

### D3 — A ordenação mora na função pura, não na query

- **Opção A':** adicionar `.order("raio_max_km", { referencedTable: "taxas_entrega" })` em
  `listarZonasComTaxas`. *Contra:* (i) mover a garantia de correção do valor cobrado para **fora** da
  fonte única de verdade — a função pura passaria a depender de o caller ter ordenado, e um segundo
  caller (ou um teste) que passasse zonas fora de ordem cobraria o valor errado silenciosamente;
  (ii) ordenar por coluna de tabela embutida no PostgREST é frágil; (iii) não daria determinismo em
  empate.
- **Escolhida:** ordenar/selecionar **dentro** de `calcularFrete`. *Prós:* a invariante é garantida
  no mesmo lugar onde o valor é produzido; ambos os call sites herdam de graça; testável como função
  pura sem pglite. *Contra:* custo O(n) por chamada — irrelevante (n = zonas de uma loja, ordem de
  unidades, em memória).

Isso é obrigatório, não estético: `listarZonasComTaxas` (`entregaPagamento.ts:43-48`) **não tem
`.order()`**, então hoje a ordem das zonas é a que o Postgres devolver. Sem ordenação interna, a nova
regra seria não determinística — o mesmo endereço poderia cobrar valores diferentes em duas chamadas.

### D4 — Distância desconhecida e frete degradado: intocados por construção

O caminho de fallback **não passa pela seleção de faixa**:
- `distanciaDaLojaAoCep` (`distanciaFrete.ts:25-53`) é **fail-closed total**: CEP ausente, loja sem
  coords, geocoding null ou qualquer exceção → `undefined`, nunca lança.
- Os dois call sites só injetam `distanciaKm` quando é `number` (`frete.ts:132`, `pedido.ts:282-284`).
- Com `distanciaKm` ausente, `zonaAtende` retorna `false` para todo `raio_km` (`calcularFrete.ts:83`,
  `dist != null &&`). Logo o **conjunto de candidatas de raio é vazio** e a nova etapa de seleção de
  faixa nem chega a rodar: cai direto nas candidatas `bairro`/`faixa_cep` e, na ausência delas, no
  `taxaForaZona` (`calcularFrete.ts:140-151`, inalterado).
- `freteDegradado.ts::lojaTemRaioSemCoords` (linhas 33-41) só pergunta se existe zona `raio_km` ativa
  **com taxa** — não lê `raio_max_km` nem compara preço. Seu contrato ("espelha o predicado de
  `zonaAtende`") continua verdadeiro, porque `zonaAtende` não muda. **Nenhuma linha de
  `freteDegradado.ts` muda; nenhum teste dele muda.**

### D5 — Desempate quando duas faixas têm o mesmo `raio_max_km`

Misconfiguração possível (nada no banco impede duas faixas com o mesmo teto). O comparador é
totalmente determinístico e **não pode depender da ordem recebida do banco** (D3):

`raio_max_km` crescente → em empate, **`taxa` DECRESCENTE** → em empate, `id` crescente (`localeCompare`).

- **Opção:** empate → menor taxa (simetria com a regra de `bairro`). *Contra:* reabre exatamente o
  vetor da issue — duas faixas ambíguas resolvidas pelo preço mais barato é o que motivou o item.
- **Escolhida:** empate → **maior taxa**, alinhado à RN-C8 ("ambiguidade nunca reduz o frete"); `id`
  como terceiro critério garante determinismo total sem depender do banco. Nenhum teste existente
  cobre empate entre zonas de raio (o empate testado em `calcularFrete.test.ts:188-195` é entre duas
  `zonaBairro`), então não há regressão.
- A correção definitiva — impedir tetos duplicados/sobrepostos no cadastro — é **issue separada**
  (validação em `schemaTaxa`/Server Action), não remendo aqui.

## Cenários

**Caminho feliz (o caso numérico validado pelo usuário).** Faixas `0–1 = R$ 4`, `1,1–2 = R$ 6`,
`2,1–3 = R$ 8`, todas ativas. Cliente a 1,5 km: candidatas = {teto 2, teto 3}; menor teto = 2 →
**R$ 6**, `zonaId` = a da faixa 1,1–2. O mesmo valor sai no preview (`frete.ts`) e no autoritativo
(`pedido.ts`), porque é a mesma função sobre as mesmas zonas do banco.

**Regressão que motivou a issue.** `até 2 km = R$ 6`, `até 3 km = R$ 5`; cliente a 1,5 km: hoje paga
R$ 5 (menor taxa), passa a pagar **R$ 6** (menor teto). Preço fora de ordem deixa de ser explorável.

**Bordas:**
- `dist == raio_max_km` (1,0 km com faixa teto 1): teto é **inclusivo** (`<=`, linha 83, inalterado) →
  faixa 0–1, R$ 4.
- `dist` logo acima do teto (1,1 com faixa teto 1 e faixa teto 2) → faixa 1,1–2, R$ 6. O piso implícito
  é `> 1`, não `>= 1,1`: distâncias fracionárias como 1,02 km (o haversine devolve float cru, sem
  arredondar — ver comentário em `distanciaFrete.ts:13`) caem na faixa 1,1–2. É o comportamento
  correto e não deixa buraco entre faixas.
- Acima da última faixa (3,1 km): nenhuma candidata de raio → `taxaForaZona` se `number`,
  `FORA_DE_AREA` se `null`/`undefined`. **Inalterado** (`calcularFrete.ts:140-151`).
- `raio_max_km` null em zona `raio_km`: já não atende (`raio_max_km != null`, linha 83) — segue
  ignorada, teste existente `calcularFrete.test.ts:254` continua verde.
- Zona inativa ou `taxa: null`: filtrada antes da seleção, como hoje (linha 132).
- `taxa` negativa no banco: piso 0 preservado (linha 160).
- Loja com zona `raio_km` ativa e sem coords: `distanciaKm` undefined → sem candidata de raio →
  `lojaTemRaioSemCoords` classifica como `indisponivel_loja` no preview. **Inalterado.**
- Loja misturando `bairro` + `raio_km`: faixa de raio correta é eleita primeiro, depois disputa por
  menor taxa com a zona de bairro (D2). Cobre o caso do `pedido.test.ts:1041`.
- Duplo submit / race: irrelevante aqui — função pura e determinística; a atomicidade do pedido é da
  RPC `criar_pedido`, fora do escopo.
- ViaCEP/Nominatim indisponível: fail-closed já coberto em D4; frete degrada para fallback (mais caro)
  ou indisponível, **nunca** para uma faixa mais barata.

**Tratamento de erro:** nenhum caminho novo de exceção. `calcularFrete` continua pura e sem `throw`;
os erros de I/O seguem tratados nos call sites com mensagem genérica ao cliente e `console.error` no
servidor (`frete.ts:167-171`, `seguranca.md` §14).

## Contratos de Dados

**Nenhuma mudança de schema. SEM MIGRATION.** `taxas_entrega` permanece
(`supabase/migrations/20260614000129_schema_inicial.sql:109-115`): `raio_max_km numeric(5,2)` nullable.
Nenhuma política RLS muda. **Não** rodar `npx supabase db push` nem `npx supabase gen types` por conta
desta issue — `src/lib/database.types.ts` fica intocado.

Contrato TypeScript de `calcularFrete` (assinatura, `ZonaComTaxa`, `EnderecoEntrega`, `ResultadoFrete`)
**não muda** — só a semântica de qual zona é eleita. Nenhum call site precisa ser editado.

## Recálculo no Servidor

| | |
|---|---|
| O cliente envia | `loja_id`, `bairro`, `cep`, itens, cupom — **nenhum valor monetário e nenhuma distância** |
| O servidor busca do banco | zonas + taxas (`listarZonasComTaxas`, escopo `loja_id` + RLS), `lojas.taxa_entrega_fora_zona`, preços dos produtos |
| O servidor deriva | `distanciaKm` (coords da loja via service_role → geocoding do CEP → haversine) e o bairro canônico (ViaCEP) |
| O servidor decide | a **faixa** pela nova regra e a `taxa` a partir de `taxas_entrega.taxa`; `total` via `calcularTotal` (`pedido.ts:321`) |
| Payload adulterado | `schemaFretePreview` é `.strict()` (`frete.ts:50-61`): campo monetário injetado é rejeitado antes de qualquer I/O. `distanciaKm` do cliente nunca é lido — só o valor derivado é injetado (`pedido.ts:282-284`) |

A mudança **não afrouxa** nada disso: continua tudo server-side, e o preview segue não vinculante.

## Arquivos

**Criar:** nenhum.

**Modificar (nível função):**
1. `src/lib/utils/calcularFrete.ts`
   - `calcularFrete`, corpo de seleção — substituir o laço `131-138` pelas etapas do D1
     (candidatas → faixa de raio por menor teto com o desempate do D5 → menor taxa entre a faixa e as
     candidatas não-raio). O bloco de fallback `140-151` e o de grátis/arredondamento `153-163` ficam
     **literalmente como estão**.
   - Docstring `101-120` — reescrever o passo 2 de "entre as que atendem, escolhe a de MENOR taxa"
     para a regra de faixa exclusiva, mantendo os passos 1, 3 e 4 e as referências a RN-C4/RN-C8.
   - Comparador de faixa: função auxiliar **privada** no mesmo arquivo (não exportar, não criar
     módulo — não há segundo consumidor).
2. `src/lib/utils/calcularFrete.test.ts` — só o `tdd` (fase RED), no passo seguinte. **Adiciona** um
   `describe` de faixas exclusivas; não edita nem remove nenhum caso existente.

**NÃO tocar (com motivo):**
- `src/lib/actions/pedido.ts` e `src/lib/actions/frete.ts` — herdam a regra pela função; editá-los
  duplicaria a verdade em dois lugares (sinal de remendo).
- `src/lib/supabase/queries/entregaPagamento.ts` — a ordenação é responsabilidade da função pura (D3).
- `src/lib/utils/freteDegradado.ts` e `src/lib/actions/distanciaFrete.ts` — o caminho de distância
  desconhecida não passa pela seleção de faixa (D4).
- `src/lib/validacoes/entrega.ts` (`schemaTaxa`) e a UI de `/painel/configuracoes/entregas`,
  `src/lib/actions/entrega.ts`, `src/app/admin/assinantes/actions/admin-entrega.ts` — cadastro de
  zona não muda; validar sobreposição de faixas é issue separada (D5).
- `src/components/vitrine/checkout/EtapaEntrega.tsx` e `estado.ts` — só exibem `taxa_preview`/
  `zona_nome`, cujo shape não muda.
- `supabase/migrations/*`, `src/lib/database.types.ts` — sem migration, sem regen de tipos.
- `mockups/entregas-faixas-km.{html,md}` — item 3, adiado; preservar intactos.
- `src/types/supabase.ts` — arquivo morto (CLAUDE.md).

## Dependências Externas

**Nenhuma nova.** Nenhum pacote adicionado, nenhuma chamada de API nova. As integrações já existentes
(ViaCEP, Nominatim) **não são chamadas a mais nem a menos** por esta issue — o número de chamadas por
checkout é idêntico ao de hoje, porque a mudança acontece depois da derivação da distância. Custo
incremental de quota: **zero**. Custo computacional: uma partição + um `reduce` sobre as zonas de uma
loja, em memória.

## Ordem de Implementação

1. **RED (`tdd`)** — obrigatório antes de qualquer código de produção (`crítica: SIM`, mandato 3).
   Escrever os casos abaixo em `calcularFrete.test.ts` e **capturar o output literal com `FAIL`**.
   Só testes de função pura; sem pglite (não há schema envolvido).
2. **GREEN (`executar`)** — reescrever a seleção conforme D1/D5 e a docstring. Nada além.
3. `npx vitest run src/lib/utils/calcularFrete.test.ts` → depois a suíte de regressão dos call sites:
   `npx vitest run src/lib/actions/frete.test.ts src/lib/actions/pedido.test.ts` (dependência: se a
   regra nova quebrasse um call site, apareceria aqui — a expectativa é **zero** quebras, ver abaixo).
4. Gate completo: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
5. Fan-out `revisar` ‖ `testar` ‖ `auditar`; depois `verificar`; depois `escriba`.

**Regressões esperadas: nenhuma.** Verificado arquivo por arquivo: os dois testes de "menor taxa" e
"empate" (`calcularFrete.test.ts:180-195`) usam `zonaBairro`, cujo comportamento é preservado por D2;
`pedido.test.ts` (`zonasComRaio`, linhas 343-356) e `frete.test.ts` (`zonaRaio`, linhas 117-128)
constroem **uma única** zona de raio por cenário, e uma faixa sozinha é eleita igual sob as duas
regras. Se algum desses testes ficar vermelho, é sinal de que a implementação divergiu do plano —
voltar ao plano, não editar o teste.

## Casos de borda da issue → cobertura no plano

| Caso pedido na seção "Casos de borda" | Onde o plano o cobre |
|---|---|
| 1,0 km → faixa 0–1 (R$ 4) | Bordas, teto inclusivo (`<=`, linha 83) |
| 1,1 km → faixa 1,1–2 (R$ 6) | Bordas, piso implícito |
| 1,5 km → faixa 1,1–2 (R$ 6) | Caminho feliz (caso numérico do usuário) |
| 2,0 km → faixa 1,1–2 (R$ 6) | Bordas, teto inclusivo |
| 2,1 km → faixa 2,1–3 (R$ 8) | D1, menor teto que cobre |
| 3,1 km → fora de todas as faixas | Bordas, fallback `taxaForaZona` |
| Preço fora de ordem (`2 km = R$ 6`, `3 km = R$ 5`) não pode dar o mais barato | Cenários, "Regressão que motivou a issue" |
| `taxaForaZona` como fallback acima da última faixa | Bordas + D1 etapa 4; bloco `140-151` inalterado |
| `taxaForaZona = null` → fora da área de entrega | Bordas, `FORA_DE_AREA` inalterado |
| `pedido_minimo_gratis` avaliado **na faixa escolhida** | D1: grátis é aplicado **depois** da eleição, sobre `escolhida` (linhas 153-155, inalteradas). Crítico: `pedido_minimo_gratis` **não participa** da seleção — a faixa é eleita por `raio_max_km`, nunca por conceder grátis. Teste explícito: duas faixas, a **errada** com `pedido_minimo_gratis` atingível; a eleita deve ser a certa e o grátis deve seguir o `pedido_minimo_gratis` **dela** |
| Preview da vitrine ≡ valor autoritativo do pedido | Mapa de Impacto: `frete.ts:136` e `pedido.ts:288` são os **únicos** dois call sites de `calcularFrete` no repo (verificado por grep); ambos passam as mesmas zonas do banco. Teste de paridade: mesma entrada → mesmo `ResultadoFrete` |

Casos extras que o `tdd` deve incluir além da lista da issue: empate de `raio_max_km` (D5),
determinismo com a lista de zonas **embaralhada** (D3 — mesma entrada em ordem diferente produz o
mesmo resultado), `distanciaKm` ausente com faixas cadastradas (D4), e loja misturando `bairro` +
faixas de raio (D2).

## Checklist de Validação Pós-Implementação

- [ ] `npx vitest run src/lib/utils/calcularFrete.test.ts` verde, com 1,5 km → R$ 6
- [ ] `npx vitest run src/lib/actions/frete.test.ts src/lib/actions/pedido.test.ts` verde sem edição
- [ ] `npx tsc --noEmit` · `npm run lint` (0 erros) · `npm test` · `npm run build` sem warning novo
- [ ] Preview e autoritativo devolvem o mesmo valor para a mesma entrada (teste de paridade)
- [ ] Lista de zonas embaralhada produz o mesmo frete (determinismo, D3)
- [ ] `pedido_minimo_gratis` de outra faixa não concede grátis na faixa eleita
- [ ] Nenhum arquivo em `supabase/migrations/` alterado; `npx supabase migration list` sem linha nova
- [ ] `src/lib/database.types.ts` sem diff
- [ ] `git diff --stat` toca apenas `calcularFrete.ts`, `calcularFrete.test.ts` e este arquivo
- [ ] `verificar`: na loja "Lanches base", frete no checkout da vitrine com distância em faixa
      intermediária mostra a taxa da faixa certa

