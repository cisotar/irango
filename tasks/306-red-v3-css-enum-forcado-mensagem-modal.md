# [306] RED V3: CSS e enum forçado (tamanho, cor, fonte, alinhamento, tipo, marcas)

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** —
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Segurança, matriz V3; RN-M03, RN-M05, RN-M13, RN-M14)

## Objetivo
Suíte vermelha que prova que todo atributo de formatação é enum fechado no zod e que o renderizador, mesmo recebendo valor forçado por cast, não emite classe, `style`, `<link>`, `@font-face` nem heading.

## Escopo
- [ ] Criar `tests/seguranca/modal-sazonal/v3-enum.test.tsx`.
- [ ] Para cada caso: (a) `schemaMensagemModal` reprova; (b) `lerMensagemModal` devolve `null`; (c) `renderToStaticMarkup(<MensagemFormatada mensagem={forcado as MensagemModalValidada} />)` sem `style=`, sem classe derivada do valor, sem o valor literal no markup.
- [ ] **A3** tamanho: `"999px"`, `"constructor"`, `"x;position:fixed"`.
- [ ] **A4** marca não booleana: `negrito: "true"`, `1`, `{}` → render forçado sem `<strong>` (idem `italico`/`<em>`, `tachado`/`<s>`, `sublinhado`/`underline`).
- [ ] **A19** cor: `"#ff0000"`, `"rgb(0,0,0)"`, `"red"`, `"marrom; background:url(//x)"`, `"constructor"`.
- [ ] **A20** fonte: `"Comic Sans MS"`, `"url(https://golpe.com/f.woff)"`, `"serif; @import"` → sem `<link`, sem `@font-face`, sem `@import`.
- [ ] **A21** tipo: `{tipo:"titulo", lista:true}`, `{titulo:true, tipo:"item-lista"}`, `tipo:"h1"`, `tipo:"script"` → zod reprova; render forçado com `tipo:"h1"` não emite `<h1`..`<h6`; `tipo:"titulo"` válido renderiza `<p` (nunca heading).
- [ ] **A23** alinhamento: `"justify; position:fixed"`, `"left"`, `"constructor"`.
- [ ] Positivo de controle: valores-padrão (`"normal"`, `"automatica"`, `"padrao"`, `"paragrafo"`, `"esquerda"`, marca `false`) são aceitos e canonizados para ausente (RN-M03).
- [ ] Capturar o `FAIL`.

## Fora de escopo
Contraste da paleta (310). Produção (313).

## Reuso esperado
- Padrão `renderToStaticMarkup` de `ModulosImpressaoAdmin.test.tsx`.
- Enums exatamente os do spec §Formato da mensagem (`versao: 1`).

## Segurança
`MAPA["constructor"]` devolveria função: o teste com `"constructor"` é o que trava o uso de `Object.hasOwn`.

## Critério de aceite
- [ ] A3, A4, A19, A20, A21, A23 cobertos em zod, leitura e render forçado; `FAIL` capturado.
- [ ] Nenhum arquivo em `src/` alterado.
