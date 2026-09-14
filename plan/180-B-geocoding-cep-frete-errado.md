# Plano técnico — 180-B: falha de geocoding do CEP do cliente cobra frete errado

> Issue: `tasks/180-B-geocoding-do-cep-do-cliente-cobra-frete-errado.md` (o mesmo plano
> está anexado lá). Agente `arquitetar`, 2026-09-13. Nada implementado — só plano.


## Plano Técnico

> Produzido pelo agente `arquitetar` (2026-09-13). Cópia em
> `plan/180-B-geocoding-cep-frete-errado.md`.

### Diagnóstico

**Causa raiz.** `distanciaDaLojaAoCep` (`src/lib/actions/distanciaFrete.ts:49-83`)
colapsa **sete causas distintas** num único `undefined`: CEP ausente, loja sem coords,
ViaCEP fora do ar, Google fora do ar, teto de orçamento batido, CEP inexistente e exceção
de banco. A jusante, `calcularFrete` não tem como distinguir *"a distância não se
aplica"* de *"a distância não pôde ser calculada"* — para ele só existe
`distanciaKm == null` → `zonaAtende('raio_km')` falso (`calcularFrete.ts:83`) → nenhuma
zona casa → `taxa_entrega_fora_zona` (`:177-186`). **O fallback fora-de-zona é uma regra
de negócio sobre o ENDEREÇO ("você mora fora das minhas zonas"), e está sendo aplicado a
uma falha de INFRAESTRUTURA nossa.** A invariante violada é: *o valor cobrado só pode
derivar de fato conhecido sobre o endereço; ausência de conhecimento não é um fato sobre
o endereço.*

O fail-closed de `distanciaFrete.ts` está certo (§12-A: não inventar distância). O erro é
que ele é **fail-closed sem sinal** — degrada em silêncio para um caminho que cobra
dinheiro. O `freteDegradado.ts` já provou o antídoto para um caso (loja sem coords), mas
o antídoto foi aplicado só no ramo `!atendido` do preview: quando a loja tem
`taxa_entrega_fora_zona`, `atendido` é `true` e a classificação **nunca roda** — nem no
preview, nem no autoritativo.

**Por que é complexo.** (a) Muda o contrato de retorno de um helper compartilhado pelos
dois caminhos de frete (preview e autoritativo) — RN-7 exige que os dois mudem juntos ou
divergem; (b) muda o contrato de dados (`pedidos.taxa_entrega` NOT NULL → nullable +
coluna nova), tocando a RPC transacional `criar_pedido`, a RLS de `pedidos`, os tipos
gerados e 4 telas de exibição; (c) muda o gate de conclusão do checkout
(`podeConfirmar`); (d) introduz mecânica temporal no cliente (retry 10s/20s) que **não
pode** virar autoridade; (e) o modo de falha é inobservável no ambiente de teste (sem
jsdom, sem browser) justamente na parte mais frágil (link de WhatsApp pós-spinner).

**Remendos rejeitados explicitamente.**

| Remendo tentador | Por que é remendo |
|---|---|
| Só trocar a mensagem "fora do seu bairro" por outra | não conserta a cobrança errada, que é o dano em dinheiro |
| Guard no `EtapaEntrega` que esconde o valor quando `zona_nome === 'fora_zona'` | guard de UI sobre um valor que o servidor já gravaria errado; a verdade tem que estar antes do dinheiro |
| Fazer `calcularFrete` receber `distanciaIndisponivel: boolean` e devolver `atendido:false` | mistura classificação de causa numa função pura de cálculo e faz a loja SEM zona de raio perder o fallback legítimo |
| Retry dentro de `distanciaDaLojaAoCep` (servidor tenta 3x no mesmo request) | triplica o gasto na Google dentro do mesmo timeout de Server Action, com o canal já degradado; é exatamente o que o comentário de `geocodificarCepResolvido` proíbe ("retry num canal já degradado dobraria o gasto") |
| Flag `frete_a_combinar` enviada pelo cliente no payload | valor/marcação monetária vinda do cliente — mandato 1 |

---

### Mapa de Impacto

```
[CLIENTE — preview, contornável, só UX]
EtapaEntrega.tsx ──chama──▶ calcularFreteAction (Server Action)
   │  (novo) ModalFreteIndisponivel.tsx ──usa──▶ retryFrete.ts (relógio 10s/20s, INJETADO)
   │                                     └──▶ re-chama calcularFreteAction (2x no máx.)
   └──reporta status──▶ CheckoutWizard.tsx ──▶ podeConfirmar (estado.ts) [gate de UI]

[SERVIDOR — preview: não-vinculante, mas precisa espelhar o autoritativo (RN-7)]
frete.ts:calcularFreteAction
   ├──▶ distanciaDaLojaAoCep ──▶ geocodificarCepResolvido ──▶ consultarGoogle
   │                                  │  (burst 10/s | teto diário global | teto por IP)
   │                                  └──▶ MOTIVO nasce aqui  ◀── CAUSA RAIZ da perda de informação
   ├──▶ calcularFrete (pura)
   └──▶ classificarFrete (pura, freteDegradado.ts)  ◀── NOVO ponto único de decisão

[SERVIDOR — AUTORITATIVO: é aqui que o dinheiro é gravado]
pedido.ts:criarPedido:288-311
   ├──▶ distanciaDaLojaAoCep  (MESMO helper — paridade RN-7)
   ├──▶ calcularFrete (pura)
   ├──▶ classificarFrete (pura — MESMA função do preview)
   └──▶ rpc criar_pedido ──escreve──▶ pedidos.taxa_entrega (NULL) + pedidos.frete_a_combinar (true)
                                          │
                                          ├──▶ confirmacao/page.tsx      (cliente, sem login, por id+token)
                                          ├──▶ whatsappPedido.ts         (mensagem ao lojista)
                                          ├──▶ DetalhePedido.tsx         (painel)
                                          ├──▶ ReciboCliente.tsx         (impressão)
                                          └──▶ DashboardLoja.tsx ──▶ calcularMetricasDoDia (soma `total`)
```

**Onde cada invariante é GARANTIDA:**

```
"Nunca cobrar o fallback fora-de-zona por falha do geocoder"
  ├── EtapaEntrega/Modal          — [cliente: PREVIEW, contornável, só UX]
  ├── lib/utils/freteDegradado.ts — [FONTE ÚNICA da classificação; pura, sem I/O]
  ├── lib/actions/frete.ts        — [preview server-side, não-vinculante]
  └── lib/actions/pedido.ts       — [Server Action AUTORITATIVA — decide o que é gravado]

"Pedido a combinar não pode virar R$ 0,00 silencioso"
  ├── tipos gerados (taxa_entrega: number | null) — [type-check: quebra o consumidor esquecido]
  └── CHECK chk_pedidos_frete_a_combinar          — [BANCO: última linha, vale para qualquer escritor]

"distanciaKm nunca vem do cliente"
  └── schemaPayloadPedido .strict() + derivação 100% server-side — [INALTERADO por esta issue]

"O relógio dos 10s/20s"
  └── 100% CLIENTE (setTimeout injetado). O servidor NÃO conta tentativa, NÃO confia em
      contador do cliente e NÃO tem estado de retry. Cada retentativa é uma chamada nova e
      independente a `calcularFreteAction`, sujeita ao rate limit já existente
      (fretePreview 20/min por IP) e aos tetos do geocoder. O único efeito do relógio é
      QUANDO o cliente pede de novo — nunca QUANTO ele paga.
```

---

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/utils/geocodificarEndereco.ts` | classifica `nao_encontrado` × `transitorio`; travas burst/diário-global/diário-IP em `consultarGoogle` | `MotivoGeocoding` ganha `"esgotado"`; os 3 pontos de negação passam a devolver o motivo certo (burst → `transitorio`; teto global e teto IP → `esgotado`; chave/credenciais ausentes → `esgotado`) |
| `src/lib/actions/distanciaFrete.ts` | devolve `number \| undefined` — **engole a causa** | passa a devolver `ResultadoDistancia` discriminado (`km` + `causa`). Continua fail-closed, continua nunca lançando, continua sem arredondar |
| `src/lib/utils/freteDegradado.ts` | `lojaTemRaioSemCoords` + `VEREDITO_LOJA_SEM_COORDS` | ganha `classificarFrete` (pura) e 3 vereditos novos. Vira a fonte única da decisão "ok × a combinar × indisponível" |
| `src/lib/utils/calcularFrete.ts` | cálculo puro do valor | **NÃO MUDA** (ver "NÃO tocar") |
| `src/lib/actions/frete.ts` | preview; mapeia `ResultadoFrete` → `zona_nome` | consome `classificarFrete`; `ResultadoFretePreview` ganha variante `a_combinar`; o `buscarCoordsLoja` extra do ramo `!atendido` some (a causa já chega do helper) |
| `src/lib/actions/pedido.ts` | autoritativo; `!atendido` → recusa | consome `classificarFrete`; a-combinar → grava `taxa_entrega = null`, `frete_a_combinar = true`, `total = subtotal − desconto` |
| `src/lib/validacoes/pedido.ts` | `.strict()`, sem campos monetários | **NÃO MUDA** — nenhuma flag nova vinda do cliente |
| `src/components/vitrine/checkout/EtapaEntrega.tsx` | `EstadoFrete` com 6 status | ganha `a_combinar`; abre o modal; deixa de mentir "fora do seu bairro" |
| `src/components/vitrine/checkout/estado.ts` | `podeConfirmar` exige `freteStatus === "ok"` | aceita também `"a_combinar"` |
| `src/components/vitrine/checkout/CheckoutWizard.tsx` | `:96` força `retirada` quando `!aceitaEntrega`; `fretePreviewEfetivo` | reusa o forçar-retirada como saída do modal; frete preview a-combinar exibe rótulo, não número |
| `src/components/vitrine/checkout/ResumoValores.tsx` | linha "Entrega" sempre `formatarMoeda` | aceita `frete: number \| "a_combinar"` |
| `src/app/(publica)/loja/[slug]/pedido/page.tsx` | deriva `preAbrirWhatsapp` (exige `whatsapp_envio_automatico`) | passa `whatsappLoja` (só o número, já público na `vitrine_lojas`) — **independente** da flag de envio automático, porque decisão 4 do usuário depende só de *ter canal* |
| `src/app/(publica)/loja/[slug]/confirmacao/page.tsx:219` | `taxa_entrega === 0 && retirada ? "Grátis" : moeda` | 3º estado "A combinar com a loja" + link de WhatsApp |
| `src/lib/utils/whatsappPedido.ts:111` | idem | 3º estado no texto enviado ao lojista |
| `src/components/painel/DetalhePedido.tsx:251` / `ReciboCliente.tsx:128` | `formatarMoeda(pedido.taxa_entrega)` | 3º estado com etiqueta "a combinar" |
| `src/lib/utils/metricasPedidos.ts` | soma `pedido.total` | **NÃO MUDA** — `total` já é NOT NULL e já nasce com frete 0; a decisão 5 do usuário é satisfeita sem tocar aqui (ver Decisão D7) |
| `src/lib/supabase/queries/pedidos.ts` | `SELECT *` | **NÃO MUDA** — coluna nova entra sozinha na projeção |
| `supabase/migrations/*` | `taxa_entrega numeric NOT NULL DEFAULT 0` | migration expand + RPC `criar_pedido` v17 |

---

### Decisões de Design

**D1 — Como a causa sobe do geocoder até a UI.**
- (a) `distanciaDaLojaAoCep` continua `number | undefined` e cada caller reconsulta o
  geocoder para descobrir a causa. **Contras:** dobra o custo na API paga e permite
  divergência preview↔autoritativo. Rejeitada.
- (b) Variável/contexto global "última causa". **Contras:** estado implícito entre
  requests concorrentes na mesma lambda; corrida silenciosa. Rejeitada.
- (c) **ESCOLHIDA:** retorno discriminado.
  ```ts
  // distanciaFrete.ts
  export type CausaDistancia =
    | "ok" | "sem_cep" | "loja_sem_coords"
    | "nao_encontrado" | "transitorio" | "esgotado" | "erro";
  export type ResultadoDistancia =
    | { km: number; causa: "ok" }
    | { km: undefined; causa: Exclude<CausaDistancia, "ok"> };
  ```
  **Por quê:** o compilador força os dois callers a tratar; nenhum dado sensível novo
  atravessa (a causa é um enum, o par (lat,lng) continua morrendo dentro do módulo de
  geocoding — §19 preservado); fail-closed intacto (nunca lança, `km` só é número quando
  a distância é real).

**D2 — Onde nasce `retriável × esgotado`.**
- (a) Inferir na UI a partir do tempo de resposta / mensagem. Rejeitada (adivinhação).
- (b) **ESCOLHIDA:** nasce em `consultarGoogle`, que é o único lugar que sabe QUAL trava
  negou. Mapa fixo e exaustivo:

  | Situação | Motivo | Retry? |
  |---|---|---|
  | burst `fixedWindow(10,"1s")` negou | `transitorio` | sim |
  | `fetch` timeout (5s) / reject / exceção | `transitorio` | sim |
  | HTTP não-ok (5xx, 429) | `transitorio` | sim |
  | `status` Google ≠ OK/ZERO_RESULTS (incl. `OVER_QUERY_LIMIT`, `UNKNOWN_ERROR`) | `transitorio` | sim |
  | teto diário **global** negou | `esgotado` | **não** |
  | teto diário **por IP** negou | `esgotado` | **não** |
  | `GOOGLE_GEOCODING_API_KEY` ausente | `esgotado` | **não** |
  | credenciais Upstash ausentes | `esgotado` | **não** |
  | ViaCEP devolveu `null` / lançou | `transitorio` | sim |
  | CEP malformado (`!/^\d{8}$/`) | `nao_encontrado` | **não** (hoje é `transitorio`; corrigido — retentar um CEP inválido nunca resolve) |
  | `ZERO_RESULTS` em toda a cascata / fora do bounding box | `nao_encontrado` | **não** |

  Chave ausente e credenciais ausentes viram `esgotado` porque a semântica que a UI
  precisa é **"retentar AGORA adianta?"**, e não "a falha é permanente?" — 20s de spinner
  por uma env var faltando é puro desperdício de atenção do comprador.
  `REQUEST_DENIED` (chave inválida/sem billing) cai em "status ≠ OK" e fica `transitorio`:
  é indistinguível de erro momentâneo pelo corpo da resposta, e o custo do erro é 2
  chamadas que a Google não cobra.

**D3 — Onde a decisão "a combinar" é tomada.**
- (a) Dentro de `calcularFrete`, passando a causa. **Contras:** contamina a função pura
  de VALOR com classificação de CAUSA; qualquer erro ali muda preço. Rejeitada.
- (b) Duplicada nas duas actions. **Contras:** é exatamente o bug que a issue corrige.
  Rejeitada.
- (c) **ESCOLHIDA:** função pura nova em `freteDegradado.ts`, consumida pelas duas
  actions — mesmo padrão que já resolveu `VEREDITO_LOJA_SEM_COORDS`.
  ```ts
  export type VereditoFrete =
    | { tipo: "ok" }
    | { tipo: "a_combinar"; veredito: VereditoACombinar }
    | { tipo: "indisponivel"; veredito: "indisponivel" | typeof VEREDITO_LOJA_SEM_COORDS };

  export const VEREDITO_A_COMBINAR_RETRIAVEL = "a_combinar_retriavel";
  export const VEREDITO_A_COMBINAR_ESGOTADO  = "a_combinar_esgotado";
  export const VEREDITO_A_COMBINAR_CEP       = "a_combinar_cep";

  export function classificarFrete(args: {
    resultado: ResultadoFrete;      // saída de calcularFrete
    zonas: ZonaComTaxa[];
    causaDistancia: CausaDistancia;
    temCoordsLoja: boolean | null;  // null = não consultado (só usado quando causa === "sem_cep")
  }): VereditoFrete;
  ```
  **Predicado exato — a parte que decide dinheiro:**
  ```
  a_combinar  ⟺  causaDistancia ∈ {nao_encontrado, transitorio, esgotado, erro, loja_sem_coords}
              ∧  resultado.zonaId == null                  // nenhuma zona específica casou
              ∧  distanciaEraNecessaria(zonas)             // ∃ zona raio_km ATIVA e COM taxa
  ```
  As três conjunções importam:
  - `zonaId == null` — se uma zona `bairro`/`faixa_cep` casou, o frete é conhecido e
    correto: a falha de geocoding é irrelevante, **não** vira a combinar.
  - `distanciaEraNecessaria` — loja sem nenhuma zona de raio nunca dependeu da distância;
    o fallback fora-de-zona ali é a regra de negócio legítima e **continua valendo**.
    Espelha `lojaTemRaioSemCoords` (mesmo predicado `ativo && taxa != null`), para que a
    classificação não divirja de `zonaAtende`.
  - a causa — `causa === "ok"` ou `"sem_cep"` nunca produz a combinar (sem CEP, o caminho
    de raio nem se aplica; a loja sem coords mantém `VEREDITO_LOJA_SEM_COORDS`, que já
    existe e é UM caso de misconfiguração da loja, não do canal).

  Consequência deliberada: **o veredito a-combinar PRECEDE o fallback fora-de-zona.** É a
  inversão que corrige a causa raiz — hoje o fallback ganha por ser o último `else`.

**D4 — `nao_encontrado` também vira a combinar?**
- (a) Manter o comportamento atual (cobra fallback). **Contras:** é o mesmo dano em
  dinheiro por uma causa que o cliente não controla plenamente (CEP novo, base do ViaCEP
  desatualizada). Rejeitada.
- (b) **ESCOLHIDA:** sim — a invariante é *"distância necessária e desconhecida ⇒ não
  invento preço"*, independente do porquê. O que muda por motivo é só a **UI**:
  `nao_encontrado` pede conferir o CEP e **não** faz retry; `transitorio` faz retry;
  `esgotado` pula direto ao passo 3. Uma invariante, três textos.

**D5 — Como o "a combinar" chega ao cliente no preview.**
- (a) Mais um literal em `zona_nome` (como `indisponivel_loja` hoje). **Contras:**
  `zona_nome` é `string`; um consumidor novo que esqueça o caso compila e exibe o nome cru.
- (b) **ESCOLHIDA:** terceira variante no union de retorno:
  ```ts
  export type ResultadoFretePreview =
    | { ok: true; taxa_preview: number; zona_nome: string }
    | { ok: true; a_combinar: true; veredito: VereditoACombinar }
    | { ok: false; erro: string };
  ```
  Quebra no type-check quem esquecer. `zona_nome` continua carregando
  `VEREDITO_LOJA_SEM_COORDS`/`"indisponivel"` (sem regressão).

**D6 — Marcação no banco.** Decidida pelo usuário: `taxa_entrega` nullable +
`frete_a_combinar boolean NOT NULL DEFAULT false`, com CHECK amarrando os dois. Registro
do porquê para o futuro: NULL sozinho não distingue "a combinar" de dado legado/faltante,
e `taxa_entrega = 0` é frete grátis legítimo.

**D7 — Receita do painel.** Decidida pelo usuário: entra na soma com frete 0. Verificação
feita no código: o único agregado de receita é `calcularMetricasDoDia`
(`metricasPedidos.ts`), que soma `pedido.total` — coluna NOT NULL que já nasce como
`subtotal − desconto + 0`. **Não existe hoje nenhum `SUM(taxa_entrega)` em SQL nem em TS**
(`grep` em `lib/supabase/queries/` e `components/painel/`). Portanto o `COALESCE(taxa_entrega, 0)`
pedido pelo usuário é **regra preventiva**, não edição: fica registrado como obrigação em
`references/schema.md` para qualquer agregado futuro, e `metricasPedidos.ts` não é tocado.
A **etiqueta** vem sempre de `frete_a_combinar`, nunca de `taxa_entrega == 0`.

**D8 — Onde mora o relógio do retry.**
- (a) Servidor mantém estado de tentativa (Redis por IP+CEP). **Contras:** estado novo,
  custo novo no Redis, e nenhuma invariante ganha — o servidor recalcula tudo de qualquer
  forma. Rejeitada.
- (b) **ESCOLHIDA:** relógio 100% no cliente, em módulo **neutro e injetável**
  `src/components/vitrine/checkout/retryFrete.ts` (mesmo padrão de `aberturaWhatsapp.ts`
  e `criarControladorPolling` — `setTimeout` recebido por parâmetro, testável em
  `environment: node` sem jsdom).
  ```ts
  export interface DepsRetryFrete {
    tentar: () => Promise<ResultadoFretePreview>;
    agendar: (fn: () => void, ms: number) => number;   // default: setTimeout
    cancelar: (id: number) => void;                    // default: clearTimeout
    aoEstado: (e: EstadoRetry) => void;                // {tentativa: 1|2|3, fase}
  }
  export const ATRASOS_RETRY_MS = [10_000, 10_000] as const; // t=10s e t=20s
  export function criarRetryFrete(deps: DepsRetryFrete): { iniciar(): void; parar(): void };
  ```
  A chamada que abriu o modal **já é a tentativa 1** (decisão 2 do usuário): `iniciar()`
  agenda a tentativa 2 em +10s e a 3 em +10s após ela. Sucesso em qualquer uma cancela o
  timer pendente e fecha o modal. `parar()` no unmount.
  **O que o servidor valida sobre isso: nada.** Não há contador, nem token de tentativa,
  nem janela temporal server-side. A proteção contra abuso do retry é a que já existe
  (`fretePreview` 20/min por IP + tetos diários do geocoder), e o valor final é sempre
  recalculado do zero em `criarPedido`.

**D9 — WhatsApp no modal.**
- (a) `window.open` ao esgotar as tentativas. **Contras:** a user activation morreu depois
  de até 20s (`aberturaWhatsapp.ts:86` documenta exatamente isso); cai no bloqueador.
  Rejeitada — é a restrição dura da issue.
- (b) **ESCOLHIDA:** `<a href={urlHttpsSegura(link)} target="_blank" rel="noopener noreferrer">`
  renderizado dentro do modal. Navegação iniciada pelo próprio clique do usuário, sem
  `await` no meio: não depende de user activation herdada. O guard `urlHttpsSegura` (§15)
  é aplicado **na montagem do href**, e `href` nulo ⇒ o link não é renderizado
  (fail-closed). O href monta a mesma `wa.me` já usada no projeto, com texto pedindo o
  endereço ao cliente; **nenhuma PII vai na query string neste ponto** (o pedido ainda nem
  existe) — a mensagem é genérica ("Olá! Quero fazer um pedido e combinar a entrega").
- O modal **não cria pedido**. O pedido "a combinar" nasce quando o comprador conclui o
  checkout normalmente (D10).

**D10 — O pedido a-combinar não depende de o cliente ter visto o modal.**
Nenhuma flag de "ciente" vem do cliente. `criarPedido` reclassifica do zero: se no momento
do submit a distância continuar necessária e desconhecida, grava a combinar. Isso cobre o
caso real de o preview ter acertado (cache quente) e o autoritativo falhar segundos
depois. A comunicação nesse caminho é a tela de confirmação, que exibe "Entrega: a
combinar com a loja" + link de WhatsApp.

**D11 — Loja publicada sem WhatsApp.** Decidida pelo usuário: modal oferece retirada,
reusando `CheckoutWizard.tsx:96`. Implementação: o botão do modal chama o
`handleTipoEntregaChange("retirada")` que já existe — **não** um segundo caminho.
O modal recebe `whatsappLoja: string | null` por prop (derivado no SSR da
`vitrine_lojas`, independente de `whatsapp_envio_automatico`) e escolhe o rodapé:
`null` ⇒ botão "Retirar no balcão"; caso contrário ⇒ link do WhatsApp + botão secundário
"Continuar e combinar o frete".

---

### Cenários

**Caminho feliz (sem regressão).** Geocoding responde → `causa: "ok"` → `classificarFrete`
devolve `{tipo:"ok"}` → preview e pedido idênticos ao comportamento atual.

**Falha retriável, sucesso na 2ª.** Preview falha (`transitorio`) → modal abre com spinner
e "tentativa 1 de 3" → em t=10s chama de novo → `ok` → timer 3 cancelado, modal fecha,
frete correto aplicado.

**Falha retriável, 3 tentativas esgotadas.** Modal troca para o passo 3: texto explicando
que **o serviço de endereços está indisponível, não que o endereço é inválido**, link de
WhatsApp clicável pedindo para informar o endereço à loja, e botão "Continuar e combinar o
frete no pedido" (libera o `podeConfirmar`). Confirmando, `criarPedido` grava a combinar.

**Motivo `esgotado`.** Modal abre **já no passo 3**, sem spinner e sem consumir tentativa.
Texto **não culpa o cliente** (o teto por IP pode ter sido estourado por NAT corporativo ou
CGNAT móvel — `rateLimit.ts:52-64`): *"Não conseguimos calcular a entrega agora. Isso pode
acontecer em redes compartilhadas (Wi-Fi de empresa, internet móvel)."*

**Motivo `nao_encontrado`.** Modal sem spinner e sem retry: *"Não localizamos esse CEP.
Confira o número e tente de novo"* + as mesmas saídas (WhatsApp / retirada / continuar a
combinar). Nunca "não atendemos seu bairro".

**Loja sem zona de raio, geocoding caído.** `distanciaEraNecessaria === false` →
`{tipo:"ok"}` → fallback fora-de-zona cobrado normalmente. **Comportamento atual
preservado de propósito** — ali o fallback é regra de negócio, não remendo.

**Endereço genuinamente fora de área.** Geocoding OK, distância maior que todas as faixas,
sem `taxa_entrega_fora_zona` → `{tipo:"indisponivel", veredito:"indisponivel"}` → a
mensagem "Entrega não disponível para o seu bairro" continua existindo **e só aqui**.

**Loja sem coords (180-A/005).** `causa: "loja_sem_coords"` → `VEREDITO_LOJA_SEM_COORDS`
mantido (misconfiguração da loja, mensagem própria já existente). Não vira a combinar.

**Retirada.** `criarPedido` força `taxa_entrega = 0`, `frete_a_combinar = false`. Nenhum
geocoding é feito. Inalterado.

**Loja fecha / assinatura expira entre o preview e o submit.** Guards existentes de
`criarPedido` (loja ativa, `assinaturaPermiteAcesso`, `lojaAberta`) rodam **antes** do
frete e continuam recusando. O caminho a-combinar não fura nenhum deles.

**Duplo submit / race.** `idempotency_key` + dedupe na RPC (`criar_pedido`, issue 063)
continua valendo: a 2ª chamada devolve o mesmo pedido, sem 2º INSERT. Um retry cujo
geocoding volta a funcionar **não** reescreve o pedido já gravado como a combinar — é o
comportamento correto da idempotência, e a divergência é resolvida no chat com a loja.

**Cupom expirado/esgotado.** Ortogonal; a trava de cupom da RPC recalcula
`v_total := p_subtotal + p_taxa_entrega` quando perde a corrida — **atenção:** com
`p_taxa_entrega NULL` essa expressão viraria NULL. A RPC precisa de
`coalesce(p_taxa_entrega, 0)` nessa linha (ver Contratos de Dados). É a borda mais fácil
de esquecer do plano inteiro.

**Modal desmontado no meio (voltar etapa, fechar aba).** `parar()` limpa o timer; nenhum
`setState` pós-unmount; nenhuma chamada pendente à Server Action é considerada.

**Erro interno em qualquer ponto.** Mensagem genérica ao comprador, detalhe só no
`console.error` do servidor (§14). Nenhuma causa técnica crua (status da Google, nome de
trava, IP) é exibida ao cliente — o enum de veredito é o único que atravessa.

---

### Contratos de Dados

**Migration EXPAND — `supabase/migrations/<ts>_pedidos_frete_a_combinar.sql`** (entra
neste PR; `npx supabase db push` **só com autorização explícita do usuário**):

```sql
-- 1) coluna nova, default seguro: todo pedido existente é "frete conhecido"
alter table public.pedidos
  add column if not exists frete_a_combinar boolean not null default false;

-- 2) afrouxa o NOT NULL (compatível com o código ANTIGO em produção: ele nunca
--    escreve NULL e nenhuma linha existente é NULL)
alter table public.pedidos
  alter column taxa_entrega drop not null;

-- 3) o par é amarrado: a combinar ⟺ taxa NULL. Impede tanto "a combinar com R$ 0,00"
--    quanto "NULL órfão sem intenção declarada". NOT VALID: não varre a tabela agora
--    e não aborta o deploy por uma linha inesperada; validado na fase CONTRACT.
alter table public.pedidos
  add constraint chk_pedidos_frete_a_combinar
  check (
    (frete_a_combinar and taxa_entrega is null)
    or (not frete_a_combinar and taxa_entrega is not null)
  ) not valid;

comment on column public.pedidos.frete_a_combinar is
  'true = frete não pôde ser calculado (geocoding indisponível) e será combinado com a loja. Implica taxa_entrega IS NULL. NUNCA inferir "a combinar" de taxa_entrega = 0 (isso é frete grátis).';
```

**RPC `criar_pedido` v17** — migration separada, no MESMO PR:
- `create or replace` com o 17º parâmetro `p_frete_a_combinar boolean default false` e
  `p_taxa_entrega numeric` aceitando NULL;
- linha da trava de cupom perdida vira `v_total := p_subtotal + coalesce(p_taxa_entrega, 0);`
- `insert` ganha `frete_a_combinar`;
- grants reafirmados para `service_role` (revoke de `public`/`anon`/`authenticated`).
- **Divergência deliberada do precedente da 009500:** aquela migration DROPou o overload
  antigo no mesmo passo. Aqui **não dropamos** a função de 16 args na fase expand — o
  código antigo continua em produção durante a janela de deploy e chama a de 16 args. A de
  16 args não fura invariante de valor (só não sabe gravar a combinar) e continua exposta
  apenas a `service_role`. O `drop` vai para a fase CONTRACT.

**BACKFILL:** nenhum dado a corrigir (o `DEFAULT false` cobre 100% das linhas). O passo é
uma verificação, não uma escrita:
```sql
select count(*) from public.pedidos
 where (frete_a_combinar and taxa_entrega is not null)
    or (not frete_a_combinar and taxa_entrega is null);  -- esperado: 0
```

**CONTRACT (issue própria, DEPOIS do código em produção — não entra neste PR):**
```sql
alter table public.pedidos validate constraint chk_pedidos_frete_a_combinar;
drop function if exists public.criar_pedido(
  uuid, text, text, jsonb, text, text, numeric, numeric, numeric, numeric,
  uuid, text, jsonb, text, numeric, uuid);   -- overload de 16 args
```

**RLS de `pedidos` — revisão exigida e resultado.** As duas policies existentes
(`pedidos_insert_publico` com `WITH CHECK (loja_esta_ativa(loja_id))` e
`pedidos_acesso_lojista` com `USING/WITH CHECK` por `dono_id`) são **por linha, não por
coluna**: a coluna nova é coberta automaticamente pelas duas e **nenhuma policy nova é
necessária nem desejável**. Registro explícito de dois pontos:
1. Não existe SELECT anon em `pedidos` (deny-all por design); a leitura do comprador
   continua por `id + token_acesso` via `service_role` (`buscarPedidoPorToken`). O novo
   campo herda esse isolamento sem mudança.
2. **Residual pré-existente, fora do escopo desta issue:** `anon` tem INSERT autorizado em
   `pedidos` (policy + grants amplos da `20260614008500`), então um cliente que fale
   direto com o PostgREST já podia forjar `total`. `frete_a_combinar` não amplia essa
   superfície (é um booleano, não um valor), e o `CHECK` novo até a estreita um pouco. Vale
   abrir issue separada para o `auditar` avaliar revogar o INSERT direto de `anon` agora
   que todo pedido nasce pela RPC sob `service_role`. **Não fazer isso dentro desta issue.**

**Tipos gerados:** após aplicar a migration, `npx supabase gen types typescript >
src/lib/database.types.ts`. `pedidos.Row.taxa_entrega` vira `number | null` e aparece
`frete_a_combinar: boolean`. **É esse regen que quebra no type-check os 4 consumidores de
exibição** — é o mecanismo de segurança do plano, não um efeito colateral. Se o regen não
for possível (migration não aplicada no cloud), o `executar` **não** deve editar
`database.types.ts` à mão: a ordem de implementação abaixo prevê isso.

---

### Recálculo no Servidor (dinheiro)

| O cliente envia | O servidor faz |
|---|---|
| `loja_id`, itens (`produto_id` + quantidade + opcionais), `endereco_entrega` (rua/número/bairro/cidade/CEP), `forma_pagamento`, `codigo_cupom`, `idempotency_key` | tudo já validado por `schemaPayloadPedido.strict()` — **inalterado** |
| — **nunca** `distanciaKm` | recalcula do zero: `buscarCoordsLoja` (service_role) + ViaCEP + Google, via `distanciaDaLojaAoCep` |
| — **nunca** `taxa_entrega` | recalcula por `calcularFrete` sobre as zonas lidas do banco |
| — **nunca** `frete_a_combinar` | **decide sozinho**, via `classificarFrete`, a partir da causa da distância, das zonas do banco e do resultado do cálculo |
| — **nunca** `total` | `total = subtotal − desconto + (a combinar ? 0 : frete.taxa)` |

Payload adulterado com `frete_a_combinar: true` é rejeitado pelo `.strict()` antes de
qualquer I/O. Payload adulterado com `taxa_entrega: 0` idem. Um comprador **não consegue**
forçar frete a combinar: teria que derrubar o geocoder para o próprio CEP — e mesmo
conseguindo, não paga menos, só adia a definição do frete para o chat com a loja (com o
pedido registrado e visível ao lojista).

---

### Arquivos

**Criar**
| Arquivo | Conteúdo |
|---|---|
| `src/components/vitrine/checkout/retryFrete.ts` | módulo NEUTRO: `criarRetryFrete(deps)`, `ATRASOS_RETRY_MS`, tipos de estado. Sem `'use client'`, sem `window`/`setTimeout` global — injetados (padrão `aberturaWhatsapp.ts`) |
| `src/components/vitrine/checkout/retryFrete.test.ts` | mecânica: t=10s/t=20s, sucesso cancela pendente, `parar()` limpa, esgotado não agenda |
| `src/components/vitrine/checkout/ModalFreteIndisponivel.tsx` | `'use client'`; usa `Dialog` de `components/ui/dialog.tsx` (**já existe** — não rodar shadcn CLI); 3 modos (retriável / esgotado / cep) × 2 rodapés (com WhatsApp / sem WhatsApp → retirada) |
| `supabase/migrations/<ts>_pedidos_frete_a_combinar.sql` | expand (coluna + drop not null + CHECK NOT VALID) |
| `supabase/migrations/<ts>_rpc_criar_pedido_frete_a_combinar.sql` | RPC v17 |
| `tests/migrations/pedidos_frete_a_combinar.test.ts` | CHECK aceita/rejeita cada combinação; RLS do lojista e ausência de SELECT anon continuam valendo com a coluna nova |

**Modificar (nível função)**
| Arquivo | Função | Mudança |
|---|---|---|
| `geocodificarEndereco.ts` | `MotivoGeocoding` | `\| "esgotado"` |
| | `consultarGoogle` | tetos diário global e por IP → `"esgotado"`; burst e demais falhas → `"transitorio"` |
| | `geocodificarCepResolvido` | portões 0/1 (chave/credenciais) → `"esgotado"`; CEP malformado → `"nao_encontrado"` |
| | `geocodificarEnderecoComMotivo` | só herda o tipo — **assinatura inalterada** (caminho da loja, 180-A) |
| `distanciaFrete.ts` | `distanciaDaLojaAoCep` | retorna `ResultadoDistancia`; mapeia `null` de `buscarCoordsLoja` → `"loja_sem_coords"`, CEP ausente → `"sem_cep"`, `catch` → `"erro"` |
| `freteDegradado.ts` | `classificarFrete` (nova), `distanciaEraNecessaria` (nova), 3 constantes de veredito | fonte única da decisão |
| | `lojaTemRaioSemCoords` | **mantida** (usada pelo ramo `sem_cep`) |
| `frete.ts` | `calcularFreteAction` | `const d = await distanciaDaLojaAoCep(...)`; injeta `d.km` só quando `causa==="ok"`; chama `classificarFrete`; remove o `buscarCoordsLoja` extra do ramo indisponível (passa a ser consultado só quando `causa === "sem_cep"`); nova variante de retorno |
| `pedido.ts` | `criarPedido` | idem no bloco `:288-311`; `a_combinar` ⇒ `p_taxa_entrega: null`, `p_frete_a_combinar: true`, `total` sem frete; `indisponivel` ⇒ mantém a recusa atual |
| `estado.ts` | `podeConfirmar` | aceita `freteStatus === "a_combinar"` |
| `EtapaEntrega.tsx` | `EstadoFrete`, efeito de cálculo | variante `a_combinar`; abre o modal; não fixa a chave de dedupe em a-combinar (permite recalcular ao trocar o CEP) |
| `CheckoutWizard.tsx` | render + `fretePreviewEfetivo` | passa `whatsappLoja`; rótulo "A combinar" no resumo; reusa `handleTipoEntregaChange("retirada")` como saída do modal |
| `ResumoValores.tsx` | props | `frete: number \| "a_combinar"` |
| `pedido/page.tsx` (checkout) | `CheckoutPage` | deriva e passa `whatsappLoja` |
| `confirmacao/page.tsx` | render do bloco de valores (`:219`) | 3º estado + link WhatsApp com guard `urlHttpsSegura` |
| `whatsappPedido.ts` | `montarLinkWhatsappPedido` (`:111`) | 3º estado: `Entrega: a combinar` |
| `DetalhePedido.tsx` (`:251`) / `ReciboCliente.tsx` (`:128`) | render | 3º estado com etiqueta visível |
| `references/schema.md`, `seguranca.md`, `architecture.md` | — | pelo `escriba` no fim (schema de `pedidos`; §10 ganha a regra "ausência de distância ≠ fora de área"; §12-A ainda fala "Nominatim" e precisa refletir Google + o novo motivo `esgotado`) |

**NÃO tocar (com motivo)**
| Arquivo | Motivo |
|---|---|
| `src/lib/utils/calcularFrete.ts` | função pura de VALOR. A classificação de causa fica fora dela de propósito (D3). Mexer aqui é o remendo que muda preço para todo mundo |
| `src/lib/validacoes/pedido.ts` | nenhum campo novo pode vir do cliente. `.strict()` é a defesa |
| `src/lib/utils/metricasPedidos.ts` | soma `total` (NOT NULL), que já nasce com frete 0 (D7) |
| `src/lib/supabase/queries/pedidos.ts` | `SELECT *` já traz a coluna nova |
| `src/components/ui/*` | gerado pelo shadcn CLI; `dialog.tsx` já cobre o modal |
| `src/lib/utils/rateLimit.ts` | o retry não precisa de trava nova; `fretePreview` 20/min já cobre 3 tentativas com folga |
| `src/types/supabase.ts` | morto (CLAUDE.md) |
| `src/lib/actions/loja.ts`, `admin-perfil.ts`, `PerfilClient.tsx` | caminho da LOJA = issue 180-A. Esta issue só herda o tipo `MotivoGeocoding` |

---

### Dependências Externas

**Nenhum pacote novo.** `Dialog` (shadcn, já em `components/ui/`), `sonner`, zod, Upstash —
todos já em `package.json`. Nada de `react-*` novo.

**Custo e quota (architecture.md §9 nº1).** A API paga é a Google Geocoding, já em uso
(issue 190). Esta issue **não** adiciona um provedor; adiciona **até 2 chamadas extras por
checkout que falhar de forma retriável**:

| Dimensão | Valor |
|---|---|
| Cobra por chamada? | sim — Google Geocoding, ~US$5/1.000 após a cota gratuita mensal |
| Teto atual | `GEOCODE_GOOGLE_DAILY_LIMIT` = 500/dia global; `GEOCODE_GOOGLE_DAILY_LIMIT_IP` = 50/dia por IP |
| Pior caso novo | 3 chamadas por tentativa de frete em vez de 1 → o teto por IP passa a comportar ~16 checkouts com falha/dia/IP em vez de 50 |
| Quanto custa no limite | o teto global **não muda**: 500/dia continua sendo o orçamento. O retry consome cota mais rápido, nunca acima do teto |
| Nota importante | a grande maioria das retentativas **não chega a ser cobrada**: `transitorio` costuma ser burst negado (não sai request), timeout ou 5xx (a Google não cobra erro). O caso cobrado é `OVER_QUERY_LIMIT`/`UNKNOWN_ERROR`, minoria |
| Comportamento ao estourar | **fail-closed** (§12-A preservado): teto batido ⇒ `esgotado` ⇒ **nenhuma** chamada, **nenhum** retry, modal vai direto ao passo 3. A issue *reduz* o gasto nesse cenário em relação a um retry ingênuo |
| Cache | inalterado: hit de `irango:geocode:<cep>` (TTL 25 dias) pula travas e Google; um retry logo após um sucesso não gasta nada |

---

### Ordem de Implementação

Cada passo deixa `npx tsc --noEmit`, `npm run lint`, `npm test` e `npm run build` verdes.

0. **`180-A` primeiro** (não é bloqueio duro, mas evita resolver o mesmo conflito em
   `MotivoGeocoding` duas vezes).
1. **RED (`tdd`) — antes de qualquer código de produção.** Lista fechada na seção abaixo.
   Capturar output `FAIL`.
2. **`migrar`** escreve as duas migrations (expand + RPC v17) e
   `tests/migrations/pedidos_frete_a_combinar.test.ts`. pglite aplica as migrations do
   diretório, então o teste de CHECK/RLS fica verde **sem** tocar o cloud. *Pedir
   autorização do usuário antes de `npx supabase db push`; o plano assume NÃO aplicada.*
3. **Regen de tipos.** Se a migration já foi aplicada no cloud (autorizada no passo 2):
   `npx supabase gen types typescript > src/lib/database.types.ts`. **Se não foi**, o
   `executar` PARA e reporta: sem o regen, `taxa_entrega` continua `number` e o type-check
   não protege os consumidores — seguir sem ele é o caminho para o R$ 0,00 silencioso.
   (É também a condição para que o passo 7 compile.)
4. **`geocodificarEndereco.ts`** — `esgotado` + remapeamento dos portões. Dependência: nada.
   Os testes existentes do módulo que afirmam `"transitorio"` nos casos remapeados mudam
   junto, com o porquê no diff.
5. **`freteDegradado.ts`** — `classificarFrete` + `distanciaEraNecessaria` + vereditos.
   Pura, testável isolada. Dependência: o tipo do passo 4.
6. **`distanciaFrete.ts`** — novo retorno discriminado. Quebra os dois callers de propósito.
7. **`frete.ts` e `pedido.ts` no MESMO commit.** Não separar: é a paridade RN-7; um commit
   que conserte só o preview é exatamente a divergência que `distanciaFrete.ts` existe para
   impedir. Aqui os testes RED de dinheiro (passo 1) ficam verdes.
8. **Consumidores de exibição** (`whatsappPedido`, `confirmacao/page`, `DetalhePedido`,
   `ReciboCliente`) — o type-check do passo 3 lista exatamente quais são.
9. **`retryFrete.ts` + teste** — módulo neutro, sem UI ainda.
10. **UI do checkout** (`ModalFreteIndisponivel`, `EtapaEntrega`, `CheckoutWizard`,
    `ResumoValores`, `estado.ts`, `pedido/page.tsx`) — por último, porque é a única camada
    não testável a fundo neste ambiente; entra sobre um servidor já provado.
11. **`revisar` ‖ `testar` ‖ `auditar`** → **`verificar`** (manual, lista abaixo) →
    **`escriba`** (`schema.md`, `seguranca.md` §10/§12-A, `architecture.md`).
12. **Abrir a issue de CONTRACT** (`validate constraint` + `drop` do overload de 16 args)
    em `tasks/`, marcada como "só depois do código em produção".

---

### Fase RED — testes que o `tdd` escreve ANTES do código

**O mais importante (critério de aceite do mandato 3):**
1. `pedido.test.ts` — **com o geocoding falhando (`transitorio`) e a loja tendo
   `taxa_entrega_fora_zona = 15` e uma zona `raio_km` ativa, `criarPedido` NÃO chama a RPC
   com `p_taxa_entrega = 15`.** Asserção sobre os args da RPC: `p_taxa_entrega === null` e
   `p_frete_a_combinar === true`, e `p_total === subtotal − desconto`. Este teste falha hoje
   com `p_taxa_entrega: 15` — é o output `FAIL` a capturar.

**Dinheiro e paridade:**
2. mesmo cenário com `esgotado` e com `nao_encontrado` → mesmo resultado (a invariante é
   uma só — D4).
3. loja **sem** zona `raio_km`, geocoding falhando → `p_taxa_entrega = 15`,
   `p_frete_a_combinar = false` (o fallback legítimo **não** pode regredir).
4. geocoding falhando mas uma zona `bairro` casa → cobra a zona, `frete_a_combinar = false`.
5. **paridade preview↔autoritativo:** para os cenários 1–4, `calcularFreteAction` devolve
   `a_combinar` exatamente quando `criarPedido` grava `frete_a_combinar = true`.
6. payload com `frete_a_combinar: true` ou `taxa_entrega: 0` → rejeitado pelo `.strict()`
   antes de qualquer I/O.
7. retirada com geocoding caído → `taxa_entrega = 0`, `frete_a_combinar = false`.

**Classificação de motivo (um teste por causa, critério de aceite 1):**
8. `geocodificarEndereco`: burst negado → `transitorio`; teto global negado → `esgotado`;
   teto por IP negado → `esgotado`; chave ausente → `esgotado`; credenciais Upstash
   ausentes → `esgotado`; HTTP 500 → `transitorio`; `OVER_QUERY_LIMIT` → `transitorio`;
   `ZERO_RESULTS` em toda a cascata → `nao_encontrado`; CEP malformado → `nao_encontrado`.
9. `classificarFrete` (pura): matriz causa × (zona casou?) × (existe zona raio ativa?) →
   `ok` / `a_combinar` / `indisponivel` / `VEREDITO_LOJA_SEM_COORDS`.
10. `distanciaDaLojaAoCep`: loja sem coords → `causa: "loja_sem_coords"` **sem** chamar o
    geocoder; CEP ausente → `"sem_cep"` sem nenhuma I/O; exceção do banco → `"erro"`,
    nunca propaga.

**Retry (mecânica, sem UI):**
11. `retryFrete`: `esgotado` não agenda nada (critério "não consome tentativa nem exibe
    spinner"); falha retriável agenda em 10s e 20s; sucesso na 2ª cancela a 3ª; `parar()`
    limpa timer pendente; no máximo 2 chamadas extras (3 no total com a que abriu o modal).

**Banco:**
12. `tests/migrations/`: `frete_a_combinar = true` com `taxa_entrega = 0` → CHECK rejeita;
    `= true` com NULL → aceita; `= false` com NULL → rejeita; `= false` com número →
    aceita. Anon continua sem SELECT em `pedidos`; lojista lê a coluna nova só da própria
    loja.

---

### Recorte: automatizado × manual

**Coberto por Vitest/pglite (`environment: node`, sem jsdom, sem Docker):** tudo acima —
classificação de motivo, função pura de veredito, as duas Server Actions (com o geocoder e
o Supabase mockados), a mecânica do retry (timers injetados/fake timers), CHECK e RLS em
pglite, e o texto gerado por `whatsappPedido` (função pura).

**NÃO coberto — verificação manual obrigatória (`verificar`), sem Playwright e sem MCP de
browser (débito 176):**
1. **O link de WhatsApp depois de ~20s de spinner, em iOS Safari e Android Chrome** — risco
   residual nº1. Confirmar que é `<a href>` clicável (não `window.open`) e que abre o app.
2. Os 2 retries visíveis a cada 10s, com o estado do modal correto ("tentativa 2 de 3").
3. Modal em motivo `esgotado`: **sem** spinner, direto no passo 3.
4. Loja sem WhatsApp: modal oferece retirada e o wizard realmente muda para retirada
   (mesmo caminho de `CheckoutWizard.tsx:96`).
5. Pedido a combinar distinguível de frete grátis em: confirmação, recibo impresso, detalhe
   no painel e mensagem do WhatsApp.
6. Foco/ESC/leitor de tela no modal (`Dialog` do shadcn já entrega, confirmar que não foi
   quebrado — `design-system.md` §modal).

*Como simular a falha sem derrubar nada:* em dev, apagar `GOOGLE_GEOCODING_API_KEY` produz
`esgotado`; apontar o fetch para um host inexistente (ou desconectar a rede) produz
`transitorio`; um CEP válido de formato mas inexistente produz `nao_encontrado`.

---

### Checklist de Validação Pós-Implementação

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` — sem erro e sem
      warning novo
- [ ] Teste RED nº 1 capturado com output `FAIL` **antes** de qualquer código de produção
- [ ] Política RLS testada em pglite: anon sem SELECT em `pedidos`; lojista de outra loja
      recebe deny na linha com `frete_a_combinar`
- [ ] CHECK `chk_pedidos_frete_a_combinar` rejeita as 2 combinações inválidas
- [ ] Valor recalculado no servidor ignora payload adulterado (`frete_a_combinar`,
      `taxa_entrega`, `total`, `distanciaKm` → todos barrados pelo `.strict()`)
- [ ] Preview e autoritativo concordam nos 4 cenários de frete (teste de paridade RN-7)
- [ ] Loja **sem** zona de raio continua cobrando `taxa_entrega_fora_zona` (sem regressão)
- [ ] "Entrega não disponível para o seu bairro" só aparece com geocoding OK
- [ ] Nenhum secret, nenhum par (lat,lng) e nenhum dado pessoal atravessa para o cliente —
      só o enum de veredito
- [ ] Nenhuma PII na query string do link de WhatsApp do modal
- [ ] `migration list` conferido; `db push` só com autorização explícita; issue de CONTRACT
      aberta em `tasks/`
