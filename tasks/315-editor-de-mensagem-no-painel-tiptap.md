# [315] Editor da mensagem no painel (Tiptap com allowlist, barra, prévia, aviso "só título")

**crítica:** SIM (a fronteira de confiança é o zod da 313, mas a issue instala dependência e fixa o lint que isola o editor da vitrine)
**Mundo:** painel
**Depende de:** 313, 314
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Painel; §Segurança "Dependência nova" e V9; RN-M02, RN-M08, RN-M12, RN-M13, RN-M14)

## Objetivo
O lojista escreve, formata e pré-visualiza a mensagem; o painel envia só o formato iRango e o Tiptap nunca alcança a vitrine.

## Gate de dependência (antes de instalar, e para a issue se falhar)
1. `npm audit --json` salvo no scratchpad da sessão (fora do repo); baseline conhecida: **8 high pré-existentes** não relacionados.
2. Instalar **pacotes individuais** do Tiptap **3.31.3** (fixar a versão exata), nunca `@tiptap/starter-kit` (traz `Code`, `CodeBlock`, `HardBreak`, `Blockquote`, `HorizontalRule`, proibidos): `@tiptap/react`, `@tiptap/pm`, `@tiptap/core`, `@tiptap/extension-document`, `-paragraph`, `-text`, `-bold`, `-italic`, `-underline`, `-strike`, `-heading`, `-bullet-list`, `-ordered-list`, `-list-item`, `-text-align`, `-link`, e o pacote de desfazer/refazer da 3.x (conferir o nome em `node_modules`/npm antes; não inventar).
3. `npm audit` de novo: delta de high/critical **tem que ser zero**. Se não for, desfazer a instalação, não seguir, e reportar.
4. `npx shadcn add toggle-group` (não editar `components/ui/` à mão).

## Arquivos
- **Criar** `src/components/painel/editor-mensagem/EditorMensagem.tsx`: extensões e configurações exatamente da tabela de §Painel; marks próprias `tamanho`/`cor`/`fonte` com `parseHTML: () => []`; `handlePaste` só `text/plain`; conteúdo inicial só de `mensagemParaDocumentoEditor`; nunca `setContent`/`insertContent` com string HTML. Carregado via `next/dynamic` com `ssr: false` no form.
- **Criar** `src/components/painel/editor-mensagem/BarraFormatacao.tsx`: grupos de §Painel com `ToggleGroup`, nome acessível em cada cor, alvos 44×44 literais, linha inline de link validada por `urlLinkExternoSegura` com erro "Use um endereço completo que comece com https://".
- **Criar** `src/components/painel/editor-mensagem/conversorEditorMensagem.ts` + `conversorEditorMensagem.test.ts` ao lado: `documentoEditorParaMensagem` (ignora nó/mark fora da allowlist, **achata** lista aninhada: cobre o lado editor de A22) e `mensagemParaDocumentoEditor` (itens consecutivos voltam a ser uma lista); ida e volta estável após `schemaMensagemModal`.
- **Criar** `src/app/(painel)/painel/(bloqueavel)/configuracoes/promocoes/modalSoComTitulo.ts` + `.test.ts` ao lado: helper puro `modalSoComTitulo({ mensagem, categorias, cardapios })`.
- **Modificar** `.../promocoes/montarPayloadModalSazonal.ts` (+ teste existente): `mensagem` sempre presente, `null` quando vazio.
- **Modificar** `.../promocoes/PromocoesClient.tsx` (`FormModalSazonal`): estado `mensagem`, editor dinâmico, contador "N/800" com `contarCaracteresMensagem`, prévia com `MensagemFormatada` sem `aoEscolherLink`, aviso "só título" não bloqueante, seleção opcional.
- **Modificar** `.../promocoes/page.tsx`: cada `mensagem` passa por `lerMensagemModal(raw, { lojaId, modalId })`; inválida vira `null`.
- **Modificar** `eslint.config.mjs`: `no-restricted-imports` com padrão `@tiptap/*` proibido fora de `src/components/painel/editor-mensagem/**` (V9/A14). Prova: arquivo temporário fora da pasta importando `@tiptap/react` faz `npm run lint` falhar; remover o arquivo depois e registrar o output na issue/PR.
- **Não tocar:** `components/ui/` à mão, `MensagemFormatada`/`AvisoSaidaLink` (só reuso), vitrine.

## Reuso
`MensagemFormatada`, `urlLinkExternoSegura`, `schemaMensagemModal`, `contarCaracteresMensagem`, `lerMensagemModal`, paleta de `paletaMensagem.ts` (313); `Label`, `Input`, `Button`, `Card` shadcn; ícones `lucide-react` listados no spec.

## Suítes/testes que ficam verdes
Não fecha vetor V1–V8 (já verdes na 314). Fecha V9 (A14) e deixa verdes `conversorEditorMensagem.test.ts`, `modalSoComTitulo.test.ts`, `montarPayloadModalSazonal.test.ts`.

## Behaviors do spec que esta issue fecha (marcar `[x]` no mesmo PR)
- "Salvar um modal só com título, janela e mensagem, sem categoria nem cardápio."
- "Salvar um modal só com seleção, sem mensagem, como hoje."
- "Salvar um modal só com título e janela, sem mensagem e sem seleção, vendo antes o aviso "Este modal vai aparecer só com o título…", que não bloqueia."
- "Escrever a mensagem em parágrafos (Enter cria parágrafo)."
- "Aplicar negrito, itálico, sublinhado ou tachado a um trecho selecionado, pela barra ou pelos atalhos."
- "Mudar o tamanho de um trecho (Pequeno, Normal, Grande, Enorme)."
- "Mudar a cor de um trecho para uma das cores da paleta, ou voltar para a automática."
- "Mudar a fonte de um trecho (Padrão, Serifada, Monoespaçada)."
- "Alinhar um parágrafo à esquerda, ao centro ou à direita."
- "Transformar um parágrafo em título."
- "Criar uma lista com marcadores ou numerada, de um nível só."
- "Pôr um link num trecho digitando uma URL `https://`."
- "Remover o link de um trecho."
- "Colar texto de outro app e ver só o texto entrar, sem formatação, link ou imagem."
- "Digitar emoji pelo teclado do sistema e vê-lo inteiro na prévia e na vitrine, inclusive sequências como 👨‍👩‍👧."
- "Ver o contador "N/800" e o aviso ao passar do limite."
- "Ver a prévia da mensagem como o cliente verá."
- "Apagar toda a mensagem e salvar."
- "Reabrir um modal salvo e ver a mensagem de volta no editor com toda a formatação."

Ao fim, com as 4 issues de implementação mescladas, o spec fica 100% `[x]`: `git mv` para `specs/arquivo/` e a linha no RN-06 de `specs/arquivo/modal-divulgacao-sazonal.md` (ver cabeçalho do spec).

## Critério de aceite
- [ ] Delta de `npm audit` high/critical = 0 registrado (antes/depois); `grep -n "starter-kit" package.json` vazio; versões `3.31.3` fixas.
- [ ] `grep -rn "@tiptap" src --include=*.ts --include=*.tsx | grep -v "src/components/painel/editor-mensagem/"` vazio; prova do lint falhando registrada.
- [ ] `grep -rn "TextStyle\|extension-color\|font-family\|FontSize\|setContent(\"\|insertContent(\"" src/components/painel/editor-mensagem/` vazio.
- [ ] Testes ao lado dos módulos verdes; `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build` verdes.
