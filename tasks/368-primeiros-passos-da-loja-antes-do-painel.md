# [368] Assistente de primeiros passos antes do painel + gate único de publicação (incorpora 193)

**crítica:** SIM — autorização do painel + gate único de publicação (lojista e admin, escopo por loja_id) + Server Action nova com API externa
**Incorpora:** 193 — as opções em aberto da 193 estão decididas em D12–D17; ignore as listas de opções de lá
**Mundo:** painel do lojista + hub admin (gate de publicação)
**Plano de execução:** `plan/loop-368-primeiros-passos-da-loja.md`

## Pedido (literal)

> lojista cria nova loja, ele não deve ser direcionado para /painel enquanto loja não for publicada. enquanto loja não for publicada, ele deve ser direcionado para um wizard que o ajude a configurar o perfil da loja, os horários, as formas de entrega e de pagamento, os primeiros produtos e opcionais para então a loja ser publicada. lojista só deve ir para painel após login quando loja já estiver publicada.

## Resposta do usuário à 1ª versão do plano (literal)

> 1. A task 193 entra nesta entrega (`tasks/193-endereco-obrigatorio-e-gate-de-publicacao.md`). Ela sai de `tasks/` no mesmo PR, junto com a 368.
> 2. Mesmo gate em todos os caminhos. Publicar pelo lojista, republicar depois de pausar e publicar pelo hub admin (`src/app/admin/assinantes/actions/admin-perfil.ts` e/ou `admin-publicar`) passam por um gate único em `podePublicarLoja`, com o mínimo: nome, WhatsApp, ≥1 produto, ≥1 forma de pagamento, endereço completo e coordenada gravada. O admin não pode forçar.
> 3. Endereço completo obrigatório para publicar: CEP, rua, número, bairro, cidade e UF. Complemento é opcional. O zod do perfil (`src/lib/validacoes/loja.ts`) marca os mesmos campos. A coordenada não entra no zod: é derivada no servidor. A mensagem de erro distingue "falta preencher o endereço" de "não conseguimos localizar seu endereço agora, tente em instantes".
> 4. 193 item 5 (loja publicada que perde a coordenada): a loja segue no ar. O painel mostra um aviso persistente com o botão "Localizar meu endereço de novo". Esse botão é também o caminho de recuperação exigido pelo aceite da 193 (loja sem coords cujo endereço não mudou e que não regeocodifica pela 180-A). O checkout já degrada pela 180-B (mesclada no PR #128).
> 5. Versão completa, sem corte.

## Leitura do cloud (P1, só leitura, 2026-11-16)

- lojas no total: 11 · `ativo=true`: 9
- `ativo=true` com endereço incompleto (algum dos 6 campos vazio): 4
- `ativo=true` com endereço completo e sem par `latitude`/`longitude`: 2
- "Pão do Ciso": ativa, endereço completo, com par
- "Lanches base": ativa, endereço completo, sem par
- Gatilho de pausa do D16 (>10 com endereço completo e sem par, ou "Pão do Ciso" incompleta/sem par): não disparou.
- Consequência: 4 lojas ativas sem endereço completo e 2 sem par entram no ar com o aviso D15, sem backfill.

## Decisões (fixas; divergência de qualquer agente → `ok:false` com motivo)

- **D1.** Roteamento usa "já publicada ao menos uma vez" = `lojas.primeira_publicacao_em IS NOT NULL`, nunca `ativo` atual. Despublicar não devolve ao assistente.
- **D2.** Backfill do marcador: preenche em toda loja com `ativo = true` OU com ≥1 linha em `pedidos`. Demais ficam nulas e caem no assistente no próximo acesso.
- **D3.** Marcador gravado só pelo banco (trigger BEFORE INSERT/UPDATE em `lojas`) quando `ativo` vira/nasce `true`. Write-once: nenhum papel de aplicação (`authenticated`, `service_role`) altera ou limpa depois de preenchido.
- **D4.** Assistente em `/painel/primeiros-passos/*`, FORA de `(bloqueavel)/` (isenção posicional, igual a `assinatura-bloqueada/`). Gate novo vive em `(bloqueavel)/layout.tsx`. `decidirAcessoBase` NÃO muda. Layout do painel troca o chrome (sem `SidebarPainel`) para loja não concluída.
- **D5.** Assistente não aplica `decidirAssinatura`; `assinatura-bloqueada/` e `configuracoes/assinatura/` seguem alcançáveis.
- **D6.** Etapas: perfil → horários → entregas → pagamentos → produtos → opcionais (pode pular) → revisar e publicar. Navegação livre; retomada abre a primeira etapa com pendência.
- **D7.** Gate único de publicação em `podePublicarLoja` (`src/lib/utils/publicacao.ts`), revalidado no servidor a partir do banco: nome + WhatsApp + CEP, rua, número, bairro, cidade e UF preenchidos + par `latitude`/`longitude` gravado + ≥1 produto disponível + ≥1 forma de pagamento. Contagens com `eq("loja_id")` explícito. Caminhos: `definirPublicacao` (lojista, inclusive republicar depois de pausar) e `publicarLojaAdmin` (admin, sem exceção). Despublicar nunca passa pelo gate.
- **D8.** Botão publicar só na última etapa do assistente; no painel, segue onde está hoje (perfil).
- **D9.** Após publicar pelo assistente: `/painel` com o layout pai re-renderizado (chrome completo).
- **D10.** Mensagens do gate, cada uma com verbo no imperativo e nunca começando com "Sem…"/"Caso não…": (a) falta preencher endereço → lista os campos que faltam; (b) endereço completo sem coordenada → manda tocar em "Localizar meu endereço de novo" e tentar em instantes, sem pedir para corrigir o endereço; (c) perfil, (d) produto, (e) pagamento: uma cada. A causa exata da falha de localização vem do botão, por `avisoGeocodingPerfil(motivo)`, que já separa falha nossa de dado errado.
- **D11.** Nenhum ponto de login/callback muda.
- **D12.** Endereço exigido só a partir do perfil: `schemaPerfil` torna os 6 campos obrigatórios; `FormNovaLoja.tsx`, `schemaNovaLojaAdmin` e o cadastro do lojista não mudam. Consequência aceita: qualquer save de perfil (assistente, painel e hub admin) passa a exigir o endereço completo.
- **D13.** Com o endereço obrigatório no zod, payload sem endereço é recusado na validação, antes do geocoding: o modal "não localizamos seu endereço" deixa de aparecer para quem nunca preencheu (aceite da 193). Remover ou manter o ramo morto "sem motivo" de `avisoGeocodingPerfil` é decisão do P2.
- **D14.** Botão "Localizar meu endereço de novo" = Server Action nova do lojista em `src/lib/actions/loja.ts`. Só age se o endereço está completo e falta o par. Reusa `montarConsultaGeocoding`, `temCoordenadas` e `geocodificarLojaComRetry` (balde por loja). Rate limit com chave nova em `LIMITES`. Grava só o par, com o client autenticado e `eq("id")` da loja do dono. Se falhar, não grava nada e devolve `motivo`. Revalida o layout do painel para o aviso sumir.
- **D15.** Aviso persistente no layout do painel, em toda página, para loja já publicada alguma vez (D1) que esteja sem endereço completo ou sem par: (a) endereço incompleto → link para completar o perfil; (b) completo sem par → botão D14. A loja segue no ar; nenhum código despublica. Hub admin não ganha botão: o admin recupera salvando o perfil (regra 3 de `deveRegeocodificar`).
- **D16.** Lojas já publicadas sem endereço completo ou sem par: contagem só por leitura (números acima). Continuam no ar e recebem o aviso D15. Sem backfill de geocoding em lote.
- **D17.** Débito 140 (PATCH direto em `ativo` pelo dono) fica ABERTO nesta entrega: fechá-lo por trigger copiaria as 11 condições de D7 em SQL, criando segunda fonte contra o "gate único em `podePublicarLoja`". O bypass exige o JWT do próprio dono sobre a própria loja (auto-dano). O PATCH direto também preenche o marcador e pula o assistente: mesma classe, mesmo registro. O P10 registra o 140 em `architecture.md` §10 com o gate novo. Fechar no futuro: função SQL única de prontidão, chamada pelo trigger e por `podePublicarLoja`, em issue própria.

## Critério de aceite

1. Prova por fatia: coluna "prova" da tabela "Risco por fatia" do plano `plan/loop-368-primeiros-passos-da-loja.md` (marcador/trigger/backfill, decisão + gate posicional, gate único de publicação, endereço obrigatório no perfil, Server Action D14, aviso D15, etapas sem via de escrita própria, chrome por estado).
2. Aceites da 193:
   - [ ] Publicar loja sem o endereço mínimo é recusado no servidor, com mensagem que diz quais campos faltam.
   - [ ] Publicar loja com endereço preenchido mas sem coordenada é recusado, com mensagem que distingue falha do serviço de dado errado do lojista.
   - [ ] Existe caminho de recuperação para loja sem coords cujo endereço não mudou (botão D14).
   - [ ] O schema zod do perfil exige os mesmos campos, e o form marca-os como obrigatórios.
   - [ ] Loja já publicada sem endereço tem comportamento definido e documentado (aviso D15).
   - [ ] Teste do gate cobrindo: sem endereço → recusa; endereço mínimo → publica; nome/WhatsApp ausentes seguem recusando.
   - [ ] O modal de aviso de geocoding não aparece mais por ausência de endereço, só por falha do serviço ou endereço não localizável.
3. Checklist de clique (usuário):
   1. criar conta nova de lojista (e-mail de teste próprio), confirmar, entrar → assistente, sem menu lateral
   2. digitar `/painel/pedidos` → volta ao assistente; `/painel/configuracoes/assinatura` → abre
   3. etapa de perfil: salvar sem endereço → campos marcados como obrigatórios, sem o modal "não localizamos seu endereço"
   4. última etapa com algo faltando (endereço, localização, produto ou pagamento) → publicar desabilitado com a mensagem certa; corrigir → habilita
   5. pular opcionais → segue para revisar
   6. publicar → `/painel` com menu completo
   7. despublicar no painel → sair → entrar → continua no painel
   8. entrar como "Pão do Ciso" → painel direto; se aparecer o aviso de endereço, só anotar, não alterar
   9. hub admin: publicar a loja de teste nova sem produto ou sem endereço → recusa com a mensagem
   10. aviso persistente: vale o teste automatizado; opcional: "Lanches base" com endereço que o mapa não encontre, tocar em "Localizar meu endereço de novo"
4. Gates: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes; migration com Remote preenchido (`npx supabase migration list`); `gh pr checks <n>` verde.

## Arquivos

criar: migration `supabase/migrations/20261101xxxxxx_lojas_primeira_publicacao.sql` · `tests/migrations/lojas_primeira_publicacao.test.ts` · `src/app/(painel)/painel/primeiros-passos/` (layout, páginas das etapas, `layout.guard.test.tsx`) · componente do aviso D15 em `src/components/painel/` · `mockups/primeiros-passos-da-loja.html` + `.md`

modificar: `src/lib/utils/acessoPainel.ts` · `(bloqueavel)/layout.tsx` · `painel/layout.tsx` · `route-group.guard.test.ts` · `src/lib/utils/publicacao.ts` · `src/lib/actions/loja.ts` · `src/app/admin/assinantes/actions/admin-publicar.ts` · `src/lib/actions/admin-loja.ts` (`CAMPOS_LOJA_SOMENTE_SERVIDOR`) · `src/lib/validacoes/loja.ts` · `src/lib/utils/rateLimit.ts` · `PerfilClient.tsx` e `PerfilAdminClient.tsx` · `src/lib/database.types.ts` · fixtures de teste (`manifestPainel.test.ts`, `manifest.webmanifest/route.test.ts`, guards, payloads de perfil) · `references/architecture.md` §3, §5, §6, §10 · `references/schema.md` §`lojas` · `references/seguranca.md` §4, §17

higiene no fim: `git rm` desta issue e da 193; `git mv` dos dois `plan/loop-368-*` para `plan/arquivo/`.

## Plano técnico

> Gravado pelo P2 (`arquitetar`, 2026-11-16). D1–D17 não foram reabertas. Tudo abaixo é nome fixo: P3–P7 não decidem nome, caminho nem texto, salvo onde está escrito "P4 pode polir".

### Diagnóstico

**Causa raiz:** "pronta para ir ao ar" não tem fonte única. Hoje há três cópias de um predicado raso (nome + WhatsApp): `loja.ts:155,184` (inline, com constante duplicada), `publicacao.ts:8` (admin e preview) e o texto fixo do `PerfilClient` ("Preencha nome e WhatsApp…"). Nenhuma olha endereço, coordenada, produto ou pagamento. O roteamento pós-login usa a existência da loja (`decidirAcessoBase`) e nunca o estado de publicação. Resultado: loja nasce, cai no painel inteiro e pode ir ao ar sem como receber pedido. E `schemaPerfil` aceita perfil sem endereço, então o geocoding devolve `geocodificado:false` sem motivo e o modal culpa o lojista por um dado que ele nunca digitou.

**Por que é complexo:** mexe no guard de autorização das rotas do painel (risco de ciclo de redirect), muda o contrato de `podePublicarLoja` (lojista, admin e preview de duas telas), muda `schemaPerfil` (afeta painel e admin, que deriva as chaves do `shape`), cria coluna com trigger write-once e backfill em tabela populada, e cria Server Action com API externa de custo.

### Achados que mudam o plano de execução

1. **O ramo "sem motivo" de `avisoGeocodingPerfil` não está morto.** `salvarPerfilAdmin` nunca devolve `motivo` (`admin-perfil.ts:39-41`), e o `PerfilAdminClient` reusa o `PerfilClient`, que cai em `?? "nao_encontrado"` (`PerfilClient.tsx:256`). Toda falha de geocoding pela via admin, inclusive a nossa (`transitorio`, `throttle_interno`), mostra "confira rua, número e CEP". Decisão D13 abaixo.
2. **Os textos de `avisoGeocodingPerfil` falam "tente salvar novamente" e "seu endereço foi salvo".** Mostrados depois do botão D14, que não salva nada, ficam falsos. Decisão abaixo (parâmetro `acao`).
3. **Layout pai não re-renderiza em navegação** (`node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md:43`). `router.push("/painel")` depois de publicar manteria o chrome mínimo. Precisa de `revalidatePath("/painel", "layout")` na Server Action (D9, D14).
4. **Preview de publicação precisa de contagens** (produto, pagamento). O preview do admin exige loader novo em `carga.ts`, porque a page admin não pode criar `service_role` (`enforcement-escopo-admin.test.ts`).
5. Arquivos a mais em relação ao plano: `src/lib/supabase/queries/publicacao.ts`, `src/lib/utils/primeirosPassos.ts`, `src/components/painel/{CartaoPublicacao,BotaoLocalizarEndereco,AvisoEnderecoLoja,ChromeAssistente}.tsx`, `perfil/perfilInicial.ts`, `entregas/EntregasConteudo.tsx`, `admin/assinantes/[lojaId]/carga.ts`, `admin-perfil.ts`, `avisoGeocoding.ts`, `NavPainel.tsx` (só `export`), page admin de perfil. Nenhum muda decisão.
6. Fora do escopo, só registro: `revalidarVitrine` (`loja.ts:51-58`) revalida `/${slug}`, mas a vitrine é `/loja/[slug]`: é no-op desde sempre. Não corrigir aqui (muda o cache de `salvarPerfil`/`salvarHorarios`/`salvarTema`). Vira issue nova no P12.

### Mapa de Impacto

```
LOGIN (não muda, D11) → /painel
painel/layout.tsx ── decidirAcessoBase (não muda)
   └─ "ok" → decidirPrimeirosPassos(loja)            [acessoPainel.ts — puro]
        ├─ "primeiros-passos" → <ChromeAssistente>   (logo, nome, Sair; sem Sidebar)
        └─ "concluido"        → Sidebar+Topbar + varianteAvisoEndereco(loja) → <AvisoEnderecoLoja> (D15)
(bloqueavel)/layout.tsx
   ├─ decidirPrimeirosPassos === "primeiros-passos" → redirect /painel/primeiros-passos   (ANTES do paywall)
   └─ decidirAssinatura (não muda)
primeiros-passos/layout.tsx + cada page → exigirAssistente() [guard.ts, cache()]
   ├─ "concluido" → redirect /painel
   └─ carregarProntidaoPublicacao(supabase, loja) → pendenciasPublicacao → ProgressoAssistente
primeiros-passos/page.tsx → redirect rotaDaEtapa(etapaDeRetomada(pendencias))
etapas → telas existentes (pages/loaders reusados) → Server Actions existentes → router.refresh() já presente nos clients
revisar → <CartaoPublicacao> → definirPublicacao(true) ─┐
painel perfil → <CartaoPublicacao> → definirPublicacao ─┼→ carregarProntidaoPublicacao(client autenticado, loja) → podePublicarLoja
admin perfil  → <CartaoPublicacao> → publicarLojaAdmin ─┘     (svc, eq loja_id)  → produtos / formas_pagamento
     └ todas gravam lojas.ativo → TRIGGER lojas_marca_primeira_publicacao → primeira_publicacao_em (write-once)
<BotaoLocalizarEndereco> (revisar + aviso D15) → localizarEnderecoDeNovo() → montarConsultaGeocoding → geocodificarLojaComRetry(consulta, loja.id) → UPDATE {latitude, longitude}
salvarPerfil / salvarPerfilAdmin → schemaPerfil (6 campos obrigatórios) → recusa antes do geocoding
```

Onde cada invariante é garantida:

```
Marcador primeira_publicacao_em
  ├── trigger BEFORE INSERT/UPDATE em lojas — AUTORITATIVO (ignora o valor que o escritor manda, inclusive service_role)
  └── CAMPOS_LOJA_SOMENTE_SERVIDOR + .strict() de schemaPerfil — defesa em profundidade
Prontidão para publicar (D7)
  ├── CartaoPublicacao (botão desabilitado + texto) — [cliente, só UX]
  ├── podePublicarLoja(estado) em lib/utils/publicacao.ts — fonte única da regra
  ├── carregarProntidaoPublicacao — fonte única das contagens, eq("loja_id") explícito
  ├── definirPublicacao / publicarLojaAdmin — AUTORITATIVO (relê do banco, ignora qualquer preview)
  └── PATCH direto do dono em `ativo` — NÃO coberto (débito 140, D17)
Endereço completo no perfil (D12)
  ├── required nos inputs do PerfilClient — [cliente, só UX]
  └── schemaPerfil no servidor (salvarPerfil, salvarPerfilAdmin) — AUTORITATIVO
Coordenada (D14)
  └── só o servidor deriva (localizarEnderecoDeNovo, salvarPerfil*). Cliente recebe só variante/booleano (seguranca.md §19)
Acesso ao painel antes da 1ª publicação (D4)
  └── (bloqueavel)/layout.tsx — posicional; assistente fora do grupo
```

### Análise do Codebase

| Arquivo | Papel atual | O que muda |
|---|---|---|
| `src/lib/utils/acessoPainel.ts` | `decidirAcessoBase`, `decidirAssinatura` | + `decidirPrimeirosPassos`, `DecisaoPrimeirosPassos` |
| `(bloqueavel)/layout.tsx` | gate de assinatura | gate do assistente antes do de assinatura |
| `painel/layout.tsx` | guard base + chrome | ramo "ok" escolhe chrome por estado; aviso D15 |
| `src/lib/utils/publicacao.ts` | `podePublicarLoja(nome, whatsapp)` | gate D7, pendências, textos D10, campos de endereço, predicado D15 |
| `src/lib/actions/loja.ts` | `salvarPerfil`, `definirPublicacao` (gate inline :155,:184) | gate único; `revalidatePath("/painel","layout")`; + `localizarEnderecoDeNovo` |
| `admin-publicar.ts` | gate nome+WhatsApp | gate único com contagens sob `svc` |
| `admin-perfil.ts` | devolve `geocodificado` sem motivo | devolve `motivo` (paridade) |
| `src/lib/validacoes/loja.ts` | endereço `.optional()` | 6 campos obrigatórios |
| `perfil/PerfilClient.tsx` | form + cartão de publicação | perde o cartão (vira slot `topo`); 6 inputs `required` |
| `perfil/avisoGeocoding.ts` | texto por motivo, aceita `undefined` | sem `undefined`; parâmetro `acao` |
| `perfil/montarPayloadPerfil.ts` | comentário diz "schema os trata como opcionais" | só o comentário |
| `admin/.../perfil/{page,PerfilAdminClient}.tsx` | preview nome+WhatsApp | `bloqueio` via loader admin; `topo` com `CartaoPublicacao` |
| `entregas/page.tsx` | loader + `hrefPerfil` fixo | vira casca de `EntregasConteudo` |
| `NavPainel.tsx` | `BotaoLogout` interno | `export function BotaoLogout({ className })` |

### Decisões de Design

**DD1 — Onde mora a lista de campos de endereço e `temCoordenadas`.**
(a) Mover `temCoordenadas` para `lib/utils` e reexportar de `patches-loja.ts`: dois caminhos de import para a mesma função, churn em 2 importadores e no teste. (b) Manter `temCoordenadas` em `src/lib/actions/patches-loja.ts:144` (módulo neutro, puro, sem `"use server"`, já documentado como importável por painel e admin) e criar a lista em `publicacao.ts`. **Escolhida: (b).** `CAMPOS_ENDERECO_LOJA` e `camposEnderecoFaltando` vivem em `src/lib/utils/publicacao.ts` e são a lista usada por gate, aviso D15, retomada e action D14. O zod não importa a lista (as chaves do `z.object` são literais); a paridade é travada por teste (`publicacao.test.ts`, "paridade com schemaPerfil") que afirma: as 6 chaves `endereco_*` de `schemaPerfil.shape` são exatamente `CAMPOS_ENDERECO_LOJA`, e `schemaPerfil.shape[k].safeParse(undefined).success === false` para cada uma. Segunda paridade: endereço completo implica `montarConsultaGeocoding(...) !== null`.

**DD2 — Forma do gate.**
(a) Manter `podePublicarLoja(nome, whatsapp): boolean` e somar parâmetros: 11 posicionais, sem motivo. (b) Gate que faz I/O: mistura regra com banco e impede o preview puro. (c) Função pura sobre um estado já carregado + loader de contagem separado. **Escolhida: (c).** Regra pura em `publicacao.ts`; I/O único em `src/lib/supabase/queries/publicacao.ts`, chamado pelos dois caminhos com o client de cada um.

**DD3 — Contagem: `count/head` em vez de `buscarProdutosDoLojista`/`listarFormasPagamento`.** O gate roda no publicar e no preview de três telas (perfil do painel, perfil admin, revisar) e no layout do assistente. Carregar o catálogo com `categorias(*)` só para contar é desperdício e não filtra `disponivel`/`oculto`. `select("id", { count: "exact", head: true })` com `eq("loja_id")` explícito. `count` nulo conta como 0 (fail-closed: recusa publicar).

**DD4 — "Produto disponível"** = `disponivel = true AND oculto = false`. A frequência de exibição (`dias_semana`, `hora_*`, `periodo_*`) não entra: é avaliada em TS na vitrine e depende do relógio. Borda aceita: produto com `dias_semana = '{}'` conta como disponível. Registrar na `## UX` só se o P4 quiser texto.

**DD5 — Reuso das telas nas etapas.**
(a) Renderizar a page default do painel dentro da etapa. (b) Extrair loader compartilhado de cada page. (c) Copiar as pages. **Escolhida: (a) onde a page não tem nada específico do painel, (b) onde tem.** Horários, pagamentos, produtos e opcionais: a etapa importa e renderiza a page default (`import HorariosPage from "@/app/(painel)/painel/(bloqueavel)/configuracoes/horarios/page"`) dentro de `<EtapaAssistente>`; nenhum loader duplicado. O gate do `(bloqueavel)/layout.tsx` não roda porque o layout é por rota, não por import, e isso é D5. Links internos dessas telas que apontam para `(bloqueavel)` (ex.: `hrefCardapios`) levam de volta ao assistente pela retomada, sem ciclo. Entregas: `hrefPerfil` fixo em `/painel/configuracoes/perfil` → extrair `entregas/EntregasConteudo.tsx` (Server Component async, prop obrigatória `hrefPerfil: string`, corpo = o atual da page); a page vira `<EntregasConteudo hrefPerfil="/painel/configuracoes/perfil" />` e a etapa usa `"/painel/primeiros-passos/perfil"`. Perfil: o mapeamento loja → `PerfilInicial` (12 campos, hoje copiado na page do painel e na do admin) sai para `perfil/perfilInicial.ts` → `perfilInicialDaLoja(loja: LojaCompleta): PerfilInicial`, usado pelas três.

**DD6 — Publicar só na última etapa sem afrouxar o `PerfilClient` (issue 160).**
(a) Tornar `onDefinirPublicacao` opcional: afrouxa exatamente o que a 160 fechou. (b) Flag `exibirPublicacao`: dois fluxos por flag, e a etapa ainda passaria uma action que não usa. (c) Extrair o cartão. **Escolhida: (c).** Novo `src/components/painel/CartaoPublicacao.tsx` (`"use client"`) recebe o JSX do cartão e a função `alternarPublicacao` que hoje estão em `PerfilClient.tsx:158-170,282-315`. Props, todas obrigatórias: `publicado: boolean`, `bloqueio: string | null` (texto D10 da 1ª pendência; `null` = pode publicar), `onDefinirPublicacao: typeof definirPublicacao`, `destinoAposPublicar: string | null`. O `PerfilClient` perde `publicado`, `podePublicar` e `onDefinirPublicacao` e ganha a prop obrigatória `topo: ReactNode`, renderizada no lugar do cartão (entre o `h1` e o form). Painel e admin passam `<CartaoPublicacao …/>`; a etapa perfil passa `topo={null}` de forma explícita. Nenhuma action vira opcional. O texto "Preencha nome e WhatsApp e salve antes de publicar." some: no lugar entra `bloqueio`. Após sucesso: `destinoAposPublicar` não nulo → `router.replace(destino)`; nulo → `router.refresh()` (comportamento de hoje).

**DD7 — Marcar obrigatórios nos dois clients de perfil.** O `PerfilAdminClient` só embrulha o `PerfilClient`, então uma mudança cobre os dois: atributo nativo `required` nos 6 inputs (`perfil-endereco-cep` é `IMaskInput`, aceita `required`). O subtítulo da seção passa a dizer que o endereço é obrigatório para publicar (texto: P4 pode polir; o teste afirma só o `required`). A validação nativa do form segura o submit antes do `safeParse`; o `safeParse` cliente e o servidor seguem. Telefone e WhatsApp não mudam (`required` só no endereço; o WhatsApp é cobrado no gate, não no zod).

**DD8 — Destino do ramo "sem motivo" (D13).** (a) Manter: deixa a via admin culpando o lojista por falha nossa (achado 1). (b) Remover. **Escolhida: (b), com paridade.** `avisoGeocodingPerfil(motivo: MotivoGeocoding, acao?)`: sai `undefined` do tipo e o comentário "caso sem motivo (compatibilidade…)". `salvarPerfilAdmin` passa a devolver `motivo` igual a `salvarPerfil` (o tipo local `ResultadoPerfilAdmin` ganha `motivo?: MotivoGeocoding`; o geocoding já devolve). No `PerfilClient`, o fallback `?? "nao_encontrado"` vira `?? "transitorio"`: sem motivo, nunca culpar o dado do lojista. Depois de D12 o fallback é inalcançável pela via do lojista (consulta nunca é nula, e o atalho de `deveRegeocodificar` só pula com par gravado); fica como defesa.

**DD9 — Texto do botão D14.** `avisoGeocodingPerfil(motivo, acao: "salvar" | "localizar" = "salvar")`. Implementação: classificação interna `classeDaFalha(motivo)` → `"instantes" | "rajada" | "config" | "esgotado" | "endereco"` e uma tabela `Record<AcaoGeocoding, Record<ClasseFalha, string>>` (exaustiva por tipo). Os 5 textos de `"salvar"` ficam idênticos aos de hoje. Textos de `"localizar"` (P4 pode polir, mantendo verbo no imperativo e as invariantes testadas):
- instantes: "Tente de novo em instantes: o mapa não respondeu agora."
- rajada: "Tente de novo em instantes: muitas consultas ao mapa ao mesmo tempo por aqui."
- config: "Tente de novo mais tarde: nosso serviço de mapas está com um problema de configuração e nossa equipe já foi avisada."
- esgotado: "Tente de novo mais tarde: o serviço de mapas está indisponível no momento."
- endereco: "Confira rua, número e CEP no perfil: o mapa não encontrou esse endereço."

**DD10 — Refresh e re-render (conferido em `node_modules/next/dist/docs/`, Next 16.3.6).**
- Etapas: todos os clients reusados já chamam `router.refresh()` depois da action (`HorariosClient`, `PagamentosClient`, `FormPagamento`, `ModalidadesEntrega`, `pecasEntrega`, `ProdutosClient` via `ProvedorRefreshCoalescido`, `OpcionaisClient`, `PerfilClient`). `router.refresh()` "re-renders Server Components" da rota atual, layouts incluídos (`use-router.md:46`), então o progresso no `primeiros-passos/layout.tsx` se atualiza. Não depender do `revalidatePath` das actions: `produto.ts`/`opcional.ts` revalidam `/painel/cardapio`, rota inexistente (débito já registrado em `architecture.md` §10). Nenhuma action existente muda.
- Navegação entre etapas: o layout não re-renderiza (`03-layouts-and-pages.md:43`), por isso `exigirAssistente()` roda também em cada page (padrão `minha-conta/guard.ts`) e cada page de etapa lê o próprio dado.
- D9: `definirPublicacao`, depois do UPDATE com sucesso, chama `revalidatePath("/painel", "layout")` (best-effort em try/catch, como `revalidarVitrine`). Em Server Function isso atualiza a UI na hora e invalida o layout e tudo abaixo (`revalidatePath.md`, "Layouts"). O `CartaoPublicacao` da etapa revisar faz `router.replace("/painel")`. As duas ordens terminam em `/painel` com chrome completo: se o re-render chegar antes, o guard do assistente redireciona para `/painel`. `publicarLojaAdmin` não precisa: o lojista renderiza do zero no próximo request.
- D14: `localizarEnderecoDeNovo` chama o mesmo `revalidatePath("/painel", "layout")` em sucesso; `BotaoLocalizarEndereco` também chama `router.refresh()`.
- Helper único em `loja.ts`: `function revalidarPainel(): void` (try/catch + `console.error("revalidarPainel:", e)`), não exportado.

**DD11 — Trigger write-once: sobrescrever em silêncio × lançar.** (a) Lançar exceção em escrita na coluna: quebra qualquer UPDATE que reenvie a linha inteira, e o PATCH do dono teria que ser negado por `current_user`. (b) O trigger calcula o valor e ignora o que vier. **Escolhida: (b).** `INSERT`: `new.primeira_publicacao_em := case when new.ativo then now() else null end`. `UPDATE`: `new.primeira_publicacao_em := coalesce(old.primeira_publicacao_em, case when new.ativo then now() else null end)`. Vale para todo papel, sem bypass (D3). Teste afirma "valor intacto", não SQLSTATE.

**DD12 — Chave de rate limit do D14.** Identificador `loja.id` (precisa ler a loja antes, uma query barata; sem sessão `buscarLojaDoDono` devolve `null` e nada geocodifica). `localizarEndereco: { limite: 5, janela: "1 m" }`. O custo real é contido pelo teto diário global do geocoder (500/dia, `geocodificarEndereco.ts:100`) e pelo balde de burst por loja. Mesma classe do que já existe: `salvarPerfil` com endereço inalterado e sem par regeocodifica a 10/min por IP (regra 3).

**DD13 — Corrida do D14 com `salvarPerfil`.** O geocoding leva segundos (retry de 1,1 s). Se o lojista salvar endereço novo nesse meio, gravar o par do endereço velho deixaria o pino no lugar errado. UPDATE com compare-and-set: `.update({ latitude, longitude }, { count: "exact" }).eq("id", loja.id).is("latitude", null).eq("endereco_rua", loja.endereco_rua).eq("endereco_numero", …).eq("endereco_bairro", …).eq("endereco_cidade", …).eq("endereco_estado", …)` (os 5 campos da consulta; o CEP não entra na consulta, issue 186). `count === 0` → `{ ok: true }` sem gravar (outro save já tratou), e revalida.

**DD14 — Precedência no `(bloqueavel)/layout.tsx`.** Assistente antes do paywall: loja nunca publicada e com assinatura bloqueada vai para `/painel/primeiros-passos`, que não aplica `decidirAssinatura` (D5). `assinatura-bloqueada/` segue alcançável por URL direta.

### Nomes fixos

**Migration** `supabase/migrations/20261116120000_lojas_primeira_publicacao.sql`, nesta ordem (o backfill precisa rodar ANTES do trigger, senão o trigger zera as lojas `ativo=false` com pedido):
1. `alter table public.lojas add column primeira_publicacao_em timestamptz;` + `comment on column`.
2. Backfill D2: `update public.lojas l set primeira_publicacao_em = now() where l.ativo = true or exists (select 1 from public.pedidos p where p.loja_id = l.id);`
3. `create or replace function public.lojas_marca_primeira_publicacao() returns trigger language plpgsql` (corpo de DD11, `return new`; INVOKER; objetos qualificados, mesmo estilo de `lojas_protege_billing`).
4. `create trigger lojas_marca_primeira_publicacao_trg before insert or update on public.lojas for each row execute function public.lojas_marca_primeira_publicacao();`
5. Rollback comentado: `drop trigger …; drop function …; alter table … drop column …`.
Sem índice (lido sempre por linha da própria loja). `database.types.ts`: `primeira_publicacao_em: string | null` em Row; `?: string | null` em Insert e Update.

**`src/lib/utils/acessoPainel.ts`**
```ts
export type DecisaoPrimeirosPassos = "primeiros-passos" | "concluido";
export function decidirPrimeirosPassos(
  loja: Pick<LojaCompleta, "primeira_publicacao_em">,
): DecisaoPrimeirosPassos  // == null (inclui undefined) → "primeiros-passos"; senão "concluido". Nunca lê `ativo` (D1).
```

**`src/lib/utils/publicacao.ts`** (reescrito; corrige o comentário `:1-7`)
```ts
export const CAMPOS_ENDERECO_LOJA = ["endereco_cep","endereco_rua","endereco_numero","endereco_bairro","endereco_cidade","endereco_estado"] as const;
export type CampoEnderecoLoja = (typeof CAMPOS_ENDERECO_LOJA)[number];
export const ROTULOS_CAMPOS_ENDERECO: Record<CampoEnderecoLoja, string>; // CEP, rua, número, bairro, cidade, UF
export function camposEnderecoFaltando(loja: Partial<Record<CampoEnderecoLoja, string | null>>): CampoEnderecoLoja[]; // trim; ordem da lista
export type EstadoProntidao = Pick<LojaCompleta, "nome" | "whatsapp" | CampoEnderecoLoja | "latitude" | "longitude"> & {
  produtosDisponiveis: number;
  formasPagamento: number;
};
export type PendenciaPublicacao =
  | { tipo: "perfil" }
  | { tipo: "endereco"; faltando: CampoEnderecoLoja[] }
  | { tipo: "localizacao" }
  | { tipo: "pagamento" }
  | { tipo: "produto" };
export type ProntidaoPublicacao = { ok: true } | { ok: false; pendencia: PendenciaPublicacao };
export function pendenciasPublicacao(estado: EstadoProntidao): PendenciaPublicacao[]; // ordem: perfil, endereco, localizacao, pagamento, produto; "localizacao" só com endereço completo
export function podePublicarLoja(estado: EstadoProntidao): ProntidaoPublicacao;     // 1ª pendência
export function mensagemPendencia(p: PendenciaPublicacao): string;
export const ROTULO_LOCALIZAR_DE_NOVO = "Localizar meu endereço de novo";
export const ERRO_PERFIL_INCOMPLETO = "Complete nome e WhatsApp antes de publicar a loja."; // texto atual, mantido
export function mensagemEnderecoIncompleto(faltando: readonly CampoEnderecoLoja[]): string;
export const ERRO_SEM_LOCALIZACAO: string;
export const ERRO_SEM_PAGAMENTO = "Cadastre ao menos uma forma de pagamento antes de publicar a loja.";
export const ERRO_SEM_PRODUTO = "Cadastre ao menos um produto disponível antes de publicar a loja.";
export type VarianteAvisoEndereco = "completar-endereco" | "localizar-de-novo";
export function varianteAvisoEndereco(
  loja: Pick<LojaCompleta, "primeira_publicacao_em" | CampoEnderecoLoja | "latitude" | "longitude">,
): VarianteAvisoEndereco | null; // decidirPrimeirosPassos !== "concluido" → null; endereço incompleto → "completar-endereco"; !temCoordenadas → "localizar-de-novo"; senão null
```
Textos D10 (o P3 afirma estes fragmentos):
- (a) `mensagemEnderecoIncompleto(["endereco_cep","endereco_numero"])` → `"Preencha CEP e número do endereço da loja antes de publicar."`. Junção: vírgulas e " e " antes do último.
- (b) `ERRO_SEM_LOCALIZACAO = \`Toque em “${ROTULO_LOCALIZAR_DE_NOVO}” e tente publicar de novo em instantes.\``. Não contém "confira", "corrija" nem "errado".
- (c) `ERRO_PERFIL_INCOMPLETO` (atual). (d) `ERRO_SEM_PRODUTO`. (e) `ERRO_SEM_PAGAMENTO`.
- Nenhum começa com "Sem" nem com "Caso não" (teste em loop).
`publicacao.ts` importa `temCoordenadas` de `@/lib/actions/patches-loja`, `decidirPrimeirosPassos` de `./acessoPainel` e `LojaCompleta` como tipo. Sem I/O.

**`src/lib/supabase/queries/publicacao.ts`** (novo)
```ts
export async function carregarProntidaoPublicacao(
  client: Client,
  loja: Pick<LojaCompleta, "id" | "nome" | "whatsapp" | CampoEnderecoLoja | "latitude" | "longitude">,
): Promise<EstadoProntidao>
// produtos: select("id", { count: "exact", head: true }).eq("loja_id", loja.id).eq("disponivel", true).eq("oculto", false)
// formas_pagamento: select("id", { count: "exact", head: true }).eq("loja_id", loja.id)
// as duas em Promise.all; error → throw; count null → 0
```

**`src/lib/utils/primeirosPassos.ts`** (novo, puro)
```ts
export const ROTA_PRIMEIROS_PASSOS = "/painel/primeiros-passos";
export const ETAPAS_ASSISTENTE = [
  { etapa: "perfil", rotulo: "Perfil" },
  { etapa: "horarios", rotulo: "Horários" },
  { etapa: "entregas", rotulo: "Entregas" },
  { etapa: "pagamentos", rotulo: "Pagamentos" },
  { etapa: "produtos", rotulo: "Produtos" },
  { etapa: "opcionais", rotulo: "Opcionais", podePular: true },
  { etapa: "revisar", rotulo: "Revisar e publicar" },
] as const;
export type EtapaAssistente = (typeof ETAPAS_ASSISTENTE)[number]["etapa"];
export function rotaDaEtapa(e: EtapaAssistente): string; // `${ROTA_PRIMEIROS_PASSOS}/${e}`
export function etapaDaPendencia(p: PendenciaPublicacao): EtapaAssistente;
// perfil|endereco → "perfil"; localizacao → "revisar" (onde está o botão D14); pagamento → "pagamentos"; produto → "produtos"
export function etapaDeRetomada(pendencias: readonly PendenciaPublicacao[]): EtapaAssistente;
// a etapa de menor índice em ETAPAS_ASSISTENTE entre etapaDaPendencia(p); sem pendência → "revisar"
export function etapasComPendencia(pendencias: readonly PendenciaPublicacao[]): ReadonlySet<EtapaAssistente>;
```
Predicado de retomada (D6): horários, entregas e opcionais nunca têm pendência (horários tem default; entrega não entra no gate; opcionais pode pular). Retomada usa só as pendências do gate. Assim zod, gate, aviso e retomada partem da mesma `pendenciasPublicacao`.

**Rotas** (todas fora de `(bloqueavel)/`): `/painel/primeiros-passos` (só redireciona para `rotaDaEtapa(etapaDeRetomada(...))`), `/painel/primeiros-passos/{perfil,horarios,entregas,pagamentos,produtos,opcionais,revisar}`.

**`src/app/(painel)/painel/primeiros-passos/guard.ts`** (`import "server-only"`)
```ts
export type ContextoAssistente = { supabase: Awaited<ReturnType<typeof createClient>>; loja: LojaCompleta; estado: EstadoProntidao };
export async function exigirAssistente(): Promise<ContextoAssistente>
// leitura única por request via cache(): createClient → getUser → buscarLojaDoDono → carregarProntidaoPublicacao.
// Qualquer erro, user null ou loja null → redirect("/login?erro=sessao") (redirect fora do try).
// decidirPrimeirosPassos(loja) === "concluido" → redirect("/painel").
```
Chamado pelo `layout.tsx` e por cada `page.tsx` da pasta. Não chama `decidirAssinatura` (D5).

**Server Action D14** em `src/lib/actions/loja.ts`
```ts
export type ResultadoLocalizar = { ok: true } | { ok: false; erro: string; motivo?: MotivoGeocoding };
export async function localizarEnderecoDeNovo(): Promise<ResultadoLocalizar>
```
Ordem: `createClient` → `buscarLojaDoDono` (null → `ERRO_SEM_LOJA`) → `verificarRateLimit("localizarEndereco", loja.id)` (negado → `"Muitas tentativas. Aguarde um instante."`) → `camposEnderecoFaltando(loja)` não vazio → `{ ok:false, erro: mensagemEnderecoIncompleto(faltando) }` → `temCoordenadas(loja)` → `revalidarPainel()` e `{ ok: true }` → `montarConsultaGeocoding(loja)` → `geocodificarLojaComRetry(consulta, loja.id)` → sem coords: `{ ok:false, motivo, erro: avisoGeocodingPerfil(motivo, "localizar") }`, nada gravado → com coords: UPDATE de DD13 no client autenticado, patch exatamente `{ latitude, longitude }` → erro → throw → catch → `ERRO_GENERICO` com `console.error("localizarEnderecoDeNovo:", e)` → `revalidarPainel()` → `{ ok: true }`. Nunca grava `ativo`, nunca grava par nulo. Sem argumento: nada vem do cliente.

**`src/lib/utils/rateLimit.ts`** `LIMITES.localizarEndereco = { limite: 5, janela: "1 m" }`, com comentário (balde por loja, custo do geocoder).

**Componentes**
- `src/components/painel/CartaoPublicacao.tsx` (DD6).
- `src/components/painel/BotaoLocalizarEndereco.tsx` (`"use client"`): props `{ onLocalizar: () => Promise<ResultadoLocalizar> }`; rótulo `ROTULO_LOCALIZAR_DE_NOVO`; `useTransition`; ok → `toast.success` + `router.refresh()`; falha → `toast.error(r.erro)`. Não importa `geocodificar*` nem lê `process.env`.
- `src/components/painel/AvisoEnderecoLoja.tsx` (`"use client"`): props `{ variante: VarianteAvisoEndereco; hrefPerfil: string; onLocalizar: () => Promise<ResultadoLocalizar> }`. `role="status"`, padrão visual de `AvisoEstadoBloqueado.tsx` (sem componente Alert novo). Variante (a): texto + link "Completar endereço" → `hrefPerfil`. Variante (b): texto + `<BotaoLocalizarEndereco>`. Nunca recebe latitude/longitude (seguranca.md §19). Textos do corpo: P4.
- `src/components/painel/ChromeAssistente.tsx` (Server Component): props `{ nomeLoja: string; logoUrl: string | null; children: ReactNode }`. Header com logo (`fotoSegura` + `next/image`, mesmo padrão do `NavPainel`), nome e `<BotaoLogout />`; `<main className="superficie-painel …">{children}</main>`. Sem Sidebar, sem Topbar, sem link de vitrine.
- `NavPainel.tsx`: `BotaoLogout` vira `export function BotaoLogout({ className }: { className?: string })`. Nada mais muda.
- `primeiros-passos/ProgressoAssistente.tsx` (`"use client"`): props `{ pendentes: EtapaAssistente[] }`; lê `usePathname()` só para destacar a etapa atual (UX, não authz); links livres para todas as etapas (D6).
- `primeiros-passos/NavegacaoEtapas.tsx` (`"use client"`): props `{ etapa: EtapaAssistente }`; "Voltar"/"Próximo"; na etapa `opcionais` o "Próximo" diz "Pular" (P4 pode polir); sem botão em `revisar`.

### Arquivos a criar

| Arquivo | Conteúdo |
|---|---|
| `supabase/migrations/20261116120000_lojas_primeira_publicacao.sql` | coluna, backfill, função, trigger |
| `tests/migrations/lojas_primeira_publicacao.test.ts` | ver casos |
| `src/lib/supabase/queries/publicacao.ts` (+ `.test.ts`) | `carregarProntidaoPublicacao` |
| `src/lib/utils/primeirosPassos.ts` (+ `.test.ts`) | etapas, retomada |
| `src/app/(painel)/painel/primeiros-passos/guard.ts` | `exigirAssistente` |
| `…/primeiros-passos/layout.tsx` | `exigirAssistente` + `<ProgressoAssistente pendentes>` + `children` + `<NavegacaoEtapas>` por page |
| `…/primeiros-passos/page.tsx` | redirect de retomada |
| `…/primeiros-passos/perfil/page.tsx` | `<PerfilClient inicial={perfilInicialDaLoja(loja)} topo={null} logoUrlInicial onSalvar={salvarPerfil} …actions de logo/galeria do lojista>` |
| `…/primeiros-passos/{horarios,pagamentos,produtos,opcionais}/page.tsx` | `await exigirAssistente()` + page default do painel |
| `…/primeiros-passos/entregas/page.tsx` | `<EntregasConteudo hrefPerfil="/painel/primeiros-passos/perfil" />` |
| `…/primeiros-passos/revisar/page.tsx` | checklist de `pendenciasPublicacao(estado)` com `mensagemPendencia` e link `rotaDaEtapa(etapaDaPendencia(p))`; `<BotaoLocalizarEndereco onLocalizar={localizarEnderecoDeNovo}>` se houver `localizacao`; `<CartaoPublicacao publicado={false} bloqueio={…} onDefinirPublicacao={definirPublicacao} destinoAposPublicar="/painel">` |
| `…/primeiros-passos/{ProgressoAssistente,NavegacaoEtapas}.tsx` | acima |
| `…/primeiros-passos/layout.guard.test.tsx`, `…/primeiros-passos/page.test.tsx` | ver casos |
| `src/app/(painel)/painel/cadeia-redirect.guard.test.tsx` | enumerativo anti-ciclo |
| `src/components/painel/{CartaoPublicacao,BotaoLocalizarEndereco,AvisoEnderecoLoja,ChromeAssistente}.tsx` | acima |
| `src/components/painel/{CartaoPublicacao,AvisoEnderecoLoja}.test.tsx` | ver casos |
| `(bloqueavel)/configuracoes/perfil/perfilInicial.ts` | `perfilInicialDaLoja` |
| `(bloqueavel)/configuracoes/entregas/EntregasConteudo.tsx` | corpo atual da page de entregas |
| `mockups/primeiros-passos-da-loja.{html,md}` | P4 |

### Arquivos a modificar (nível função)

| Arquivo | Função / trecho |
|---|---|
| `src/lib/utils/acessoPainel.ts` | + `DecisaoPrimeirosPassos`, `decidirPrimeirosPassos` |
| `(bloqueavel)/layout.tsx` | depois de `loja === null`: `if (decidirPrimeirosPassos(loja) === "primeiros-passos") redirect(ROTA_PRIMEIROS_PASSOS);` antes de `decidirAssinatura` |
| `painel/layout.tsx` | ramo `"ok"`: `decidirPrimeirosPassos(loja!) === "primeiros-passos"` → `<ChromeAssistente nomeLoja logoUrl>{children}</ChromeAssistente>`; senão chrome atual com `{variante && <AvisoEnderecoLoja variante hrefPerfil="/painel/configuracoes/perfil" onLocalizar={localizarEnderecoDeNovo} />}` antes de `children` no `<main>` |
| `route-group.guard.test.ts` | invariante do assistente |
| `src/lib/utils/publicacao.ts` | tudo de "Nomes fixos" |
| `src/lib/actions/loja.ts` | `definirPublicacao`: remove a constante `:155-156` e o gate `:183-186`; ao publicar, `carregarProntidaoPublicacao(supabase, loja)` (client autenticado) → `podePublicarLoja` → `{ ok:false, erro: mensagemPendencia(...) }` sem UPDATE; depois do UPDATE, `revalidarPainel()`. Corrige o docblock. + `revalidarPainel`, `ResultadoLocalizar`, `localizarEnderecoDeNovo`. `salvarPerfil` não muda de código (o zod recusa antes) |
| `admin-publicar.ts` | troca `podePublicarLoja(alvo.nome, alvo.whatsapp)` por `podePublicarLoja(await carregarProntidaoPublicacao(svc, alvo))` + `mensagemPendencia`; corrige o docblock item 3 |
| `admin-perfil.ts` | guarda `motivo` do `geocodificarLojaComRetry` e devolve `{ ok: true, geocodificado: false, motivo }`; tipo local ganha `motivo?` |
| `src/lib/actions/admin-loja.ts` | `"primeira_publicacao_em"` em `CAMPOS_LOJA_SOMENTE_SERVIDOR` |
| `src/lib/validacoes/loja.ts` | tira `.optional()` dos 6 `endereco_*`; corrige o comentário "Endereço da loja (issue 004): opcionais" |
| `src/lib/utils/rateLimit.ts` | `localizarEndereco` |
| `perfil/PerfilClient.tsx` | DD6 (perde `publicado`/`podePublicar`/`onDefinirPublicacao`/`alternarPublicacao`/cartão; ganha `topo`), DD7 (`required`), DD8 (fallback `"transitorio"`) |
| `perfil/page.tsx` | `perfilInicialDaLoja`; `carregarProntidaoPublicacao(supabase, loja)`; `topo={<CartaoPublicacao publicado={loja.ativo} bloqueio={…} onDefinirPublicacao={definirPublicacao} destinoAposPublicar={null} />}` |
| `perfil/avisoGeocoding.ts` | DD8 + DD9 |
| `perfil/montarPayloadPerfil.ts` | só o docblock de `montarPayloadPerfil` ("o schema os trata como `.optional()`" passa a ser falso para o endereço) |
| `entregas/page.tsx` | casca de `EntregasConteudo` |
| `admin/assinantes/[lojaId]/carga.ts` | + `carregarProntidaoAdmin(lojaId): Promise<EstadoProntidao>` (mesma ordem fail-closed: `validarLojaIdAdmin` → `verificarAdminSaaS` → `createServiceClient` → `buscarLojaAdminPorId` → `carregarProntidaoPublicacao(svc, loja)`) |
| `admin/.../perfil/page.tsx` | `perfilInicialDaLoja`; `bloqueio` de `carregarProntidaoAdmin` |
| `admin/.../perfil/PerfilAdminClient.tsx` | `podePublicar` → `bloqueio: string \| null`; monta `topo={<CartaoPublicacao … onDefinirPublicacao={(p) => publicarLojaAdmin(lojaId, p)} destinoAposPublicar={null} />}` |
| `src/components/painel/NavPainel.tsx` | `export` de `BotaoLogout` + `className?` |
| `src/lib/database.types.ts` | coluna |
| `references/*` | P10 |

### NÃO tocar

- `decidirAcessoBase`, login, callback, `destinoPadraoPorPapel` (D4, D11).
- `deveRegeocodificar`, `montarConsultaGeocoding`, `temCoordenadas`, `geocodificarLojaComRetry`: reusados como estão. A regra 2 de `deveRegeocodificar` fica inalcançável pelos saves (consulta nunca é nula depois de D12), mas segue correta e testada como função pura.
- `salvarPerfil` (código), `salvarHorarios`, `salvarTema`, `entrega.ts`, `pagamento.ts`, `produto.ts`, `opcional.ts`, `logo.ts`, `galeria.ts`, `upload.ts`: únicas vias de escrita do assistente; nenhuma muda.
- `FormNovaLoja.tsx`, `schemaNovaLojaAdmin`, cadastro do lojista (D12).
- `src/components/ui/*` (gerado pelo shadcn).
- `revalidarVitrine` (achado 6).
- `lojas_protege_billing`: o marcador tem trigger próprio; não estender a v4.

### Cenários

- Caminho feliz: cadastro → confirmar → login → `/painel` → `(bloqueavel)` redireciona → `/painel/primeiros-passos` → `/perfil` → etapas → revisar → publicar → `/painel` com chrome completo. Logout/login → `/painel` direto.
- Despublicar no painel: marcador fica, continua no painel (D1). Republicar passa pelo mesmo gate.
- Loja ativa sem marcador: impossível depois do backfill; se a migration não estiver no cloud, a coluna vem `undefined` e todo lojista cai no assistente. Por isso o merge só depois do `db push` (P11).
- Assinatura bloqueada + nunca publicada: assistente (DD14). `/painel/assinatura-bloqueada` e `/painel/configuracoes/assinatura` abrem com o chrome mínimo.
- Produto de outra loja: contagem com `eq("loja_id")`; a RLS de leitura pública que expõe produtos de lojas ativas não conta. No admin, `svc` sem RLS, mesmo `eq`.
- Endereço completo e geocoder fora do ar: publicar recusa com (b); o botão D14 devolve o texto do motivo (DD9) e não grava nada. Loja segue sem par até o serviço voltar (consequência aceita na 193).
- Teto diário do geocoder estourado: `esgotado_global` → texto "tente mais tarde", fail-closed (nada gravado).
- Duplo clique em publicar: a transição desabilita o botão; dois UPDATEs `ativo=true` são idempotentes; o marcador é write-once.
- Duplo clique em D14: rate limit + compare-and-set (`is("latitude", null)`); o segundo grava 0 linhas e devolve ok.
- D14 enquanto o perfil salva endereço novo: compare-and-set nos 5 campos (DD13).
- Sessão expirada no assistente: `exigirAssistente` → `/login?erro=sessao`.
- Admin publica loja do lojista: marcador preenchido; no próximo request o lojista vai ao painel.
- PATCH direto do dono em `ativo`: publica sem gate e preenche o marcador (D17, débito 140 aberto).
- Erro interno: mensagem genérica no cliente, detalhe em `console.error` com prefixo da função (§14). Endereço e coordenada nunca no log.

### Recálculo no servidor

O cliente envia `publicar: boolean` (ou nada, no D14). O servidor relê do banco nome, WhatsApp, 6 campos, par e as duas contagens e decide. `bloqueio`/`podePublicar` vindos de preview nunca são lidos pelas actions. Coordenada nunca vem do cliente (`.strict()` + D14 sem argumento).

### Dependências externas

Nenhum pacote novo. API externa reusada: geocoder de `geocodificarEndereco.ts` (Google + ViaCEP), cobrado por chamada. D14 só chama quando o endereço está completo e falta o par. Contenção: `localizarEndereco` 5/min por loja (fail-open se o Redis cair, como todo o `rateLimit.ts`), burst por loja (10/s), teto diário global (500, default) e por IP. Ao estourar: fail-closed, nada gravado, texto "tente mais tarde". Custo marginal: no pior caso uma loja com endereço não localizável consome até o teto diário global, a mesma exposição que `salvarPerfil` já tem hoje pela regra 3 (10/min por IP). Sem custo fixo novo.

### Casos de teste nomeados (por arquivo)

**`tests/migrations/lojas_primeira_publicacao.test.ts`** (backfill via `createTestDb({ antesDaMigration: { migration: "20261116120000_lojas_primeira_publicacao", semear } })`)
- "backfill: loja ativo=true ganha primeira_publicacao_em"
- "backfill: loja ativo=false com pedido ganha primeira_publicacao_em"
- "backfill: loja ativo=false sem pedido fica nula"
- "INSERT ativo=false nasce nula mesmo enviando valor (asService)"
- "INSERT ativo=true nasce preenchida ignorando o valor enviado (asService)"
- "false→true via asService preenche"
- "false→true via asUser (PATCH do dono) preenche — débito 140"
- "despublicar mantém o marcador"
- "republicar mantém o timestamp original"
- "asUser tentando limpar ou alterar → valor intacto"
- "asService tentando limpar ou alterar → valor intacto"
- "asUser gravando marcador em loja ativo=false → segue nula"

**`src/lib/utils/acessoPainel.test.ts`** (describe "decidirPrimeirosPassos")
- "marcador null → 'primeiros-passos'"
- "marcador undefined (coluna ausente na row) → 'primeiros-passos'"
- "marcador preenchido → 'concluido'"
- "marcador preenchido e ativo=false → 'concluido' (D1)"
- "ativo=true sem marcador → 'primeiros-passos' (nunca lê ativo)"
- "marcador preenchido e assinatura vencida → 'concluido' (não olha assinatura)"
(`acessoPainel.papel.test.ts` e `acessoPainel.deprecacao.test.ts` sem edição.)

**`src/app/(painel)/painel/bloqueavel-layout.guard.test.tsx`** (`fazerLoja` ganha `primeira_publicacao_em: "2026-01-01T00:00:00Z"` por padrão, sobrescrevível; asserções existentes intactas)
- "(5) marcador nulo → redirect('/painel/primeiros-passos') e REJEITA"
- "(6) marcador nulo + 'suspensa' → '/painel/primeiros-passos' (assistente vence o paywall)"
- "(7) marcador preenchido + 'suspensa' → '/painel/assinatura-bloqueada'"
- "(8) marcador preenchido + 'ativa' → children cru"

**`src/app/(painel)/painel/primeiros-passos/layout.guard.test.tsx`**
- "marcador nulo → renderiza children, sem redirect"
- "marcador preenchido → redirect('/painel') e REJEITA"
- "marcador nulo + assinatura 'suspensa' → renderiza (D5)"
- "getUser lança → '/login?erro=sessao'"
- "buscarLojaDoDono lança → '/login?erro=sessao'"
- "contagem de prontidão lança → '/login?erro=sessao'"
- "loja null → '/login?erro=sessao'"

**`src/app/(painel)/painel/primeiros-passos/page.test.tsx`**
- "loja recém-criada → redirect '/painel/primeiros-passos/perfil'"
- "perfil e endereço completos, sem par, sem pagamento → '/painel/primeiros-passos/pagamentos'"
- "só falta produto → '/painel/primeiros-passos/produtos'"
- "só falta o par → '/painel/primeiros-passos/revisar'"
- "nada pendente → '/painel/primeiros-passos/revisar'"
- "marcador preenchido → '/painel'"

**`src/app/(painel)/painel/route-group.guard.test.ts`**
- "'primeiros-passos/page.tsx' existe FORA de (bloqueavel)/"
- "nenhum arquivo sob primeiros-passos/ está em caminho com (bloqueavel)/"
- "existe primeiros-passos/<etapa>/page.tsx para cada etapa de ETAPAS_ASSISTENTE"

**`src/app/(painel)/painel/cadeia-redirect.guard.test.tsx`** — `it.each` sobre {marcador: nulo, preenchido} × {assinatura: 'ativa', 'suspensa'} × {rota: `/painel`, `/painel/pedidos`, `/painel/configuracoes/perfil`, `/painel/primeiros-passos`, `/painel/primeiros-passos/perfil`, `/painel/primeiros-passos/revisar`, `/painel/assinatura-bloqueada`, `/painel/configuracoes/assinatura`}: "cadeia de redirect termina em ≤2 saltos sem repetir rota". Modelo: para cada rota, invoca os layouts/page reais que a envolvem (`(bloqueavel)/layout` para rotas do grupo; `primeiros-passos/layout` e, na raiz, `primeiros-passos/page`), captura o `NEXT_REDIRECT` e segue o destino. Mocks iguais aos dos guards.

**`src/app/(painel)/painel/painel-layout.guard.test.tsx`** (fixture `fazerLoja` ganha marcador preenchido; `painel-layout.papel-bordas.test.tsx:39` idem, sem mudar asserção)
- "marcador nulo → ChromeAssistente, sem SidebarPainel/TopbarPainel"
- "marcador preenchido → SidebarPainel + TopbarPainel"
- "publicada, endereço completo sem par → AvisoEnderecoLoja variante 'localizar-de-novo'"
- "publicada, endereço incompleto → variante 'completar-endereco'"
- "publicada completa com par → sem aviso"
- "marcador nulo e sem endereço → sem aviso"
- "AvisoEnderecoLoja não recebe latitude nem longitude"

**`src/lib/utils/publicacao.test.ts`** (reescrito: os 4 casos atuais viram linhas da matriz, mesma semântica)
- `it.each` "sem <condição> → pendência <tipo>" para: nome nulo, nome só espaços, WhatsApp nulo, WhatsApp vazio, cada um dos 6 campos de endereço, latitude nula, longitude nula, 0 produtos, 0 formas
- "tudo presente → { ok: true }"
- "endereço incompleto e sem par → pendência 'endereco', não 'localizacao'"
- "mensagem de endereço lista só os campos que faltam, com rótulo"
- "campo só com espaços conta como faltando"
- "mensagem de localização contém ROTULO_LOCALIZAR_DE_NOVO e não contém 'confira', 'corrija' nem 'errado'"
- "nenhuma mensagem começa com 'Sem' ou 'Caso não'"
- "pendenciasPublicacao devolve todas, na ordem perfil → endereco → localizacao → pagamento → produto"
- "paridade com schemaPerfil: CAMPOS_ENDERECO_LOJA = chaves endereco_* do shape, todas obrigatórias"
- "paridade com o geocoding: endereço completo ⇒ montarConsultaGeocoding não nula"
- varianteAvisoEndereco: "marcador nulo → null", "publicada e endereço incompleto → 'completar-endereco'", "publicada, completa, sem par → 'localizar-de-novo'", "publicada completa com par → null", "despublicada com marcador e sem par → 'localizar-de-novo' (D1)"

**`src/lib/supabase/queries/publicacao.test.ts`**
- "produtos: eq('loja_id', loja.id), disponivel=true, oculto=false, count exact head"
- "formas: eq('loja_id', loja.id), count exact head"
- "loja B com produtos visíveis ao mesmo client não conta para a loja A"
- "count null → 0"
- "erro do banco lança"

**`src/lib/utils/primeirosPassos.test.ts`**
- "ETAPAS_ASSISTENTE segue a ordem de D6"
- "sem pendência → 'revisar'"
- "perfil → 'perfil'"; "endereco → 'perfil'"; "localizacao sozinha → 'revisar'"; "pagamento + produto → 'pagamentos'"; "só produto → 'produtos'"
- "horarios, entregas e opcionais nunca são retomada"
- "rotaDaEtapa('perfil') === '/painel/primeiros-passos/perfil'"

**`src/lib/actions/loja.test.ts`**
Fixtures: `PERFIL_SEM_ENDERECO` = o `PERFIL_OK` atual (`:161`); `PERFIL_OK` passa a ter o endereço completo (= `PERFIL_COM_ENDERECO`, que vira alias). O fake autenticado ganha `select(cols, opts)` com `.eq` encadeado que conta numa tabela em memória filtrada por todo `.eq` recebido (prova de escopo sem mockar a query). `vi.mock("next/cache")` com espião de `revalidatePath`.
Casos existentes que passam a afirmar recusa (`{ ok:false, erro: ERRO_VALIDACAO }`, geocoder não chamado, zero UPDATE), com o título reescrito:
- `:217` "sucesso sem endereço" → "sem endereço → recusa na validação (D13)"
- `:288` "endereço incompleto (sem cidade/UF) e loja SEM coords"
- `:444` "loja com coords pela METADE … endereço segue incompleto"
- `:481` "coord ÓRFÃ (loja com coords e endereço incompleto)"
- `:829` "só cidade, sem UF"
- `:844` "só UF, sem cidade"
- `:915` "endereço previamente completo agora salvo sem cidade"
- `:943` "endereço sem nenhum campo e loja sem coords"
Casos existentes que só ganham endereço no payload (asserção intacta; os de rejeição precisam do endereço para recusar pelo motivo certo): `:227`, `:549`, `:555`, `:565-566`, `:575`, `:611`, `:620`, `:629`, `:639`, `:652`, `:665`, `:672`, `:680`. `:858` "cidade + UF presentes → Nominatim chamado" passa a usar `{ ...PERFIL_OK, endereco_cidade: "Curitiba", endereco_estado: "PR" }`.
`definirPublicacao` (`:776`): `:785`, `:795`, `:802`, `:809`, `:816` ganham loja completa + 1 produto + 1 forma no fake, asserções intactas. Novos:
- "loja A sem produto e loja B ativa com produto visível ao mesmo client → recusa com 'produto', UPDATE não chamado"
- "loja A sem forma e loja B com forma → recusa com 'forma de pagamento', UPDATE não chamado"
- "endereço incompleto → recusa listando os campos, UPDATE não chamado"
- "endereço completo sem par → recusa com ROTULO_LOCALIZAR_DE_NOVO, geocoder não chamado, UPDATE não chamado"
- "republicar loja pausada passa pelo mesmo gate"
- "despublicar loja incompleta → ok, contagem não consultada"
- "contagem falha → erro genérico, UPDATE não chamado"
- "publicar ok → revalidatePath('/painel', 'layout')"
`localizarEnderecoDeNovo` (describe novo):
- "rate limit negado → geocoder não chamado, nada gravado"
- "rate limit chaveado por 'localizarEndereco' e loja.id"
- "sem loja → ERRO_SEM_LOJA, geocoder não chamado"
- "loja com par → ok, geocoder não chamado, nada gravado"
- "endereço incompleto → recusa com a lista de campos, geocoder não chamado"
- "geocoder recebe montarConsultaGeocoding(loja) e loja.id"
- "sucesso → update exatamente { latitude, longitude } no client autenticado, eq('id', loja.id), is('latitude', null) e os 5 campos da consulta"
- "sucesso → revalidatePath('/painel', 'layout')"
- "falha transitorio → nada gravado, motivo 'transitorio', erro sem 'salvar' e sem 'confira'"
- "falha nao_encontrado → motivo repassado, erro pede conferir o endereço"
- "nenhuma chamada grava ativo nem par nulo"
- "compare-and-set grava 0 linhas → ok, sem erro"
- "erro do UPDATE → erro genérico, sem detalhe"

**`src/app/admin/assinantes/actions/admin-publicar.test.ts`** — `:140`, `:166`, `:205` ganham loja-alvo completa + contagens no fake de `svc` (asserções intactas); `:177`, `:186` passam a afirmar o fragmento de `ERRO_PERFIL_INCOMPLETO`. Novos:
- "loja-alvo sem produto e outra loja com produto sob o mesmo svc → recusa com 'produto', zero update"
- "loja-alvo sem forma de pagamento → recusa, zero update"
- "loja-alvo sem par → recusa com ROTULO_LOCALIZAR_DE_NOVO"
- "loja-alvo com endereço incompleto → recusa listando os campos"
- "nenhum parâmetro pula o gate: publicarLojaAdmin.length === 2"

**`src/lib/validacoes/loja.test.ts`**
- passam a afirmar recusa: `:174` "aceita payload SEM nenhum campo de endereço" → "rejeita payload sem endereço"; `:189` "aceita cada campo individualmente" → "rejeita cada campo sozinho"
- ganham `...enderecoValido` (aceite intacto): `:59`, `:105`, `:109`
- ganham `...enderecoValido` para recusar pelo motivo certo: `:64`, `:69`, `:73`, `:77`, `:81`, `:85`, `:89`, `:95`, `:99`, `:114`, `:119`, `:290`
- título do describe `:157` "(6 campos opcionais …)" → "(6 campos obrigatórios …)"
- novo `it.each` "rejeita payload sem <campo>" para os 6

**`src/app/admin/assinantes/actions/admin-perfil.test.ts`**
- `:546` "coord ÓRFÃ …" → afirma recusa (`ERRO_VALIDACAO`, zero UPDATE, geocoder não chamado)
- `:508` passa a esperar `{ ok: true, geocodificado: false, motivo: "transitorio" }`
- novos: "payload sem endereço → ERRO_VALIDACAO no parse (antes de verificarAdminSaaS e de qualquer I/O), geocoder não chamado, zero UPDATE"; "geocoding falho devolve motivo (paridade com salvarPerfil)"
**`admin-perfil.modal-promocoes.test.ts`**: `:100`, `:118`, `:129`, `:139` ganham os 6 campos (asserções intactas).

**`perfil/avisoGeocoding.test.ts`**: `:58` tira `undefined` do loop (o tipo não aceita mais). Novos: "acao 'localizar': nenhum texto contém 'salvar'", "acao 'localizar' + falha nossa não manda conferir", "acao 'localizar' + nao_encontrado/cep_inexistente pede conferir", "acao omitida = 'salvar' (textos atuais intactos)".

**`perfil/montarPayloadPerfil.test.ts`**: `:102` só o título ("…o schema os trata como opcionais…" → "…omitidos; o schema decide se faltam"); `:156` "payload mínimo (form em branco) também passa" → "form em branco reprova no schemaPerfil (endereço obrigatório)".

**`perfil/PerfilClient.test.tsx`**: o harness (`:148-160`) tira `publicado`, `podePublicar`, `onDefinirPublicacao` e passa `topo={null}`. Novos: "os 6 inputs de endereço saem com required", "telefone e WhatsApp não saem com required", "renderiza o topo recebido", "topo=null → sem botão 'Publicar loja'".

**`admin/.../perfil/PerfilAdminClient.test.tsx`**: `:128-129` trocam `podePublicar` por `bloqueio={null}`. Novos: "topo é um CartaoPublicacao cujo onDefinirPublicacao chama publicarLojaAdmin(lojaId, publicar)", "markup do wrapper admin traz os 6 required".
**`admin/.../perfil/page.test.tsx`**: mock de `carregarProntidaoAdmin`; `:90` → "bloqueio=null com loja pronta"; `:95` → "bloqueio = ERRO_PERFIL_INCOMPLETO quando falta WhatsApp"; novo "consome carregarProntidaoAdmin(lojaId)".

**`src/components/painel/CartaoPublicacao.test.tsx`**
- "rascunho + bloqueio → 'Publicar loja' desabilitado e texto do bloqueio visível"
- "rascunho sem bloqueio → habilitado"
- "publicado → 'Despublicar' habilitado mesmo com bloqueio"

**`src/components/painel/AvisoEnderecoLoja.test.tsx`**
- "'completar-endereco' → link para hrefPerfil, sem botão de localizar"
- "'localizar-de-novo' → botão com ROTULO_LOCALIZAR_DE_NOVO"

**`src/lib/utils/rateLimit.test.ts`**: `:92` lista de chaves ganha `localizarEndereco`; novo "localizarEndereco = 5 por 1 m".
**`src/lib/actions/admin-loja.test.ts`**: `:309` lista de colunas bloqueadas ganha `primeira_publicacao_em`.
**Fixtures `: LojaCompleta =`** (P5): `src/lib/utils/manifestPainel.test.ts:18`, `src/app/(painel)/painel/manifest.webmanifest/route.test.ts:38`.

### Gates mecânicos

- `grep -rnE '\.from\(|createServiceClient|"use server"' "src/app/(painel)/painel/primeiros-passos"` vazio.
- `grep -rn "app/admin" "src/app/(painel)/painel/primeiros-passos"` vazio.
- `grep -rnE "geocodificarComRetry|geocodificarEndereco|process\.env" src/components/painel/{AvisoEnderecoLoja,BotaoLocalizarEndereco}.tsx` vazio.
- `grep -n "ativo" src/components/painel/{AvisoEnderecoLoja,BotaoLocalizarEndereco}.tsx` vazio; na action D14, nenhum `ativo` no patch (teste).
- Nenhum `NEXT_PUBLIC_` novo.
- `grep -n "nome e WhatsApp e salve" -r src` vazio (texto antigo removido).

### Ordem de implementação

1. **P3 (tdd, RED)** todos os testes acima. FAIL esperado por símbolo/coluna inexistente ou asserção nova. `npx tsc --noEmit` só com erros nos testes do P3.
2. **P4 (desenhar)** em paralelo: mockup e `## UX`. Pode polir só os textos marcados "P4 pode polir". Mudar texto que o P3 afirma (D10, `ROTULO_LOCALIZAR_DE_NOVO`) → `ok:false` para a sessão.
3. **P5 (migrar)** migration + tipos + 2 fixtures. Vem antes do P6 porque `CAMPOS_LOJA_SOMENTE_SERVIDOR` tem `satisfies` sobre as colunas e `decidirPrimeirosPassos` lê a coluna tipada.
4. **P6 (executar, servidor)** nesta ordem: `acessoPainel.ts` → `publicacao.ts` (+ queries) → `primeirosPassos.ts` → `validacoes/loja.ts` → `rateLimit.ts` → `avisoGeocoding.ts` → `loja.ts` (`definirPublicacao`, `localizarEnderecoDeNovo`) → `admin-publicar.ts` → `admin-perfil.ts` → `admin-loja.ts` → `(bloqueavel)/layout.tsx` → `primeiros-passos/guard.ts` + `layout.tsx` + `page.tsx` + página mínima de cada etapa (só o guard e um título, para o guard estrutural e o enumerativo passarem) → `painel/layout.tsx` com `ChromeAssistente` e `AvisoEnderecoLoja` mínimos. Regra antes de quem consome; layouts por último, porque dependem de tudo.
5. **P7 (executar, telas)**: `CartaoPublicacao` + `PerfilClient` (DD6/DD7/DD8) + `perfilInicial.ts` + pages de perfil (painel e admin) + `carga.ts` + `PerfilAdminClient` → `EntregasConteudo` → etapas reais → revisar → `ProgressoAssistente`/`NavegacaoEtapas` → `AvisoEnderecoLoja`/`BotaoLocalizarEndereco`/`ChromeAssistente` com o visual do P4 → `NavPainel` (`export`).
6. P8–P13 como no plano de execução.

### Checklist de validação pós-implementação

- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build` verdes, sem warning novo
- [ ] Migration testada no pglite e com Remote preenchido; leitura pós-push com marcador em "Pão do Ciso" e "Lanches base"
- [ ] Contagens do gate com `eq("loja_id")` nos dois caminhos; loja vizinha com produto não libera a publicação
- [ ] Admin não tem parâmetro que pula o gate
- [ ] Nenhuma cadeia de redirect passa de 2 saltos (enumerativo verde)
- [ ] Action D14 grava só o par, com compare-and-set, nunca `ativo` nem par nulo
- [ ] Nenhuma coordenada vai ao cliente; nenhum secret no cliente; nenhum dado pessoal em código, teste ou log
- [ ] Mensagens D10 com verbo no imperativo; (b) não manda corrigir endereço
- [ ] Checklist de clique (critério de aceite 3) entregue ao usuário

## UX

> Gravado pelo P4 (`desenhar`, 2026-11-16). Mockup: `mockups/primeiros-passos-da-loja.html` + `.md` (layout, classes e o porquê de cada decisão). Textos abaixo são finais: o P7 copia, não decide. Textos já fixados no plano técnico e afirmados pelo P3 (D10, `ROTULO_LOCALIZAR_DE_NOVO`, rótulos de `ETAPAS_ASSISTENTE`) estão repetidos aqui sem alteração. Nenhum token nem componente shadcn novo.

### Chrome mínimo (`ChromeAssistente`)

- Header `h-14 border-b bg-card`: logo da loja 32 px (sem logo: inicial do nome em círculo `bg-muted`, `aria-hidden`) · nome da loja (`truncate font-heading font-semibold`) · linha abaixo do nome: **"Primeiros passos"** (`text-xs text-muted-foreground`) · `<BotaoLogout className="min-h-[44px] w-auto" />` com o texto atual **"Sair"** (ícone + texto, nunca só ícone).

### Progresso (`ProgressoAssistente`)

- `<nav aria-label="Etapas da configuração">` dentro de `Card`.
- Linha de estado: **"Etapa {n} de 7 · {rotulo}"** (rótulos de `ETAPAS_ASSISTENTE`: Perfil, Horários, Entregas, Pagamentos, Produtos, Opcionais, Revisar e publicar). Abaixo, barra de 7 segmentos `aria-hidden`.
- Abaixo de `lg`: `<details>` com `<summary>` **"Ver todas as etapas"** (≥44 px). A partir de `lg`: lista sempre visível em coluna esquerda (`lg:grid-cols-[15rem_1fr]`, `lg:sticky lg:top-6`), linha de estado vira só **"Etapa {n} de 7"**.
- Lista `<ol>` com 7 links (≥44 px, `focus-visible:ring-2`), número + rótulo. Etapa atual: `aria-current="step"`, `bg-muted font-medium border-l-4 border-primary`, texto auxiliar **"você está aqui"** (só abaixo de `lg`).
- Etapa em `pendentes`: selo **"Falta"** (`Badge variant="outline"` + `border-amber-300 bg-amber-50 text-amber-800` + ícone `CircleAlert`). Etapa sem pendência não ganha check nem "concluída" (horários, entregas e opcionais nunca têm pendência; marcar como feito seria falso).
- Opcionais: texto auxiliar **"pode pular"** (`text-xs text-muted-foreground`).

### Navegação (`NavegacaoEtapas`)

- `Card` no fim da etapa. Texto fixo acima dos botões: **"Salve as alterações antes de seguir."** (os botões só navegam; cada tela salva pelo próprio botão).
- Na etapa opcionais o texto fixo é outro: **"Adicione opcionais agora ou depois, pelo painel."**
- Botões (`min-h-[44px]`; em 360 px `grid grid-cols-2 gap-2`): **"Voltar"** (`variant="ghost"`, ícone `ChevronLeft`; ausente em perfil) · **"Próximo: {rótulo da etapa seguinte}"** (`variant="outline"`, ícone `ChevronRight`), ex.: "Próximo: Horários". Na etapa opcionais: **"Pular para revisar"**. Nunca `variant="default"`: o primário da etapa é o "Salvar" da tela reusada.
- Revisar não tem `NavegacaoEtapas` (como no plano).

### Etapa perfil (`PerfilClient`, vale também para painel e admin)

- Rótulo **"Logradouro"** vira **"Rua"** (casa com "rua" de `ROTULOS_CAMPOS_ENDERECO` e da mensagem D10 a). Placeholder segue "Rua, avenida…".
- Os 6 rótulos ganham ` *` em `<span aria-hidden="true">`: **"CEP *"**, **"Rua *"**, **"Número *"**, **"Bairro *"**, **"Cidade *"**, **"UF *"**; inputs com `required` (DD7). Complemento não existe.
- Subtítulo da seção (troca "Usado para calcular zonas de entrega por raio."): **"Obrigatório para publicar a loja. Usado para calcular as zonas de entrega por raio. Campos com * são obrigatórios."**
- Erro de campo vazio: mensagem nativa do navegador (atributo `required`). Nenhum texto novo; nenhum modal de geocoding para quem não preencheu (D13). Demais textos do form (toast "Perfil salvo!", "Confira os dados do perfil.") não mudam.

### Etapa revisar

- Cabeçalho (`Card`): h1 **"Revisar e publicar"**. Subtítulo:
  - 1 pendência: **"Resolva o item marcado para publicar a loja."**
  - 2+ pendências: **"Resolva os {n} itens marcados para publicar a loja."**
  - nenhuma: **"Tudo pronto. Publique para a vitrine aparecer para os clientes."**
- Checklist: `<ul aria-label="O que a loja precisa para ir ao ar">` em `Card`, **5 linhas fixas** nesta ordem, derivadas de `pendenciasPublicacao(estado)`:

| Linha (título) | Pronto | Pendente (texto = `mensagemPendencia(p)`) | Ação na linha |
|---|---|---|---|
| **Nome e WhatsApp** | "Pronto" | (c) `ERRO_PERFIL_INCOMPLETO` | link **"Ir para Perfil"** |
| **Endereço** | "Pronto" | (a) `mensagemEnderecoIncompleto(faltando)` | link **"Ir para Perfil"** |
| **Localização no mapa** | "Pronto" | (b) `ERRO_SEM_LOCALIZACAO` | `<BotaoLocalizarEndereco>` |
| **Forma de pagamento** | "Pronto" | (e) `ERRO_SEM_PAGAMENTO` | link **"Ir para Pagamentos"** |
| **Produto disponível** | "Pronto" | (d) `ERRO_SEM_PRODUTO` | link **"Ir para Produtos"** |

  - Terceiro estado só da linha "Localização no mapa": com pendência `endereco`, a linha mostra **"Complete o endereço para localizar a loja no mapa."**, ícone `Circle` tracejado `text-muted-foreground`, sem botão.
  - Ícones: pronto `CheckCircle2` (`text-foreground`), pendente `CircleAlert` (`text-amber-800`). Leitor de tela: `<span className="sr-only">(pendente)</span>` / `(aguardando)` após o título.
  - Links das linhas: `Button variant="outline"` como link, `min-h-[44px]`, destino `rotaDaEtapa(etapaDaPendencia(p))`.
- `CartaoPublicacao` **depois** do checklist (último bloco da página).

### Textos D10 (sem alteração; afirmados pelo P3)

- (a) `mensagemEnderecoIncompleto(faltando)`: **"Preencha {campos} do endereço da loja antes de publicar."**, campos por `ROTULOS_CAMPOS_ENDERECO` (CEP, rua, número, bairro, cidade, UF), vírgulas e " e " antes do último. Ex.: "Preencha CEP e número do endereço da loja antes de publicar."
- (b) `ERRO_SEM_LOCALIZACAO`: **"Toque em “Localizar meu endereço de novo” e tente publicar de novo em instantes."**
- (c) `ERRO_PERFIL_INCOMPLETO`: **"Complete nome e WhatsApp antes de publicar a loja."**
- (d) `ERRO_SEM_PRODUTO`: **"Cadastre ao menos um produto disponível antes de publicar a loja."**
- (e) `ERRO_SEM_PAGAMENTO`: **"Cadastre ao menos uma forma de pagamento antes de publicar a loja."**

### `CartaoPublicacao` (revisar, perfil do painel, perfil do admin)

- Título **"Status da vitrine"** + selo **"No ar"** (`Badge variant="secondary"`) ou **"Rascunho"** (`variant="outline"`) — textos atuais.
- Texto (`text-sm text-muted-foreground`, com `id` referenciado por `aria-describedby` do botão):
  - publicado: **"Sua vitrine está visível e aceitando pedidos."** (atual)
  - rascunho com `bloqueio`: o próprio `bloqueio` (texto D10 da 1ª pendência)
  - rascunho sem bloqueio: **"Sua vitrine está oculta. Publique para receber pedidos."** (atual)
- Só quando `destinoAposPublicar !== null` e rascunho sem bloqueio, linha extra: **"Depois de publicar, você vai para o painel da loja."**
- Botão: **"Publicar loja"** (`variant="default"`) / **"Despublicar"** (`variant="outline"`), `min-h-[44px]`, `w-full sm:w-auto`; `Loader2` girando durante a transição; desabilitado em rascunho com bloqueio (o texto continua visível ao lado, nunca só tooltip).
- Toasts (atuais): sucesso **"Loja publicada!"** / **"Loja despublicada."**; falha: `toast.error(r.erro)` com o texto que o servidor devolver (D10 ou genérico).

### Botão D14 (`BotaoLocalizarEndereco`)

- Rótulo: **"Localizar meu endereço de novo"** (`ROTULO_LOCALIZAR_DE_NOVO`), `Button variant="outline"`, ícone `MapPin`, `min-h-[44px] w-full sm:w-auto`.
- Carregando: rótulo **"Localizando…"**, `Loader2 animate-spin`, `disabled`, `aria-busy="true"`.
- Sucesso (`{ ok: true }`): `toast.success` **"Endereço localizado no mapa."** + `router.refresh()`; nenhum texto inline.
- Falha (`{ ok: false, erro }`): `toast.error(erro)` **e** o mesmo `erro` fica em `<p aria-live="polite" className="text-sm text-foreground">` logo abaixo do botão até a próxima tentativa (o toast some; a instrução precisa ficar). A próxima tentativa limpa a linha.
- Textos de falha que chegam em `erro` (todos com verbo no imperativo, nenhum diz "salvar", só `endereco` manda conferir):
  - `avisoGeocodingPerfil(motivo, "localizar")` — mantidos como no plano (DD9), sem polimento:
    - `transitorio` → **"Tente de novo em instantes: o mapa não respondeu agora."**
    - `throttle_interno` → **"Tente de novo em instantes: muitas consultas ao mapa ao mesmo tempo por aqui."**
    - `indisponivel_config` → **"Tente de novo mais tarde: nosso serviço de mapas está com um problema de configuração e nossa equipe já foi avisada."**
    - `esgotado_global`, `esgotado_ip` → **"Tente de novo mais tarde: o serviço de mapas está indisponível no momento."**
    - `nao_encontrado`, `cep_inexistente` → **"Confira rua, número e CEP no perfil: o mapa não encontrou esse endereço."**
  - rate limit da action → **"Muitas tentativas. Aguarde um instante."** (fixado no plano)
  - endereço incompleto na action → `mensagemEnderecoIncompleto(faltando)` (D10 a)
  - sem loja / erro interno → `ERRO_SEM_LOJA` / `ERRO_GENERICO` de `loja.ts` (atuais)
- `avisoGeocodingPerfil(motivo, "salvar")` e o modal do perfil não mudam de texto.

### Aviso persistente D15 (`AvisoEnderecoLoja`)

- Lugar: topo do `<main>` do painel, antes de `children`, em toda página. Sem botão de fechar.
- Visual: `Card` branco (`§10.2` regra 4) com `CardContent className="flex gap-3"`, ícone `MapPin` (`aria-hidden`), título `font-medium`, corpo `text-sm text-muted-foreground`; `role="status"`. **Não** usa `destructive` nem o fundo de `AvisoEstadoBloqueado`: a loja está no ar, vermelho diria o contrário.
- (a) `"completar-endereco"`:
  - título **"Complete o endereço da loja"**
  - corpo **"Sua loja segue no ar. Preencha o endereço completo no perfil para ativar as zonas de entrega por raio."**
  - ação: `Link` com estilo `Button variant="outline"`, `min-h-[44px] w-full sm:w-auto`, texto **"Completar endereço"** → `hrefPerfil`
- (b) `"localizar-de-novo"`:
  - título **"Localize sua loja no mapa"**
  - corpo **"Sua loja segue no ar. Toque em “Localizar meu endereço de novo” para ativar as zonas de entrega por raio."**
  - ação: `<BotaoLocalizarEndereco>` (estados acima)
- Nenhum texto do aviso fala de pedido, cancelamento ou endereço errado.

### Acessibilidade (checar no P7/P9)

- Alvos interativos `min-h-[44px]` literal (base de 120%, `design-system.md` §5).
- Foco visível em links da lista, `<summary>`, botões e links-botão.
- Contraste sobre branco: `muted-foreground` 4,74:1; `text-amber-800` sobre `bg-amber-50` 6,8:1.
- Estado nunca só por cor: "Falta", "Pronto", "(pendente)", "(aguardando)" por extenso.
