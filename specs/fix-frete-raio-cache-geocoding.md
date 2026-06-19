# Spec: Correção do Frete por Raio — Cache de Geocoding por CEP

**Versão:** 0.1.0 | **Atualizado:** 2026-06-19 | **Status:** ✅ IMPLEMENTADO (issue 001, verificado contra cloud 2026-06-19)

> Bugfix de runtime de frete. **Não inventa feature nova** — fecha um buraco já
> previsto como "v2" no spec `zonas-entrega-raio-km.md` (Fora do Escopo: "Cache de
> resultados de geocoding (CEP→coords)"). O frete por raio existe e está correto na
> função pura `calcularFrete`; o que quebra é a **canibalização da trava global de
> 1 req/s do Nominatim** quando o mesmo CEP é geocodificado várias vezes no mesmo
> segundo. Esta spec é acionável e **não contém código de implementação** — só a
> decisão arquitetural e os contratos.

---

## Opções consideradas (A / B / C)

O bug tem três caminhos de correção. A spec recomenda a **Opção A** e detalha
apenas ela; B e C ficam documentadas para registro da decisão.

### Opção A — Cache de geocoding por CEP no Redis (**RECOMENDADA**)

Cachear o resultado `CEP → {latitude, longitude}` no Upstash Redis (já em uso pelo
rate-limiter), com chave `irango:geocode:<digitos_cep>` e **sem TTL** (cache
permanente — CEP→coords é estável e quase nunca muda; geocodificar é caro porque é
limitado a 1 req/s, então maximizar o hit rate vale mais que expirar o dado).

- **Cache hit pula o rate-limiter E o Nominatim.** O mesmo CEP em re-renders do
  checkout, no preview (`frete.ts`) e no autoritativo (`pedido.ts`) é resolvido pelo
  cache na 1ª chamada — as seguintes não disputam o token de 1 req/s nem batem no
  Nominatim. A canibalização descrita na causa raiz desaparece.
- **Mantém a política anti-ban** (`seguranca.md` §12-A): a trava global de 1 req/s
  continua intacta e só é exercida para CEPs **nunca vistos** (cache miss).
- **Reduz drasticamente o volume real ao Nominatim** — o mesmo insumo do efeito
  "cache de geocoding (v2)" já antecipado em `zonas-entrega-raio-km.md` §Rate limit.
- **Custo:** zero novo. Reusa o Upstash já provisionado (`UPSTASH_REDIS_REST_*`),
  custo fixo do plano (`modelo-negocio.md` §6). Nenhuma dependência nova.
- **Opcional (não obrigatório na v1 do fix):** retry curto com espera para CEPs
  **distintos** em rajada (espaça as chamadas dentro de 1 req/s ao invés de
  derrubá-las). Fora do escopo deste fix — ver §Fora do Escopo.

### Opção B — Paliativo: alargar a janela do rate-limiter

Trocar `fixedWindow(1, "1 s")` por `fixedWindow(3, "1 s")` ou `slidingWindow`.

- **Prós:** destrava rápido, mudança de uma linha.
- **Contras (eliminatório como solução final):** **viola a política do Nominatim**
  (OSM/Nominatim Usage Policy: máx **1 req/s** por aplicação). 3 req/s expõe o IP de
  saída de produção a **ban**, que é exatamente o risco primário que `seguranca.md`
  §12-A foi escrito para evitar — indisponibilidade global do frete por raio para
  **todos** os lojistas. Só admissível como mitigação temporária com prazo, nunca como
  estado final.

### Opção C — Só diagnóstico, sem fix agora

Documentar a causa raiz e adiar a correção.

- **Prós:** custo zero imediato.
- **Contras:** o bug é **reproduzido e ativo** — frete por raio retorna
  "indisponível" para clientes legítimos em produção. Adiar mantém uma feature paga
  do lojista quebrada. Rejeitada.

### Decisão

**Opção A.** Resto da spec detalha A. Se o cache estiver indisponível, o sistema
degrada para **o caminho atual** (Opção A já contém o caminho de B/C como fallback
seguro, sem violar a política anti-ban) — ver §Regras de Negócio RN-F4.

---

## Visão Geral

**O que faz:** insere uma camada de cache CEP→coords no Redis, **acima** da trava
anti-ban do Nominatim, compartilhada por todos os consumidores de geocoding do CEP do
cliente. Elimina a canibalização da trava de 1 req/s que faz o frete por raio cair em
"Entrega indisponível para o seu bairro" mesmo com loja geocodificada, zonas certas e
CEP dentro do raio.

**Qual problema resolve (causa raiz reproduzida, 19 jun 2026):** no checkout, o ViaCEP
preenche campos em sequência e o React re-dispara `calcularFreteAction` várias vezes em
<1 s; além disso, preview (`frete.ts`) e autoritativo (`pedido.ts criarPedido`)
geocodificam o **mesmo CEP**. Cada request faz **duas** geocodificações
(`distanciaDaLojaAoCep` + a própria action), mas o `Ratelimit.fixedWindow(1, "1 s")`
**global e fail-closed** só deixa **uma** passar por segundo — a segunda recebe `null` →
`distanciaDaLojaAoCep` retorna `undefined` → `calcularFrete` não casa a zona `raio_km` →
indisponível. (Evidência: loja paodociso, CEP 12900-000 → 3.30 km → deveria dar R$7
"Centro expandido"; das duas geocodificações por request, só uma passava.)

**Em qual mundo vive:** runtime de frete compartilhado pelos **dois** mundos —
**vitrine pública** (preview no checkout, `frete.ts`; autoritativo no pedido,
`pedido.ts`) e **painel** (geocoding do endereço da loja no `salvarPerfil`, `loja.ts`).
**Nenhuma página, rota ou UI nova.** A correção é 100% invisível e server-side.

---

## Atores Envolvidos

| Ator | Papel nesta correção |
|------|---------------------|
| **iRango (SaaS)** | provê a camada de cache CEP→coords no Redis e mantém a política anti-ban 1 req/s para os misses; degrada com segurança quando o cache está fora |
| **Lojista** | nenhuma ação nova — passa a ter o frete por raio funcionando de forma confiável; o geocoding do endereço da loja (`salvarPerfil`) é **não cacheado** por CEP (ver RN-F6) |
| **Cliente** | nenhuma ação nova — informa o CEP como hoje; passa a receber o frete por raio correto no preview e a pagar o valor autoritativo do servidor |

---

## Páginas e Rotas

> Nenhuma rota nova e nenhuma mudança de UI. As páginas abaixo já existem (definidas
> em `zonas-entrega-raio-km.md`); listadas só para mapear os behaviors afetados e a
> fronteira cliente↔servidor de cada um. Behaviors marcados `[~]` = já existem, esta
> correção muda **a confiabilidade interna**, não o contrato visível.

### Checkout / Preview de frete — `/loja/[slug]/pedido`

**Mundo:** vitrine pública (sem auth)

**Descrição:** o cliente informa o CEP (via ViaCEP, como hoje). O preview de frete
(`calcularFreteAction`) e, na finalização, o cálculo autoritativo (`criarPedido`)
geocodificam o CEP no servidor. Com o cache, a 1ª geocodificação do CEP popula o Redis;
todas as repetições no mesmo fluxo (re-renders, preview→autoritativo) leem do cache sem
disputar a trava de 1 req/s.

**Componentes:** (todos existentes — reuso, sem componente novo)
- `Carrinho.tsx` / wizard de checkout — sem mudança; consomem o preview de
  `calcularFreteAction`
- `calcularFrete` (`lib/utils/calcularFrete.ts`) — **não muda**; função pura, fonte
  única do frete
- `calcularFreteAction` (`lib/actions/frete.ts`) — **não muda diretamente**; herda o
  cache via `distanciaDaLojaAoCep`
- `distanciaDaLojaAoCep` (`lib/actions/distanciaFrete.ts`) — **não muda
  diretamente**; herda o cache via `geocodificarEndereco`
- `geocodificarEndereco` (`lib/utils/geocodificarEndereco.ts`) — **único ponto de
  mudança de runtime**: consulta cache → miss → trava 1 req/s → Nominatim → grava cache
- `rateLimit.ts` / Upstash `Redis` — reuso do client e das credenciais
  `UPSTASH_REDIS_REST_*` já existentes

**Behaviors:**
- [~] Informar CEP no checkout — ação do cliente. Garantido em: cliente (UX, ViaCEP)
- [~] Ver preview de frete por raio (estimativa de UX) — agora **resolve por cache** em
  re-renders/repetições do mesmo CEP, sem cair em "indisponível" por canibalização da
  trava. Garantido em: **Server Action `calcularFreteAction`** (geocoding + haversine no
  servidor; cache só acelera, não muda o valor); cliente nunca envia `distanciaKm` nem
  `taxa`. **Preview de UX — nunca autoritativo.**
- [~] Finalizar pedido com frete por raio (valor cobrado) — frete recalculado do zero;
  o cache fornece as coords do CEP já vistas no preview, garantindo **paridade
  preview↔autoritativo** (RN-7 do spec base). Garantido em: **Server Action `criarPedido`
  + RPC `criar_pedido` + RLS** — valor autoritativo do servidor; `distanciaKm`,
  `taxa`, `total` do cliente são ignorados.

---

### Configurações › Perfil da Loja — `/painel/configuracoes/perfil`

**Mundo:** painel (auth obrigatório)

**Descrição:** o lojista salva o endereço completo da loja; `salvarPerfil` geocodifica
e persiste `latitude`/`longitude`. **Importante:** este geocoding usa uma `consulta` de
**endereço completo** (`montarConsultaGeocoding` → rua/número/bairro/cidade/UF), **não**
um CEP isolado. Por isso **não** compartilha o cache por CEP (ver RN-F6) — o resultado
deste caminho seria diferente de "CEP→coords" e contaminaria o cache do checkout.

**Componentes:** (existentes)
- `PerfilClient.tsx`, `salvarPerfil` (`lib/actions/loja.ts`), `geocodificarEndereco`
  (mesmo util) — sem mudança de contrato

**Behaviors:**
- [~] Salvar perfil com endereço (dispara geocoding server-side) — **não cacheado por
  CEP**: a consulta é endereço completo, não CEP. Garantido em: **Server Action
  `salvarPerfil`** + RLS (`auth.uid()=dono_id`); coords nunca vêm do cliente.

---

## Modelos de Dados

**Nenhuma migration. Nenhuma tabela nova. Nenhuma coluna nova.**

O cache vive **exclusivamente no Redis (Upstash)** — não no Postgres. Justificativa:

- É dado **derivado e descartável** (reconstruível a partir do Nominatim); não é fonte
  de verdade nem precisa de RLS de linha. Postgres seria over-engineering.
- Sem TTL: a gravação é um `SET` simples, sem expiração. Storage do Upstash (256 MB)
  comporta >1M de CEPs (~80 B cada); o gargalo real é comandos/mês, que o cache
  REDUZ (hit não chama o Nominatim). Não há job de limpeza.
- Reusa a infra Upstash já provisionada — custo fixo, zero variável
  (`modelo-negocio.md` §6).

### Contrato da chave de cache

| Propriedade | Valor |
|-------------|-------|
| **Namespace/chave** | `irango:geocode:<digitos_cep>` (8 dígitos, sem hífen/máscara) |
| **Valor** | JSON serializado `{ "latitude": number, "longitude": number }` (mesmo shape de `Coordenadas`) |
| **TTL** | **Nenhum** (cache permanente; CEP→coords é estável). Se um CEP raro mudar, deletar a chave individual |
| **Escopo** | **global ao SaaS** — CEP→coords independe de loja; não há PII de cliente na chave nem no valor |

- A chave usa o **prefixo `irango:geocode:`** — distinto de `irango:rl:nominatim`
  (trava) e de `irango:rl:<ip>` (rate-limit por IP). Sem colisão.
- `<digitos_cep>` = `cep.replace(/\D/g, "")` (mesma normalização já usada em
  `calcularFrete` para faixa de CEP) — garante que `01310-100` e `01310100` mapeiam pra
  mesma chave.

### Tabelas afetadas

Nenhuma. `zonas_entrega`, `taxas_entrega`, `bairros_zona`, `lojas`, `pedidos` —
inalteradas. `pedidos.endereco_entrega` continua persistindo `distanciaKm` no snapshot
como hoje (RN-9 do spec base), sem mudança.

---

## Regras de Negócio

| Regra | Camada que garante |
|-------|--------------------|
| **RN-F1** — Onde fica o cache: **dentro** de `geocodificarEndereco` (`lib/utils/geocodificarEndereco.ts`), acima do Portão 2 (trava 1 req/s) e do fetch ao Nominatim. **Não** numa camada por-CEP nova acima do util. | `geocodificarEndereco` (ponto único; todos os 4 consumidores herdam o cache sem mudança) |
| **RN-F2** — Chave `irango:geocode:<digitos_cep>`, valor `{latitude, longitude}`, **sem TTL** (cache permanente; `SET` simples). | `geocodificarEndereco` (escrita/leitura) |
| **RN-F3** — **Cache hit pula a trava E o Nominatim**: encontrou coords válidas → retorna sem tocar o limitador nem o fetch. Elimina a canibalização da trava de 1 req/s. | `geocodificarEndereco` (ordem dos portões: cache → trava → fetch) |
| **RN-F4** — **Cache fail-open** (degradação segura): cache indisponível, vazio, JSON corrompido ou exceção de leitura → **ignora o cache e segue o caminho atual** (Portão 0→3 + fetch). O cache **nunca** quebra o frete. | `geocodificarEndereco` (try/catch só ao redor do cache; falha de cache não propaga) |
| **RN-F5** — **A trava anti-ban permanece fail-closed e intacta** (`seguranca.md` §12-A): em cache **miss**, sem trava verificada (sem credenciais/Redis down/exceção) → `null`, sem chamar o Nominatim. O cache acelera os hits; **não** afrouxa a política dos misses. | `geocodificarEndereco` (Portões 0–3 inalterados após o cache) |
| **RN-F6** — **Escopo do cache = só geocoding de CEP do cliente.** O caminho `salvarPerfil` geocodifica **endereço completo** (não CEP) e **não** participa do cache por CEP — sua `consulta` não é um CEP, então não casa a chave `irango:geocode:<cep>` nem grava nela. | `geocodificarEndereco` (só cacheia quando a `consulta` é um CEP puro — ver RN-F7) |
| **RN-F7** — **Critério de cacheabilidade:** uma `consulta` é cacheável como CEP **somente** quando, normalizada (`\D` removido), resulta em exatamente **8 dígitos** e nada mais. Qualquer outra consulta (endereço livre da loja) passa direto, sem leitura nem escrita de cache. | `geocodificarEndereco` (guard de formato antes de montar a chave) |
| **RN-F8** — **Paridade preview↔autoritativo preservada** (`seguranca.md` §10, RN-7 do spec base): preview (`frete.ts`) e autoritativo (`pedido.ts`) chamam o **mesmo** `geocodificarEndereco` e, portanto, o **mesmo** cache. O autoritativo segue recalculando o frete do zero — o cache só fornece o **insumo** (coords), idêntico em ambos os lados. | `calcularFreteAction` + `criarPedido` (mesmo util, mesmo cache, recálculo autoritativo no servidor) |
| **RN-F9** — **Sem invalidação automática.** Cache permanente, sem TTL. Não há gatilho que invalide um CEP; CEP→coords não muda na prática. Se um CEP raro mudar de localização, a correção é deletar a chave `irango:geocode:<cep>` manualmente (operação pontual, não código). Um valor levemente desatualizado já é coberto pela limitação estrutural de granularidade do Nominatim documentada no spec base. | Operação manual (sem job de invalidação) |
| **RN-F10** — **Cache nunca guarda `null`/miss do Nominatim.** Só grava em sucesso (par numérico válido). Um Nominatim que falhou ou retornou vazio **não** vira cache negativo — senão um CEP geocodificável ficaria "envenenado" permanentemente (sem TTL para se auto-corrigir). | `geocodificarEndereco` (grava só no caminho de retorno `{latitude, longitude}`) |

### Fronteira cliente ↔ servidor (resumo monetário)

| Item | Tipo | Garantido em |
|------|------|--------------|
| `taxa_preview` no carrinho/checkout | **Preview de UX (cliente)** — estética, não vinculante | `calcularFreteAction` (recalcula do banco; cache só acelera) |
| `taxa_entrega` / `total` do pedido | **Valor autoritativo (servidor)** | `criarPedido` + RPC `criar_pedido` + RLS — recálculo do zero |
| `distanciaKm` (insumo do raio) | **Derivado 100% no servidor** | `distanciaDaLojaAoCep` → `geocodificarEndereco`; jamais vem do cliente |

O cache **não** altera nenhuma dessas fronteiras: ele só troca *de onde vêm as coords*
(Redis vs Nominatim), não *quem decide o valor* (sempre a Server Action a partir do
banco).

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai do cache?** Não há PII. A chave é um CEP (dado público,
  não identifica pessoa isoladamente) e o valor são coordenadas de um CEP (público).
  **Não** cachear nome, telefone, endereço completo do cliente, nem o par `(lat,lng)`
  associado a um indivíduo. (Coerente com `seguranca.md` §8 — proibição de hardcode de
  PII — e §21 — scrubbing de PII no log: não logar o par geocodificado do cliente.)
- **Valor monetário?** Sim — frete. **O recálculo autoritativo no servidor permanece
  obrigatório** (`seguranca.md` §10): `criarPedido` recalcula `taxa_entrega`/`total` do
  zero. O cache **não** é fonte de valor; é fonte do *insumo geográfico*. Nenhum valor
  monetário entra no cache. Adulterar o Redis poderia, no máximo, alterar a **distância**
  computada — mas isso já é mitigado por: (a) o lojista calibrar o raio com margem
  (spec base §granularidade); (b) o Redis ser server-only e não acessível ao cliente
  (`UPSTASH_REDIS_REST_*` sem prefixo `NEXT_PUBLIC_`, `import "server-only"`).
- **Tabela nova?** Não → **sem RLS nova**. O cache vive no Redis, fora do Postgres; a
  postura de RLS de `lojas`/`zonas_entrega`/`pedidos` é inalterada. As coords da loja
  continuam **fora** da view `vitrine_lojas` (lidas só via `service_role`, §19).
- **API externa com key?** Nominatim não usa key, mas exige **User-Agent identificado**
  (`NOMINATIM_USER_AGENT`, sem prefixo público) e **política anti-ban 1 req/s** — ambos
  **preservados** (RN-F5). O Upstash (`UPSTASH_REDIS_REST_*`) permanece server-only.
  Nenhuma credencial nova.
- **Política anti-ban não pode ser afrouxada:** o cache **adia** o esgotamento da trava
  (menos misses), mas a trava continua governando 100% das chamadas que saem ao
  Nominatim. Não há caminho em que um cache miss chame o Nominatim sem passar pela trava
  fail-closed.

---

## Fora do Escopo (v1 do fix)

- **Cache negativo (miss do Nominatim)** — não cachear falhas (RN-F10 proíbe). Fora de
  escopo por design.
- **Retry com espera para CEPs distintos em rajada** (espaçar chamadas dentro de 1 req/s
  em vez de derrubá-las) — a Opção A já resolve a canibalização do **mesmo** CEP via
  cache; o retry só ajudaria CEPs **distintos** simultâneos, caso raro. Candidato a
  iteração futura.
- **Invalidação automática / por-CEP** — cache permanente sem TTL; correção de um CEP é deleção manual da chave (RN-F9).
- **Cache do geocoding de endereço completo da loja** (`salvarPerfil`) — fora de escopo:
  consulta de endereço completo, baixa frequência, não cacheável por CEP (RN-F6).
- **Migração para provedor de geocoding pago** (Google/Mapbox) ou **cálculo de rota
  real** (OSRM) — já listados como fora de escopo no spec base; inalterados.
- **Pré-aquecimento do cache** (warm-up de CEPs frequentes) — não necessário na escala
  projetada.
- **Alargar a janela do rate-limiter (Opção B)** — rejeitada por violar a política do
  Nominatim; não será implementada nem como flag.

---

## Próximos passos

Quebrar em issues com `/break` passando este spec.

Issue crítica prevista (TDD red-first — toca runtime de **valor monetário** via insumo
de frete):
- `geocodificarEndereco.ts`: camada de cache CEP→coords (cache→trava→fetch→grava),
  fail-open de cache + fail-closed de trava preservado, cacheabilidade só para CEP de 8
  dígitos, sem cache negativo, paridade preview↔autoritativo.
