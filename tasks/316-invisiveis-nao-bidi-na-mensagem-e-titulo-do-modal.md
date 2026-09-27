# 316 — Remover invisíveis não-bidi (Hangul filler, tags, SHY…) da mensagem e do título do modal sazonal

crítica: SIM (normalização de texto exibido a visitante anônimo; toca `normalizarObservacao`, que também serve a observação de pedido)
Spec: specs/modal-sazonal-mensagem-formatada.md (RN-M03, RN-M09, behavior "Ter o título com caracteres invisíveis/bidi removidos")

## Origem

`auditar` (V5, achado B2) @ `0f79d62`, branch `feat/modal-sazonal-mensagem-formatada`.

## Problema

`removerInvisiveisEControles` (`src/lib/utils/normalizarObservacao.ts`) remove C0/C1, zero-width e
toda a família bidi — Trojan Source está fechado. Mas passam intactos caracteres visualmente vazios que
não reordenam texto: U+3164, U+115F, U+1160, U+FFA0, U+2800, U+00AD, U+034F, U+180E, U+FFF9–U+FFFB,
tags U+E0000–U+E007F e seletores U+FE00–U+FE0E fora de emoji. Efeitos:

- `titulo: "\u3164"` passa em `min(1)` e o modal abre com título visualmente vazio;
- trecho com link e `texto: "\u3164"` vira link que só mostra o ícone;
- tags escondem payload ASCII no texto.

## Fix mínimo

Incluir esses caracteres na classe de remoção (só encurta, invariante preservada), mantendo FE0E/FE0F
depois de pictograma e tags depois de U+1F3F4 (bandeiras de subdivisão). Estender o CHECK
`modais_sazonais_titulo_sem_invisiveis` em migration nova. Opcional: limitar diacríticos seguidos
(`/(\p{Mn}{3})\p{Mn}+/gu → "$1"`) contra Zalgo (B3 foi mitigado só no layout com `overflow-hidden`).

## Aceite

RED em `tests/seguranca/modal-sazonal/v5-unicode.test.ts` com cada caractere; `normalizarObservacao.test.ts`
verde; behavior do título recebe `[x]` no spec.
