# [234] `ModalPromocoes` + `decidirModalPromocoes` — abre 1× por dia e nunca rouba o gesto

**crítica:** NÃO
**Mundo:** vitrine pública
**Depende de:** [220] (`tasks/220-migration-modal-promocoes-em-lojas-e-recriacao-de-vitrine-lojas.md`), [222] (`tasks/222-extrair-fusoloja-de-lojaaberta.md`), [224] (`tasks/224-contrato-de-catalogo-produtovitrine-e-projecao.md`) e [232] (`tasks/232-tokens-de-promocao-selodesconto-e-precoproduto.md`)
**Spec:** specs/desconto-por-produto-e-pratos-promocionais.md
**Decisões:** D1, D6 · RN-15, RN-16, RN-17, RN-18 · design §5

## Objetivo

Entregar o modal de abertura da vitrine com a decisão de abrir **fora do componente**, numa
função pura testável em `environment: node`, e com as travas que impedem o erro do PR #139
(modal que intercepta o toque no meio do gesto de navegação).

## Escopo

- [ ] `src/components/vitrine/decisaoModalPromocoes.ts` — módulo **neutro** (sem `'use client'`)
      exportando `decidirModalPromocoes({ toggleDaLoja, temPromocaoAtiva, diaDeHojeNaLoja,
      ultimaVisualizacao, scrollY }): boolean`, com teste próprio ao lado;
- [ ] leitura/escrita de `localStorage` **sempre** em `try/catch`, com o `storage` **injetado por
      parâmetro** (nunca lido de `window` dentro da função). Leitura que falha devolve `null`,
      escrita que falha é engolida. Pior caso: o modal reabre. Chave `irango:promo:<slug>`
      (por slug — um dispositivo visita várias lojas no mesmo dia). `sessionStorage` **não** serve;
- [ ] `src/components/vitrine/ModalPromocoes.tsx` com `Dialog` do shadcn e props **todas
      obrigatórias**: `promocoes: ProdutoVitrine[]`, `toggleDaLoja`, `diaDeHojeNaLoja`,
      `storage: Storage | null`, `destinoFoco: RefObject<HTMLElement | null>`;
- [ ] as **sete travas** de RN-17 / design §5.2: decisão única num `useEffect(..., [])`; **zero
      `setTimeout`**; `scrollY > 0` ⇒ não abre; marca como visto **no instante da decisão**, não no
      fechamento; um único `fechar()` usado por ✕, ESC, clique-fora e pelos dois CTAs; nada no SSR;
      `VitrineClient` renderiza o componente **incondicionalmente** e quem devolve `null` é o filho;
- [ ] **nenhum handler escuta `touchstart`, `pointerdown` ou `mousedown`** — só `onClick` e
      `onKeyDown` (é o que preserva a trava nativa "click exige down E up no mesmo elemento");
- [ ] `destinoFoco` é o `<main>` da vitrine com `tabIndex={-1}`, passado a `finalFocus` do `Dialog`
      (ou `destinoFoco.current?.focus()` no `fechar()`), e é **o mesmo alvo** do CTA "Ver promoções"
      — foco e scroll nunca divergem;
- [ ] anatomia do design §5.4: no máximo **3** pratos + "e mais N"; linhas **não interativas**;
      duas saídas rotuladas ("Ver promoções" ≥52px, "Continuar vendo o cardápio" ≥44px);
- [ ] `diaDeHojeNaLoja` ("YYYY-MM-DD") é derivado **no fuso da loja** via `lib/utils/fusoLoja.ts`,
      no servidor — nunca no relógio do dispositivo;
- [ ] a lista de promoções é `produtosDoCatalogo.filter(p => p.temDesconto)` no **SSR**, sobre o
      catálogo que a página já carregou: zero query nova (RN-15).

## Fora de escopo

O toggle do lojista na tela de perfil (issue 236) e a allowlist (issue 231). Qualquer navegação:
o modal **não** abre o carrinho, **não** muda de rota e **não** adiciona item — o único CTA é uma
âncora na mesma página. Nenhum `revalidate`/ISR. Nenhuma segunda guarda no `VitrineClient`.

## Reuso esperado

- `src/components/ui/dialog.tsx` — foco preso, ESC e clique-fora de graça (`design-system.md` §5:
  não recriar modal ad-hoc).
- `PrecoProduto` (`tamanho="lista"`) e `SeloDesconto` (issue 232) — a **mesma** regra de §3.
- `fotoSegura` + o gradiente-placeholder do `CardProduto` para produto sem foto.
- `src/lib/utils/fusoLoja.ts` (issue 222) — o "hoje" da loja.
- `VitrineClient.tsx:20-22` — o comentário do PR #139 é o precedente a não contrariar.

## Segurança

- Nada monetário e nada de permissão: as duas condições de negócio (toggle e existência de
  promoção) são **SSR**; só o "1× por dia" vive no cliente, e é preferência de UX por dispositivo.
  Limpar o `localStorage` só faz o modal reaparecer — sem consequência.
- `localStorage` falhando não pode quebrar a vitrine (RN-18): nenhuma exceção escapa.

## Critério de aceite

- [ ] `decisaoModalPromocoes.test.ts` cobre: toggle desligado ⇒ `false`; sem promoção ⇒ `false`
      **mesmo com o toggle ligado**; já visto hoje ⇒ `false`; `scrollY > 0` ⇒ `false`;
      `ultimaVisualizacao` de ontem ⇒ `true`; storage lançando exceção ⇒ trata como `null` e
      **não propaga**;
- [ ] `grep -rn "setTimeout\|onPointerDown\|onTouchStart\|onMouseDown" src/components/vitrine/ModalPromocoes.tsx`
      **não devolve nada**;
- [ ] `grep -n "setAberto(true)" src/components/vitrine/ModalPromocoes.tsx` devolve **uma** linha,
      dentro do `useEffect` de deps `[]`;
- [ ] `destinoFoco` é prop obrigatória: omiti-la **não compila**;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
