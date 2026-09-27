# Spec: Modal sazonal com mensagem formatada e seleção opcional

**Versão:** 0.3.0 | **Atualizado:** 2026-09-27

> **Histórico v0.3.0 (decisões do usuário, fechadas):**
> 1. **modal só com título pode ser salvo e abre**: a abertura depende só de `ativo` + janela
>    (RN-M01), e o `.refine` de seleção/mensagem deixa de existir (RN-M02);
> 2. correção de precedência **aplicada** (RN-M07);
> 3. **gravação atômica** de linha + mensagem + seleção numa RPC transacional, corrigida agora, dentro
>    desta feature (RN-M15);
> 4. matriz de testes **organizada por vetor de ataque**, com a regra de fatiamento para `quebrar`/`tdd`
>    (§Segurança).
>
> **Histórico v0.2.0:** v0.1.0 cobria tamanho, negrito, itálico, sublinhado e tachado. A v0.2.0 incorpora a
> revisão de escopo do usuário: **links clicáveis** (só `https://`, com aviso de saída), **cor do texto**
> (paleta fixa), **fonte** (lista fixa), **alinhamento**, **listas** e **títulos**. **Imagens
> continuam fora** (decisão explícita do usuário). **Emoji** é o emoji Unicode padrão que já funciona
> como texto. Não é feature nova (§Esclarecimento sobre emoji).

> **Extensão do modal sazonal que já existe. Não é feature nova do zero.** O spec de origem,
> `specs/arquivo/modal-divulgacao-sazonal.md` (v0.1.0, 19/19 `[x]`, arquivado), continua valendo em
> tudo o que este documento não altera explicitamente. Criei um spec **novo e vinculado** em vez de
> reabrir o arquivado: o arquivado está 100% entregue, e reabri-lo misturaria "o que foi entregue" com
> "o que muda". O PR que implementar esta spec acrescenta **uma linha** ao RN-06 do arquivado, sem mexer
> em checkbox: `> Substituída por specs/modal-sazonal-mensagem-formatada.md (RN-M02).`
> *(Divergência corrigida na implementação, 2026-09-27: o texto da linha segue a instrução do usuário.)*
>
> **O que este spec altera no de origem:**
>
> | Regra de origem | O que acontece |
> |---|---|
> | RN-06 (ao menos uma seleção) | **removida** por RN-M02: título sozinho já é conteúdo válido; seleção e mensagem são opcionais |
> | "gravação atômica das junções" (RN-06 de origem; o código real faz requests separados em `regravarSelecao`) | **corrigida de fato** por RN-M15: RPC transacional `salvar_modal_sazonal` |
> | RN-01 (título como texto) | **mantida e endurecida** por RN-M09: normalização Unicode e CHECK de tamanho no banco |
> | RN-09 (precedência) | **ajustada** por RN-M07: só suprime o `ModalPromocoes` quando o sazonal vai de fato abrir |
> | "um dialog por vez" (sequenciamento do detalhe, 289/RN-5) | **mantido**: o aviso de saída de link é uma **vista dentro do mesmo dialog**, não um segundo dialog (RN-M12) |
> | Demais (RN-02 a RN-05, RN-07, RN-08, RN-10, RN-11) | inalteradas |
>
> **Prioridade declarada pelo usuário:** segurança contra ataques diversos e isolamento total entre
> lojas vêm **antes** de UX e de velocidade de entrega. Toda alternativa que armazene ou renderize HTML,
> Markdown, CSS livre, cor hex livre, família de fonte livre, fonte externa ou `<a href>` direto vindo
> do lojista foi **descartada neste spec** (§Alternativas descartadas), e não fica para a implementação
> decidir. **Cada recurso novo é um enum fechado ou uma estrutura fixa**, e o link é a única string
> além do texto: validado por protocolo **e** formato, canonizado e revalidado no render.

> **Notas da implementação (2026-09-27, loop autônomo; o código manda):**
> - `preservarJuncaoDeEmoji` também mantém o ZWJ quando o pictograma da esquerda vem seguido de U+FE0F
>   ou de modificador de tom de pele (U+1F3FB–1F3FF); sem isso 🏳️‍🌈 e família com tom de pele se
>   desmontariam. ZWJ entre letras continua removido.
> - Parágrafo **comum** só com espaços também é tratado como vazio na canonização (reforça o anti-padding).
> - O rótulo acessível "(link externo, abre aviso)" é um `<span className="sr-only">`, não `aria-label`:
>   nenhum atributo é montado com texto do lojista.
> - Link inválido forçado no renderer vira texto comum (defesa extra além do `AvisoSaidaLink`).
> - A RPC trata `p_categorias`/`p_cardapios` `NULL` como seleção vazia (RN-M02).
> - Tiptap 3.31.3 em pacotes individuais; desfazer/refazer é `UndoRedo` de `@tiptap/extensions/undo-redo`.
>   O `npx shadcn add toggle-group` trouxe a dependência `cn` (shadcn-ui/cn, fixada em 0.4.0), usada só
>   pelos arquivos gerados em `components/ui/toggle*.tsx`.
> - As seis migrations (`20260927120000` a `20260927125000`) foram aplicadas no cloud em 2026-09-27 e a
>   verificação no app (Playwright com mouse, loja "Lanches base") marcou 29 behaviors. Ficam `[ ]` só dois,
>   cobertos por teste automatizado mas não conferidos no app: mensagem inválida gravada direto no PostgREST
>   e remover link. Toque real em aparelho também não foi testado.

---

## Visão Geral

Hoje o modal sazonal da vitrine (`ModalSazonal`) só mostra um **título** e uma **lista de pratos**
curados. O formulário do painel (`FormModalSazonal` em `/painel/configuracoes/promocoes`) **recusa
salvar** se o lojista não marcar ao menos uma categoria ou um cardápio (RN-06, `.refine` em
`src/lib/validacoes/modalSazonal.ts`). Com isso, o lojista não consegue usar o modal para o caso mais
simples: **dar um aviso** ("Fechados no feriado de 12/10", "Novo horário a partir de segunda").

Esta extensão faz duas coisas:

1. **A seleção de pratos passa a ser opcional, e a mensagem também.** Um modal só com título é válido
   e abre na janela (decisão do usuário: o lojista pode usar só o título como aviso). A gravação de
   título, janela, mensagem e seleção passa a ser **atômica** (RN-M15).
2. **Entra uma mensagem livre ao cliente**, distinta do título, com formatação:
   - **por trecho:** negrito, itálico, sublinhado, tachado, tamanho (4 níveis), **cor** (paleta fixa de
     7 cores + automática), **fonte** (3 famílias do sistema) e **link** (`https://`);
   - **por parágrafo:** **alinhamento** (esquerda, centro, direita) e **tipo** (parágrafo, **título**,
     **item de lista com marcador**, **item de lista numerada**), sem aninhamento.

A mensagem é texto de um lojista exibido a **visitantes anônimos**, ou seja, a superfície clássica de
XSS armazenado. Por isso ela **não é HTML**. É um **documento estruturado** (JSON com parágrafos e
trechos, cada trecho com texto puro e atributos de enum fechado), validado por zod na escrita **e na
leitura**, e renderizado por um componente React que mapeia cada atributo para um elemento ou classe
fixos. O texto do lojista **só vira nó de texto do React**, nunca atributo, classe, estilo ou `href`.
O link é renderizado como **botão que abre um aviso de saída**. O único `href` do fluxo mora nesse
aviso, com URL revalidada e `rel="noopener noreferrer"` (RN-M03 a RN-M06, RN-M12).

**Mundos em que vive:**

| Mundo | O que muda |
|---|---|
| Vitrine pública (`/loja/[slug]`) | o `ModalSazonal` passa a mostrar a mensagem formatada, pode abrir **sem pratos** (só título, ou título e mensagem) e troca para a vista de **aviso de saída** quando o cliente toca num link. Critério de abertura novo decidido no SSR (RN-M01) |
| Painel (`/painel/configuracoes/promocoes`) | o `FormModalSazonal` ganha o editor da mensagem com barra de formatação e prévia. A seleção de categoria/cardápio deixa de ser obrigatória |
| Hub admin | nada (herda o Fora do Escopo do spec de origem) |
| Auth | nada |

### Esclarecimento sobre emoji (não é requisito novo)

"Emoji" no pedido do usuário é o **emoji Unicode padrão** (😀🍔🎉) digitado pelo teclado do sistema.
Ele já é texto puro e passa pelo mesmo caminho do resto do texto: **nenhum campo, marca ou regra de
render novo**. Emoji customizado por upload é imagem, e continua **fora do escopo**. O único cuidado de
implementação é **não quebrar sequências de emoji**: a normalização remove U+200D (ZWJ), o que
desmontaria 👨‍👩‍👧 em três emojis. Por isso a mensagem usa a opção `preservarJuncaoDeEmoji`
(§Reuso), que mantém o ZWJ **só entre dois pictogramas** (`\p{Extended_Pictographic}`). Um ZWJ solto
entre letras continua removido. O seletor de variação U+FE0F não está na lista de remoção e fica
preservado. O U+FE0E (apresentação texto do coração, U+2764 U+FE0E) só fica **logo depois de um pictograma**; solto, sai
(issue 316). Bandeiras de subdivisão (🏴 + tags + CANCEL TAG, ex.: Inglaterra) ficam **só no trecho da
mensagem** (`preservarJuncaoDeEmoji`) e só no molde U+1F3F4 + 2 a 7 tags em `[0-9a-z]` + U+E007F; fora
dele, e sempre no título, as tags saem e fica a 🏴. Marcas combinantes seguidas são limitadas a 3
(anti-Zalgo) no trecho e no título; vietnamita decomposto usa 2 e passa intacto.

---

## Atores Envolvidos

| Ator | O que faz nesta feature |
|---|---|
| **iRango (SaaS)** | garante que a mensagem de uma loja só é gravada pelo dono dela e só aparece na vitrine dela. Garante que nenhum conteúdo gravado, mesmo escrito direto no PostgREST contornando a Server Action, vira HTML, script, estilo livre, fonte externa, elemento fora do contêiner ou navegação sem aviso. Valida na escrita **e** na leitura. |
| **Lojista** | escreve a mensagem, formata trechos (negrito, itálico, sublinhado, tachado, tamanho, cor, fonte, link) e parágrafos (alinhamento, título, lista), vê a prévia, salva um modal só com mensagem, só com pratos ou com os dois. |
| **Cliente** | vê o modal na primeira visita do dia com título, mensagem formatada e, se houver, os pratos. Ao tocar num link, vê o **endereço de destino** e decide se continua. Não envia nada. |

---

## Como esta extensão reusa o que existe (não reinventar)

- **Pipeline de escrita**: `criarModalSazonal`/`editarModalSazonal` em `src/lib/actions/modalSazonal.ts`
  mantêm a sequência rate-limit, zod, `buscarLojaDoDono`, allowlist e `revalidar`. Nada de action nova.
  **Muda a escrita:** o par "INSERT/UPDATE da linha + `regravarSelecao`" (hoje 3 a 5 requests
  PostgREST sem transação) é trocado por **uma** chamada `supabase.rpc("salvar_modal_sazonal", …)`
  (RN-M15). `regravarSelecao` é **removida**. A RPC segue a variante `SECURITY INVOKER` de
  `seguranca.md` §2 ("RPC de escrita em lote do lojista", molde `reordenar_categorias`), porque só o
  lojista autenticado escreve (admin continua fora do escopo).
- **Schema isomórfico**: `schemaModalSazonal` ganha o campo `mensagem`, que aponta para um sub-schema
  novo `schemaMensagemModal` em `src/lib/validacoes/mensagemModal.ts`. O mesmo zod roda no form (UX),
  na Server Action (autoridade de escrita) e no SSR da vitrine e do painel (autoridade de leitura,
  RN-M04).
- **Allowlist de patch**: `montarPatchModalSazonal` (`src/lib/actions/patches-modal-sazonal.ts`) ganha
  `mensagem`, coluna a coluna, nunca spread, e passa a montar os **argumentos nomeados da RPC**
  (`p_titulo`, `p_exibicao_inicio`, `p_exibicao_fim`, `p_mensagem`, `p_mostrar_promocoes_junto`,
  `p_categorias`, `p_cardapios`). `p_loja_id` e `p_modal_id` são acrescentados pela Server Action
  (dono e rota), **nunca** vêm do payload.
- **Normalização Unicode**: os passos de `normalizarObservacao` (`src/lib/utils/normalizarObservacao.ts`)
  que removem controles C0/C1, invisíveis e bidi (Trojan Source, CVE-2021-42574) e substitutos
  desemparelhados são **extraídos** para `removerInvisiveisEControles(texto, opcoes?)` no **mesmo**
  módulo. `normalizarObservacao` a compõe **com as opções padrão**. A extração em si não muda comportamento (a suíte
  `normalizarObservacao.test.ts` guarda a refatoração); a issue 316 depois estendeu a remoção, e isso **muda** a
  observação de pedido, `schemaObservacao` e `linhaCarrinhoId` (ver RN-M03). A opção nova `preservarJuncaoDeEmoji` (padrão
  `false`) só é ligada pela mensagem (§Esclarecimento sobre emoji). O trecho **não** usa
  `normalizarObservacao` inteira, porque o `trim()` e o colapso de espaço apagariam o espaço entre
  trechos (`"Olá "` + **`mundo`**).
- **Guard de URL**: `urlHttpsSegura` (`src/lib/utils/urlHttpsSegura.ts`) continua a **fonte única** do
  predicado "começa exatamente com `https://`" (`seguranca.md` §15). O link da mensagem ganha uma
  **especialização** `urlLinkExternoSegura` (`src/lib/utils/urlLinkExternoSegura.ts`) que **delega**
  primeiro a `urlHttpsSegura` e só então aplica as regras de formato de RN-M12, no mesmo molde de
  `fotoSegura`. Um predicado, sem divergência.
- **Abertura de aba externa**: o padrão de `seguranca.md` §15-A. O destino é conhecido antes do gesto,
  então é navegação declarativa `<a target="_blank" rel="noopener noreferrer">` no aviso, sem mecânica
  de pré-abertura.
- **Decisão de abertura do modal**: `decidirModalSazonal` **não muda**. Muda o que o componente passa em
  `temModalSazonal`: deixa de ser `produtos.length > 0` e passa a ser "o SSR mandou um modal" (RN-M01).
- **Janela, precedência e derivação de pratos**: `dentroDaJanelaExibicao`,
  `derivarProdutosDoModalSazonal`, `buscarModalSazonalAtivo`/`listarModaisSazonaisDoDono`
  (`src/lib/supabase/queries/modaisSazonais.ts`) são reusadas. As queries acrescentam `mensagem` a
  `COLUNAS_MODAL` **e** a `hidratar` (divergência conferida no código em 2026-09-27: sem `hidratar` a
  coluna era lida e descartada).
- **Tipografia sem fonte externa**: as famílias da mensagem são as **pilhas de sistema padrão do
  Tailwind** (`font-sans`, que já é a do projeto em `globals.css`, mais `font-serif` e `font-mono`).
  Nenhum download, nenhum `next/font`, nenhum `@font-face`. O design system hoje carrega **uma** família
  só, a pilha de sistema, então "3–4 famílias já carregadas" se realiza como 3 pilhas de sistema.
- **Cores**: tokens de sistema já existentes quando servem (`--texto` #3e2723, `--texto-muted` #6b5d4f,
  `--promo-texto` #166534) mais tons fixos da paleta padrão do Tailwind. **Nunca** as cores do tema da
  loja (`--cor-primaria`/`--cor-destaque`): elas são do lojista e o contraste delas é risco conhecido
  (`design-system.md` §4).
- **Render de teste sem jsdom**: `renderToStaticMarkup` (`react-dom/server`), padrão de
  `ModulosImpressaoAdmin.test.tsx`.
- **shadcn/ui**: `Dialog`, `Card`, `Button`, `Label`, `Input` já existem. **`toggle-group`** entra pelo
  CLI (`npx shadcn add toggle-group`). `components/ui/` não se edita à mão.
- **Ícones**: `lucide-react` (já em `package.json`): `ExternalLink`, `AlignLeft`/`AlignCenter`/
  `AlignRight`, `List`, `ListOrdered`, `Heading`, `Bold`, `Italic`, `Underline`, `Strikethrough`, `Link`,
  `Unlink`.
- **Editor**: não existe editor rico no projeto, e escrever um sobre `contentEditable` à mão é reinventar
  a roda (e `document.execCommand` está depreciado e gera HTML). A decisão é o **Tiptap** (headless,
  sobre ProseMirror, MIT) **só no painel**, com allowlist de extensões. Ele é **só UX**: o documento dele
  nunca é persistido nem enviado. O que vai ao servidor é o formato iRango, produzido por um conversor
  puro. O `planejar` confirma nomes e versões atuais dos pacotes e roda `npm audit` antes de instalar.

---

## Páginas e Rotas

### Vitrine da loja: modal sazonal — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)

**Descrição:** na primeira visita do dia, se a loja tem um modal sazonal **ativo e dentro da janela**
(RN-M01), abre o overlay com o título do lojista, a **mensagem formatada** (se houver) e a **lista de
pratos** (se houver). Sem pratos, o modal mostra título, a mensagem (se houver) e os dois CTAs, sem lista
e sem a linha "N pratos em destaque". Só com título, ele é um aviso de uma linha com os CTAs. Ao tocar num **link** da mensagem, o
conteúdo do **mesmo dialog** troca para a vista **"aviso de saída"**. Ela mostra o domínio de destino em
destaque e o endereço completo, com os botões "Continuar para {domínio}" e "Voltar". As 7 travas
anti-gesto, a chave `irango:promo-sazonal:{slug}`, o fechamento único e o sequenciamento do detalhe do
prato continuam **idênticos**.

**Componentes:**
- `ModalSazonal` (`src/components/vitrine/ModalSazonal.tsx`), **modificar**:
  - prop nova `mensagem: MensagemModalValidada | null` (tipo com *brand* do zod, RN-M04; um `unknown`
    cru do banco **não compila** como prop);
  - `temModalSazonal: true`, porque a existência já foi decidida no SSR (o `VitrineClient` só monta o
    componente com `modalSazonal !== null`). A trava 7 (`return null`) passa a guardar só o caso
    defensivo `titulo.trim() === ""`, que o zod e o CHECK tornam impossível. **Não existe** helper
    `modalSazonalTemConteudo`: com o título sempre presente, "ter conteúdo" deixou de ser condição;
  - estado novo `linkPendente: LinkExternoValidado | null`. Com valor, o `DialogContent` renderiza
    `AvisoSaidaLink` **no lugar** da mensagem e da lista (mesmo dialog, mesmo focus-trap, mesma trava de
    scroll: nunca dois dialogs, RN-M12). O `fechar()` único (trava 5) também zera `linkPendente`;
  - a lista `<ul>` de pratos e a descrição "N pratos em destaque" só renderizam com `produtos.length > 0`;
  - o `DialogDescription`: com mensagem, envolve a mensagem; sem mensagem e com pratos, mantém o texto de
    contagem de hoje; só com título, é omitido (o base-ui aceita dialog sem descrição, e o título basta);
  - a área da mensagem tem **altura máxima com rolagem interna** e quebra de palavra forçada
    (`break-words [overflow-wrap:anywhere]`). Uma mensagem longa **nunca** empurra o ✕ nem os CTAs para
    fora da tela (RN-M06).
- `MensagemFormatada` (`src/components/shared/MensagemFormatada.tsx`), **criar**. Módulo sem estado, sem
  `'use client'` próprio, que recebe `mensagem` e uma **callback opcional** `aoEscolherLink(link)`. Com a
  callback, o trecho com link vira `<button type="button">`. Sem a callback (prévia do painel), vira
  `<span>` com o mesmo visual e nenhuma interação. **Nunca `<a>`** (RN-M05). Não importa nada de
  `@tiptap/*`. Usado na vitrine e na prévia do painel: um renderizador só, prévia fiel por construção.
- `AvisoSaidaLink` (`src/components/shared/AvisoSaidaLink.tsx`), **criar**. Recebe o link validado.
  **Revalida** com `urlLinkExternoSegura` no próprio render (§15: todo `href` vindo do banco passa pelo
  guard onde é renderizado). Mostra:
  - o **hostname em ASCII/punycode** (o `URL.hostname` canônico), como anti-homógrafo, em destaque;
  - o endereço completo como **texto**;
  - a instrução "Confira o endereço antes de continuar." (copy imperativa, conforme a memória
    "copy manda o cliente agir"; o texto final é com `desenhar`);
  - `<a href={urlRevalidada} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">`
    com rótulo "Continuar para {hostname}". O `onClick` dele chama o `fechar()` único **sem**
    `preventDefault`: a aba abre e o modal fecha;
  - `<button>` "Voltar", que zera `linkPendente` e volta à mensagem.

  URL que falhe na revalidação: mostra "Este link não está disponível." e **nenhum** `<a>`.
- `VitrineClient` (`src/components/vitrine/VitrineClient.tsx`), **modificar**: `ModalSazonalDados`
  ganha `mensagem`. Repasse puro.
- `page.tsx` (`src/app/(publica)/loja/[slug]/page.tsx`), **modificar**: depois de
  `buscarModalSazonalAtivo`, chama `lerMensagemModal(modal.mensagem)` (parse na leitura, RN-M04),
  aplica o critério de RN-M01 (remove a condição `produtosDoModalSazonal.length > 0`) e reescreve
  `suprimirPromocoes` a partir de `modalSazonal` (RN-M07).
- `Dialog`: **reuso**, sem alteração.

**Behaviors:**
- [x] **Ver o modal só com o título** quando o lojista não escreveu mensagem e não há prato selecionado à
  venda agora (sem seleção, ou com os selecionados fora de vigência). Garantido em: **SSR** (RN-M01:
  ativo + janela bastam).
- [x] **Ver o modal com título e mensagem**, sem lista de pratos, quando não há prato selecionado à venda
  agora. Garantido em: **SSR** (RN-M01).
- [x] **Ver título, mensagem e pratos juntos** quando o modal tem os dois. Garantido em: **SSR**
  (RN-M01, RN-10 inalterada).
- [x] **Ver o modal com título e pratos**, como hoje, quando não há mensagem. Garantido em: **SSR**.
- [x] **Ver a formatação de trecho aplicada** (negrito, itálico, sublinhado, tachado, 4 tamanhos, cor
  da paleta, fonte da lista) exatamente como o lojista viu na prévia. Garantido em: **renderizador**
  (`MensagemFormatada`, mapas constantes de classe, RN-M05).
- [x] **Ver títulos, listas com marcador, listas numeradas e alinhamento** como o lojista montou, com
  listas de um nível só. Garantido em: **renderizador** (RN-M05/RN-M14) + **zod** (estrutura plana, sem
  aninhamento, RN-M14).
- [x] **Ler toda cor da mensagem com contraste AA** sobre o fundo do modal. Garantido em: **paleta
  fixa** pré-validada por teste (RN-M13). O lojista não escolhe hex.
- [x] **Tocar num link e ver o aviso de saída** com o domínio de destino antes de sair da vitrine.
  Garantido em: **renderizador** (link é `<button>`, nunca `<a href>` na mensagem, RN-M05/RN-M12) +
  **cliente (UX)** (vista de aviso no mesmo dialog).
- [x] **Continuar pelo aviso** e abrir o site numa aba nova, sem que ele consiga controlar a vitrine
  (`window.opener`) nem receber a URL da loja como referrer. Garantido em: **renderizador**
  (`AvisoSaidaLink` com `rel="noopener noreferrer"` + `referrerPolicy="no-referrer"` e URL revalidada no
  render) + **zod** (só `https://` canônico gravado e lido, RN-M12).
- [x] **Voltar do aviso** para a mensagem sem sair da loja, ou fechar o modal inteiro pelo ✕/ESC.
  Garantido em: **cliente (UX)** (`linkPendente` zerado pelo "Voltar" ou pelo `fechar()` único).
- [x] **Nunca executar script, carregar recurso externo (fonte, imagem, CSS), seguir link sem aviso ou
  herdar estilo livre** vindo da mensagem, mesmo que o banco contenha lixo hostil. Garantido em: **SSR**
  (parse na leitura, fail-closed, RN-M04) + **renderizador** (RN-M05) + **CHECK no banco** (RN-M08).
- [ ] **Ver o modal sem a mensagem, e não uma vitrine quebrada** *(pendente: conferir no app; coberto só por teste automatizado)*, quando a mensagem gravada é inválida
  (escrita direta via PostgREST contornando a Server Action). O modal abre sem a mensagem: título, mais
  os pratos se houver. Garantido em: **SSR** (`lerMensagemModal` devolve `null`; o log leva só `loja_id`
  e `modal_id`, nunca conteúdo nem URL).
- [x] **Fechar o modal mesmo com uma mensagem de tamanho máximo**: ✕ e CTAs sempre visíveis, e a
  mensagem rola por dentro. Garantido em: **cliente (UX)** (RN-M06).
- [x] **Ter o `ModalPromocoes` suprimido só quando o sazonal de fato é enviado para abrir** (e o
  lojista não ligou "mostrar promoções junto"). Nunca por um sazonal que o SSR não mandou. Garantido em:
  **SSR** (RN-M07).
- [x] **Nunca ver mensagem de outra loja nem rascunho**. Garantido em: **RLS**
  (`modais_sazonais_leitura_publica`: `ativo = true` + `loja_esta_ativa`; a coluna nova herda a política
  por ser da mesma linha) + **query** (`.eq("loja_id", lojaId)` + `.eq("ativo", true)`).

---

### Promoções e modal sazonal do painel — `/painel/configuracoes/promocoes`

**Mundo:** painel (auth obrigatório, sob `(bloqueavel)`)

**Descrição:** no `FormModalSazonal`, abaixo do título, entra o campo **"Mensagem aos clientes"**:
um editor com barra de formatação, contador de caracteres e **prévia** renderizada pelo mesmo
componente da vitrine. A mensagem e a seção "O que divulgar" (categorias/cardápios) passam a ser
**opcionais**. Sem as duas, o form **não bloqueia**: mostra um aviso leve, não destrutivo, acima do botão
salvar: **"Este modal vai aparecer só com o título. Escreva uma mensagem ou escolha pratos para
divulgar, se quiser."** (copy final com `desenhar`, imperativa conforme a memória "copy manda o cliente
agir"). O aviso some assim que houver mensagem ou seleção.

**Componentes:**
- `FormModalSazonal` (dentro de `PromocoesClient.tsx`), **modificar**: estado `mensagem` (formato iRango
  ou `null`), editor, prévia e o aviso "só título" (derivado por um helper puro
  `modalSoComTitulo({ mensagem, categorias, cardapios })`, testável em node; é só UX e nunca bloqueia o
  submit). Continua validando com `schemaModalSazonal.safeParse(montarPayloadModalSazonal(campos))` no
  submit, só como gate de UX.
- `EditorMensagem` (`src/components/painel/editor-mensagem/EditorMensagem.tsx`), **criar**. Client
  component carregado com `next/dynamic` (`ssr: false`) só dentro do form: o Tiptap não entra no bundle
  de nenhuma outra rota. **Extensões permitidas, e só estas**, cada uma configurada como indicado:

  | Extensão | Configuração obrigatória |
  |---|---|
  | `Document`, `Paragraph`, `Text` | padrão |
  | `Bold`, `Italic`, `Underline`, `Strike` | padrão (atalhos nativos) |
  | desfazer/refazer | padrão |
  | `Heading` | `levels: [2]` apenas. É a representação **no editor** do `tipo: "titulo"`, e o conversor a traduz. Na vitrine, título **não** é `<h*>` (RN-M14) |
  | `BulletList`, `OrderedList`, `ListItem` | `ListItem` estendido com `content: "paragraph"` (**sem** `block*`), o que torna lista aninhada impossível no editor. Tab/Shift+Tab não aprofunda nível |
  | `TextAlign` | `types: ["paragraph","heading"]`, `alignments: ["left","center","right"]`, sem `justify` |
  | `Link` | `openOnClick: false`, `autolink: false`, `linkOnPaste: false`, `isAllowedUri`/`shouldAutoLink` delegando a `urlLinkExternoSegura`, e `HTMLAttributes` fixos (`rel: "noopener noreferrer"`, `target: null`) |
  | mark própria `tamanho` | atributo enum `pequeno\|grande\|enorme` |
  | mark própria `cor` | atributo enum da paleta (RN-M13) |
  | mark própria `fonte` | atributo enum `serifa\|mono` |

  As três marks próprias têm `parseHTML: () => []`: **não** leem `style`, `color`, `font-family` nem
  `font-size` de nenhum HTML. **Proibidas**: `TextStyle`, `Color`, `FontFamily`, `FontSize` (guardam CSS
  livre em `style`), `Image`, `CodeBlock`, `Code`, `HardBreak`, `Blockquote`, `HorizontalRule`, `Table`,
  `Mention`, e qualquer extensão que aceite HTML. **Colar entra sempre como texto puro** (`handlePaste`
  insere só `text/plain`): nada de formatação, link ou imagem de Word/web. O conteúdo inicial vem **só**
  de `mensagemParaDocumentoEditor` (JSON). **Nunca** `setContent`/`insertContent` com string HTML.
- `BarraFormatacao` (`src/components/painel/editor-mensagem/BarraFormatacao.tsx`), **criar**. Usa
  `ToggleGroup` do shadcn (adicionar pelo CLI). Grupos:
  - marcas: Negrito, Itálico, Sublinhado, Tachado (`aria-pressed`);
  - tamanho: Pequeno, Normal, Grande, Enorme (seleção única);
  - cor: amostras da paleta de RN-M13 (seleção única), cada uma com **nome acessível** ("Vermelho") e
    não só a cor;
  - fonte: Padrão, Serifada, Monoespaçada (seleção única, cada rótulo na própria família);
  - parágrafo: Título, Lista, Lista numerada (seleção única, com "Parágrafo" como estado sem seleção);
  - alinhamento: Esquerda, Centro, Direita (seleção única);
  - link: "Inserir link" abre uma **linha inline** abaixo da barra (sem primitivo novo), com `Input`
    para a URL, validação ao vivo por `urlLinkExternoSegura` e erro "Use um endereço completo que
    comece com https://". "Remover link" limpa a marca.

  Alvos de toque de 44×44 em valor literal (`design-system.md` §5). No celular, a barra quebra em
  linhas. A disposição final é com `desenhar`.
- `conversorEditorMensagem.ts` (`src/components/painel/editor-mensagem/`), **criar**. Módulo puro,
  testável em `environment: node`:
  - `documentoEditorParaMensagem(doc: unknown): unknown` percorre o JSON do ProseMirror e emite o
    formato iRango. **Ignora** qualquer nó ou mark fora da allowlist e **achata** qualquer lista
    aninhada que apareça (defensivo, porque o editor já não deixa criar). A saída ainda passa pelo zod,
    então o conversor não é fronteira de confiança;
  - `mensagemParaDocumentoEditor(m: MensagemModalValidada | null)` faz o caminho inverso: itens
    consecutivos do mesmo tipo de lista voltam a ser uma lista do editor.
- `MensagemFormatada` (`src/components/shared/`), **reuso** na prévia, sem `aoEscolherLink`: link
  aparece com o visual de link, sem interação.
- `montarPayloadModalSazonal.ts`, **modificar**: `CamposModalSazonal`/`PayloadModalSazonal` ganham
  `mensagem`, sempre presente (`null` quando vazio), pelo mesmo motivo documentado para
  `mostrar_promocoes_junto`: chave condicional impediria **apagar** a mensagem.
- `page.tsx` do painel, **modificar**: ao listar os modais, cada `mensagem` passa por `lerMensagemModal`.
  Inválida vira `null` (editor vazio) com log no servidor, sem derrubar a página.

**Behaviors:**
- [x] **Salvar um modal só com título, janela e mensagem**, sem categoria nem cardápio. Garantido em:
  **Server Action** (`schemaModalSazonal` sem o `.refine` de seleção, RN-M02) + **RPC transacional**
  (RN-M15) + **RLS** (`modais_sazonais_escrita_propria`, USING + WITH CHECK). `loja_id` sai de
  `buscarLojaDoDono`, nunca do payload.
- [x] **Salvar um modal só com seleção, sem mensagem**, como hoje. Garantido em: **Server Action** +
  **RPC transacional** + **RLS**.
- [x] **Salvar um modal só com título e janela**, sem mensagem e sem seleção, vendo antes o aviso "Este
  modal vai aparecer só com o título…", que não bloqueia. Garantido em: **cliente (UX)** para o aviso +
  **Server Action + RPC + RLS** para a gravação. Salvar assim é decisão consciente do lojista (RN-M02).
- [x] **Gravar título, janela, mensagem, "mostrar promoções junto", categorias e cardápios de uma vez:
  ou tudo grava, ou nada grava.** Garantido em: **RPC transacional** `salvar_modal_sazonal` (uma
  transação Postgres, RN-M15) + **RLS** + **FK composta**.
- [x] **Ver o modal exatamente como estava antes** quando uma edição falha no meio (ex.: uma categoria
  escolhida foi apagada por outra aba entre abrir o form e salvar). Linha, mensagem e seleção antigas
  ficam intactas, e a UI mostra "Não foi possível salvar. Tente novamente." Garantido em: **RPC
  transacional** (rollback total) + **Server Action** (erro genérico, `seguranca.md` §14).
- [x] **Não ficar com um rascunho órfão** quando a criação de um modal falha no meio. Garantido em:
  **RPC transacional** (INSERT da linha revertido junto com as junções).
- [x] **Escrever a mensagem em parágrafos** (Enter cria parágrafo). Garantido em: **cliente (UX)** +
  **Server Action** (tetos de RN-M08, recontados no servidor).
- [x] **Aplicar negrito, itálico, sublinhado ou tachado** a um trecho selecionado, pela barra ou pelos
  atalhos. Garantido em: **cliente (UX)**. No servidor, cada marca é só `true` validado pelo zod.
- [x] **Mudar o tamanho de um trecho** (Pequeno, Normal, Grande, Enorme). Garantido em: **cliente (UX)**
  + **Server Action** (enum fechado; nunca px, rem ou CSS).
- [x] **Mudar a cor de um trecho** para uma das cores da paleta, ou voltar para a automática. Garantido
  em: **cliente (UX)** + **Server Action** (enum fechado da paleta; hex, `rgb()`, nome CSS ou qualquer
  string fora da lista reprova, RN-M13).
- [x] **Mudar a fonte de um trecho** (Padrão, Serifada, Monoespaçada). Garantido em: **cliente (UX)** +
  **Server Action** (enum fechado; nome de família, `url()` ou `@font-face` reprovam; nada é baixado).
- [x] **Alinhar um parágrafo** à esquerda, ao centro ou à direita. Garantido em: **cliente (UX)** +
  **Server Action** (enum fechado, RN-M14).
- [x] **Transformar um parágrafo em título.** Garantido em: **cliente (UX)** + **Server Action**
  (`tipo: "titulo"`, enum, RN-M14).
- [x] **Criar uma lista com marcadores ou numerada**, de um nível só. Garantido em: **cliente (UX)**
  (`ListItem` sem sub-blocos) + **Server Action** (item de lista é um tipo de parágrafo plano; não existe
  campo de nível nem filho, RN-M14).
- [x] **Pôr um link num trecho** digitando uma URL `https://`. URL sem `https://`, com usuário/senha,
  com IP, `localhost`, porta explícita ou malformada é recusada já no campo. Garantido em: **cliente
  (UX)** (`urlLinkExternoSegura` no campo) + **Server Action** (mesma função no zod, com canonização,
  RN-M12).
- [ ] **Remover o link** *(pendente: conferir no app; coberto só por teste automatizado)* de um trecho. Garantido em: **cliente (UX)** + **Server Action** (trecho sem
  `link`).
- [x] **Colar texto de outro app** e ver só o texto entrar, sem formatação, link ou imagem. Garantido
  em: **cliente (UX)** (`handlePaste`). Mesmo contornando o editor, o servidor só aceita o formato iRango.
- [x] **Digitar emoji pelo teclado do sistema** e vê-lo inteiro na prévia e na vitrine, inclusive
  sequências como 👨‍👩‍👧. Garantido em: **Server Action** (normalização com `preservarJuncaoDeEmoji`,
  §Esclarecimento sobre emoji).
- [x] **Ver o contador "N/800"** e o aviso ao passar do limite. Garantido em: **cliente (UX, preview)**
  com `contarCaracteresMensagem`, a mesma função do zod. **Autoridade:** Server Action recontando depois
  de normalizar.
- [x] **Ver a prévia da mensagem** como o cliente verá. Garantido em: **cliente (UX)**, com o mesmo
  `MensagemFormatada` da vitrine.
- [x] **Apagar toda a mensagem** e salvar. O modal fica com título e, se houver, pratos. Garantido em:
  **Server Action** (documento sem texto visível é canonizado para `null`, RN-M03).
- [x] **Reabrir um modal salvo e ver a mensagem de volta no editor** com toda a formatação. Garantido
  em: **SSR do painel** (`lerMensagemModal` + `mensagemParaDocumentoEditor`).
- [x] **Não conseguir gravar nada fora do contrato**, nem com payload forjado na Server Action: HTML,
  `style`, chave extra, cor/fonte/alinhamento/tipo fora do enum, link não-`https`, lista aninhada,
  milhares de trechos, mais de 10 links, caracteres invisíveis/bidi. Garantido em: **Server Action**
  (`schemaMensagemModal` com `.strict()` em todos os níveis, tetos antes da transformação,
  normalização, canonização, RN-M03/RN-M08/RN-M12/RN-M14).
- [x] **Não conseguir gravar mensagem fora do limite nem com escrita direta no PostgREST** usando a
  própria sessão, seja na tabela, seja chamando a RPC direto. Garantido em: **CHECK no banco** (bytes e
  forma de topo, RN-M08) + **travas do corpo da RPC** (cardinalidade e duplicata dos arrays, RN-M15). O
  conteúdo que passa no CHECK mas não no zod é neutralizado na leitura (RN-M04).
- [x] **Não conseguir ler nem editar a mensagem do modal de outra loja**, nem por `id` forjado, nem
  chamando a RPC com `p_loja_id`/`p_modal_id` alheios. Garantido em: **Server Action + RPC + RLS**
  (`loja_id` de `buscarLojaDoDono`; trava de posse explícita no corpo da RPC; RLS avaliada nos
  INSERT/UPDATE/DELETE da RPC `invoker`; `id` validado como uuid, RN-M10).
- [x] **Ter o título com caracteres invisíveis/bidi removidos** antes de salvar. Garantido em:
  **Server Action** (RN-M09) + **CHECK no banco**.

---

## Modelos de Dados

Referência: `references/schema.md` §`modais_sazonais`. **Nenhuma tabela nova.** Duas migrations novas,
aditivas, sobre a tabela de `20260925140000_modais_sazonais_rls.sql`, em ordem:

1. `supabase/migrations/<ts1>_modais_sazonais_mensagem.sql`: coluna `mensagem` + CHECKs (abaixo);
2. `supabase/migrations/<ts2>_rpc_salvar_modal_sazonal.sql`: a RPC transacional de RN-M15
   (§RPC `salvar_modal_sazonal`). Depende da 1 porque grava `mensagem`.

> **Endurecimento das issues 316–319** (quatro migrations aditivas depois das duas acima):
> `20260927122000_modais_sazonais_titulo_invisiveis_nao_bidi.sql` (CHECK do título ampliado, RN-M09),
> `20260927123000_modal_sazonal_juncoes_leitura_por_modal_ativo.sql` (leitura pública das junções só
> para modal ativo de loja ativa, RN-03 do spec de origem),
> `20260927124000_modais_sazonais_teto_por_loja.sql` (teto de 50 modais por loja, RN-M08) e
> `20260927125000_rpc_ativar_modal_sazonal.sql` (RN-M16).

> **Dependência de deploy:** esta migration depende da 300 estar aplicada no cloud. *(Conferido em
> 2026-09-27 com `npx supabase migration list`: `20260925140000` **já está no Remote**; os comentários de
> `modaisSazonais.ts` que diziam o contrário estavam desatualizados.)* Rodar `npx supabase migration list` antes. Só as duas
> novas sobem no `db push`, que é irreversível e **exige autorização explícita do
> usuário**. O deploy do código que chama a RPC só pode ir ao ar **depois** do push (sem a função,
> criar/editar quebram com `PGRST202`).

### Coluna nova em `modais_sazonais`

```sql
alter table public.modais_sazonais
  add column mensagem jsonb null;   -- NULL = sem mensagem

-- RN-M08: teto de BYTES (CWE-770). Folga ~1,5–2x sobre o maior documento
-- legítimo (800 caracteres, 120 trechos com todos os atributos, 20 parágrafos
-- com tipo/alinhamento e 10 links de até 1000 caracteres ≈ 32–40 KB em
-- jsonb::text). Barra quem escreve direto no PostgREST com a própria sessão.
alter table public.modais_sazonais
  add constraint modais_sazonais_mensagem_tamanho
  check (mensagem is null or octet_length(mensagem::text) <= 65536);

-- RN-M08: forma de TOPO (versão + lista de parágrafos com teto). A validação
-- SEMÂNTICA completa (enums, URL, estrutura plana) é do zod, na escrita E na
-- leitura. Não é duplicada em SQL.
alter table public.modais_sazonais
  add constraint modais_sazonais_mensagem_forma
  check (
    mensagem is null or (
      jsonb_typeof(mensagem) = 'object'
      and mensagem -> 'versao' = '1'::jsonb
      and jsonb_typeof(mensagem -> 'paragrafos') = 'array'
      and jsonb_array_length(mensagem -> 'paragrafos') between 1 and 20
    )
  );

-- RN-M09: endurecimento do TÍTULO (hoje só o zod limita a 120).
alter table public.modais_sazonais
  add constraint modais_sazonais_titulo_tamanho
  check (char_length(titulo) between 1 and 120);

alter table public.modais_sazonais
  add constraint modais_sazonais_titulo_sem_invisiveis
  check (titulo !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0D\uFEFF\uFFA0\uFFF9-\uFFFB\U000E0000-\U000E007F]');  -- escapes ARE; nunca caractere invisível literal (corrigido 2026-09-27; conjunto ampliado pela issue 316 em 20260927122000)
```

- **RLS:** nenhuma política nova. A coluna pertence à linha, e as três políticas de `modais_sazonais`
  já cobrem leitura e escrita dela. Rascunho continua sem vazar para `anon`, mensagem incluída (RN-03).
  **Obrigatório:** teste pglite provando isso para a coluna nova (matriz A9/A10).
- **GRANTs:** inalterados (grant de tabela cobre a coluna nova).
- **Linhas existentes:** `mensagem` nasce `NULL`. Os CHECKs de título validam as linhas atuais. Se alguma
  violar, a migration falha e é revertida, mas as anteriores do mesmo push podem já ter sido aplicadas (a
  transação é por arquivo). Por isso a pré-checagem no cloud é obrigatória antes do push, com zero linhas.
- **Tipos:** o tipo manual `ModalSazonal` em `modaisSazonais.ts` ganha `mensagem: unknown`, **de propósito
  `unknown`**: o consumidor é obrigado a passar por `lerMensagemModal` (RN-M04).
- **Rollback (manual):** ordem reversa. `drop function public.salvar_modal_sazonal(...)` (a Server
  Action precisa voltar ao caminho antigo **antes**, senão criar/editar quebra), depois `drop constraint`
  (x4) + `drop column mensagem`. Perde as mensagens gravadas.

### RPC `salvar_modal_sazonal` (RN-M15)

**Variante:** `SECURITY INVOKER`, conforme `seguranca.md` §2 ("RPC de escrita em lote do lojista", molde
`reordenar_categorias`). Só o lojista autenticado escreve, e a RLS dele é avaliada em cada
INSERT/UPDATE/DELETE do corpo. `DEFINER` foi **recusado**: admin está fora do escopo, e `definer`
trocaria a RLS por travas no corpo sem nenhum ganho. Uma função PL/pgSQL roda numa transação só: qualquer
`raise` ou erro de constraint (`23503`, `23505`, `23514`) desfaz **tudo** o que ela já escreveu.

```sql
create or replace function public.salvar_modal_sazonal(
  p_loja_id                 uuid,         -- da Server Action (buscarLojaDoDono), NUNCA do payload
  p_modal_id                uuid,         -- null = criar; senão = editar (validado como uuid na Action)
  p_titulo                  text,
  p_exibicao_inicio         timestamptz,
  p_exibicao_fim            timestamptz,
  p_mensagem                jsonb,        -- já canonizada pelo zod; os CHECKs da tabela valem
  p_mostrar_promocoes_junto boolean,      -- null = preservar (editar) / default false (criar)
  p_categorias              uuid[],
  p_cardapios               uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$ ... $$;
```

**Travas do corpo, nesta ordem** (numeração própria, inspirada em T1–T7 de `seguranca.md` §2):

| Trava | O quê | Por quê nesta ordem |
|---|---|---|
| S1 | `auth.uid() is not null`, senão `raise` | sem sessão (anon, `service_role` sem JWT de usuário) é fail-closed. Admin fora do escopo |
| S2 | **Posse explícita:** `exists (select 1 from lojas where id = p_loja_id and dono_id = auth.uid())`, senão `raise` | não depende só da RLS: continua fail-closed se a policy um dia for afrouxada. Vem antes de tocar em qualquer linha |
| S3 | Arrays: `cardinality()` (nunca `array_length`) ≤ 50 cada (espelho de `TETO_SELECAO`); `array_ndims` ≤ 1; sem `null` dentro; sem duplicata (`cardinality = count(distinct)`) | a RPC pode ser chamada **direto** pelo PostgREST com a sessão do dono, contornando o zod. Array multidimensional corromperia a contagem (achado de `20260908130000`) |
| S4 | `p_modal_id` nulo: `INSERT` da linha (`ativo` no default `false`, `loja_id = p_loja_id`) `returning id`. Não nulo: `UPDATE ... where id = p_modal_id and loja_id = p_loja_id returning id`; **0 linhas** faz `raise` (modal de outra loja ou inexistente, sem oráculo: mesma mensagem nos dois casos) | a linha é escrita primeiro para que as FKs compostas das junções tenham alvo. `atualizado_em = now()` no UPDATE. `mostrar_promocoes_junto = coalesce(p_mostrar_promocoes_junto, mostrar_promocoes_junto)` no UPDATE preserva a semântica "ausente = manter" de hoje. **`ativo` nunca é escrito aqui** (transição de estado é de `ativar`/`desativar`, RN-05) |
| S5 | `delete from modal_sazonal_categorias where loja_id = p_loja_id and modal_sazonal_id = v_id`, idem cardápios | escopo duplo explícito além da RLS |
| S6 | `insert ... select p_loja_id, v_id, unnest(p_categorias)`, idem cardápios; confere `row_count = cardinality(...)`, senão `raise` | a **FK composta** `(categoria_id, loja_id)` / `(cardapio_id, loja_id)` recusa (`23503`) id de outra loja ou apagado, e isso **desfaz a transação inteira** (RN-11 + RN-M15) |
| S7 | `revoke all on function ... from public, anon;` `grant execute ... to authenticated;` (**sem grant novo** a `service_role`) *(corrigido 2026-09-27: `service_role` mantém EXECUTE pelos default privileges de `20260614008500`, que o revoke não alcança — `seguranca.md` §2; é barrado por S1, provado em V6 com `asService`)* | `anon` recebe `EXECUTE` por entrada própria na ACL via default privileges (`seguranca.md` §2). Sem o revoke nominal, a anon key do bundle chamaria a RPC |

- **Mensagens de `raise`:** códigos e textos internos estáveis (ex.: `P0001 'modal_sazonal: sem posse'`)
  para o teste afirmar **o fragmento da mensagem junto do SQLSTATE** (memória "SQLSTATE não basta em
  teste de escopo"). A Server Action traduz qualquer erro para `ERRO_GENERICO` e loga o detalhe
  (`seguranca.md` §14).
- **Retorno:** o `id` do modal (criado ou editado). A Action não precisa de nenhum SELECT extra.
- **Tipos:** até `database.types.ts` conhecer as tabelas e a função, a chamada `.rpc` passa pela mesma
  fronteira mínima tipada que `modalSazonal.ts` já usa (`ClientModal`), acrescida de
  `rpc(nome, args): PromiseLike<RespostaModal>`.
- **Por que RPC e não a alternativa sem RPC** (`seguranca.md` §2, "sequência de requests sob constraint
  trigger DEFERRED"): aquela alternativa exige uma **invariante** que um trigger verifique no COMMIT. Aqui
  a garantia desejada é "o conjunto inteiro de escritas de um save é tudo ou nada", e não existe
  invariante de linha que expresse isso (seleção vazia agora é válida). Requests PostgREST separados
  continuariam sendo transações separadas. Só uma função resolve.

### Formato da mensagem (contrato `versao: 1`)

```ts
// src/lib/validacoes/mensagemModal.ts — forma CANÔNICA (depois do transform do zod)

type TamanhoTrecho = "pequeno" | "grande" | "enorme";                       // ausente = normal
type CorTrecho = "marrom" | "vermelho" | "laranja" | "verde" | "azul" | "roxo" | "cinza"; // ausente = automática
type FonteTrecho = "serifa" | "mono";                                       // ausente = padrão (sans)
type TipoParagrafo = "titulo" | "item-lista" | "item-numerado";            // ausente = parágrafo comum
type Alinhamento = "centro" | "direita";                                    // ausente = esquerda

type Trecho = {
  texto: string;          // texto PURO, 1+ caractere, sem quebra de linha, normalizado
  negrito?: true;         // cada marca presente só quando ligada (nunca `false`)
  italico?: true;
  sublinhado?: true;
  tachado?: true;
  tamanho?: TamanhoTrecho;
  cor?: CorTrecho;
  fonte?: FonteTrecho;
  link?: LinkExterno;     // URL https CANÔNICA (RN-M12); com link, `cor` e `sublinhado` são removidos
};

type Paragrafo = {
  tipo?: TipoParagrafo;   // UM valor só: título e item de lista são mutuamente exclusivos por construção
  alinhamento?: Alinhamento;
  trechos: Trecho[];      // [] = linha em branco (só em parágrafo comum)
};

type MensagemModal = { versao: 1; paragrafos: Paragrafo[] };

// Tipos BRANDED: só saem do parse do zod.
type MensagemModalValidada = MensagemModal & z.BRAND<"MensagemModalValidada">;
type LinkExterno = string & z.BRAND<"LinkExternoValidado">;
```

- **Não existe** campo para hex, `rgb()`, nome de família, `url()`, classe, id, `style`, `target`,
  `rel`, nível de lista, filhos ou HTML. `.strict()` recusa qualquer chave fora das listadas acima.
- **Listas são planas:** um "item de lista" é um parágrafo com `tipo`. Itens consecutivos do mesmo tipo
  formam **uma** lista no render. Não há recursão no schema (`z.lazy` proibido neste módulo) nem no
  renderizador.
- Chaves em português (convenção do projeto). `versao` permite evoluir o formato. Um `versao`
  desconhecido reprova na escrita e é descartado na leitura.

---

## Regras de Negócio

Numeração `RN-M*` para não colidir com RN-01 a RN-11 do spec de origem.

- **RN-M01 — Critério de abertura: ativo e na janela, e só isso.** O SSR monta
  `modalSazonal = { titulo, mensagem, produtos }` sempre que o modal é `ativo` (query) e está
  `dentroDaJanelaExibicao` (RN-02). O título é obrigatório (zod + CHECK), então todo modal tem o que
  mostrar. `mensagem` (resultado de `lerMensagemModal`) e `produtos` (resultado de
  `derivarProdutosDoModalSazonal`, RN-10) só decidem **o que aparece dentro**, nunca **se** abre:

  | Mensagem | Pratos à venda agora | O modal mostra |
  |---|---|---|
  | não | não (sem seleção, ou seleção fora de vigência) | **só o título** + CTAs |
  | sim | não | título + mensagem |
  | não | sim | título + pratos (igual a hoje) |
  | sim | sim | título + mensagem + pratos |

  **Mudança de comportamento em relação a hoje:** um modal com seleção cujos pratos estão todos fora de
  vigência **passa a abrir** só com o título, onde hoje ele não abria (`page.tsx` exigia
  `produtosDoModalSazonal.length > 0`). É consequência direta da decisão do usuário (título sozinho é
  conteúdo). O componente não reavalia conteúdo: `temModalSazonal: true`, e a trava 7 só guarda o
  título vazio (defensivo). Garantido em: **SSR** (autoridade da existência).

- **RN-M02 — Seleção e mensagem são opcionais** (remove RN-06). O `.refine` de
  `categorias.length + cardapios.length >= 1` é **removido** do `schemaModalSazonal`, e nenhum outro o
  substitui. Um modal só com título e janela é válido. **Não** há CHECK nem trigger equivalente a
  remover: a RN-06 vivia só no zod (conferido na migration `20260925140000`). Continua valendo: título
  obrigatório (1..120, RN-M09), janela ordenada (RN-02), tetos das listas (`TETO_SELECAO`). No form,
  o caso "nem mensagem nem seleção" gera **só** o aviso leve não bloqueante (§Painel), para que ativar um
  modal só com título seja decisão consciente e não descuido. Garantido em: **Server Action** (o zod
  aceita) + **cliente (UX)** (aviso).

- **RN-M03 — A mensagem é um documento estruturado, nunca HTML/Markdown/CSS.** `schemaMensagemModal`:
  - `.strict()` em **todos** os níveis (documento, parágrafo, trecho): `href`, `style`, `class`, `html`,
    `target`, `rel`, `nivel`, `filhos`, `__proto__`, `constructor` ou qualquer chave fora da allowlist
    **reprova**;
  - marcas booleanas: `z.boolean().optional()` na entrada, `false` canonizado para ausente (a saída só tem `true`). *(Corrigido 2026-09-27: `z.literal(true)` recusaria o `false` que a própria regra manda aceitar; o render continua lendo com `=== true`.)*;
  - `tamanho`, `cor`, `fonte`, `tipo`, `alinhamento`: `z.enum([...])` fechados. Os valores-padrão
    (`"normal"`, `"automatica"`, `"padrao"`, `"paragrafo"`, `"esquerda"`) são aceitos na entrada e
    canonizados para ausente;
  - `link`: RN-M12;
  - `texto`: teto bruto antes do transform (`.max(3200)`), depois troca de qualquer quebra ou tab
    (`\t`, `\n`, `\v`, `\f`, `\r`, U+0085, U+2028/2029) por espaço e **só então**
    `removerInvisiveisEControles(t, { preservarJuncaoDeEmoji: true })`. Parágrafo é a **única** forma de quebra.
    Além de controles e bidi, a função remove os invisíveis **não-bidi** (issue 316): U+00AD, U+034F,
    U+115F, U+1160, U+180E, U+2800, U+3164, U+FFA0, U+FFF9–U+FFFB, U+FE00–U+FE0E e as tags
    U+E0000–U+E007F. Exceções: U+FE0E logo depois de `\p{Extended_Pictographic}` fica; a bandeira de
    subdivisão (U+1F3F4 + 2 a 7 tags em U+E0030–E0039/U+E0061–E007A + U+E007F) fica no trecho. Depois da
    remoção, marcas combinantes seguidas são cortadas em 3 (`/(\p{Mn}{3})\p{Mn}+/gu → "$1"`, anti-Zalgo),
    antes de qualquer teto ser medido. A observação de pedido (`normalizarObservacao`) ganha só a remoção,
    não o corte de Zalgo. Na observação todas as tags saem (a bandeira de subdivisão vira U+1F3F4), porque ali
    `preservarJuncaoDeEmoji` é `false`; isso também muda `linhaCarrinhoId`, então um carrinho salvo antes do deploy
    com duas linhas que diferiam só por U+00AD passa a ter o mesmo id nas duas (efeito de UX, sem valor monetário,
    coberto em `normalizarObservacao.test.ts` §passo 3b);
    *(Divergência conferida em 2026-09-27: o passo 2 de `normalizarObservacao` preserva `\t`/`\n` e o
    passo 3 apaga U+2028/2029; na ordem original, U+2028 sumia em vez de virar espaço e `\t` sobrevivia.)*;
  - **canonização** (transform), nesta ordem:
    1. remove trechos de texto vazio;
    2. em trecho com `link`, remove `cor` e `sublinhado` (o visual do link é fixo, RN-M12);
    3. em parágrafo `titulo`, remove `tamanho` dos trechos (o título tem tamanho fixo, RN-M14);
    4. **funde trechos adjacentes com todos os atributos idênticos**, `link` incluído;
    5. parágrafo `titulo`/`item-*` sem texto visível vira parágrafo comum vazio;
    6. remove parágrafos vazios do começo e do fim e colapsa 2+ vazios seguidos em 1 (anti-padding);
    7. documento sem nenhum caractere visível (`\S`) vira `null`;
  - os tetos de RN-M08 são medidos **depois** da canonização (ordem transform, depois medir, como em
    `schemaObservacao`).

  Garantido em: **Server Action** (escrita) + **zod na leitura** (RN-M04).

- **RN-M04 — Parse na leitura, fail-closed.** Todo caminho que **exibe** a mensagem (SSR da vitrine,
  SSR do painel) obtém o valor por `lerMensagemModal(raw: unknown, ctx: { lojaId; modalId }): MensagemModalValidada | null`
  (o `ctx` só alimenta o log; assinatura fixada na quebra em issues), que
  roda o **mesmo** `schemaMensagemModal.safeParse`. Falha devolve `null` e faz
  `console.error("[modalSazonal] mensagem inválida", { lojaId, modalId })`, **sem** logar conteúdo nem
  URL. Motivo: a RLS `modais_sazonais_escrita_propria` permite ao dono gravar a própria linha **direto no
  PostgREST** com anon key e JWT, contornando zod e Server Action (o mesmo vetor do trigger de
  consentimento, `seguranca.md` §2). Os tipos *branded* garantem, pelo `tsc`, que nenhum componente
  renderiza mensagem nem URL não parseada. Garantido em: **SSR** + **tipo**.

- **RN-M05 — Contrato do renderizador `MensagemFormatada` (seguro por construção).** Mesmo que
  recebesse lixo, o componente não produz marcação perigosa:
  - **blocos:** parágrafo comum é `<p>`. `titulo` é `<p>` com classe fixa de título (RN-M14), **não**
    `<h*>`. Itens consecutivos `item-lista` formam `<ul>` com `<li>`, e `item-numerado` forma `<ol>`
    com `<li>`, **sem** atributo `start`/`type`/`value`. Nada é recursivo;
  - **alinhamento:** classe de um mapa constante (`text-center`, `text-right`);
  - **trecho:** negrito `<strong>`, itálico `<em>`, tachado `<s>`. Sublinhado, tamanho, cor e fonte são
    `<span>` com classes **de mapas constantes** (ex.: `underline`; `text-sm`/`text-lg`/`text-xl`; classes
    da paleta; `font-serif`/`font-mono`). O valor final de cada classe fica com `desenhar`;
  - **link:** com `aoEscolherLink`, `<button type="button" onClick={() => aoEscolherLink(link)}>` com
    visual fixo de link (cor de link fixa + sublinhado + ícone `ExternalLink` com `aria-hidden`) e
    rótulo acessível "{texto} (link externo, abre aviso)". Sem callback, `<span>` com o mesmo visual.
    **Proibido `<a>` no renderizador**: o único `href` do fluxo é o do `AvisoSaidaLink` (RN-M12);
  - o texto entra **só** como filho `{trecho.texto}` (escape do React). **Proibido**:
    `dangerouslySetInnerHTML`, spread de props, atributo derivado do conteúdo (`id`, `name`, `title`,
    `href`, `style`, `className` montado com string do lojista, `data-*`), portal, `<style>`, `<link>`,
    `@font-face`;
  - marca booleana lida com `=== true` estrito;
  - toda classe de enum buscada com `Object.hasOwn(MAPA, valor)` (ou `Map`), nunca `MAPA[valor]` direto
    (`MAPA["constructor"]` devolveria uma função). Valor desconhecido não gera classe;
  - `key` por índice (o conteúdo nunca vira chave);
  - contêiner com `break-words [overflow-wrap:anywhere]`, sem `position` absoluta/fixa, sem `z-index`.

  Preserva o princípio da RN-01 de origem ("input externo é dado, nunca instrução") e a `seguranca.md`
  §15. Garantido em: **renderizador** + teste `renderToStaticMarkup` com corpus hostil.

- **RN-M06 — A mensagem não sequestra o modal.** Área da mensagem com altura máxima e rolagem própria.
  ✕ (44×44) e CTAs fora dela, sempre alcançáveis. Nenhum elemento da mensagem pode cobrir ou deslocar
  os controles do modal (UI redress). Um título da mensagem não é confundido com o título real do modal:
  o `DialogTitle` continua sendo o único heading. Garantido em: **cliente (UX)** + **renderizador**.

- **RN-M07 — Supressão do `ModalPromocoes` só quando o sazonal abre** (ajusta RN-09). Hoje
  `suprimirPromocoes = modalSazonalNaJanela !== null && !mostrar_promocoes_junto`: um sazonal na janela
  **sem nada a mostrar** suprime as promoções e o cliente fica sem modal nenhum. Passa a ser
  `modalSazonal !== null && !modalSazonalNaJanela.mostrar_promocoes_junto`. **Aplicar** (decisão do
  usuário).
  > **Nota honesta:** com RN-M01 da v0.3.0 (todo modal ativo na janela abre), `modalSazonal !== null`
  > passa a ser **equivalente** a `modalSazonalNaJanela !== null`. O bug descrito deixa de ser
  > alcançável e a fórmula nova produz o mesmo resultado da antiga. A correção continua valendo **pela
  > invariante**: a supressão é derivada do objeto que **de fato desce** para o cliente, então qualquer
  > critério futuro de não abrir (ex.: modal que some por outro motivo) não volta a suprimir promoções à
  > toa. O teste afirma a invariante ("`suprimirPromocoes` implica `modalSazonal !== null`"), não só o
  > cenário.

  Garantido em: **SSR**.

- **RN-M08 — Tetos de cardinalidade e tamanho (CWE-770).** Constantes exportadas de `mensagemModal.ts`,
  usadas pelo zod e pelo contador da UI:

  | Limite | Valor | Onde é medido |
  |---|---|---|
  | caracteres visíveis no total (`contarCaracteresMensagem`, unidades UTF-16; URL de link **não** conta) | **800** | zod, depois da canonização |
  | parágrafos (incluindo linhas em branco, títulos e itens de lista) | **20** | zod (bruto `.max(40)`; canônico `.max(20)`) + CHECK de topo |
  | trechos por parágrafo (bruto, antes da fusão) | **200** | zod, antes do transform |
  | trechos no documento (canônico, depois da fusão) | **120** | zod, depois da canonização |
  | texto bruto por trecho | **3200** | zod, antes do transform |
  | trechos com link (canônico, depois da fusão) | **10** | zod, depois da canonização |
  | URL de link | bruto **2048**; canônico **1000** | zod (antes e depois de canonizar) |
  | documento serializado | **64 KB** | CHECK `modais_sazonais_mensagem_tamanho` |
  | corpo da Server Action | 2 MB | `next.config` `serverActions.bodySizeLimit` (já existe) |
  | modais por loja (`TETO_MODAIS_POR_LOJA`, `validacoes/modalSazonal.ts`) | **50** | trigger `after insert` `modais_sazonais_teto_por_loja` (AFTER para não virar oráculo de contagem antes da RLS) (P0001 `modal_sazonal: teto de modais`, cobre INSERT direto e RPC; serializado por loja com advisory lock) + `.limit(50)` em `listarModaisSazonaisDoDono` (issue 318) |

  Garantido em: **Server Action** (zod) + **CHECK no banco** + **trigger** (teto de modais).

- **RN-M09 — Título do modal endurecido** (amplia RN-01). `titulo` no zod passa pela troca de quebra
  de linha **e tab** por espaço e **depois** por `removerInvisiveisEControles` (sem
  `preservarJuncaoDeEmoji`, igual à observação), antes de `trim().min(1).max(120)`. *(Divergência
  conferida em 2026-09-27: `normalizarObservacao` preserva `\t`, e o CHECK `modais_sazonais_titulo_sem_invisiveis`
  recusa U+0009; sem a troca, um título com tab passava no zod e caía em `23514`.)* No banco, CHECK de tamanho e de ausência
  de controles/bidi **e dos invisíveis não-bidi** (issue 316: U+00AD, U+034F, U+115F, U+1160, U+180E,
  U+2800, U+3164, U+FE00–U+FE0D, U+FFA0, U+FFF9–U+FFFB, U+E0000–U+E007F; U+FE0E/U+FE0F ficam fora do
  CHECK porque o regex do Postgres não avalia contexto de pictograma, e o zod remove o U+FE0E solto). No
  título as tags de bandeira saem sempre, e o Zalgo é cortado em 3 marcas antes do `max(120)` (sem CHECK:
  o Postgres não tem `\p{Mn}`). Renderização continua como texto do React. Garantido em: **Server Action** +
  **CHECK no banco**.

- **RN-M10 — `id` de rota validado antes de I/O.** `editarModalSazonal`, `ativarModalSazonal`,
  `desativarModalSazonal` e `removerModalSazonal` passam `id` por `z.guid().safeParse` antes de
  rate-limit, client e query. Lixo recebe `ERRO_VALIDACAO`. Garantido em: **Server Action**.

- **RN-M11 — Isolamento por loja estendido ao campo novo (sem furo).** Escrita: `mensagem` só entra por
  `montarPatchModalSazonal` (allowlist) nos argumentos da RPC, com `p_loja_id` vindo de
  `buscarLojaDoDono`, posse reconferida no corpo (S2), `where loja_id = p_loja_id` em toda escrita e RLS
  USING + WITH CHECK avaliada (RPC `invoker`). Leitura pública: só modal `ativo` de loja
  ativa, escopado por `loja_id` da loja do slug. Render: o conteúdo de uma loja não tem nenhum canal para
  afetar a vitrine de outra, porque não existe CSS, script, id, classe dinâmica, fonte externa nem estado
  global derivado dele. O link só leva o cliente **para fora**, com aviso, e não altera nada no iRango.
  O cache de rota é por slug. Garantido em: **Server Action + RLS** (escrita), **RLS + query**
  (leitura), **renderizador** (RN-M05).

- **RN-M12 — Links: só `https://`, formato estrito, canônico, com aviso de saída.**
  - **Validação** (`urlLinkExternoSegura(bruto): LinkExterno | null`, usada pelo zod na escrita, pelo zod
    na leitura, pelo campo do editor e pelo `AvisoSaidaLink` no render), nesta ordem:
    1. `bruto.length <= 2048`;
    2. `urlHttpsSegura(bruto)` não nulo: começa **exatamente** com `https://`, case-sensitive.
       `javascript:`, `data:`, `vbscript:`, `http:`, `mailto:`, `tel:`, `//host`, relativa, espaço ou
       controle no início: tudo cai aqui;
    3. `new URL(bruto)` não lança, e `protocol === "https:"` (confere de novo depois do parser WHATWG);
    4. `username === ""` e `password === ""` (bloqueia `https://irango.vercel.app@golpe.com`);
    5. `port === ""` (sem porta explícita);
    6. hostname não é IP literal (IPv4 decimal/hex/octal normalizado pelo parser, IPv6 `[...]`), não é
       `localhost` nem termina em `.localhost`, e tem ao menos um ponto com rótulo final não numérico;
    7. canonização: devolve `url.href`, com hostname IDN em **punycode** (feito pelo parser WHATWG, e é o
       que o aviso mostra: anti-homógrafo). `url.href.length <= 1000`;
    8. o valor devolvido é o **canônico**. O que se grava e o que se renderiza é sempre ele, nunca o bruto.
  - **Links para o próprio domínio do iRango** (outra loja, por exemplo) são permitidos: são `https`, só
    navegam (GET), passam pelo mesmo aviso, e nenhuma Server Action é disparada por GET.
  - **Render:** na mensagem, link é `<button>` (RN-M05). O toque troca o conteúdo do **mesmo** dialog para
    o `AvisoSaidaLink`. Nunca um segundo dialog, o que preserva o "um focus-trap e uma trava de scroll por
    vez" do 289/RN-5. O aviso revalida a URL e só então renderiza
    `<a href target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">`. `rel` e
    `referrerPolicy` são **literais fixos no componente**, não props.
  - **Visual fixo:** o link tem cor fixa, sublinhado e ícone `ExternalLink`. `cor` e `sublinhado` do
    lojista são removidos na canonização, então um link não pode se disfarçar de texto comum. Texto comum
    não pode receber o ícone, e o ícone é o sinal distintivo, já que "azul + sublinhado" em texto comum é
    possível.
  - **Log:** a URL nunca vai para log nem Sentry (pode conter token de terceiro na query).

  Garantido em: **zod** (escrita e leitura) + **renderizador** (`MensagemFormatada` sem `<a>`,
  `AvisoSaidaLink` com revalidação e `rel` fixo) + **cliente (UX)** (aviso).

- **RN-M13 — Cor: paleta fixa pré-validada para WCAG AA.** Enum fechado de 7 cores + automática
  (ausente = cor de texto do modal). Valores iniciais (o `desenhar` pode trocar tons, mas **só** para
  outros que passem no teste):

  | Chave | Tom | Origem | Contraste sobre `#ffffff` (medido) |
  |---|---|---|---|
  | `marrom` | `#3e2723` | token `--texto` | 13,82:1 |
  | `vermelho` | `#b91c1c` | Tailwind red-700 | 6,47:1 |
  | `laranja` | `#c2410c` | Tailwind orange-700 | 5,18:1 |
  | `verde` | `#166534` | token `--promo-texto` | 7,13:1 |
  | `azul` | `#1d4ed8` | Tailwind blue-700 | 6,70:1 |
  | `roxo` | `#7e22ce` | Tailwind purple-700 | 6,98:1 |
  | `cinza` | `#6b5d4f` | token `--texto-muted` | 6,36:1 |

  A cor fixa do link é um tom separado, fora da paleta do lojista (proposta: `#1e40af`, Tailwind
  blue-800, 8,72:1). Como ela fica perto do `azul`, **o ícone `ExternalLink` é o sinal distintivo** do
  link, não a cor. A paleta e a cor do link vivem num
  módulo constante (`src/lib/constants/paletaMensagem.ts`) junto com `FUNDO_MODAL_MENSAGEM` (o `bg-popover`
  claro do `Dialog`, `oklch(1 0 0)` = `#ffffff`). **Teste obrigatório:** razão de contraste WCAG de cada
  cor, e da cor do link, contra `FUNDO_MODAL_MENSAGEM` **≥ 4,5:1** (texto normal, inclusive no tamanho
  "pequeno"). Cor fora do enum é recusada no zod, e o render não gera classe para valor desconhecido.
  Garantido em: **zod** (enum) + **teste de contraste** + **renderizador** (mapa constante). As cores do
  tema da loja **nunca** entram na paleta.
  > Premissa registrada: a vitrine não usa a variante `.dark`. Se um dia usar, a paleta precisa de um
  > segundo conjunto validado contra o fundo escuro, e isso fica fora deste spec.

- **RN-M14 — Estrutura de bloco: título, listas e alinhamento, sem aninhamento.**
  - `tipo` é **um** enum por parágrafo (`titulo | item-lista | item-numerado`, ausente = comum). "Título
    e item de lista ao mesmo tempo" é **impossível por construção**: não há dois campos para combinar, e
    uma chave extra (`titulo: true`, `lista: true`) reprova no `.strict()`;
  - **título** é estilo visual fixo (ex.: `text-lg font-bold`, valor com `desenhar`) num `<p>`. **Não**
    é `<h1>`–`<h6>`: o `DialogTitle` já é o heading real do modal, e um heading dentro da mensagem
    quebraria a hierarquia da página. Os trechos dentro do título perdem `tamanho` na canonização; as
    demais marcas valem;
  - **listas** são planas: sem campo de nível, sem filhos, sem `start`. Itens consecutivos do mesmo tipo
    viram uma lista, e a numeração sempre começa em 1 por grupo;
  - **alinhamento** por parágrafo, enum `centro | direita` (ausente = esquerda), mapeado para classe fixa.
    `justificado` fica **fora**: prejudica leitura em tela estreita (WCAG 1.4.8 recomenda evitar) e não
    foi pedido;
  - o teto de 20 parágrafos (RN-M08) inclui títulos e itens de lista.

  Garantido em: **zod** (enum + `.strict()` + ausência de recursão) + **renderizador** (mapa constante,
  agrupamento sem recursão).

- **RN-M15 — Salvar um modal é atômico: linha + mensagem + seleção numa transação só.** Hoje
  `criarModalSazonal`/`editarModalSazonal` fazem INSERT/UPDATE da linha e depois `regravarSelecao`
  (DELETE categorias, DELETE cardápios, INSERT categorias, INSERT cardápios), em até 5 requests
  PostgREST, cada um sua própria transação. Uma falha no meio deixa estado misto, visível ao cliente: por
  exemplo, título e mensagem novos com seleção apagada, ou (na criação) um rascunho órfão sem seleção.
  Passa a ser **uma** chamada à RPC `salvar_modal_sazonal` (§Modelos de Dados), em que:
  - tudo ou nada: qualquer erro (FK composta `23503`, CHECK `23514`, `raise` de trava, `row_count`
    divergente) desfaz linha, mensagem e junções juntos;
  - a Server Action continua sendo a porta: rate-limit, zod, `buscarLojaDoDono`, allowlist, `id` como uuid
    (RN-M10). A RPC é a **unidade de escrita**, com travas próprias (S1–S7) porque também pode ser chamada
    direto pelo PostgREST;
  - `regravarSelecao` é **apagada** (não fica como caminho morto);
  - `desativar`/`remover` **não mudam**; `ativar` passa a ser **uma** chamada à RPC
    `ativar_modal_sazonal` (RN-M16, issue 319).

  Garantido em: **RPC transacional (banco)** + **RLS** (invoker) + **FK composta** + **Server Action**.

  **Testes obrigatórios de falha no meio** (pglite, `asUser(dono)`, suíte V8):
  1. editar com `p_categorias` válidas e `p_cardapios` contendo um cardápio de **outra loja**: `23503`,
     e o título, a mensagem, a janela e as junções **antigas** continuam idênticos ao estado anterior
     (comparação da linha e das junções antes/depois);
  2. editar com um id de categoria **apagado** entre a leitura e o save: `23503`, mesmo rollback total;
  3. criar com seleção inválida: `23503` e **zero** linhas novas em `modais_sazonais` (sem órfão);
  4. editar com `p_mensagem` de 70 KB: `23514` com o nome da constraint, e linha e junções intactas;
  5. **o caso que mais importa:** falha **depois** do DELETE das junções (S5) e **antes** do fim dos
     INSERTs (S6). Os casos 1 e 2 caem exatamente aí. O teste afirma que as junções antigas **voltam**
     a existir, o que prova o rollback do DELETE, e não só a ausência das novas;
  6. `p_modal_id` de outra loja: `raise` de S4 com fragmento de mensagem afirmado, e nada muda em nenhuma
     das duas lojas.

- **RN-M16 — Ativar um modal é atômico: desativar o anterior e ligar o alvo numa transação só**
  (issue 319; ajusta RN-05). `ativarModalSazonal` faz **uma** chamada
  `rpc("ativar_modal_sazonal", { p_modal_id })`, sem `.from(...)`; antes eram dois UPDATEs em requests
  separados, e uma falha entre eles deixava a loja com **zero** modais ativos. A RPC
  (`20260927125000_rpc_ativar_modal_sazonal.sql`) segue o molde de RN-M15: `security invoker` (RLS vale
  nos dois UPDATEs), `raise 'modal_sazonal: sem sessao'` sem `auth.uid()`, posse conferida (modal de uma
  loja do chamador) **antes** de tocar em linha, `raise 'modal_sazonal: modal inexistente'` idêntico para
  modal de outra loja e inexistente, `revoke` de `public` e `anon`, `grant` a `authenticated`. Ativar o
  que já está ativo é idempotente. Só `ativo` (e `atualizado_em`) mudam. A Server Action mantém `id`
  como uuid (RN-M10) e o rate limit antes, e traduz qualquer erro para `ERRO_GENERICO`, com detalhe só no
  log. Garantido em: **RPC transacional (banco)** + **RLS** (invoker) + **índice único parcial** (backstop
  contra corrida) + **Server Action**.

---

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** a mensagem é conteúdo **público** do lojista, não PII de cliente. O
  lojista pode escrever telefone ou chave Pix nela por vontade própria, e isso é conteúdo dele na vitrine
  dele. **Nunca** logamos conteúdo nem URL (RN-M04/RN-M12).
- **Valor monetário?** **Não.** A mensagem não é preço, desconto nem frete, e os pratos seguem com
  preço/selo/comprabilidade recalculados pelo contrato de catálogo. **Não há recálculo novo.** Um "R$"
  escrito na mensagem é texto e não entra em carrinho, checkout nem `criarPedido`.
- **Tabela nova?** Não. Coluna nova em tabela com RLS: **nenhuma política nova**, com **teste pglite
  obrigatório** de herança do isolamento.
- **Função nova?** Sim: `salvar_modal_sazonal`, `SECURITY INVOKER` (a RLS continua sendo avaliada),
  `search_path` fixo, posse reconferida no corpo, `REVOKE ALL FROM public, anon` + `GRANT EXECUTE TO
  authenticated`. **Não** concede a `service_role` (RN-M15, S1–S7). A regra de `seguranca.md` §2 sobre
  revogar `anon` nominalmente vale aqui, e é verificada por **inspeção da migration** + teste pglite de
  chamada `asAnon` (`42501`).
- **API externa com key?** Nenhuma. Nenhuma requisição de servidor a URL do lojista: o link **nunca é
  buscado** (sem preview de link, sem unfurl, sem fetch de favicon), então não há SSRF. Só o navegador do
  cliente navega, depois do aviso.
- **Recurso externo carregado pela vitrine?** Nenhum: fontes são pilhas de sistema, e não há imagem.
- **Dependência nova (Tiptap/ProseMirror):** só no painel, atrás do guard de auth, via `next/dynamic`.
  **Travada por lint:** `no-restricted-imports` em `eslint.config.mjs` proíbe `@tiptap/*` fora de
  `src/components/painel/editor-mensagem/**`, então a vitrine não consegue importar o editor. `npm audit`
  sem alta/crítica antes do merge, e o `pentester` casa a versão com advisories do ProseMirror/Tiptap. O
  editor **não é fronteira de confiança**.
- **Superfície de escrita direta (PostgREST com JWT do dono, na tabela ou na RPC):** coberta por CHECK
  (bytes e forma de topo), pelas travas S1–S7 da RPC e por parse na leitura (RN-M04). A validação semântica completa em SQL foi **recusada** (duplicaria o
  zod). O CHECK existe para **limitar recurso**, e o parse na leitura para **garantir forma**.
- **Erro do banco não vaza:** `23514` cai no `catch` genérico das actions (`seguranca.md` §14).

### Matriz de ataque, defesa e teste, organizada por VETOR (entrada para `quebrar`/`tdd`)

> **Regra de fatiamento (obrigatória para `quebrar` e `tdd`):** as issues de teste **críticas
> (red-first)** são fatiadas **por vetor de ataque**, e **não** por arquivo ou componente tocado. Cada
> issue crítica cobre **um vetor inteiro, de ponta a ponta**: todos os pontos onde aquele vetor
> precisa ser barrado (zod na escrita, zod na leitura, renderizador, CHECK/migration, RLS, RPC, Server
> Action), numa **suíte só**. É proibido espalhar o mesmo vetor em "issue do schema", "issue do
> renderer" e "issue da migration", cada uma testando uma camada isolada: assim nenhuma issue prova
> que o vetor está fechado, e uma camada esquecida passa despercebida.
>
> - **Uma suíte por vetor**, em `tests/seguranca/modal-sazonal/<vetor>.test.ts(x)` (pasta nova; o
>   `planejar` pode ajustar o caminho, mas não o agrupamento). A suíte importa o que precisar de cada
>   camada: `schemaMensagemModal`, `lerMensagemModal`, `renderToStaticMarkup(MensagemFormatada)`,
>   `createTestDb()` com `asAnon`/`asUser`/`asService`, e a Server Action com mocks.
> - **Issue crítica de teste = um vetor** (V1–V8 abaixo). O teste vermelho de cada vetor falha em
>   **todas** as camadas que ainda não existem, e o `tdd` captura o `FAIL`.
> - **Issues de implementação (GREEN)** podem continuar por camada (migration, schema, renderer,
>   action, editor), porque é assim que o código se organiza. Cada uma declara **quais suítes de vetor
>   ela deixa verdes** (ex.: "a migration da RPC deixa verde V6-A29 e V8"). Um vetor só fecha quando a
>   suíte dele está 100% verde.
> - Um caso de teste mora na suíte do seu **vetor principal**. Quando um ataque toca dois vetores, a
>   linha diz onde ele mora, e a outra suíte não o duplica.
> - Testes **não** de segurança (conversor do editor, `modalSoComTitulo`, montagem de payload, prévia)
>   continuam ao lado do módulo, conforme a convenção do `CLAUDE.md`, sem issue crítica.

#### V1 — XSS armazenado e injeção de marcação
*Onde é barrado:* zod `.strict()` (escrita e leitura), renderizador (texto só como nó de texto, sem `<a>`).

| # | Ataque | Defesa | Teste obrigatório |
|---|---|---|---|
| A1 | Texto com `"<img src=x onerror=alert(1)>"`, `"<script>"`, `"javascript:..."` | RN-M05 | `renderToStaticMarkup` com o corpus: saída sem `<img`, `<script`, `on*=`, `href`, `style=`, e texto escapado (`&lt;`). O mesmo corpus gravado direto no banco passa por `lerMensagemModal` e é renderizado igualmente inerte |
| A2 | Chave extra em qualquer nível (`href`, `style`, `class`, `target`, `rel`, `__proto__`, `constructor`, `dangerouslySetInnerHTML`) | RN-M03 `.strict()` | zod reprova cada chave na escrita. `lerMensagemModal` devolve `null` para o mesmo JSON lido do banco. `__proto__`/`constructor` via `JSON.parse` |

#### V2 — Link e URL hostil
*Onde é barrado:* `urlLinkExternoSegura` (campo do editor, zod na escrita, zod na leitura, render do aviso), renderizador sem `<a>`.

| # | Ataque | Defesa | Teste obrigatório |
|---|---|---|---|
| A15 | Protocolo hostil: `javascript:alert(1)`, `JavaScript:alert(1)`, `java\tscript:`, `data:text/html,<script>…`, `vbscript:`, `http://…`, `//golpe.com`, `/painel`, `mailto:`, `tel:`, `" https://…"`, `https:golpe.com` | RN-M12 passos 2–3 | `urlLinkExternoSegura` devolve `null` para cada caso; zod reprova; documento gravado direto com esse link faz `lerMensagemModal` devolver `null`; `AvisoSaidaLink` recebendo o valor por cast não renderiza `<a>` |
| A16 | Link enganoso: `https://irango.vercel.app@golpe.com`, `https://192.168.0.1`, `https://0x7f.1`, `https://[::1]`, `https://localhost`, `https://a.localhost`, `https://golpe.com:8443`, `https://intranet`, homógrafo IDN `https://іrango.com` | RN-M12 passos 4–7 | `null` para credenciais, IP, localhost, porta e host sem ponto. O IDN é aceito e **canonizado para punycode**, e o aviso mostra o hostname `xn--…` |
| A17 | Contornar o aviso: link virar `<a href>` direto na mensagem | RN-M05/RN-M12 | `renderToStaticMarkup(MensagemFormatada)` com links: **zero** `<a` e **zero** `href`; o link é `<button type="button">` |

#### V3 — CSS e enum forçado (tamanho, cor, fonte, alinhamento, tipo de bloco, marcas)
*Onde é barrado:* zod (enums fechados, `z.literal(true)`, `.strict()`), renderizador (mapas constantes com `Object.hasOwn`, `=== true`).

| # | Ataque | Defesa | Teste obrigatório |
|---|---|---|---|
| A3 | Tamanho: `"999px"`, `"constructor"`, `"x;position:fixed"` | enum + `Object.hasOwn` | zod reprova; render forçado (cast) não emite classe nem `style` |
| A4 | Marca não booleana: `negrito: "true"`, `1`, `{}` | `z.literal(true)` + `=== true` | zod reprova; render forçado não emite `<strong>` |
| A19 | Cor: `"#ff0000"`, `"rgb(0,0,0)"`, `"red"`, `"marrom; background:url(//x)"`, `"constructor"` | enum + `Object.hasOwn` | zod reprova; render forçado sem classe nem `style` |
| A20 | Fonte / carregamento externo: `"Comic Sans MS"`, `"url(https://golpe.com/f.woff)"`, `"serif; @import"` | enum + `Object.hasOwn` | zod reprova; render forçado sem classe, `style`, `<link>` nem `@font-face` |
| A21 | Tipo de bloco conflitante: `{tipo:"titulo", lista:true}`, `{titulo:true, tipo:"item-lista"}`, `tipo:"h1"`, `tipo:"script"` | enum único + `.strict()` | zod reprova cada caso; não existe forma de exprimir "título e item" juntos; render forçado com `tipo:"h1"` não emite `<h1>` |
| A23 | Alinhamento: `"justify; position:fixed"`, `"left"`, `"constructor"` | enum + `Object.hasOwn` | zod reprova; render forçado sem classe nem `style` |

#### V4 — DoS, cardinalidade e padding
*Onde é barrado:* zod (tetos brutos antes do transform, tetos canônicos depois), CHECK de bytes/topo, travas S3 da RPC, `bodySizeLimit`.

| # | Ataque | Defesa | Teste obrigatório |
|---|---|---|---|
| A5 | 10 mil trechos, 1 mil parágrafos, texto de 1 MB, URL de 1 MB | tetos brutos + `bodySizeLimit` | zod reprova sem transformar; fronteiras 120/121 trechos, 800/801 caracteres, 10/11 links, 1000/1001 URL canônica, 20/21 parágrafos |
| A7 | Padding para contornar teto: trechos vazios, parágrafos vazios, trechos idênticos picados | canonização antes de medir | 200 trechos idênticos num parágrafo viram 1 e passam (300 = 150+150 em dois parágrafos); 38 vazios entre dois textos viram 1. *(Corrigido em 2026-09-27: "300 num parágrafo" e "50 vazios" contradiziam os tetos brutos de 200 trechos/parágrafo e 40 parágrafos do RN-M08, que vencem.)* |
| A22 | Profundidade forçada: `nivel: 5`, `filhos: [...]`, parágrafo dentro de `trechos`, 1 mil níveis de aninhamento | estrutura plana, sem `z.lazy`, render sem recursão | zod reprova sem `RangeError`; o conversor do editor achata lista aninhada |
| A30 | RPC chamada **direto** com arrays hostis: 10 mil ids, array 2D (`'{{a,b},{c,d}}'`), `null` dentro, duplicatas | S3 (`cardinality`, `array_ndims`, `count(distinct)`) | pglite `asUser(dono)`: cada caso faz `raise` com fragmento afirmado, e nada muda na linha nem nas junções |
| A8b | Documento de 70 KB gravado direto na tabela | CHECK `modais_sazonais_mensagem_tamanho` | pglite: `23514` + nome da constraint (a parte de forma/contorno mora em V6-A8) |

#### V5 — Trojan Source, bidi e Unicode
*Onde é barrado:* `removerInvisiveisEControles` (zod do texto e do título), CHECK do título.

| # | Ataque | Defesa | Teste obrigatório |
|---|---|---|---|
| A6 | U+202E, U+2066–2069, zero-width, C0/C1, substituto desemparelhado no texto e no título | normalização + CHECK do título | removidos antes de medir; `800 visíveis + 50 invisíveis` passa; CHECK recusa título com U+202E via `asUser` (direto na tabela **e** via RPC) |
| A26 | Quebra de emoji e ZWJ usado como invisível entre letras | `preservarJuncaoDeEmoji` só entre pictogramas | `"👨‍👩‍👧"` preservado byte a byte; `"a‍b"` vira `"ab"`; suíte existente de `normalizarObservacao` continua verde |

#### V6 — Isolamento cross-tenant e contorno da Server Action
*Onde é barrado:* Server Action (`.strict()`, `buscarLojaDoDono`, `id` uuid), RPC (S1, S2, S4, S7), RLS, FK composta, parse na leitura.

| # | Ataque | Defesa | Teste obrigatório |
|---|---|---|---|
| A8 | Escrita direta no PostgREST (dono, anon key + JWT) com JSON fora do contrato | CHECK de topo + parse na leitura | pglite `asUser(dono)`: `versao: 2` faz `23514`; topo válido com trecho `{href}` ou `link:"javascript:…"` é gravado, e `lerMensagemModal` devolve `null` |
| A9 | Dono B edita `mensagem` do modal de A (tabela), ou INSERT com `loja_id` de A | RLS USING + WITH CHECK + allowlist | pglite: UPDATE de B afeta 0 linhas e A intacta; INSERT faz `42501`; Action `editarModalSazonal(idDeA, …)` sob B devolve `ok:false` |
| A29 | Dono B chama a **RPC direto** com `p_loja_id` de A, ou com o próprio `p_loja_id` e `p_modal_id` de A, ou com categoria/cardápio de A; `anon` chama a RPC | S1, S2, S4, S6 (FK composta), S7 | pglite: posse alheia faz `raise` (fragmento afirmado); `p_modal_id` alheio faz `raise` de S4; seleção alheia faz `23503`; `asAnon` faz `42501`; **em todos**, zero mudança nas duas lojas |
| A10 | Anon lê `mensagem` de modal `ativo = false` | `modais_sazonais_leitura_publica` | pglite `asAnon`: 0 linhas |
| A11 | Payload com `loja_id`/`ativo` pendurado junto de `mensagem` | `.strict()` raiz | payload válido + `loja_id` reprova, e a RPC nunca é chamada (spy) |
| A12 | `id` de rota lixo (`"1 or 1=1"`, `"../"`) | RN-M10 | action devolve `ERRO_VALIDACAO` sem criar client (spy em `createClient` não chamado) |

#### V7 — UI redress, disfarce e tabnabbing
*Onde é barrado:* layout fixo do `ModalSazonal`, renderizador (visual fixo de link), `AvisoSaidaLink` (`rel`/`referrerPolicy` literais), paleta.

| # | Ataque | Defesa | Teste obrigatório |
|---|---|---|---|
| A13 | Mensagem máxima empurra ✕/CTAs para fora | RN-M06 | afirmação estrutural no markup (contêiner com altura máxima/rolagem, CTAs fora dele) + `verificar` manual em 360px |
| A18 | Tabnabbing e vazamento de referrer no destino | `rel`/`referrerPolicy` literais | markup do aviso tem `rel="noopener noreferrer"`, `referrerpolicy="no-referrer"`, `target="_blank"`, `href` = canônico revalidado; URL que falha na revalidação não gera `<a>` |
| A24 | Link disfarçado de texto (cor igual ao texto, sem sublinhado) | canonização remove `cor`/`sublinhado` + ícone fixo | canonizado sem `cor`/`sublinhado`; o markup do link sempre traz o ícone e a classe fixa |
| A25 | Contraste ilegível (paleta alterada sem checagem) | RN-M13 | razão de contraste WCAG ≥ 4,5:1 de cada cor e da cor do link contra `FUNDO_MODAL_MENSAGEM` |

#### V8 — Integridade transacional (escrita parcial visível ao cliente)
*Onde é barrado:* RPC `salvar_modal_sazonal` (uma transação), FK composta, Server Action (erro genérico).

| # | Ataque ou falha | Defesa | Teste obrigatório |
|---|---|---|---|
| A27 | Falha no meio de uma **edição** (seleção de outra loja, id apagado, CHECK estourado) deixa estado misto: título/mensagem novos com seleção antiga apagada | RN-M15 | casos 1, 2, 4 e 5 de RN-M15: linha **e** junções antigas idênticas antes/depois, e as junções apagadas **voltam** (rollback do DELETE provado) |
| A28 | Falha no meio de uma **criação** deixa rascunho órfão | RN-M15 | caso 3 de RN-M15: zero linhas novas em `modais_sazonais` e nas junções |
| A31 | Regressão: alguém reintroduz escrita em requests separados na Action | `regravarSelecao` apagada; Action faz uma chamada `.rpc` | teste da Action com client mockado: `criar`/`editar` fazem **exatamente uma** chamada, a `rpc("salvar_modal_sazonal", …)`, e **nenhum** `.from("modal_sazonal_*")` |

#### V9 — Superfície de dependência (não crítica, sem TDD red-first)

| # | Ataque | Defesa | Teste |
|---|---|---|---|
| A14 | Import do editor na vitrine | `no-restricted-imports` | `npm run lint` falha com fixture importando `@tiptap/react` fora da pasta permitida (ou prova equivalente no plano) |

**Issues críticas de TDD red-first: uma por vetor, V1 a V8** (oito issues de teste). Cada uma lista as
camadas que o vetor atravessa e os casos (A-números) da sua tabela. V9 é configuração de lint,
verificada na issue que instala o Tiptap.

---

## Alternativas descartadas (decisão fechada, não reabrir na implementação)

| Alternativa | Por que foi descartada |
|---|---|
| Guardar HTML do editor e sanitizar com DOMPurify na renderização | Coloca um parser de HTML e uma allowlist de sanitizador entre o lojista e o visitante. Bypass de sanitizador (mXSS) é uma classe recorrente de CVE. **Violaria a RN-01 de origem.** |
| Markdown renderizado por lib | Parser de string livre, que é o que a RN-01 proíbe. Links e imagens viriam do parser sem aviso nem validação própria. Não tem sublinhado, cor nem tamanho nativos. |
| Guardar o JSON do Tiptap/ProseMirror direto | Acopla banco e vitrine ao formato de uma lib do painel e amplia o schema aceito (nós e marks do ProseMirror, `attrs` livres como `href`/`target`/`class` do `Link`). O formato próprio é menor, versionado e independente do editor. |
| **Tamanho, cor ou fonte livres**: px/rem, hex/`rgb()`/nome CSS, família por nome, `FontSize`/`Color`/`FontFamily`/`TextStyle` do Tiptap (CSS em `style`) | Abre injeção de CSS, quebra de layout, contraste ilegível e carregamento de fonte externa (rastreamento, `url()`). **Cor e fonte, que entraram na v0.2.0, seguem o MESMO padrão de enum fechado do tamanho**: paleta de 7 cores pré-validada para AA e 3 pilhas de fonte do sistema, mapeadas para classes constantes. Não abriram exceção ao princípio. |
| **Link genérico**: `<a href>` direto com a URL do lojista, aceitando qualquer protocolo ou forma (a alternativa implícita na v0.1.0, que deixou links fora) | `javascript:`/`data:` executam código, `http:` expõe o cliente a MITM, credenciais na URL e homógrafos enganam, `<a>` sem `rel` permite tabnabbing, e o clique leva o cliente para fora sem que ele veja para onde. **Por que o link da v0.2.0 é seguro, ao contrário desta alternativa:** (1) só `https://` canônico, validado por protocolo **e** formato (sem credenciais, porta, IP, localhost; IDN em punycode), na escrita **e** na leitura; (2) nenhum `<a>` na mensagem: o toque abre um **aviso de saída** que mostra o domínio real, e só ele tem `href`, revalidado no render; (3) `rel="noopener noreferrer"` + `referrerPolicy="no-referrer"` literais; (4) visual fixo com ícone, sem disfarce; (5) nenhum fetch da URL pelo servidor (sem SSRF); (6) teto de 10 links. |
| Título como `<h1>`–`<h6>` na vitrine | Quebraria a hierarquia de headings da página (o `DialogTitle` é o heading do modal) e confundiria leitor de tela. Título é estilo visual fixo num `<p>`. |
| Listas aninhadas | Abrem recursão no schema e no render (vetor de estouro de pilha) e complicam a canonização, sem ganho relevante num aviso de modal. |
| Alinhamento `justificado` | Prejudica legibilidade em tela estreita (WCAG 1.4.8) e não foi pedido. |
| Validação semântica completa em PL/pgSQL | Duplica o zod (duas fontes da verdade). A exibição já é fail-closed na leitura. |
| Atomicidade por constraint trigger `DEFERRED` + requests separados (a alternativa "sem RPC" de `seguranca.md` §2) | Não existe invariante de linha que um trigger possa conferir no COMMIT ("este save é tudo ou nada" não é uma propriedade de linha, e seleção vazia agora é válida). Requests PostgREST separados continuam sendo transações separadas. Só a RPC dá tudo ou nada (RN-M15). |
| RPC `SECURITY DEFINER` para o salvar | Só o lojista escreve (admin fora do escopo). `invoker` mantém a RLS como autoridade e soma a posse explícita no corpo; `definer` trocaria a RLS por travas sem nenhum chamador que precise disso (`seguranca.md` §2, regra das duas variantes). |
| Formatação por parágrafo inteiro (sem seleção de trecho) | Não atende o pedido ("editar a fonte" é por trecho). O formato por trechos custa o mesmo em segurança. |
| `contentEditable` artesanal ou `document.execCommand` | Reinventa a roda (mandato 2). `execCommand` está depreciado e gera HTML. |

---

## Fora do Escopo (v1)

- **Imagens na mensagem** (inclusive upload). Decisão explícita do usuário. Motivo: phishing,
  rastreamento de visitante (pixel), SSRF se algum dia houver processamento no servidor, e superfície de
  upload (`seguranca.md` §13).
- **Emoji customizado por upload.** É imagem, então fica pelo mesmo motivo acima. Emoji Unicode padrão
  **já funciona** como texto (§Esclarecimento sobre emoji).
- **Autolink** de URL, telefone ou e-mail digitados no texto: aparecem como texto puro. Link só existe
  quando o lojista o cria explicitamente pela barra (`autolink: false`, `linkOnPaste: false`).
- **Links `mailto:`, `tel:`, `http:`, WhatsApp por esquema próprio ou deep link de app.** Só `https://`
  (RN-M12). Um link `https://wa.me/...` é `https` e funciona normalmente, com aviso.
- **Prévia de link (unfurl), favicon ou verificação de reputação do domínio.** Exigiriam fetch do servidor
  a URL do lojista (SSRF) ou serviço externo.
- **Cor de fundo/realce, cor livre, mais de 7 cores, fontes web (Google Fonts etc.), listas aninhadas,
  alinhamento justificado, tabelas, citação, bloco de código, linha horizontal.**
- **Paleta para fundo escuro** (a vitrine não usa `.dark` hoje, RN-M13).
- **Reexibir o modal no mesmo dia quando o lojista edita a mensagem** (versionar a chave
  `irango:promo-sazonal:{slug}` por `atualizado_em`). Mesma regra de hoje (RN-07).
- **Mensagem no `ModalPromocoes`.** Esta spec só toca o modal sazonal.
- **Gestão pelo hub admin** (herdado do spec de origem, com a mesma consequência de segurança).
- **Analytics de leitura da mensagem ou de cliques em link.** Fase 3 (`modelo-negocio.md` §8).
- **Rich text em outros campos** (descrição de produto, "sobre a loja"). Se vier, reusa
  `schemaMensagemModal`, `MensagemFormatada` e `urlLinkExternoSegura` generalizados, em outro spec.
