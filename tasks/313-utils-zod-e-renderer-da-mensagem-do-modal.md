# [313] Utils, zod da mensagem e renderizadores (`MensagemFormatada`, `AvisoSaidaLink`)

**crítica:** SIM (GREEN de 304, 305, 306, 307, 308, 310 nas camadas zod/render)
**Mundo:** vitrine pública
**Depende de:** 304, 305, 306, 307, 308, 310 (suítes vermelhas com `FAIL` capturado)
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Como esta extensão reusa; §Formato da mensagem; RN-M02, RN-M03, RN-M04, RN-M05, RN-M08, RN-M09, RN-M12, RN-M13, RN-M14)

## Objetivo
A base de validação e render compartilhada por vitrine, painel e Server Action: um predicado de URL, um zod, um renderizador.

## Arquivos
- **Modificar** `src/lib/utils/normalizarObservacao.ts`: extrair os passos 2, 3 e 8 para `removerInvisiveisEControles(texto, opcoes?: { preservarJuncaoDeEmoji?: boolean })` exportada no mesmo módulo; `normalizarObservacao` a compõe com opção padrão, comportamento idêntico. `preservarJuncaoDeEmoji: true` mantém U+200D só entre dois `\p{Extended_Pictographic}`.
- **Criar** `src/lib/utils/urlLinkExternoSegura.ts` (+ `urlLinkExternoSegura.test.ts` ao lado para os casos felizes): passos 1–8 de RN-M12, delegando o passo 2 a `urlHttpsSegura`. Molde `fotoSegura`.
- **Criar** `src/lib/constants/paletaMensagem.ts`: paleta de RN-M13, cor fixa do link, `FUNDO_MODAL_MENSAGEM`, mapas constantes de classe (nomes exatamente os que 310 importa).
- **Criar** `src/lib/validacoes/mensagemModal.ts`: `schemaMensagemModal` (`.strict()` em todos os níveis, sem `z.lazy`, tetos brutos antes do transform, canonização 1–7 de RN-M03, tetos canônicos depois), `lerMensagemModal`, `contarCaracteresMensagem`, constantes de teto de RN-M08, tipos branded `MensagemModalValidada`/`LinkExterno`.
  - **Ordem obrigatória no `texto`:** trocar `[\t\n\v\f\r\u0085  ]` por espaço **antes** de `removerInvisiveisEControles` (o passo 2 preserva `\n`/`\t` e o passo 3 apagaria U+2028/2029 em vez de virar espaço).
- **Modificar** `src/lib/validacoes/modalSazonal.ts`: remover o `.refine` de RN-06 (e o comentário correspondente); campo `mensagem: schemaMensagemModal.nullable()` **obrigatório** (chave sempre presente, ver `montarPayloadModalSazonal` na 315); `titulo` endurecido (RN-M09) com a **mesma ordem**: troca de `[\t\n\v\f\r\u0085  ]` por espaço, depois `removerInvisiveisEControles` (sem emoji), depois `trim().min(1).max(120)`. Sem essa ordem um `\t` passa no zod e é recusado pelo CHECK `modais_sazonais_titulo_sem_invisiveis` (que inclui U+0009).
- **Criar** `src/components/shared/MensagemFormatada.tsx`: contrato de RN-M05 inteiro (sem `'use client'`, sem `<a>`, sem `dangerouslySetInnerHTML`, `Object.hasOwn`, `=== true`, `key` por índice, `<p>` para título, `<ul>/<ol>` sem `start`, contêiner `break-words [overflow-wrap:anywhere]`). Não importa `@tiptap/*`.
- **Criar** `src/components/shared/AvisoSaidaLink.tsx`: revalida com `urlLinkExternoSegura` no render, hostname punycode em destaque, URL como texto, `<a target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">` com literais fixos, "Voltar", fallback "Este link não está disponível." sem `<a>`. Precisa de `'use client'` (callbacks).
- **Não tocar:** `normalizarObservacao.test.ts`, `urlHttpsSegura.ts`, `components/ui/`, `src/types/supabase.ts`.

## Reuso
`urlHttpsSegura`, `normalizarObservacao` (extração, não cópia), `lucide-react` (`ExternalLink`), classes Tailwind existentes (`font-serif`, `font-mono`).

## Nota de integração
Com `mensagem` obrigatória no schema, o submit do `FormModalSazonal` recusa até a 315 mandar `mensagem: null`. Tudo entra no mesmo PR; não publicar 313 isolada.

## Suítes que ficam verdes
- V1 (304) inteira; V2 (305) inteira; V3 (306) inteira; V7 (310): A18, A24, A25 (A13 depende da 314).
- V4 (307): A5, A7, A22 (zod). V5 (308): A6 zod do trecho e do título, A26.
- `normalizarObservacao.test.ts` segue verde sem edição.

## Behaviors do spec que esta issue fecha (marcar `[x]` no mesmo PR)
- "Ver a formatação de trecho aplicada (negrito, itálico, sublinhado, tachado, 4 tamanhos, cor da paleta, fonte da lista) exatamente como o lojista viu na prévia."
- "Ver títulos, listas com marcador, listas numeradas e alinhamento como o lojista montou, com listas de um nível só."
- "Ler toda cor da mensagem com contraste AA sobre o fundo do modal."
- "Continuar pelo aviso e abrir o site numa aba nova, sem que ele consiga controlar a vitrine (`window.opener`) nem receber a URL da loja como referrer."

## Critério de aceite
- [ ] Casos zod/render de 304, 305, 306, 307, 308, 310 listados acima verdes.
- [ ] `grep -rn "dangerouslySetInnerHTML\|<a " src/components/shared/MensagemFormatada.tsx` vazio; `grep -n "z.lazy" src/lib/validacoes/mensagemModal.ts` vazio.
- [ ] `npx tsc --noEmit` e `npm run lint` sem erro.
