# [310] RED V7: UI redress, link disfarçado, tabnabbing e contraste da paleta

**crítica:** SIM (TDD red-first)
**Mundo:** vitrine pública
**Depende de:** —
**Spec:** specs/modal-sazonal-mensagem-formatada.md (§Segurança, matriz V7; RN-M06, RN-M12, RN-M13)

## Objetivo
Suíte vermelha que prova que a mensagem não empurra os controles do modal, que o link não se disfarça, que o aviso de saída não permite tabnabbing nem vaza referrer, e que toda cor passa AA.

## Escopo
- [ ] Criar `tests/seguranca/modal-sazonal/v7-redress.test.tsx`.
- [ ] **A13** estrutural: `renderToStaticMarkup` do conteúdo do `ModalSazonal` com mensagem de tamanho máximo: a mensagem está dentro de um contêiner com classe de altura máxima e rolagem (`max-h-`/`overflow-y-auto`) e os CTAs e o ✕ estão fora desse contêiner. Se o `Dialog` do base-ui não renderizar em SSR fechado, extrair o corpo para componente testável é permitido na 314; o teste mira o corpo. `MensagemFormatada` sem `position` absoluta/fixa nem `z-`.
- [ ] **A18** `AvisoSaidaLink` com link válido: `<a` com `rel="noopener noreferrer"`, `referrerpolicy="no-referrer"`, `target="_blank"`, `href` igual ao canônico revalidado; com URL que falha na revalidação (cast): zero `<a`.
- [ ] **A24** zod: trecho com `link` + `cor` + `sublinhado` é canonizado **sem** `cor` e `sublinhado`; markup do link sempre contém o ícone (`svg` com `aria-hidden`) e a classe fixa de link; texto comum nunca traz o ícone.
- [ ] **A25** contraste: para cada cor de `PALETA_MENSAGEM` e para `COR_LINK_MENSAGEM` (nomes a fixar pelo `tdd`, exportados de `src/lib/constants/paletaMensagem.ts`), razão WCAG contra `FUNDO_MODAL_MENSAGEM` ≥ 4,5. Cálculo de luminância relativa no próprio teste (fórmula WCAG 2.x), sem lib nova.
- [ ] Capturar o `FAIL`.

## Fora de escopo
Protocolo/formato de URL (305). Verificação manual em 360px (fica no `verificar` do ciclo).

## Reuso esperado
- Padrão `renderToStaticMarkup` de `ModulosImpressaoAdmin.test.tsx`.
- Tabela de RN-M13 como valores iniciais.

## Segurança
`rel` e `referrerPolicy` são literais no componente, não props: o teste não passa esses valores.

## Critério de aceite
- [ ] A13, A18, A24, A25 cobertos; `FAIL` capturado antes de produção.
- [ ] Nenhum arquivo em `src/` alterado.
