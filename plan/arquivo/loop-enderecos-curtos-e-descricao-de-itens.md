# Loop de execução — endereços curtos + link do Maps + observação do cliente por item

**Gerado por:** agente `orquestrar` · 2026-09-15 · branch `main` (working tree limpo, HEAD `63286d9`)
**Revisão 3** — D2 (link do Google Maps) reintegrada ao escopo por decisão do dono do produto.
**Revisão 2** — o item 3 foi lido errado na revisão 1 (ver §0).
**Status:** plano. Nada implementado. A sessão principal executa.

---

## 0. O que foi pedido

Pedido literal do dono do produto, na forma em que chegou:

> "implementar o seguinte:
> 1 - quando comprador seleciona retirar na loja, exibir na tela mensagem com o endereço da loja (rua, número e bairro). Na página de confirmação do pedido que comprador vê, exibir o endereço no mesmo formato. Na mensagem que vai pelo whatsapp, exibir o endereço da loja no mesmo formato. Assim fica fácil do cliente ver o endereço.
> 2 -  quando comprador seleciona receber em casa, nos endereços que são exibidos na confirmação da compra e na mensagem pelo whtsapp, cidade e estado e CEP são desnecessários, bastam rua, número e bairro. Implementar.
> 3 - na sidebar, na descrição de itens do pedido ( que mora em finalizar pedido /loja/paodociso/pedido), bem como na confirmação do pedido vista pelo comprador, a descrição de cada item não aparece. Exiba."

**Correção literal do dono do produto sobre o item 3, depois de ler a revisão 1 deste plano:**

> "sobre a descrição dos itens pedidos, eu falava sobre a descrição que o cliente escreve em cada pedido, não sobre a descrição que o lojista faz de cada produto. li rapidamente o plano e me parece que há uma confusão quanto a isso."

O item 3 é o campo **`observacao` por item** — o texto livre que o comprador escreve na linha ("sem cebola", "ponto da carne") — e **não** `produtos.descricao`. A revisão 1 construiu sobre `produtos.descricao` uma issue 198, uma issue 199 bloqueada, uma pergunta de snapshot × leitura viva, uma migration em `itens_pedido` e +8 invocações / +5 opus. **Tudo removido.** Não há decisão de produto pendente.

**Decisão do dono do produto sobre a D2 (link do Google Maps), 2026-09-15:** ele perguntou se sairia caro; a sessão levantou os fatos do código, recomendou incluir, e ele respondeu **"peça"**. A D2 já era decisão aprovada dele em 2026-09-06 e nunca entregue — **é retomada de escopo próprio, não escopo novo**. A revisão 2 a havia mandado para "Fora do escopo"; essa edição está **desfeita** (passo 1, edição 9).

**Duas perguntas do usuário seguem sem resposta e este plano não as presume:**
- **(a) aprovação para executar** — o plano não começa sozinho;
- **(b) se a observação do item aparece nas três telas do comprador ou só na gaveta lateral** — a cobertura das três segue como **suposição declarada** (passo 2, bloco B), não como decisão dele.

### Contexto para quem abrir este arquivo sem a sessão que o gerou

- **Branch:** `main`, limpo. `main` local e remoto sincronizados **antes** de abrir branch (CLAUDE.md; incidente do PR #126).
- **Loja de teste:** "Pão do Ciso" (`/loja/paodociso`) é do próprio usuário no Supabase cloud — dá para verificar ponta a ponta com dado real.
- **Ambiente:** sem Playwright e sem MCP de browser. Mas componentes **são** testáveis (descoberta 8) — a inspeção manual deixa de ser a única rede.
- **Spec preexistente:** `specs/retirada-endereco-da-loja.md` v0.2.0 (2026-09-06), ainda em `specs/`, **nunca implementada** (`formatarEnderecoLoja` não existe em `src/`; não há link do Maps em lugar nenhum). Colide em **dois** pontos com o pedido de agora:
  - **D1** — *"na mensagem aparece que é retirada, mas não precisa escrever o endereço da loja"*; a "Etapa 2" (endereço da loja no WhatsApp) está **cancelada**, com `whatsappPedido.ts` declarado **intocado**. O item 1 pede exatamente essa etapa.
  - **RN-R1** — fixa `{rua}, {numero} · {bairro} — {cidade}/{estado} · CEP {cep}`. Os itens 1 e 2 pedem **só rua, número e bairro**.
  A instrução nova prevalece; a spec **não pode ser contrariada em silêncio** (passo 1).
- **Decisões da spec:** **D2 — agora ativa** (link do Maps na confirmação; a v0.2.0 já dizia ter reescrito a RN-R6 para permiti-lo). D3 (complemento adiado → `specs/_debito-produto-2026-09-06.md` §1). **D4 (invariante de dinheiro da retirada — intocável).**
- **Issue adjacente:** `tasks/193` quer endereço obrigatório + gate de publicação. Hoje `podePublicarLoja` exige só nome + WhatsApp → **existe loja publicada sem endereço**, e o item 1 precisa de fallback. **Não é bloqueio.**

---

## 1. Como vamos resolver (explicação simples)

Os itens 1 e 2 são a mesma regra vista de dois lados — "endereço em uma linha: rua, número, bairro" — aplicada ao endereço da loja e ao do cliente, com um formatador único; junto vai o link "abrir no Google Maps" na confirmação, que o dono já tinha aprovado e nunca recebeu. O item 3 é puro esquecimento de renderização: a observação que o comprador escreve **já está no banco, já é validada, já sai no WhatsApp e já aparece nas três telas do lojista** — só nunca foi exibida nas telas dele. Os três itens viram **uma issue só**, porque todos editam o mesmo arquivo de confirmação, e terminam quando `tsc`/`lint`/`vitest`/`build` passam e `verificar` confirma as telas em `/loja/paodociso`.

---

## 2. Arquitetura proposta (máxima segurança, menor custo)

**Degrau 3** (2–3 agentes em sequência com validação entre eles), uma issue, uma branch, um PR.

Não usamos `/fluxo` (degrau 4) porque **a spec já é o plano** dos itens 1, 2 e da D2: nomeia arquivo, linha, regra de negócio, teste de regressão e risco. Rodar `/fluxo` faria `especificar` reescrever um spec existente (com risco de perder D3/D4) e `planejar` produzir algo menos detalhado do que já está escrito. Não usamos `/fix` (degrau 1) porque o diff tem ~11 arquivos de produção (teto de `/fix` é 3) e porque o item 2 muda que PII sai numa mensagem que vai para fora do sistema.

O que sobra de análise — reverter D1, reescrever RN-R1, alinhar RN-R6 ao formato novo, corrigir a afirmação errada da spec sobre testes de componente — é edição cirúrgica de texto: **degrau 0**, sessão principal, lista fechada no passo 1.

---

## 3. Componentes e reuso

- **Agentes reutilizados:** `tdd` (RED), `executar` (GREEN), `revisar` ‖ `testar` ‖ `auditar` (trio paralelo já validado), `verificar`, `escriba` (condicional).
- **Agentes deliberadamente NÃO usados:** `especificar`/`quebrar`/`planejar` (spec + descobertas cobrem); `migrar`/`popular` (zero migration); `acelerar` (nenhuma query, imagem ou rota nova — e o link do Maps **não** é request do iRango: quem chama o Google é o navegador do cliente, se clicar); `desenhar` (todos os blocos copiam padrões já vigentes nas próprias telas — descobertas 6, 7 e 9); `pentester` (caro; nenhum endpoint, dependência ou auth nova — o link externo é mitigado por convenção já testada, descoberta 10).
- **Skills reutilizadas:** `/pr`. `/fix` **não** cabe (teto de 3 arquivos).
- **Primitivos do harness:** nenhum. Trabalho finito, não recorrente, sem evento externo e sem fan-out que justifique paralelismo.
- **Reuso da análise da spec (não refazer):** as seis colunas de endereço já existem em `lojas` **e já são projetadas na view pública `vitrine_lojas`** (migration `20260615013000_logo_url_lojas.sql`, preservada em `20260704120000_...`); `buscarLojaPorSlug` (anon) e `buscarLojaParaPedido` (service_role) já fazem `.select("*")`. **Nenhuma migration, nenhuma view recriada, nenhuma query editada, nenhum dado novo exposto ao `anon`.** A view segue sem `latitude`/`longitude` — e a D2 **não** as usa (busca por texto, RN-R6).

### Descobertas desta sessão (verificadas por leitura — não re-investigar)

**Itens 1 e 2**

1. **A troca de assinatura do WhatsApp é só de tipo.** `montarLinkWhatsappPedido(pedido, loja)` declara `loja: Pick<LojaCompleta,"nome"|"whatsapp">`, e os dois callers já passam a row completa: `pedido.ts:459` (a mesma `loja` de que ele já lê `whatsapp_envio_automatico`) e `confirmacao/page.tsx:144` (retorno de `buscarLojaParaPedido`, `LojaCompleta`). **`src/lib/actions/pedido.ts` e `useEnviarPedido.ts` não entram no diff.** O arquivo de dinheiro fica fora.
2. **Armadilha de tipo:** alargar o `Pick` para exigir as seis colunas quebra ~10 chamadas de `whatsappPedido.test.ts` (literais `{ nome: "X", whatsapp: null }`). Usar `Pick<...> & Partial<Pick<LojaCompleta, ...endereço>>`.
3. **O formatador do endereço do cliente está duplicado** (`whatsappPedido.ts:35` e `confirmacao/page.tsx:64`), ambos no formato longo. O item 2 obriga a mudar os dois igual → consolidar (débito `specs/_debito-produto-2026-09-06.md` §2; DRY de `architecture.md` §8). Com o item 1 pedindo **o mesmo formato**, o resultado é **um util único** com dois adaptadores (colunas de `lojas` × JSONB `endereco_entrega`).
4. **🔴 Trava de escopo — o painel NÃO entra.** Terceira família de leitores do endereço do cliente: `lerEndereco`/`lerBairro` em `painel/DetalhePedido.tsx:100`, `ComandaCozinha.tsx:34`, `ReciboCliente.tsx:51`. O corte foi pedido só na **confirmação do comprador** e no **WhatsApp**. Um agente com espírito de DRY pode "consolidar" e apagar cidade/estado/CEP do painel — exatamente onde o lojista precisa do endereço completo para entregar. Vira gate mecânico (§4).

**D2 — link do Google Maps**

9. **🟢 A consulta do Maps já existe pronta no projeto — e carrega uma lição que muda a recomendação.** `montarConsultaGeocoding` (`src/lib/actions/patches-loja.ts:62`) monta, a partir das **mesmas seis colunas**, exatamente uma consulta de busca geográfica livre: `"{rua}, {numero}, {bairro}, {cidade} - {estado}, Brasil"`. Três propriedades que a tornam a escolha certa para o `query=` do Maps:
   - **🛑 Ela exclui o CEP de propósito, com incidente documentado** (issues 185/186, comentário no próprio arquivo): *"o CEP cru é token ENVENENADOR na busca livre; `q=12914-190` chegou a resolver para uma estrada na República Tcheca"*. Portanto **a recomendação de "usar o endereço completo com CEP" na busca está errada para este projeto**: completo **sim** (com cidade e UF, senão a busca é ambígua), **com CEP não**. Custa zero seguir a regra da casa.
   - **Ela já tem o gate de âncora geográfica:** sem `cidade` **e** `estado` → `null`. Isso mapeia exatamente para "sem âncora → sem link", e é melhor que a RN-R5 da v0.2.0, que mandava gerar o link "com o que houver" (uma busca de `"Rua X, 123"` sem cidade leva o cliente a uma tela inútil do Maps — o próprio motivo pelo qual a RN-R5 não queria link com endereço vazio).
   - **O módulo é importável pela página:** o cabeçalho de `patches-loja.ts` declara *"Módulo NEUTRO: sem 'use server', funções puras síncronas — pode ser importado por painel ↔ admin sem arrastar a fronteira de Server Action"*. A confirmação é Server Component; importar é seguro e não quebra o `npm run build` (que é onde `const` exportada em `'use server'` estoura). Já tem cobertura (11 referências em `patches-loja.test.ts`).
   - **Atenção ao override:** a spec v0.2.0 diz *"não reaproveitar `montarConsultaGeocoding`"*. Essa nota foi escrita sobre **formatação de exibição** (ela acrescenta `"Brasil"` ao fim, que polui a tela) e continua válida para isso. Para **consulta de busca** o raciocínio se inverte: `"Brasil"` ancora o país e ajuda. O passo 1 registra o override na própria spec, para ninguém "consertar" depois.
10. **Reverse tabnabbing e vazamento de `Referer`: mitigação é convenção vigente, já testada.** O par `target="_blank" rel="noopener noreferrer"` aparece em 8 pontos (`CadastroForm.tsx:143`, `StatusAssinatura.tsx:124`, `TabelaFaturas.tsx:71`, `NavPainel.tsx:453`, `HeaderLoja.tsx:76`, `ModalFreteIndisponivel.tsx:135`), e o teste-modelo existe literalmente: `StatusAssinatura.test.tsx:266-269` faz `renderToStaticMarkup` e assere `toContain("noopener")` / `toContain("noreferrer")` — é copiar.
11. **🔴 O `token_acesso` do pedido viaja na URL da confirmação.** `searchParams: Promise<{ pedido?: string; token?: string }>` (`confirmacao/page.tsx:34`, lido em `:120`). Sem `noreferrer`, o header `Referer` entregaria **a URL inteira, com o token**, ao Google no clique. O `rel` já convencionado bloqueia — mas **o motivo precisa estar nomeado no teste**, porque um refactor futuro que troque `noreferrer` por só `noopener` reabriria um vazamento de token de pedido e ninguém lembraria o porquê. Vira asserção do `tdd` (passo 3) e item do `auditar` (passo 5).
12. **O bloco a copiar está ~40 linhas abaixo do alvo, no mesmo arquivo.** `confirmacao/page.tsx:278-291` renderiza "Avisar a loja no WhatsApp" como `Button` com `nativeButton={false}` e `render={<a href={…} target="_blank" rel="noopener noreferrer">…}`, com ícone `MessageCircle` + `aria-hidden`. O link do Maps é esse bloco de novo, outro ícone (`MapPin`/`ExternalLink`, lucide já é dependência) e outro href. Sem componente novo de design, sem `desenhar`.

**Item 3 — a lacuna é só de renderização, e o padrão a copiar já existe**

5. **O dado está pronto, ponta a ponta.** `itens_pedido.observacao` existe desde `20260907120000_itens_pedido_observacao.sql` (`CHECK char_length <= 200`); validada e canonizada no servidor (`schemaObservacao`, `validacoes/pedido.ts:43` e `:112`, com bateria em `pedido.test.ts`); na allowlist de redação do Sentry (`sentryBeforeSend.ts:32`); **já sai no WhatsApp** (`whatsappPedido.ts:91`, com teste de que `null` não gera rótulo órfão); está em `ItemCarrinho.observacao` (`dominio.ts:33`) e entra na chave de dedup `linhaCarrinhoId`; e **já vem na projeção** `SELECT_PEDIDO_COM_ITENS` (`queries/pedidos.ts:21`) pelo `*`. **Zero migration, zero query, zero RPC. Nada a fazer no WhatsApp.**
6. **O padrão visual existe três vezes — no painel — e diverge de propósito.** `ComandaCozinha.tsx:70` (`border-l-4 border-black pl-2 text-sm font-bold whitespace-pre-line`, térmica 80mm), `DetalhePedido.tsx:227` (`text-xs text-muted-foreground`, tela), `ReciboCliente.tsx:104` (`text-xs`, térmica) — mesmo formato `{item.observacao && (<p …>Obs: {item.observacao}</p>)}` e mesmo comentário de segurança: *"texto do cliente via JSX, auto-escapado; NUNCA `dangerouslySetInnerHTML`; `null`/vazio ⇒ fora do DOM; `whitespace-pre-line` preserva as quebras"*. Classes divergem porque o meio difere — **não unificar o painel**.
7. **As três telas do comprador que faltam, e o precedente exato de componente.** Nenhuma exibe a observação: `Carrinho.tsx:65`, `checkout/EtapaItens.tsx:118` (ambas leem só para a chave de dedup) e `confirmacao/page.tsx:174` (o `map` monta nome e opcionais e ignora `item.observacao`). **`Carrinho.tsx` é um `Sheet` — literalmente a gaveta lateral.** E as três são **exatamente os três callers de `ListaOpcionaisItem`**, cujo cabeçalho descreve esse uso. Logo: `src/components/vitrine/ObservacaoItem.tsx` como gêmeo dele. Padrão da casa, não invenção.

**Transversal**

8. **Componente É testável — a spec está errada sobre isso.** `vitest.config.ts` é `environment: "node"` **com `@vitejs/plugin-react`**, e `ListaOpcionaisItem.test.tsx` / `HeaderLoja.test.tsx` / `StatusAssinatura.test.tsx` testam JSX via `renderToStaticMarkup` (`react-dom/server`). A seção "Testes" da spec afirma que a cobertura de componente "fica na verificação em navegador" — **falso**, e a correção entra no passo 1. Consequência prática: o escape de `<script>` na observação e o `rel="noreferrer"` do link do Maps viram **asserções mecânicas**, não olhar de revisor.

---

## 4. Mecanismo do loop e travas

- **Gatilho de entrada:** execução manual pela sessão principal, **após aprovação explícita do usuário** (pergunta (a) ainda em aberto), `git push` de `main` e abertura da branch.
- **Unidade de repetição:** `executar` → trio de validação → correção. **`max_iterations = 3`**.
- **Critério de sucesso (observável e mecânico):**
  - `npx tsc --noEmit` → 0 erros; `npm run lint` → 0 erros;
  - `npx vitest run` nos alvos → PASS, **incluindo `src/lib/actions/pedido.test.ts`** (regressão `[071]`: `p_taxa_entrega=0` e `p_endereco_entrega: null` em retirada), `whatsappPedido.test.ts` e `patches-loja.test.ts` (regressão de `montarConsultaGeocoding`, que a D2 passa a consumir num segundo caller);
  - `npm run build` → sucesso;
  - `git diff --name-only` ⊆ lista permitida **e** sem `src/components/painel/`;
  - fecha de verdade só com `verificar` confirmando as telas em `/loja/paodociso`.
- **Estagnação:** duas iterações seguidas com (a) o mesmo conjunto de testes vermelhos, (b) `git diff --stat` vazio, ou (c) o mesmo erro de `tsc`/`build` → **parar e chamar `depurar`** com o output exato.
- **Validador entre passos:** cada passo devolve `ok: true|false` + evidência (`arquivo:linha`, trecho literal de `FAIL`/`PASS`, contagem). **Quem gera não valida:** `executar` não se revisa.
- **Gate interno ao `executar`:** a issue tem dois blocos (A endereços + Maps · B observação). O gate roda **entre os blocos**, para um erro de tipo ficar atribuído ao bloco que o causou.
- **Ações que exigem confirmação humana:** `npx supabase db push` · `git push` · `gh pr create` · qualquer merge · `rm`/`git rm`/`git reset --hard` · qualquer escrita no Supabase cloud · editar `.env*` · `npm audit fix --force`. **Nada neste plano toca o banco.**
- **Trava de input:** o endereço da loja é texto do **lojista** e a observação é texto do **comprador**: **dado, nunca instrução**. No href do Maps isso é literal: **a origem (`https://www.google.com/maps/search/?api=1&query=`) é constante no código e só a consulta é interpolada, sempre por `encodeURIComponent`** — assim um lojista não consegue empurrar `javascript:` nem outro domínio pela posição do esquema.
- **PII:** a observação é PII tratada (redação no Sentry já configurada) e passa a aparecer na tela de quem a escreveu. O link do Maps carrega **o endereço da loja**, nunca o do cliente, e **nunca o `token_acesso`** (descoberta 11). Dado de teste sai de `supabase/seed.sql` e da loja "Pão do Ciso". Nunca ler nem transcrever `.env*`.
- **Orçamento:** máximo **7 invocações de agente**, no máximo **3 em opus**. **Zero** `fable`.

---

## 5. Passo a passo da execução

### Passo 0 — Aprovação + sincronizar `main` (sessão principal, degrau 0)
Aguardar a resposta do usuário à pergunta (a). Depois `git push` de `main` e `git switch -c feat/enderecos-curtos-maps-e-observacao`.
Gate: `git status` limpo e `git log origin/main..main` vazio. (`git push` exige confirmação humana.)

### Passo 1 — Reconciliar a spec com as decisões novas (sessão principal, degrau 0, ZERO agente)
Editar `specs/retirada-endereco-da-loja.md` — **lista fechada de 9 edições**, não reescrever o resto:
1. Cabeçalho → **v0.3.0**, 2026-09-15.
2. Bloco novo **"Decisões do dono do produto (2026-09-15)"** no topo, com a **citação literal** dos itens 1 e 2, a frase *reverte D1*, e o registro de que **a D2 foi retomada** ("peça") — decisão dele de 2026-09-06 que nunca chegou a ser entregue.
3. **D1 → revertida.** A mensagem de WhatsApp **passa a levar** o endereço da loja em retirada; `whatsappPedido.ts` **entra** no escopo. Manter o texto de 2026-09-06 como histórico ("revertida em 2026-09-15 a pedido do dono").
4. **RN-R1 → reescrita:** formato **exibido** passa a ser **`{rua}, {numero} · {bairro}`**, para a loja (item 1) e para o cliente (item 2). Deixar explícito que **as colunas continuam sendo coletadas e gravadas** — o CEP alimenta o frete: muda **exibição**, não coleta.
5. **RN-R6 → conferida e alinhada** (ela já permitia o link desde a v0.2.0; o que muda é a consulta). Passa a dizer, com as três coisas nomeadas:
   - **href:** `https://www.google.com/maps/search/?api=1&query=<consulta codificada>` — forma documentada e estável; **não usar formatos legados**. Origem literal no código; só a consulta é interpolada, sempre por `encodeURIComponent`.
   - **consulta ≠ exibição, de propósito:** a tela mostra **curto** (`rua, numero · bairro`), a busca usa o **completo com cidade e UF** — sem cidade o Maps fica ambíguo. **Isto não é contradição com o item 2**, que tratou de *exibição*. Escrito na RN para ninguém "consertar" depois.
   - **🛑 o CEP não entra na consulta**, por decisão já provada no projeto (issues 185/186, comentário em `patches-loja.ts`: `q=12914-190` resolveu para uma estrada na República Tcheca). A consulta é **`montarConsultaGeocoding`**, reusada; registrar o **override explícito** da nota da v0.2.0 ("não reaproveitar `montarConsultaGeocoding`"), que continua valendo para **exibição** e não para **busca**.
   - **Proibido, inalterado:** mapa embutido, `latitude`/`longitude`, geocoding chamado pelo iRango, link externo **no checkout**.
6. **RN-R7 → reescrita:** a mensagem muda **apenas** em dois pontos (acrescenta `Retirar em: <endereço curto>` em retirada; encurta a linha `Endereço:` em entrega); todo o resto byte a byte igual, travado por teste antes da edição. **O link do Maps não entra na mensagem** — é só tela.
7. **RN-R5 / fallback → uma regra só, estendida ao link:** loja sem endereço → **sem linha `Retirar em:` no WhatsApp** (nunca `—`, nunca linha vazia), **texto neutro na tela** e **sem link**. E, agora com precisão: **o link só é renderizado quando há âncora geográfica** (cidade **e** estado), porque é isso que `montarConsultaGeocoding` garante; endereço parcial exibe curto e simplesmente não linka. Substitui a regra da v0.2.0 de "gerar o link com o que houver".
8. **Seção "Testes" → corrigir o fato errado:** a spec afirma que o repositório "não usa jsdom" e que a cobertura de componente "fica na verificação em navegador". O repositório testa componente com `renderToStaticMarkup` (descoberta 8) — corrigir citando `ListaOpcionaisItem.test.tsx`, `HeaderLoja.test.tsx` e `StatusAssinatura.test.tsx:266-269`, e tornar **obrigatório** o teste de `target="_blank"` + `rel="noopener noreferrer"` com o motivo do `noreferrer` nomeado (token na query).
9. **"Fora do escopo" → desfazer a saída da D2.** O link do Maps **não** vai para lá (a edição da revisão 2 está revertida). Manter os demais bullets (mapa embutido, coordenadas, distância, link no checkout, obrigar endereço para publicar, consolidar `formatarEndereco`) e marcar que `src/components/painel/*` não muda.

Gate: `grep -n "cancelada\|não precisa escrever o endereço\|CEP {cep}\|não usa jsdom\|não reaproveitar" specs/retirada-endereco-da-loja.md` → nenhuma ocorrência que ainda se leia como afirmação vigente sem a ressalva.
**Escalar para `especificar` (1 opus) só se** a reversão cascatear para fora destas nove seções.

### Passo 2 — Escrever a issue (sessão principal, degrau 0, ZERO agente)
**Uma issue: `tasks/197-enderecos-curtos-maps-e-observacao-do-item.md`** — **crítica: NÃO** (não toca dinheiro, RLS, cupom, token nem autorização; `pedido.ts` fica fora — descoberta 1). Mesmo assim **`tdd` antes e `auditar` depois**, porque o diff encosta em `whatsappPedido.ts` (consumido pelo caminho que grava o pedido), mexe em qual PII do comprador aparece e em quais telas, e **acrescenta um link externo numa página cuja URL carrega o `token_acesso`**.

**Por que uma issue e não três:** todos editam **o mesmo arquivo**, `confirmacao/page.tsx` — endereço e link na região ~240–291, observação na lista de itens ~174–200. Issues separadas significariam vários `executar` e vários trios sobre o mesmo arquivo, com risco de conflito e um gate global que **não particiona a culpa**. O preço é higiene de backlog (uma issue com dois blocos); o ganho é ~4 invocações e zero conflito.

- **Bloco A — endereços curtos + link do Maps.** Arquivos: `src/lib/utils/<util novo>.ts` (+ `.test.ts`: formatação curta, adaptadores loja/JSONB e o montador puro do href), `whatsappPedido.ts` (+ `.test.ts`), `src/components/vitrine/confirmacao/LinkMapsLoja.tsx` (+ `.test.tsx`, novo — ver nota), `confirmacao/page.tsx`, `pedido/page.tsx`, `CheckoutWizard.tsx`, `EtapaEntrega.tsx`.
- **Bloco B — observação do comprador.** Arquivos: `src/components/vitrine/ObservacaoItem.tsx` (+ `.test.tsx`, novo), `Carrinho.tsx`, `checkout/EtapaItens.tsx`, `confirmacao/page.tsx`.
- **Proibidos (gate mecânico):** `src/lib/actions/pedido.ts`, `src/lib/actions/pedido.test.ts` (regressão, **não se edita**), `src/lib/actions/patches-loja.ts` (**consumido, não alterado** — a D2 só acrescenta um caller), `src/components/painel/**`, `supabase/migrations/**`, `src/lib/supabase/queries/**`, `src/lib/validacoes/**`.

**Nota sobre `LinkMapsLoja.tsx`:** o link poderia ficar inline na página, como o botão do WhatsApp vizinho. Mas a página de confirmação é Server Component `async` que lê Supabase — não dá para `renderToStaticMarkup`. Extrair um componente apresentacional de ~12 linhas é o que torna `target`/`rel` **mecanicamente testáveis**, exatamente como `StatusAssinatura.test.tsx:266-269` faz. É o custo de transformar a trava anti-vazamento de token em teste em vez de comentário.

**Suposição declarada no bloco B — pergunta (b), ainda sem resposta do usuário:** exibir a observação nas **três** telas do comprador — `Carrinho.tsx` (o `Sheet`, a gaveta lateral), `EtapaItens.tsx` (a lista de `/loja/[slug]/pedido` que ele citou) e a confirmação. Custa duas linhas a mais, cobre qualquer leitura de "sidebar" e deixa as telas do comprador em paridade com as três do lojista, que já exibem. Se ele responder "só a gaveta", é remoção trivial.

### Passo 3 — `tdd` (RED) — 1 agente, opus
Tudo mecanicamente testável (`environment: node`; `renderToStaticMarkup` onde for JSX):
- **Bloco A — formatação:** o util novo (todas as partes; partes faltando sem separador órfão; tudo vazio/`null` → `null`; string só de espaços = vazia). `montarLinkWhatsappPedido`: retirada **com** endereço → `Retirar em: rua, numero · bairro`; retirada **sem** endereço → linha **inexistente**; entrega → `Endereço:` **sem** cidade, estado nem CEP; todo o resto da mensagem idêntico.
- **Bloco A — href do Maps (novo):** origem literal `https://www.google.com/maps/search/?api=1&query=`; endereço com `&`, `#`, espaço e acento **não quebra o link** (prova do `encodeURIComponent`); **o CEP não aparece na consulta**; sem cidade/estado → `null` (sem link); **a consulta não contém `token`, `pedido` nem nada vindo de `searchParams`**.
- **Bloco A — `LinkMapsLoja` (novo):** `toContain('target="_blank"')`, `toContain("noopener")` e `toContain("noreferrer")` — copiando `StatusAssinatura.test.tsx:266-269`, **com o nome do teste dizendo o porquê**: *"`noreferrer` impede o `Referer` de entregar ao Google a URL da confirmação, que carrega o `token_acesso` do pedido"*. Endereço `null` → **nada no DOM**.
- **Bloco B — `ObservacaoItem`:** observação presente → aparece com rótulo; `null`/vazia/só espaços → **nada no DOM** (sem rótulo órfão, espelhando `whatsappPedido.test.ts:90`); quebras preservadas (`whitespace-pre-line`); **`<script>alert(1)</script>` sai escapado no HTML, nunca como tag**.
Gate: `npx vitest run` nos alvos com **output `FAIL` capturado e colado** na issue. `tdd` **para aqui**.

### Passo 4 — `executar` (GREEN) — 1 agente, opus
**Bloco A, nesta ordem:** util novo (formatação curta + montador do href, que chama `montarConsultaGeocoding` e `encodeURIComponent`) → `whatsappPedido.ts` (consome o util; alarga o `Pick` com `Partial`, descoberta 2) → `LinkMapsLoja.tsx` (copiando o bloco do botão de WhatsApp, `confirmacao/page.tsx:278-291`, com `MapPin`/`ExternalLink`) → `confirmacao/page.tsx` (remove a cópia local do formatador, usa o util, acrescenta o bloco de retirada + o link) → `pedido/page.tsx` deriva `enderecoLoja` de `loja` → `CheckoutWizard.tsx` repassa a prop às **duas** instâncias de `EtapaEntrega` (~229 e ~292 — celular e computador são árvores diferentes) → `EtapaEntrega.tsx` renderiza em retirada, **sem link** (RN-R6: link externo no checkout tiraria o cliente do fluxo antes de o pedido existir).
→ **rodar o gate aqui, antes do bloco B.**
**Bloco B:** `ObservacaoItem.tsx` espelhando `ListaOpcionaisItem` (apresentacional, vazio → `return null`, `whitespace-pre-line`, **o mesmo comentário de segurança** já escrito três vezes no painel) → plugar em `Carrinho.tsx`, `EtapaItens.tsx` e `confirmacao/page.tsx`, logo abaixo do `<ListaOpcionaisItem>` de cada um.
Gates (entre blocos e no fim): `npx tsc --noEmit` · `npx vitest run` (alvos + `pedido.test.ts` + `patches-loja.test.ts`) · `npm run lint` · `npm run build` · `git diff --name-only` ⊆ permitidos e **sem** `src/components/painel/`.
Escalonamento: se estagnar no meio, **repartir em duas invocações** (A, B) — plano B, não padrão.

### Passo 5 — `revisar` ‖ `testar` ‖ `auditar` — 3 agentes em paralelo (sonnet, sonnet, opus)
Uma única mensagem, três invocações. Sem `acelerar`.
Pauta fechada do `auditar`:
1. `[071]` de `pedido.test.ts` verdes e **não editados** (D4/RN-R4);
2. observação e endereço renderizados como **filho de JSX**, nunca `dangerouslySetInnerHTML`, e **nunca** em `href`/`src`/atributo — nas telas novas;
3. texto do **lojista** (`endereco_rua` etc.) no corpo da mensagem de WhatsApp — consegue forjar linha de sistema? Comparar com `citarTextoCliente`, que hoje protege só o texto do cliente;
4. **🔴 `token_acesso` (novo):** conferir que nenhum parâmetro de `searchParams` chega à URL do Maps, e que o `rel="noreferrer"` está presente **com teste** — é o que impede o `Referer` de entregar a URL da confirmação, com o token, ao Google (descoberta 11);
5. **🔴 href do Maps (novo):** esquema e domínio são **literais no código**; só a consulta é interpolada, sempre por `encodeURIComponent`; nenhum valor de banco ocupa a posição de esquema/domínio (nada de `javascript:` por campo de rua);
6. a redução de exibição não removeu **coleta** nem **gravação** de cidade/estado/CEP (o frete depende do CEP);
7. o endereço da loja segue exibição pura: não entra em `montarPayloadPedido`, não é persistido, não influencia frete, cupom ou total; e a D2 **não** expõe `latitude`/`longitude` (busca por texto).

### Passo 6 — `verificar` — 1 agente, sonnet
`npm run dev` contra o cloud, em `/loja/paodociso`, **nas duas larguras**:
1. "Retirada no local" → bloco com `rua, número · bairro` nas duas larguras, **sem link** no checkout;
2. pedido de retirada confirmado → a confirmação mostra o endereço **e o link do Maps**; clicar **uma vez de verdade**: abre em nova aba e cai no endereço certo;
3. pedido de entrega → confirmação e WhatsApp com o endereço do cliente **sem** cidade, estado e CEP; mensagem de retirada traz `Retirar em: ...`;
4. item **com observação** → aparece na gaveta, na lista do checkout e na confirmação;
5. **pré-checagem obrigatória:** conferir se "Pão do Ciso" tem endereço **com cidade e estado**. Sem isso o que estará na tela é o **fallback sem link** — nesse caso verificar também uma loja completa (ou preencher o endereço da loja de teste **pelo painel**, escrita autorizada do usuário, nunca escrita direta no banco).
Se algo falhar: **`depurar`** com o sintoma exato, nunca `executar` de novo às cegas.

### Passo 7 — `escriba` **condicional** — 0 ou 1 agente, sonnet
Gate: `grep -rn "Retirar em\|formatarEndereco\|montarConsultaGeocoding\|Entrega: Retirada no local\|jsdom" references/`.
Sem ocorrência → **pular**. Com ocorrência → 1 invocação, só para alinhar o trecho citado (atenção a `seguranca.md`, se ele documentar a convenção de link externo da issue 126).

### Passo 8 — `/pr` — degrau 1
Um PR para `main` com a issue 197. `/pr` roda os gates finais e abre; **não faz merge**. `gh pr create` exige confirmação humana. Remover de `tasks/` a issue entregue (CLAUDE.md: issue entregue é **removida**).

---

## 6. Custo estimado

| Passo | Agente/skill | Modelo | Invocações |
|---|---|---|---|
| 0–2 | sessão principal (spec + issue + branch) | — | 0 |
| 3 | `tdd` | opus | 1 |
| 4 | `executar` | opus | 1 |
| 5 | `revisar` ‖ `testar` ‖ `auditar` | sonnet, sonnet, opus | 3 |
| 6 | `verificar` | sonnet | 1 |
| 7 | `escriba` (condicional) | sonnet | 0–1 |
| 8 | `/pr` | skill leve | ~1 |

**Total: 7–8 invocações · opus: 3 · fable: 0 · degrau: 3 — igual à revisão 2.**

**Concordo com a leitura de que a D2 não muda a contagem**, e digo onde ela *de fato* pesa: entra no mesmo `executar`, no mesmo arquivo, e vira **+6 asserções** no `tdd` e **+2 itens** na pauta do `auditar`. O custo real não é invocação, é **+2 arquivos no diff** (`LinkMapsLoja.tsx` e seu teste) e ~10 linhas em `confirmacao/page.tsx`. O bloco A passa de 6 para 9 arquivos; por isso o gate entre blocos (§4) deixa de ser conforto e vira necessidade, e o escalonamento "repartir `executar` em duas invocações" fica mais provável de ser acionado — se for, o total sobe para 8–9 invocações e 4 opus. É o teto do orçamento, não o esperado.

Comparações:
- **vs. `/fluxo`:** economiza `especificar` + `quebrar` + `planejar` (**3 opus**) e preserva D3/D4 de uma reescrita.
- **vs. a revisão 1:** o item 3 caiu de "migration em tabela populada + RPC `criar_pedido` + `migrar` + TDD + `db push` irreversível" para um componente de 15 linhas e três call sites — **~8 invocações e ~5 opus a menos**, e uma escrita irreversível no cloud evitada.

---

## 7. Alternativa mais barata rejeitada

**Degrau 1, `/fix`.** Não cabe: ~11 arquivos de produção (teto 3); o diff encosta em `whatsappPedido.ts`, e a spec (RN-R7) manda travar o formato da mensagem com teste **antes** de editar — fase que `/fix` não tem; e o item 2 mais o link externo pedem `auditar`, que `/fix` também não tem. **Se o item 3 viesse sozinho**, aí seria `/fix` puro: 4 arquivos, sem banco, sem servidor — fica registrado como o corte natural se os itens 1 e 2 forem adiados.

**Três issues separadas (uma por item).** Rejeitada: todas editam `confirmacao/page.tsx`. Separar custaria vários `executar` e vários trios sobre o mesmo arquivo, com conflito provável e um gate global que não diz **qual** agente quebrou o tipo. Uma issue com dois blocos e gate entre blocos entrega o mesmo isolamento por ~4 invocações a menos.

**~~Deixar a D2 (link do Maps) fora~~ — rejeição derrubada.** A revisão 2 a excluía por três riscos; os três caíram contra o código: (1) reverse tabnabbing é **convenção vigente em 8 pontos do projeto, com teste-modelo pronto** em `StatusAssinatura.test.tsx:266-269`; (2) o bloco visual a copiar está no **mesmo arquivo, ~40 linhas abaixo** (`confirmacao/page.tsx:278-291`), então não há design novo nem `desenhar`; (3) o vazamento de `Referer` com o `token_acesso` é real, mas **o mesmo `rel` que a convenção já exige o bloqueia** — vira asserção de teste com o motivo nomeado, o que deixa o projeto *mais* protegido do que antes da D2, porque hoje nada impede um refactor de trocar `noreferrer` por só `noopener` naquela página. O trabalho que sobra — montar o `query=` — **também já existia pronto** (`montarConsultaGeocoding`, descoberta 9). Somando: a D2 custa +2 arquivos e +6 asserções, sem invocação nova. Foi decisão aprovada do dono em 2026-09-06 e nunca entregue; entregá-la agora é fechar um débito, não abrir escopo.

---

## 8. Lacunas

**Nenhuma lacuna de agente, skill ou decisão de produto.** O catálogo cobre tudo; a pergunta bloqueante da revisão 1 (snapshot × leitura viva de `produtos.descricao`) morreu com a correção do dono do produto; e a D2 deixou de ser dúvida com o "peça".

**Em aberto, aguardando o usuário — o plano não presume nenhuma das duas:**
- **(a) aprovação para executar.** O passo 0 não começa sem ela.
- **(b) a observação aparece nas três telas do comprador ou só na gaveta lateral?** A cobertura das três está no plano como **suposição declarada** (passo 2, bloco B), com o motivo escrito e a reversão barata caso a resposta seja "só a gaveta".
