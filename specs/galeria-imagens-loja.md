# Spec: Galeria de imagens da loja

**Versão:** 0.2.0 | **Atualizado:** 2026-10-06 (decisões D5–D10)

## Visão Geral

Hoje cada imagem da loja (foto de produto, logo) é enviada direto do formulário que a usa, vai para
o bucket `produtos` e só existe como uma URL gravada em `produtos.foto_url` ou `lojas.logo_url`.
Não há registro das imagens: o lojista não consegue reaproveitar uma foto em outro produto sem
reenviá-la, não vê o que já subiu, e o app nunca apaga objeto do Storage (só
`limparStorageDaLoja` ao excluir a loja), então trocar ou remover uma foto deixa o arquivo antigo
órfão para sempre.

A galeria resolve as três coisas:

1. **Uma página "Galeria" no painel** (`/painel/galeria`, link na sidebar) que mostra todas as
   imagens da loja, aceita envio direto (várias de uma vez) e remove uma ou várias com seleção
   múltipla.
2. **Reaproveitamento:** ao cadastrar/editar produto ou trocar a logo, o lojista escolhe entre
   "Enviar nova" e "Escolher da galeria". A galeria guarda a **original**; escolher uma imagem abre
   o cropper do destino (produto 4:3, logo 1:1 redondo) e grava uma **cópia recortada**.
3. **Remoção de verdade:** remover uma imagem apaga o arquivo do Storage e limpa os produtos e a
   logo que a usavam, com o uso recalculado no servidor no momento da remoção.

O hub admin (`/admin/assinantes/[lojaId]/galeria`) ganha a mesma galeria, pelo mesmo componente,
com Server Actions escopadas por `lojaId` validado no servidor.

**Mundos:** painel do lojista (auth obrigatório) e hub admin (auth admin). A vitrine pública não
muda de código: continua lendo `foto_url`/`logo_url` pelas views `vitrine_produtos`/`vitrine_lojas`
e cai no fallback (🍽️ / letra) quando a referência é limpa.

---

## Decisões já tomadas (não reabrir)

| # | Decisão | Consequência no spec |
|---|---------|----------------------|
| D1 | **Remover imagem em uso avisa e limpa.** A confirmação lista onde está em uso ("usada em 2 produtos e na logo"); confirmando, apaga o arquivo e zera `produtos.foto_url` / `lojas.logo_url` afetados. O uso é recalculado no servidor no momento da remoção. | RN-G7, RN-G8, RPC `remover_imagens_loja` |
| D2 | **Recorta ao usar.** A galeria guarda a original; escolher abre o cropper certo e gera uma cópia recortada. | RN-G3, coluna `origem_id`, `enviarFotoProduto`/`salvarLogoLoja` passam a exigir `origem_id` |
| D3 | **Importar tudo.** Backfill registra todas as imagens já existentes no Storage de cada loja, inclusive órfãs e logos removidas. | RN-G17, migration M3 |
| D4 | **Lojista e admin.** O hub admin ganha a galeria, com actions escopadas por `lojaId` validado no servidor (padrão `admin-upload.ts`/`admin-logo.ts`). | Páginas 2 e 4, `admin-galeria.ts` |
| D5 | **Recorte sem uso é apagado já na v1.** Quando um recorte perde o último uso (foto do produto trocada ou removida, produto excluído, logo trocada ou removida), ele é apagado. A original continua na galeria. Uma varredura de garantia roda a cada remoção na galeria. | RN-G20, RN-G21, triggers `AFTER` de M4, RPC `limpar_recortes_sem_uso` |
| D6 | **Teto de 200 originais por loja.** | RN-G12 |
| D7 | **Miniatura de 400 px** gerada no navegador no envio da original; a grade usa a miniatura. | P9 confirmada, RN-G5 |
| D8 | **Lote de remoção remove as válidas e avisa as que já tinham sumido.** "4 imagens removidas. 1 já tinha sido removida." Um id de outra loja cai no mesmo balde e nunca é afetado. | RN-G9, RPC passo 3 |
| D9 | **"Galeria" é item de primeiro nível na sidebar, logo depois de Produtos**, no painel e no admin. | Página 5 |
| D10 | **Imagem pequena demais avisa e deixa usar.** No cropper: "Esta imagem é pequena e pode ficar borrada. Prefira uma com pelo menos 800 px de largura." | Behavior nas páginas 3 e 4 |

## Premissas a confirmar (vete o que não servir)

Adotadas pela sessão principal ou por este spec. O resto do documento já está escrito em cima delas.

| # | Premissa | Se for vetada |
|---|----------|---------------|
| P1 | A grade da galeria mostra **só originais**. Cópias recortadas ficam ocultas, ligadas à original por `origem_id`. Remover a original remove as cópias e limpa produtos/logo que usam qualquer uma delas. | Cópias viram itens da grade; RN-G8 passa a valer por item, não por família |
| P2 | Imagens legadas (já recortadas, sem original) entram como **originais de si mesmas**. Escolher uma delas gera um recorte do recorte. | — |
| P3 | Upload direto no form de produto/logo grava **a original na galeria + a cópia recortada**, e só no "Confirmar" do cropper. Cancelar o cropper não sobe nada. | Ou sobe a original ao selecionar (sobra imagem ao cancelar), ou o form grava só o recorte e a galeria fica sem a original |
| P4 | A original é **reduzida no cliente** (lado maior ≤ 2048 px, webp) para caber no limite de 2 MB do bucket; o servidor revalida com `validarBlobImagem`. | Original enviada crua: foto de celular (4–8 MB) seria recusada pelo bucket |
| P5 | **Upload múltiplo** na página da galeria (fila sequencial, uma chamada de action por arquivo). | Um arquivo por vez |
| P6 | Excluir produto **não** apaga a **original**; ela fica na galeria. O **recorte** que o produto usava é apagado se perder o último uso (D5). | Excluir produto passaria a chamar a remoção (e a perguntar) |
| P7 | QR Pix (bucket `pix-qr`) fica **fora** da galeria. | — |
| P8 | ~~Teto~~ → **decidido em D6** (200). | — |
| P9 | ~~Miniatura~~ → **decidida em D7.** No envio de uma original o cliente gera também uma miniatura webp de lado maior 400 px, gravada ao lado. A grade usa a miniatura; legadas sem miniatura usam o próprio arquivo (já são ≤ 1280 px). Motivo: todo `<Image>` do projeto é `unoptimized` (ver "Divergências"), então sem miniatura uma página de 40 originais de 2048 px baixa ~15–25 MB no celular. | — |
| P10 | ~~Lote recusa inteiro~~ → **substituída por D8**: remove as válidas e devolve quantas foram ignoradas. É seguro porque toda escrita da RPC filtra `loja_id = p_loja_id`: um id alheio não tem efeito em nenhuma das duas formas. | — |
| P11 | Lote de remoção: **no máximo 50** imagens por chamada. | Outro teto |
| P12 | Recorte enviado mas nunca salvo (o lojista recortou e cancelou o form do produto) só é apagado pela varredura depois de **24 h** sem uso. A carência impede que a varredura apague um recorte que está num form aberto, ainda não salvo. | Outra carência |

---

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **iRango (SaaS)** | Guarda o registro das imagens; valida conteúdo (magic bytes), tamanho e posse no servidor; recalcula o uso e limpa referências numa transação; apaga do Storage depois do commit; isola por loja via RLS (lojista) e filtro explícito + `EscopoLoja` (admin). |
| **Lojista** | Envia imagens à galeria, reaproveita imagens em produtos e na logo (recortando), remove imagens da própria loja. |
| **Admin do SaaS** | Faz o mesmo que o lojista na loja-alvo, pelo hub admin, sob `service_role` escopado por `lojaId`. |
| **Cliente final** | Não age. Vê na vitrine a foto/logo atual, ou o fallback depois que uma imagem em uso é removida. |

---

## Páginas e Rotas

### 1. Galeria do lojista — `/painel/galeria`

**Mundo:** painel (auth obrigatório). Rota dentro de `(painel)/painel/(bloqueavel)/galeria/` (sujeita
ao paywall de assinatura, como Produtos).

**Descrição:** cabeçalho de página com título "Galeria", contador ("37 de 200 imagens") e botão
"Enviar imagens". Abaixo, grade de miniaturas das originais, mais recentes primeiro, com selo
"Em uso" nas que estão em algum produto ou na logo, e "Carregar mais" (keyset, 40 por página).
Botão "Selecionar" liga o modo de seleção: cada miniatura ganha um checkbox, e uma barra de ação
mostra "N selecionadas", "Limpar", "Cancelar" e "Remover". Remover abre um `AlertDialog` que
descreve o uso real informado pelo servidor ("3 imagens. 1 está em 2 produtos e na logo; esses
produtos ficam sem foto e a loja fica sem logo") antes de confirmar. Página vazia mostra texto +
CTA "Enviar imagens".

**Componentes:**
- `CabecalhoPagina` (reuso, `components/painel/CabecalhoPagina.tsx`) — título, contador e "Enviar imagens" na mesma linha (design-system §10.2 regra 5).
- **`GaleriaImagens`** (novo, `components/painel/GaleriaImagens.tsx`, client) — corpo da página, **compartilhado com o admin** (página 2). Recebe os dados iniciais do Server Component e um objeto `acoes` com todas as Server Actions **obrigatórias, sem default** (regra da issue 160, `seguranca.md` §7): `enviarImagem`, `listarMais`, `consultarUso`, `remover`.
- **`GradeImagens`** (novo, `components/painel/GradeImagens.tsx`, client) — grade + "Carregar mais" + seleção, com dois modos: `multipla` (página da galeria) e `unica` (seletor da página 3). Uma implementação só para os dois usos.
- **`EnvioImagensGaleria`** (novo, client, ou parte de `GaleriaImagens`) — `<input type="file" multiple>` oculto, fila sequencial, progresso por arquivo ("Enviando 2 de 5"), erro por arquivo sem derrubar a fila.
- Barra de seleção — **reusa o padrão** de `BarraSelecaoLote.tsx` (fixa no rodapé no mobile, `sticky top-0` a partir de `sm`, alvos `min-h-[44px] min-w-[44px]` literais), não o componente, que é acoplado a cardápios.
- `Card`, `Button`, `Checkbox`, `Badge`, `AlertDialog` (shadcn, já gerados); `sonner` para feedback; ícones `lucide-react` (`Images` para o item de menu).
- Util de redução no cliente — **reusa `exportarCrop`** (`lib/utils/exportarCrop.ts`) passando a área inteira da imagem (`croppedAreaPixels = {0,0,w,h}`, `aspect = w/h`, `larguraAlvo` calculada). Só o cálculo de dimensões é código novo, puro e testável (`calcularDimensoesReducao(w, h, ladoMaximo)`). A miniatura (P9) sai do mesmo caminho com `ladoMaximo = 400`. Nada de segundo código de canvas.
- Gate de UX antes de enviar — reusa `validarImagem` + `validarMagicBytes` (`lib/utils/validarImagem.ts`), igual a `UploadFotoProduto`.

**Behaviors:**
- [ ] Ver a grade de originais da loja, mais recentes primeiro, com selo "Em uso". Garantido em: **RLS** (`imagens_loja_leitura_propria`) — a query só devolve linhas da loja do dono; o selo vem de `uso_imagens_loja` no servidor. Cópias recortadas e linhas com remoção pendente não aparecem (filtro da query).
- [ ] Carregar mais imagens (keyset por `criado_em, id`). Garantido em: **Server Action + RLS** (`listarImagensGaleria`, loja derivada do auth; rate limit por loja). O cursor do cliente só posiciona a página, nunca escolhe a loja.
- [ ] Enviar uma ou várias imagens para a galeria. O cliente valida (UX), reduz a original a ≤ 2048 px webp, gera a miniatura e chama a action uma vez por arquivo, em fila. Garantido em: **Server Action** (`enviarImagemGaleria`: loja do auth, `validarBlobImagem` na original e na miniatura, teto por loja, rate limit, caminho montado no servidor) **+ RLS do bucket** (`produtos_insert_propria`) **+ RLS de `imagens_loja`** (INSERT só na própria loja) **+ CHECK** (caminho prefixado pelo `loja_id` da linha) **+ limites do bucket** (2 MB, jpeg/png/webp).
- [ ] Ver o contador "N de 200" e a recusa ao atingir o teto ("Você chegou a 200 imagens. Remova as que não usa para enviar novas."). Garantido em: **Server Action** (contagem autoritativa antes do upload); o contador na tela é preview.
- [ ] Ligar o modo de seleção, marcar e desmarcar imagens, limpar e cancelar. Garantido em: **cliente (UX)**; a seleção é só intenção.
- [ ] Pedir para remover as selecionadas e ler o uso real antes de confirmar. Garantido em: **Server Action** (`consultarUsoImagens`, loja do auth) — é **preview**; o número que vale é o recalculado na remoção (próximo behavior).
- [ ] Confirmar a remoção de uma ou várias imagens. **Garantido em: Server Action + RLS + RPC.** A action valida os ids (zod, 1..50, distintos), deriva a loja do auth e chama `remover_imagens_loja(p_loja_id, p_ids)`, que numa transação: prova posse, trava as linhas que são originais não pendentes **da loja** entre os ids recebidos, **ignora e conta** os demais (já removidos, pendentes, cópias ou de outra loja, D8), **recalcula o uso** (original + cópias), zera `foto_url` dos produtos e `logo_url` da loja afetados e marca as linhas como pendentes. Só depois do commit a action apaga os objetos do Storage (client autenticado, sob `produtos_delete_propria`) e então apaga as linhas. A lista de uso que o cliente viu nunca entra nessa conta. Na mesma chamada roda a varredura de recortes sem uso (RN-G21).
- [ ] Ver o resultado com os números devolvidos pela RPC: "3 imagens removidas. 2 produtos ficaram sem foto."; com ignoradas, "4 imagens removidas. 1 já tinha sido removida."; se nenhuma era válida, "As imagens selecionadas já tinham sido removidas." A grade recarrega. Garantido em: **Server Action** (números do servidor, não da seleção local).

---

### 2. Galeria do admin — `/admin/assinantes/[lojaId]/galeria`

**Mundo:** hub admin (auth admin; guard `verificarAdminSaaS()` em `admin/assinantes/layout.tsx`,
re-provado no loader da página antes de `createServiceClient()`, regra pós-pentest de
`seguranca.md` §7).

**Descrição:** a mesma tela da página 1, dentro do shell admin (faixa âmbar "Você está editando a
loja de outro lojista"). Mesmas ações, sobre a loja-alvo da URL.

**Componentes:**
- `GaleriaImagens` (reuso, o **mesmo arquivo** da página 1 — `paridade-hub-admin-painel.md`, "o painel do lojista é a fonte única do front").
- **`GaleriaAdminClient.tsx`** (novo wrapper, em `admin/assinantes/[lojaId]/galeria/`) — injeta as variantes `*Admin` com `lojaId` fixado em closure. Coberto automaticamente por `enforcement-props-action-admin.test.ts` (descobre todo `*AdminClient.tsx`).
- **`carga-galeria.ts`** (novo loader em `[lojaId]/`) — primeira página + contagem + uso, via `service_role` escopado por `lojaId`. Coberto automaticamente por `enforcement-escopo-admin.test.ts` (glob `carga*.ts`).
- `CabecalhoPagina` com `voltarHref` do admin.

**Behaviors:**
- [ ] Ver a galeria da loja-alvo. Garantido em: **Server Component + escopo** — `verificarAdminSaaS()` antes de elevar; leitura pela variante `(svc, lojaId)` da query, com `.eq("loja_id", lojaId)` explícito e `lojaId` validado por `z.guid()` (coberta por `enforcement-escopo-queries.test.ts`).
- [ ] Enviar imagens para a galeria da loja-alvo. Garantido em: **Server Action admin + escopo** (`enviarImagemGaleriaAdmin`: `validarLojaIdAdmin` antes de qualquer efeito, `prepararContextoAdmin` fora do `try` e antes de validar a imagem, caminho `${lojaId}/galeria/…` montado no servidor, INSERT por `escopo.inserir`) **+ CHECK** de prefixo do caminho.
- [ ] Carregar mais e consultar uso da loja-alvo. Garantido em: **Server Action admin + escopo**.
- [ ] Remover imagens da loja-alvo. **Garantido em: Server Action admin + RPC com filtro explícito de tenant.** Mesma RPC do lojista, chamada pela via de serviço com `p_loja_id` = `lojaId` validado (nunca do payload); a RPC filtra `loja_id = p_loja_id` em toda escrita (padrão "INVOKER com escopo explícito", `seguranca.md` §2, quarta/quinta instância). Antes do `storage.remove`, a action confere que cada caminho devolvido começa com `${lojaId}/` (sob `service_role` o caminho é a única amarra de isolamento no Storage). Registra `admin_acessos` (`galeria_remover`, metadados `{ quantidade }`).

---

### 3. Seletor de galeria a partir do produto — `/painel/produtos` e `/admin/assinantes/[lojaId]/produtos`

**Mundo:** painel (auth obrigatório) e hub admin (auth admin). O seletor abre de dentro do
`FormProduto`, que já vive num `Dialog` (desktop) ou `Sheet` (mobile) em `ProdutosClient`.

**Descrição:** o campo "Foto do produto" passa a oferecer duas saídas no estado vazio e no
"Substituir": **"Enviar nova"** (fluxo de hoje, agora gravando também a original na galeria) e
**"Escolher da galeria"**. Escolher abre o seletor: no mobile, `Dialog` de tela cheia (`h-dvh
w-screen`, sem cantos, igual ao `ProdutoModal`); a partir de `md:`, janela centralizada. Dentro,
a `GradeImagens` em modo `unica`. Ao tocar numa imagem, o seletor fecha e o cropper 4:3 que já
existe abre inline no form com aquela original. "Confirmar e enviar" grava a cópia recortada e
preenche o preview; o produto só muda quando o lojista salva o form (comportamento de hoje).

**Componentes:**
- **`SeletorGaleria`** (novo, `components/painel/SeletorGaleria.tsx`, client) — `Dialog` (shadcn) + `GradeImagens` modo `unica` + atalho "Enviar nova imagem" dentro do próprio seletor.
- **Classe do dialog de tela cheia extraída**, não copiada: hoje a string vive inline em `ProdutoModal.tsx:295`. Extrair para uma constante num módulo neutro (ex.: `components/shared/dialogTelaCheia.ts`, ao lado de `MensagemFormatada`) consumida por `ProdutoModal` e `SeletorGaleria`. Diferença permitida: largura desktop do seletor (`md:max-w-3xl`, grade de 4 colunas).
- `UploadFotoProduto` (modificar) — ganha "Escolher da galeria" e passa a mandar `origem_id` ao recortar. Props novas de action **obrigatórias, sem default** (issue 160): `onListarGaleria`, `onEnviarParaGaleria`. A prop existente `onEnviar` continua sendo o recorte.
- `UploadLogoLoja` (modificar, página 4) — mesma integração. **O fluxo "escolher origem → recortar → enviar recorte" não pode ser escrito duas vezes:** os dois uploaders já são quase cópias (338 e 340 linhas, mesma casca, mesmo cropper). Antes de adicionar a galeria, extrair a parte comum (hook `useOrigemDaImagem` ou casca `UploadImagemRecortada` parametrizada por `aspect`/`cropShape`/rótulos). A decisão entre hook e casca fica para o `planejar`; o spec exige uma implementação só do fluxo novo.
- `FormProduto`, `ProdutosClient` (modificar) — repassar as actions novas; o objeto `acoes` do `ProdutosClient` ganha as entradas correspondentes.
- `CardapioAdminClient` (modificar) — injeta as variantes admin. Falha de injeção é pega por `enforcement-props-action-admin.test.ts`.
- Cropper: `react-easy-crop` + `exportarCrop` (reuso, sem mudança). A original escolhida é baixada com `fetch` → `Blob` → `URL.createObjectURL`, e o cropper recebe esse objectURL. O caminho a partir daí é idêntico ao do arquivo local (mesma revogação, mesmo gate de magic bytes). Motivo: passar a URL remota direto ao canvas depende de a resposta ter vindo com CORS, senão o canvas fica contaminado e o `toBlob` falha.
  - **O `fetch` precisa de uma URL que o service worker nunca tenha guardado.** A regra [2] de `lib/pwa/runtimeCaching.ts` (`StaleWhileRevalidate` em `/storage/v1/object/public/`) guarda a resposta **opaca** de todo `<img>` sem `crossOrigin`, e a busca no Cache API ignora o `mode`. Um `fetch(url, { mode: "cors" })` da mesma URL recebe essa resposta opaca e falha com `TypeError`. Isso atinge sobretudo as imagens legadas, que são exibidas na grade pela própria URL (sem miniatura). Correção: o cropper busca `url + "?recorte=1"` (a chave do cache inclui a query, então é sempre um miss e vai à rede com CORS; o Storage ignora a query). Alternativa equivalente: uma regra `NetworkOnly` para requisições `mode: "cors"` ao Storage, antes da regra [2]. A escolha fica para o `planejar`; o critério de aceite é o recorte funcionar com o service worker ativo, verificado no navegador.

**Behaviors:**
- [ ] Abrir o seletor de galeria a partir do campo de foto. Garantido em: **cliente (UX)**. No mobile o seletor ocupa a tela inteira; `Escape` e o "Fechar" fecham **só o seletor**, nunca o `Dialog`/`Sheet` do form por baixo (regra de dialog aninhado, `design-system.md` §6 "Confirmação destrutiva"; verificar no navegador, sem Playwright nesta máquina).
- [ ] Navegar e carregar mais imagens no seletor. Garantido em: **Server Action + RLS** (mesma `listarImagensGaleria`; admin: variante escopada).
- [ ] Escolher uma imagem e recortá-la em 4:3. Garantido em: **cliente (UX)** — enquadramento é estético; o servidor não confia nele.
- [ ] Ver o aviso "Esta imagem é pequena e pode ficar borrada. Prefira uma com pelo menos 800 px de largura." quando a original tem menos de 800 px de largura; o lojista pode confirmar mesmo assim (D10). Garantido em: **cliente (UX)**, sem bloqueio no servidor. Limite em `galeria-contrato.ts` (`LARGURA_MINIMA_RECOMENDADA_PRODUTO = 800`).
- [ ] Confirmar o recorte: o cliente exporta o crop (webp ~1280×960) e chama `enviarFotoProduto` com o arquivo e o `origem_id`. Garantido em: **Server Action** (loja do auth; `origem_id` validado como original não pendente **da mesma loja** antes do upload; `validarBlobImagem`; caminho `{loja_id}/{uuid}.webp`) **+ RLS** (INSERT em `imagens_loja` e no bucket só na própria loja) **+ FK composta** (`(origem_id, loja_id)` → mesma loja; um `origem_id` de outra loja quebra com 23503 mesmo que a action falhe em checar).
- [ ] Enviar uma imagem nova pelo form: no "Confirmar e enviar", o cliente sobe primeiro a original (+ miniatura) com `enviarImagemGaleria` e depois o recorte com o `origem_id` devolvido. Cancelar o cropper não sobe nada. Garantido em: **Server Action + RLS** (as duas actions acima). Se a segunda chamada falhar, a original fica na galeria e o toast diz "A imagem foi para a galeria, mas o recorte falhou. Tente de novo pela galeria."
- [ ] Salvar o produto com a foto recortada. **Garantido em: Server Action + trigger no banco.** `schemaProduto` revalida a URL (`schemaStorageUrl`) e a action confere que ela é de imagem registrada e não pendente da loja (mensagem amigável); o trigger `produtos_foto_na_galeria` é a autoridade final e vale também para a via admin (`service_role` ignora RLS, não trigger). Fecha o "limite conhecido" do `foto-produto-painel.md` (hoje uma URL pública de outra loja passa no refine).
- [ ] Remover a foto do produto (✕). Garantido em: **cliente (UX) + Server Action** (`foto_url = null` no save, como hoje). A original continua na galeria.
- [ ] Trocar ou remover a foto de um produto, ou excluir o produto, apaga o recorte antigo se nenhum outro produto nem a logo o usa (D5). **Garantido em: trigger no banco + Server Action.** O trigger `AFTER UPDATE OF foto_url OR DELETE ON produtos` olha o valor antigo: se é um recorte (`origem_id` preenchido) sem outra referência na loja, marca a linha como pendente na mesma transação do save. Depois do save, a action processa até 50 pendentes da loja (Storage, depois DELETE das linhas), best-effort: falha não derruba o save e é retentada na próxima. A original nunca é apagada por esse caminho.

---

### 4. Seletor de galeria a partir da logo — `/painel/configuracoes/perfil` e `/admin/assinantes/[lojaId]/configuracoes/perfil`

**Mundo:** painel (auth obrigatório) e hub admin (auth admin).

**Descrição:** o bloco "Logo da loja" ganha as mesmas duas saídas. Escolher da galeria abre o
`SeletorGaleria`; a imagem escolhida vai para o cropper 1:1 redondo que já existe. Confirmar grava
a cópia recortada e já persiste `lojas.logo_url` (comportamento de hoje da logo, que salva
independente do botão "Salvar" do perfil).

**Componentes:**
- `UploadLogoLoja` (modificar; ver extração comum na página 3) — props novas obrigatórias `onListarGaleria`, `onEnviarParaGaleria`.
- `PerfilClient` (modificar) — repassa as props; a page do painel injeta as actions do lojista.
- `PerfilAdminClient` (modificar) — injeta as variantes admin com `lojaId` fixado. Coberto por `enforcement-props-action-admin.test.ts` e pelo teste de repasse existente (`PerfilClient.test.tsx`), que precisa ser estendido para as props novas.
- `SeletorGaleria`, `GradeImagens` (reuso da página 3).

**Behaviors:**
- [ ] Escolher uma imagem da galeria e recortá-la em círculo. Garantido em: **cliente (UX)**.
- [ ] Ver o aviso de imagem pequena quando a original tem menos de 400 px de largura (a logo sai com ~320 px; abaixo disso o recorte amplia). Garantido em: **cliente (UX)**, sem bloqueio (`LARGURA_MINIMA_RECOMENDADA_LOGO = 400`).
- [ ] Confirmar: o cliente exporta o crop (webp 1:1) e chama `salvarLogoLoja` com o arquivo e o `origem_id`. **Garantido em: Server Action + RLS + trigger.** Loja do auth; `origem_id` validado como original não pendente da loja; `validarBlobImagem`; caminho `{loja_id}/logo/{uuid}.webp`; INSERT da cópia em `imagens_loja` **antes** do `UPDATE lojas`; `schemaStorageUrl` antes do UPDATE; UPDATE sob `lojas_update_proprio`; trigger `lojas_logo_na_galeria` como autoridade final. Admin: `salvarLogoAdmin` com `escopo.atualizarLoja`.
- [ ] Enviar uma logo nova (original + recorte, como na página 3). Garantido em: **Server Action + RLS**.
- [ ] Remover a logo (✕). Garantido em: **Server Action + RLS** (`removerLogoLoja`, como hoje). A original continua na galeria.
- [ ] Trocar ou remover a logo apaga o recorte antigo se nenhum produto o usa (D5). Garantido em: **trigger** `AFTER UPDATE OF logo_url ON lojas` (mesma regra do produto) **+ Server Action** (`salvarLogoLoja`/`removerLogoLoja` e variantes admin processam os pendentes depois do UPDATE, best-effort).

---

### 5. Item "Galeria" na sidebar — shell `NavPainel`

**Mundo:** painel e hub admin (o shell é o mesmo componente, `components/painel/NavPainel.tsx`).

**Descrição:** item de primeiro nível "Galeria" (ícone `Images`), logo depois de "Produtos". Nos
dois mundos o `href` sai do `basePath` (`/painel/galeria`, `/admin/assinantes/[lojaId]/galeria`).
Como a rota admin existirá, não entra em `rotasAusentes`.

**Componentes:**
- `construirItens` em `NavPainel.tsx` (modificar) — um item novo na lista.
- `NavPainel.test.tsx` (estender) — ordem dos itens e `href` nos dois `basePath`.

**Behaviors:**
- [ ] Ver e clicar no item "Galeria" no painel e no hub admin, com estado ativo em `/galeria`. Garantido em: **cliente (UX de navegação)**. O acesso real é o guard do layout (painel: `decidirAcessoBase` + `decidirAssinatura`; admin: `verificarAdminSaaS()`).

---

### 6. Exclusão permanente de loja (admin) — `/admin/assinantes` (ação existente)

**Mundo:** hub admin (auth admin).

**Descrição:** `limparStorageDaLoja` (`src/app/admin/assinantes/actions.ts`) hoje lista as pastas
`${lojaId}/` e `${lojaId}/logo/` com `list()` sem paginação (a API devolve no máximo 100 itens por
chamada) e não conhece a pasta nova `galeria/`. Passa a ler os caminhos de `imagens_loja`
(`caminho` + `miniatura_caminho`) **antes** do DELETE da loja (a tabela cai em cascata junto) e
remover em blocos de até 100, mantendo a listagem atual como complemento para objetos que não
estejam registrados.

**Behaviors:**
- [ ] Excluir a loja apaga todos os objetos de imagem registrados, em blocos. Garantido em: **Server Action admin** (`verificarAdminSaaS()` antes; caminhos filtrados por prefixo `${lojaId}/`; best-effort, nunca aborta o DELETE, como hoje).

---

## Modelos de Dados

### Tabela nova `imagens_loja` (migration M1)

```sql
CREATE TABLE imagens_loja (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id             uuid NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  -- NULL = original (aparece na grade). Preenchido = cópia recortada dessa original (oculta).
  origem_id           uuid NULL,
  -- Caminho RELATIVO ao bucket `produtos` (nunca prefixado por "produtos/", seguranca.md §18).
  caminho             text NOT NULL,
  -- Miniatura da original (P9). NULL em cópias e em legadas.
  miniatura_caminho   text NULL,
  -- Tamanho medido no servidor (buffer recebido), não informado pelo cliente.
  bytes               integer NULL CHECK (bytes IS NULL OR bytes BETWEEN 1 AND 2097152),
  -- Marcada na remoção, antes de apagar do Storage (RN-G10). Linha pendente some da grade,
  -- não pode ser escolhida nem referenciada, e não conta para o teto.
  remocao_pendente_em timestamptz NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT imagens_loja_id_loja_unico   UNIQUE (id, loja_id),
  CONSTRAINT imagens_loja_caminho_unico   UNIQUE (caminho),
  -- Cópia e original sempre da mesma loja. Apagar a original apaga as cópias.
  CONSTRAINT imagens_loja_origem_fk FOREIGN KEY (origem_id, loja_id)
    REFERENCES imagens_loja (id, loja_id) ON DELETE CASCADE,
  -- Uma linha da loja A nunca aponta para objeto da pasta da loja B: apagar a linha
  -- nunca apaga arquivo alheio, nem pela via de serviço.
  CONSTRAINT imagens_loja_caminho_da_loja
    CHECK (starts_with(caminho, loja_id::text || '/') AND position('..' in caminho) = 0),
  CONSTRAINT imagens_loja_miniatura_da_loja
    CHECK (miniatura_caminho IS NULL
           OR (starts_with(miniatura_caminho, loja_id::text || '/')
               AND position('..' in miniatura_caminho) = 0)),
  CONSTRAINT imagens_loja_recorte_sem_miniatura
    CHECK (origem_id IS NULL OR miniatura_caminho IS NULL)
);

-- Grade: originais visíveis, keyset por (criado_em, id).
CREATE INDEX imagens_loja_grade_idx ON imagens_loja (loja_id, criado_em DESC, id DESC)
  WHERE origem_id IS NULL AND remocao_pendente_em IS NULL;
-- Família de uma original (uso, remoção, cascata).
CREATE INDEX imagens_loja_origem_idx ON imagens_loja (origem_id) WHERE origem_id IS NOT NULL;
```

**RLS (obrigatória antes de produção, `seguranca.md` §2):**

| Política | Operação | Regra |
|----------|----------|-------|
| `imagens_loja_leitura_propria` | SELECT | `EXISTS (SELECT 1 FROM lojas WHERE lojas.id = imagens_loja.loja_id AND lojas.dono_id = auth.uid())` |
| `imagens_loja_insert_propria` | INSERT | `WITH CHECK` igual |
| `imagens_loja_update_propria` | UPDATE | `USING` + `WITH CHECK` iguais; **grant de coluna** só em `remocao_pendente_em` (`GRANT UPDATE (remocao_pendente_em) ... TO authenticated`, precedente `clientes`) |
| `imagens_loja_delete_propria` | DELETE | `USING` igual |
| — | anon | **nenhuma política e `REVOKE ALL ... FROM anon`** explícito: os default privileges do projeto concedem tudo a `anon` em tabela nova (`seguranca.md` §19). A vitrine não lê esta tabela. |

GRANTs: `authenticated` = SELECT, INSERT, DELETE + UPDATE(coluna); `service_role` = ALL.

### Funções e triggers

| Objeto | Migration | Forma | Papel |
|--------|-----------|-------|-------|
| `public.caminho_storage_produtos(url text) → text` | M1 | `IMMUTABLE`, `SET search_path = public` | Extrai o caminho relativo ao bucket de uma URL pública (`…/storage/v1/object/public/produtos/<caminho>`); `NULL` se a URL não tiver essa forma. **Fonte única** do casamento URL ↔ registro, usada pela RPC de uso, pela de remoção, pelos triggers e pelo backfill. Não reimplementar em TS: o lado TS só faz caminho → URL com `getPublicUrl`. |
| `public.uso_imagens_loja(p_loja_id uuid, p_ids uuid[])` | M2 | `STABLE`, `SECURITY INVOKER`, filtro `loja_id = p_loja_id` explícito no corpo | Por original: quantos produtos (e quais: id, nome, `oculto`, até 5 nomes) e se a logo usam a original **ou qualquer cópia**. Serve o selo "Em uso" e a prévia da confirmação. `REVOKE ALL FROM public, anon`; `GRANT EXECUTE TO authenticated, service_role`. |
| `public.remover_imagens_loja(p_loja_id uuid, p_ids uuid[]) → jsonb` | M2 | `SECURITY INVOKER` + filtro de tenant explícito em toda escrita + T2 de posse antes de qualquer escrita (quinta instância, `seguranca.md` §2) | Ver "Ordem das operações na remoção". Devolve `{ caminhos: text[], removidas: int, ignoradas: int, produtos_limpos: int, logo_limpa: bool }`. `REVOKE ALL FROM public, anon`; `GRANT EXECUTE TO authenticated, service_role`. |
| `public.importar_imagens_do_storage() → int` | M3 | `SECURITY DEFINER`, `SET search_path = public, pg_temp`; `REVOKE ALL FROM public, anon, authenticated, service_role` (só o dono roda) | Backfill idempotente (RN-G17). Criada sempre; **chamada** só se `to_regclass('storage.objects') IS NOT NULL`. |
| `produtos_foto_na_galeria_trg` | M4 | `BEFORE INSERT OR UPDATE OF foto_url ON produtos`, `WHEN (NEW.foto_url IS NOT NULL AND NEW.foto_url IS DISTINCT FROM OLD.foto_url)` (no INSERT: `NEW.foto_url IS NOT NULL`) | Recusa `foto_url` cujo caminho não seja de linha de `imagens_loja` **da mesma loja** e sem remoção pendente. Lê a linha com `FOR KEY SHARE` (serializa com a remoção, ver casos-limite). Mensagem fixa e reconhecível pela action (`produto-contrato.ts`), nunca o erro cru. **Limite:** o trigger compara só o **caminho** depois de `/storage/v1/object/public/produtos/`, porque o banco não conhece `NEXT_PUBLIC_SUPABASE_URL`. Uma URL de outro host com o mesmo caminho passaria por ele. O host é garantido por `schemaStorageUrl` na action (lojista e admin). Então o trigger é a autoridade sobre **posse e registro**, e o zod é a autoridade sobre o **host**. |
| `lojas_logo_na_galeria_trg` | M4 | `BEFORE UPDATE OF logo_url ON lojas`, mesmo `WHEN` | Idem para `logo_url`. Convive com `lojas_protege_billing_trg`. |
| `produtos_recorte_sem_uso_trg` | M4 | `AFTER UPDATE OF foto_url OR DELETE ON produtos`, `WHEN (OLD.foto_url IS NOT NULL AND OLD.foto_url IS DISTINCT FROM NEW.foto_url)` (no DELETE: `OLD.foto_url IS NOT NULL`) | D5: se o caminho antigo é de um **recorte** (`origem_id IS NOT NULL`) da mesma loja e nenhum outro produto nem a logo da loja o referencia, marca `remocao_pendente_em = now()`. Nunca toca original. O Storage fica com a action (o banco não chama a API do Storage). |
| `lojas_recorte_sem_uso_trg` | M4 | `AFTER UPDATE OF logo_url ON lojas`, mesmo `WHEN` | Idem para a logo antiga. |
| `public.limpar_recortes_sem_uso(p_loja_id uuid) → text[]` | M2 | `SECURITY INVOKER`, filtro de tenant explícito, T2 de posse (mesmo padrão de `remover_imagens_loja`) | Varredura de garantia (RN-G21): marca como pendentes os recortes da loja sem nenhuma referência e com `criado_em < now() - interval '24 hours'` (P12), e devolve, com teto de 50, os caminhos de **todas** as linhas pendentes da loja (as recém-marcadas e as que sobraram de falhas anteriores) para a action apagar. `REVOKE ALL FROM public, anon`; `GRANT EXECUTE TO authenticated, service_role`. |

> **O `WHEN ... IS DISTINCT FROM OLD` é obrigatório, não otimização.** `atualizarProduto` manda o
> payload inteiro (`...parsed.data`), então todo UPDATE de produto inclui `foto_url` no `SET` e
> dispararia `UPDATE OF foto_url` mesmo sem mudar o valor. Sem o `WHEN`, um produto legado cuja
> `foto_url` aponta para objeto inexistente (não importado pelo backfill) ficaria impossível de
> editar.

### Colunas existentes afetadas (sem migration de coluna)

- `produtos.foto_url` e `lojas.logo_url` (`schema.md` §2): passam a ser zeradas pela RPC de remoção e guardadas pelos triggers de M4. Não mudam de tipo. Nenhuma outra tabela guarda imagem (`opcionais`, `categorias`, `modais_sazonais`, `cardapios` não têm coluna de imagem; o QR Pix fica em `pix-qr`, fora, P7).
- Views `vitrine_produtos` e `vitrine_lojas`: **sem mudança**.

### Storage

- Bucket `produtos` reusado: mesmas 4 policies (`produtos_leitura_publica`, `produtos_insert_propria`, `produtos_update_propria`, `produtos_delete_propria`), mesmos limites (2 MB, jpeg/png/webp). **Nenhuma policy nova.**
- Caminhos (montados no servidor, nunca `file.name`, relativos ao bucket):

| Objeto | Caminho |
|--------|---------|
| Original | `{loja_id}/galeria/{uuid}.{ext}` (ext do tipo real) |
| Miniatura | `{loja_id}/galeria/mini/{uuid}.webp` |
| Recorte de produto | `{loja_id}/{uuid}.webp` (igual a hoje) |
| Recorte de logo | `{loja_id}/logo/{uuid}.webp` (igual a hoje) |

### Tipos gerados

Depois do `db push` de M1/M2, regenerar `src/lib/database.types.ts`
(`npx supabase gen types typescript > src/lib/database.types.ts`). `src/types/supabase.ts` está
morto: não tocar.

---

## Server Actions, queries e módulos

| Onde | O quê |
|------|-------|
| `src/lib/actions/galeria.ts` (`'use server'`, novo) | `enviarImagemGaleria(formData)`, `listarImagensGaleria(cursor?)`, `consultarUsoImagens(ids)`, `removerImagensGaleria(ids)` — lojista, client autenticado (RLS), loja de `buscarLojaDoDono`. |
| `src/lib/actions/galeria-contrato.ts` (neutro, novo) | Fonte única dos dois mundos (padrão `produto-contrato.ts`/`cardapio-contrato.ts`, architecture §8): tipos (`ImagemGaleria`, `ResultadoEnvioGaleria`, `UsoImagem`, `ResultadoRemocao`), constantes (`TETO_IMAGENS_POR_LOJA`, `MAXIMO_LOTE_REMOCAO = 50`, `POR_PAGINA_GALERIA = 40`, `LADO_MAXIMO_ORIGINAL = 2048`, `LADO_MINIATURA = 400`), montadores de caminho (`caminhoOriginal`, `caminhoMiniatura`, `caminhoRecorte(lojaId, "produto" \| "logo", ext)`), `caminhoDaLoja(caminho, lojaId)`, mensagens literais e o reconhecedor da mensagem dos triggers de M4. Sem I/O. |
| `src/lib/validacoes/galeria.ts` (novo) | `schemaIdsImagens` (`z.array(z.guid()).min(1).max(50)` + recusa de duplicata), `schemaCursorGaleria`, `schemaOrigemId`. |
| `src/lib/supabase/queries/imagens.ts` (novo) | `listarImagensDaLoja(client, …)` (lojista, RLS) e `listarImagensDaLojaAdmin(svc, lojaId, …)` com `.eq("loja_id", lojaId)` (descoberta por `enforcement-escopo-queries.test.ts`); `buscarOriginalDaLoja(client, lojaId, id)`; `contarOriginaisDaLoja`. |
| `src/lib/actions/upload.ts` (modificar) | `enviarFotoProduto` passa a **exigir** `origem_id` no FormData, valida a origem, sobe o recorte e insere a linha-cópia. Rate limit novo. |
| `src/lib/actions/logo.ts` (modificar) | `salvarLogoLoja` passa a exigir `origem_id`; insere a cópia antes do UPDATE. **Corrigir** `revalidarVitrine`, que hoje revalida `/${slug}` em vez de `/loja/${slug}`. |
| `src/lib/actions/produto.ts`, `admin-produtos.ts` (modificar) | Traduzir a recusa do trigger de M4 em mensagem amigável ("A foto escolhida foi removida da galeria. Escolha outra."), via `produto-contrato.ts`. |
| `src/app/admin/assinantes/actions/admin-galeria.ts` (novo) | `enviarImagemGaleriaAdmin(formData)` (com `loja_id` no FormData, como `admin-upload.ts`), `listarImagensGaleriaAdmin(lojaId, cursor?)`, `consultarUsoImagensAdmin(lojaId, ids)`, `removerImagensGaleriaAdmin(lojaId, ids)`. Todas: `validarLojaIdAdmin` → `prepararContextoAdmin` fora do `try` → efeito; `registrarAcessoAdmin`; `revalidarLojaAdmin`. Auto-descobertas pelos enforcements admin. |
| `admin-upload.ts`, `admin-logo.ts` (modificar) | Mesma mudança do lojista (`origem_id` obrigatório, linha-cópia por `escopo.inserir`). |
| `src/lib/utils/rateLimit.ts` (modificar) | Chaves novas, identificador = `loja.id` da sessão (precedente `carregarMaisClientes`, issue 350): `enviarImagemGaleria` 30/min, `recorteImagem` 20/min, `removerImagensGaleria` 10/min, `listarImagensGaleria` 30/min. |
| `src/app/admin/assinantes/actions.ts` (modificar) | `limparStorageDaLoja` lê caminhos de `imagens_loja` antes do DELETE (página 6). |

**Reuso obrigatório (não recriar):** `validarBlobImagem` (`lib/actions/upload-imagem.ts`),
`validarImagem`/`validarMagicBytes`, `exportarCrop`, `schemaStorageUrl`, `CAMPO_ARQUIVO`
(`upload-contrato.ts`), `buscarLojaDoDono`, `validarLojaIdAdmin`/`prepararContextoAdmin`/
`registrarAcessoAdmin`/`revalidarLojaAdmin`, `EscopoLoja`, `verificarRateLimit`/`extrairIp`,
`fotoSegura`/`urlHttpsSegura` no render, `react-easy-crop`, `CabecalhoPagina`, shadcn `Dialog`/
`AlertDialog`/`Checkbox`/`Badge`/`Card`.

---

## Ordem das operações na remoção

Dentro de `remover_imagens_loja(p_loja_id, p_ids)`, numa transação:

1. **T1 forma:** `cardinality(p_ids)` entre 1 e 50 e sem duplicata (`cardinality()`, nunca `array_length`).
2. **T2 posse, antes de qualquer escrita:** `lojas.dono_id = auth.uid()` para `p_loja_id`, **ou** via de serviço pelos dois sinais em conjunção (`coalesce(auth.role(), '') = 'service_role'` **e** `current_setting('role', true)` fora de `authenticated`/`anon`). Senão `raise`. Sem isso, um dono passando a loja de outro e ids inexistentes produziria "0 linhas" sob RLS, indistinguível de sucesso.
3. **Trava e filtro:** `SELECT … FROM imagens_loja WHERE loja_id = p_loja_id AND id = ANY(p_ids) AND origem_id IS NULL AND remocao_pendente_em IS NULL FOR UPDATE`. Só essas linhas seguem; `ignoradas = cardinality(p_ids) - count` (já removidas, pendentes, cópias ou de outra loja, D8). Nenhuma linha válida ⇒ devolve `removidas = 0` sem escrever. Depois, travar também as cópias das válidas (`origem_id = ANY(validas)`). **Por que ignorar é seguro:** os passos 5–7 só escrevem em linhas com `loja_id = p_loja_id` e em ids que passaram por este filtro; um id alheio nunca chega a eles. O teste afirma que a imagem da outra loja fica intacta, e não só a contagem.
4. **Recalcular o uso agora**, com as linhas já travadas: conjunto de caminhos = originais + cópias.
5. `UPDATE produtos SET foto_url = NULL WHERE loja_id = p_loja_id AND caminho_storage_produtos(foto_url) = ANY(caminhos)` — qualquer estado do produto (oculto, indisponível, exclusivo de cardápio, fora da janela de frequência).
6. `UPDATE lojas SET logo_url = NULL WHERE id = p_loja_id AND caminho_storage_produtos(logo_url) = ANY(caminhos)`.
7. `UPDATE imagens_loja SET remocao_pendente_em = now()` nas originais e cópias.
8. Devolver os caminhos (incluindo miniaturas) e as contagens. **Commit.**

Na Server Action, depois do commit:

9. Conferir que cada caminho devolvido começa com `${loja.id}/` (lojista) ou `${lojaId}/` (admin); caminho fora disso é bug, loga e não remove.
10. `storage.from("produtos").remove(caminhos)` — lojista com o client autenticado (a policy `produtos_delete_propria` é segunda camada), admin com `svc`.
11. **Sucesso:** `DELETE FROM imagens_loja WHERE loja_id = … AND id = ANY(originais) AND remocao_pendente_em IS NOT NULL` (as cópias caem pela FK em cascata). Admin: `.eq("loja_id", lojaId)` explícito (camada 3 do enforcement).
12. **Falha do Storage:** as linhas ficam pendentes. O lojista recebe sucesso (para ele a imagem saiu: sumiu da grade e nada mais a referencia); o detalhe vai para `console.error` (§14). A próxima chamada de remoção da mesma loja começa retentando até 50 caminhos pendentes. `remove()` de caminho que já não existe não é erro, então a retentativa é idempotente.
13. Revalidar: `/painel/galeria`, `/painel/produtos`, `/painel/configuracoes/perfil`, `revalidatePath("/loja/[slug]", "page")`; admin: `revalidarLojaAdmin(lojaId)` + `/admin/assinantes/${lojaId}/galeria`.

**Por que banco antes do Storage:** na ordem inversa, uma falha entre os passos deixaria
`foto_url` apontando para arquivo apagado, e a vitrine mostraria imagem quebrada em vez do
fallback. Banco primeiro, o pior caso é arquivo órfão (custo), registrado como pendente e
retentado.

---

## Regras de Negócio

| # | Regra | Camada que garante |
|---|-------|--------------------|
| RN-G1 | Toda imagem pertence a uma loja. O lojista só lê e escreve imagens da própria loja; o admin, só da loja-alvo validada. | **RLS** de `imagens_loja` (lojista) + **filtro explícito / `EscopoLoja`** (admin) + **CHECK** de prefixo do caminho + **FK composta** da origem |
| RN-G2 | A grade mostra só originais sem remoção pendente. | **Query no servidor** (filtro + índice parcial) |
| RN-G3 | Todo recorte tem origem: uma original sem remoção pendente da mesma loja. | **Server Action** (valida `origem_id` antes do upload) + **FK composta** (mesma loja, 23503) |
| RN-G4 | Original, miniatura e recorte são imagens reais JPEG/PNG/WEBP de até 2 MB cada. | **Server Action** (`validarBlobImagem`: tipo, tamanho, magic bytes) + **limites do bucket** |
| RN-G5 | A original chega reduzida (lado maior ≤ 2048 px, webp) e o par original + miniatura cabe em 1,9 MB por chamada (o `bodySizeLimit` das Server Actions é 2 MB e não muda). | **Cliente** (UX e custo). O servidor não confia: só revalida tipo e tamanho |
| RN-G6 | `produtos.foto_url` e `lojas.logo_url` só aceitam URL de imagem registrada, sem remoção pendente, da mesma loja. | **Trigger** (autoridade, vale para `service_role`) + **Server Action** (`schemaStorageUrl` e checagem prévia para a mensagem) |
| RN-G7 | O uso de uma imagem é recalculado no servidor, na mesma transação que limpa as referências. O que o cliente mostrou antes é prévia. | **RPC** `remover_imagens_loja` |
| RN-G8 | Remover uma original remove todas as cópias e limpa todo produto, em qualquer estado, e a logo que usem a original ou qualquer cópia. A vitrine cai no fallback. | **RPC** |
| RN-G9 | Lote de remoção: 1 a 50 ids distintos. Remove os que são originais sem remoção pendente da loja; os demais são ignorados, contados e informados ("1 já tinha sido removida"), sem nenhum efeito sobre eles. | **zod** na Server Action (forma) + **RPC** (filtro por `loja_id` em toda escrita) |
| RN-G10 | Banco antes do Storage; falha do Storage deixa a linha pendente e é retentada; nunca uma referência viva aponta para objeto apagado. | **RPC + Server Action** (sequência acima) |
| RN-G11 | Excluir produto não apaga a **original**; o recorte que só ele usava cai por RN-G20. | **Teste de regressão** em `removerProduto` (original intacta, recorte pendente) |
| RN-G12 | Teto de 200 originais por loja (D6). Recortes e pendentes não contam. | **Server Action**, regra no `galeria-contrato.ts` para os dois mundos. É contenção de custo, não barreira: o upload direto ao Storage com a anon key já é possível hoje (ver Segurança) |
| RN-G13 | Rate limit por loja nas actions do lojista (valores acima). Admin sem rate limit (um operador). | **Server Action** (`rateLimit.ts`, fail-open) |
| RN-G14 | QR Pix fica fora da galeria. | Escopo: nenhuma action da galeria toca `pix-qr` |
| RN-G15 | Excluir a loja apaga todos os objetos registrados, lidos da tabela antes do DELETE, em blocos de 100. | **Server Action admin**, best-effort |
| RN-G16 | Caminhos montados no servidor, relativos ao bucket, nome UUID, extensão do tipo real. | **Server Action** (`galeria-contrato.ts`) + **CHECK** de prefixo |
| RN-G17 | O backfill registra como original todo objeto do bucket `produtos` cujo primeiro segmento é o id de uma loja existente e cujo mimetype é de imagem; idempotente; ignora objetos de loja que não existe mais e o bucket `pix-qr`. | **Migration M3** (`ON CONFLICT (caminho) DO NOTHING`) |
| RN-G18 | Cancelar o cropper não sobe nada. | **Cliente** |
| RN-G19 | Toda action admin prova admin antes de elevar, valida `lojaId` antes de qualquer efeito e registra em `admin_acessos`. | **Server Action admin** + enforcements automáticos |
| RN-G20 | Um recorte que perde o último uso (foto de produto trocada ou removida, produto excluído, logo trocada ou removida) é marcado para remoção na mesma transação e apagado do Storage logo depois. Original nunca é apagada por esse caminho, só pela remoção na galeria. | **Trigger `AFTER`** (marca) + **Server Action** (Storage, best-effort, mesma sequência banco → Storage de RN-G10) |
| RN-G21 | A cada remoção na galeria, uma varredura marca os recortes da loja sem uso há mais de 24 h e apaga até 50 pendentes. A carência protege o recorte que está num form aberto e ainda não foi salvo. | **RPC** `limpar_recortes_sem_uso` + **Server Action** |

---

## Segurança (obrigatório)

- **Dado sensível:** imagens são públicas por design (bucket público, aparecem na vitrine). Não há PII estruturada nem valor monetário. Os riscos são **isolamento** (loja A ler, usar ou apagar imagem da loja B), **integridade do upload** (arquivo malicioso, DoS por tamanho) e **apagar arquivo alheio** (a remoção é a primeira operação do app que apaga objeto do Storage fora da exclusão de loja).
- **Valor monetário?** Não. Nenhum recálculo de preço. O equivalente aqui é o **uso**: recalculado no servidor na RPC, nunca vindo do cliente.
- **Tabela nova:** `imagens_loja`, com as 4 políticas acima, `REVOKE` explícito de `anon` e grant de coluna no UPDATE.
- **Funções novas:** todas com `REVOKE ALL FROM public, anon` nomeando `anon` (a ACL padrão do projeto concede `EXECUTE` a `anon` por entrada própria, `seguranca.md` §2), `SET search_path`, `cardinality()` para array do cliente, T2 com `coalesce(auth.role(), '')`.
- **Isolamento no Storage sob `service_role`:** o admin apaga com `svc`, que ignora a policy do bucket. Três barreiras: CHECK de prefixo na linha, filtro `loja_id = p_loja_id` na RPC, conferência do prefixo na action antes do `remove`.
- **Upload:** `validarBlobImagem` em cada blob (original, miniatura, recorte); caminho no servidor; erro genérico ao cliente, detalhe no log (§14).
- **API externa com key?** Não. Só Supabase Storage/Postgres.
- **XSS:** o render da grade e do seletor passa por `fotoSegura`/`urlHttpsSegura` (§15), como o resto do painel.
- **Remover não é apagar na hora para o mundo:** o CDN do Supabase cacheia objetos públicos (padrão 1 h), o service worker cacheia imagens do Storage com `StaleWhileRevalidate`, e o Router Cache do Next guarda páginas por 30 s. A URL removida pode continuar acessível por algum tempo e um card pode mostrar a imagem antiga por até 30 s. Para LGPD (foto com pessoa), registrar no texto de ajuda que a remoção é definitiva mas a propagação não é instantânea.
- **Resíduo pré-existente (não criado aqui, fica registrado):** `produtos_insert_propria` permite ao lojista subir objetos direto ao bucket pela API REST do Storage com a anon key + JWT, sem passar pela action. Isso contorna magic bytes e o teto da galeria. Hoje vale para qualquer pasta da própria loja. A galeria **não fecha** esse vetor: como `authenticated` tem `INSERT` em `imagens_loja` (é o que deixa a action do lojista rodar sem `service_role`), o lojista pode, pela API REST, subir um objeto direto ao bucket e registrar ele mesmo a linha, e aí o trigger de RN-G6 aceita esse objeto como `foto_url`. O alcance continua o de hoje: só a pasta da própria loja (CHECK de prefixo + RLS) e só tipos que o bucket aceita no Content-Type declarado. A galeria também não piora o vetor, porque hoje `schemaStorageUrl` já aceita qualquer URL do Storage. Do mesmo jeito, `UPDATE(remocao_pendente_em)` e `DELETE` diretos permitem ao lojista bagunçar o registro da própria loja (tirar uma linha de pendente, apagar uma linha ainda referenciada); o dano fica restrito à loja dele. Fechar tudo exige que o upload e a escrita em `imagens_loja` passem só por funções `SECURITY DEFINER` com checagem de posse, e que o INSERT direto no bucket seja retirado. Fica como issue separada.
- **TDD red-first (crítico: SIM):**
  1. RLS cross-tenant de `imagens_loja` em pglite: lojista A não lê, insere, atualiza nem apaga linha de B; CHECK recusa caminho da pasta de B; FK composta recusa `origem_id` de B (23503); anon não lê nada.
  2. `remover_imagens_loja`: lote misto (ids de A + um id de B) ⇒ remove só os de A, devolve `ignoradas = 1`, e a linha, os produtos e a logo de B ficam **intactos** (afirmar o estado de B, não só a contagem); lojista com `p_loja_id` de B ⇒ recusa por posse (afirmar o fragmento da mensagem, não só o SQLSTATE); claim `service_role` forjado em sessão `authenticated` ⇒ recusa; via de serviço com `p_loja_id` correto ⇒ limpa produtos (inclusive `oculto = true` e `disponivel = false`) e logo que usam original ou cópia; produto de B com caminho parecido intocado; segunda chamada com os mesmos ids ⇒ `removidas = 0`, `ignoradas = N`, nenhuma escrita.
  3. Triggers de M4: `foto_url` de caminho não registrado ⇒ recusa; de imagem de B ⇒ recusa; de imagem pendente ⇒ recusa; `NULL` passa; UPDATE que reenvia a mesma `foto_url` legada não registrada passa (`WHEN`); idem `logo_url`. Triggers `AFTER` (D5): trocar a foto de um recorte usado só por aquele produto ⇒ recorte pendente; recorte também usado por outro produto ou pela logo ⇒ intacto; valor antigo que é **original** ⇒ intacta; excluir o produto ⇒ recorte pendente; recorte de B com caminho parecido ⇒ intacto.
  6. `limpar_recortes_sem_uso`: recorte sem uso com 25 h ⇒ marcado; com 1 h ⇒ intacto (carência P12); recorte em uso ⇒ intacto; original sem uso ⇒ intacta; loja B ⇒ intacta; posse igual à de `remover_imagens_loja`.
  4. Admin: `removerImagensGaleriaAdmin` com `lojaId` de A não remove imagem de B mesmo recebendo ids de B; `verificarAdminSaaS()` falhando ⇒ nenhum `createServiceClient`, nenhum `remove`.
  5. Action do lojista: `remove()` do Storage só recebe caminhos devolvidos pela RPC, todos com prefixo da loja do auth; `loja_id` no payload é ignorado.

---

## Migrations e ordem de deploy

`db push` é irreversível e exige autorização explícita do usuário (CLAUDE.md). Esta feature pede
**dois** pushes, com deploy de código entre eles.

| Migration | Conteúdo | Push |
|-----------|----------|------|
| M1 `2026100xxxxxxx_imagens_loja.sql` | tabela, constraints, índices, RLS, grants, `caminho_storage_produtos` | 1º |
| M2 `..._rpc_galeria.sql` | `uso_imagens_loja`, `remover_imagens_loja`, `limpar_recortes_sem_uso` | 1º |
| M3 `..._importar_imagens_do_storage.sql` | função de backfill + chamada protegida por `to_regclass('storage.objects') IS NOT NULL` | 1º |
| M4 `..._fotos_exigem_galeria.sql` | triggers `BEFORE` `produtos_foto_na_galeria_trg` e `lojas_logo_na_galeria_trg`; triggers `AFTER` `produtos_recorte_sem_uso_trg` e `lojas_recorte_sem_uso_trg` (D5) | **2º, depois do deploy** |

Sequência:

1. 1º push (M1–M3). O backfill registra tudo que existe no Storage.
2. Regenerar tipos; deploy do código que registra todo upload na tabela.
3. Rodar de novo `select public.importar_imagens_do_storage();` (SQL editor, papel dono) para pegar o que o código antigo subiu entre o push e o deploy. É idempotente.
4. 2º push (M4). Se M4 subisse antes do passo 3, um produto salvo com foto enviada nessa janela seria recusado pelo trigger.

`npx supabase migration list` confirma o que está só local (coluna Remote vazia ⇒ `PGRST204` em runtime).

**M4 quebra testes que já existem.** `createTestDb()` aplica todas as migrations, então, a partir de M4, todo teste pglite que grava `foto_url`/`logo_url` com uma URL literal não registrada passa a ser recusado pelo trigger. Exemplo confirmado: `tests/migrations/logo_url_vitrine.test.ts` grava `LOGO_HTTPS` e um `novo` arbitrário em `lojas.logo_url`. Além disso, os casos de `http://` e `javascript:` desse arquivo hoje afirmam a violação do `lojas_logo_url_https_chk`. Com M4 eles também quebram, porque o trigger `BEFORE` roda antes do CHECK e recusa com outro erro; a não ser que o trigger deixe passar URL que não é do Storage para o CHECK decidir. Decisão para o `planejar`: (a) o trigger ignora valores fora do formato do Storage, e o CHECK e o zod continuam donos deles; ou (b) atualizar esses testes. A issue de M4 precisa listar os arquivos afetados (`grep -rln "foto_url\|logo_url" tests/ src/**/*.test.ts`, hoje cerca de 20 arquivos, a maioria só lê a coluna) e um helper de teste `registrarImagem(db, lojaId, caminho)` para montar o cenário. O `supabase/seed.sql` não grava nenhuma das duas colunas: sem impacto.

**Testar o backfill em pglite:** pglite não tem o schema `storage` (por isso o guard), e
`storage.foldername()` também não existe lá, então a função de backfill usa
`split_part(name, '/', 1)` para extrair a loja. O teste cria um `storage.objects` mínimo
(`CREATE SCHEMA storage; CREATE TABLE storage.objects (id uuid, bucket_id text, name text,
metadata jsonb, created_at timestamptz)`), insere objetos de exemplo e chama
`public.importar_imagens_do_storage()` direto. Casos: foto na raiz, logo em `logo/`, objeto de
loja que não existe mais (ignorado), prefixo que não é uuid (ignorado), objeto do bucket `pix-qr`
(ignorado), mimetype não-imagem (ignorado), segunda execução (zero linhas novas), `criado_em` =
`created_at` do objeto. Mais um teste lendo o texto da migration M3 para afirmar que a chamada
está atrás do guard (anti-falso-verde, como `storage_bucket_produtos.test.ts`).

---

## Casos-limite

| Caso | Comportamento esperado | Onde é garantido |
|------|------------------------|------------------|
| **Remoção concorrente com edição de produto** (aba 1 remove a imagem X; aba 2 tem o form aberto com X e salva) | Remoção primeiro: o trigger do save espera a trava, relê a linha já pendente/removida e recusa; a action mostra "A foto escolhida foi removida da galeria. Escolha outra." Save primeiro: a RPC espera o `FOR KEY SHARE` do save, e como recalcula o uso **depois** de travar, limpa também o produto recém-salvo. Nos dois casos, nenhum produto fica apontando para arquivo apagado. | **Trigger** (`FOR KEY SHARE`) + **RPC** (`FOR UPDATE` antes de calcular uso). pglite tem uma conexão só: testar os dois resultados em sequência; a ordem de travas é revisada no `auditar` |
| **Lote com id de outra loja misturado** | Remove as válidas, ignora o id alheio sem nenhum efeito sobre ele, e o lojista lê "4 imagens removidas. 1 já tinha sido removida." (para ele, id alheio e id já removido são indistinguíveis, como pela RLS). | **RPC** (filtro do passo 3 + `loja_id` em toda escrita) + teste do item 2 |
| **Imagem usada por produto oculto, indisponível, exclusivo de cardápio ou fora da janela de frequência** | Conta no uso e é limpa igual. A prévia mostra "(oculto)" ao lado do nome. | **RPC** (`UPDATE` sem filtro de estado) + **`uso_imagens_loja`** |
| **Remoção concorrente com troca entre duas cópias da mesma original** (o produto P usa a cópia X1 e o save troca para X2, ambas de X, enquanto a RPC remove X) | O `BEFORE UPDATE` do save já trava a linha de P antes de rodar o trigger, e o trigger espera o `FOR KEY SHARE` em X2, que a RPC travou com `FOR UPDATE`. A RPC, por sua vez, espera P no `UPDATE produtos`. É um deadlock: o Postgres aborta uma das duas (`40P01`). Não corrompe nada, porque a transação abortada não grava. A action traduz `40P01` em "Não foi possível salvar. Tente de novo." e nunca devolve o erro cru. Nos outros casos de corrida não há deadlock: se a `foto_url` antiga de P não é da família de X, o `UPDATE` da RPC avalia o valor antigo, não casa e não espera. | **RPC + trigger** (ordem de travas), **Server Action** (mensagem). O `auditar` revisa a ordem de travas; pglite não reproduz (uma conexão só) |
| Duas abas removendo a mesma imagem | A segunda recebe "As imagens selecionadas já tinham sido removidas." e a grade recarrega. | **RPC** (filtro do passo 3) |
| **Recorte recém-enviado num form ainda não salvo** | A varredura não o apaga antes de 24 h (P12). Se o lojista deixar o form aberto por mais de 24 h e salvar, o trigger `BEFORE` recusa o recorte já removido e a action mostra "A foto escolhida foi removida da galeria. Escolha outra." | **RPC** (carência) + **trigger** |
| Dois produtos usam o mesmo recorte e um deles troca a foto | O recorte continua (ainda tem uso). Só é apagado quando o último produto deixar de usá-lo. | **Trigger `AFTER`** (checa outras referências) |
| Storage fora do ar na remoção | Referências limpas, linhas pendentes, sucesso para o lojista, retentativa na próxima remoção. | **Server Action** |
| Original escolhida no seletor é removida em outra aba antes do "Confirmar" do cropper | `enviarFotoProduto` recusa a origem pendente/inexistente ("Essa imagem foi removida da galeria."). | **Server Action** |
| Recorte sobe, mas o INSERT da linha-cópia falha | A action tenta apagar o objeto recém-subido (compensação best-effort) e devolve erro genérico. | **Server Action** |
| Imagem em uso na logo **e** em produtos | A prévia junta ("usada em 2 produtos e na logo"); a remoção limpa tudo numa transação. | **RPC** |
| Loja legada com mais de 200 imagens depois do backfill | Continua vendo e usando todas; só não envia novas até ficar abaixo do teto. | **Server Action** (teto só no envio) |
| Logo legada (320×320) escolhida para produto | Funciona; o recorte 4:3 de uma imagem pequena fica com pouca resolução. O seletor não bloqueia. | **Cliente** (aviso opcional, Q6) |
| Produto legado com `foto_url` de objeto inexistente | Continua editável (`WHEN` do trigger); trocar a foto exige imagem registrada. | **Trigger** |
| Arquivo HEIC/AVIF | Recusado no cliente e no servidor (fora da whitelist), como hoje. | **Server Action** |

---

## Fora do Escopo (v1)

- Organização da galeria: pastas, tags, renomear, busca, filtro "em uso / sem uso", ordenação manual.
- Editar a imagem na galeria (girar, filtros, brilho) ou recortar sem um destino.
- Mais de uma foto por produto, foto de categoria, capa/banner da loja.
- QR Pix na galeria (P7).
- Miniatura gerada no servidor, transformação de imagem do Supabase ou otimização do `next/image` (o projeto usa `unoptimized` em todo lugar; mudar isso é decisão de custo separada).
- Arrastar e soltar arquivos na página da galeria.
- Rate limit nas actions admin.
- Fechar o upload direto ao bucket pela API REST (resíduo descrito em Segurança): issue separada.
- Mudanças na vitrine pública.

---

## Questões em aberto

Resolvidas com o usuário em 2026-10-06: Q1 → D6 (teto 200), Q2 → D7 (miniatura), Q3 → D8 (remove as válidas e avisa), Q4 → D5 (recorte sem uso apagado na v1), Q6 → D10 (avisa e deixa usar), Q7 → D9 (primeiro nível, depois de Produtos).

| # | Questão | Sugestão |
|---|---------|----------|
| Q5 | A retentativa de pendentes acontece só quando a loja age (save de produto, troca de logo, remoção na galeria). Isso basta, ou precisa de uma rotina agendada? | Basta na v1: toda ação que cria pendente também processa pendentes. O projeto ainda não tem agendador (débito da issue 349); se a 349 escolher pg_cron, a varredura pode ir junto. |
| Q8 | Conferir a cota de Storage incluída no Supabase Pro antes do deploy, para validar o teto de 200. | Checar na fatura; não bloqueia o `quebrar`. |

---

## Divergências entre o código e a descrição recebida

- A prop do `NavPainel` que omite itens é `rotasAusentes` (não `ausentes`). O admin hoje passa `["configuracoes/promocoes", "clientes"]`.
- `revalidarVitrine` em `src/lib/actions/logo.ts` revalida `/${slug}`, não `/loja/${slug}`. A vitrine é dinâmica (sem ISR), então o efeito prático é só no Router Cache; corrigido de passagem por este spec.
- `limparStorageDaLoja` usa `list()` sem paginação (máximo de 100 itens por pasta) e só olha `${lojaId}/` e `${lojaId}/logo/`. Com a galeria, passa a ler a tabela (página 6).
- Fluxos de upload diferentes hoje: `enviarFotoProduto` só sobe e devolve a URL (o produto é gravado depois, no save do form); `salvarLogoLoja` sobe **e** grava `lojas.logo_url` na mesma action. O registro da linha-cópia entra em pontos diferentes por causa disso.
- As actions admin de upload recebem `loja_id` pelo FormData (validado por `validarLojaIdAdmin`), não por `.bind`. O spec mantém esse padrão nas actions admin novas que recebem arquivo.
- Todo `<Image>` do projeto usa `unoptimized` (vitrine e painel), então não há redimensionamento no servidor. Daí a proposta P9.
- O `FormProduto` abre num `Dialog` (desktop) ou `Sheet` (mobile) dentro do `ProdutosClient`, então o seletor de galeria é um dialog aninhado.
- Confirmado: só `produtos.foto_url` e `lojas.logo_url` guardam imagem. As policies do bucket usam `(storage.foldername(name))[1]`, função que o pglite não tem.

---

## Saída

- **Páginas/superfícies:** 6 (galeria do lojista, galeria do admin, seletor a partir do produto, seletor a partir da logo, item de menu, exclusão de loja).
- **Behaviors:** 29 (galeria do lojista 8, admin 4, seletor no produto 9, seletor na logo 6, menu 1, exclusão de loja 1).
- **Pontos críticos (TDD red-first):** RLS de `imagens_loja`; RPC `remover_imagens_loja` (posse, lote misto, recálculo de uso, limpeza de produtos em qualquer estado e da logo); triggers `BEFORE` e `AFTER` de M4; `limpar_recortes_sem_uso` (carência, posse); actions admin por `lojaId`; prefixo de caminho antes do `storage.remove`.
- **Próximo passo:** agente `quebrar` com `specs/galeria-imagens-loja.md`. Ordem sugerida: M1 + RLS (TDD) → M2 (TDD) → M3 + teste do backfill → `galeria-contrato.ts`/validações/queries → actions do lojista → actions admin → `GradeImagens`/`GaleriaImagens`/página → extração comum dos uploaders + `SeletorGaleria` → integração produto/logo (painel e admin) → item de menu → `limparStorageDaLoja` → M4 (TDD, push separado).
