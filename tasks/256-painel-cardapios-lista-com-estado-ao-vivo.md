# [256] `/painel/cardapios`: a lista com estado ao vivo e os dois diálogos

**crítica:** NÃO
**Mundo:** painel
**Depende de:** [255] (`tasks/255-schemacardapio-e-server-actions-de-crud.md`) e [254] (`tasks/254-descrevervigencia-e-proximaabertura.md`)
**Spec:** specs/cardapio-sazonal.md
**Decisões:** D2, D3, D14, D16 · RN-03, RN-11 · design §13.3
**Fatia:** 9 — a metade de tela

## Objetivo

A tela onde o lojista cria, renomeia, liga, desliga e remove cardápio, vendo o estado **ao vivo**
de cada um e, nos dois gestos destrutivos, os **dois números** que dizem o que acontece com cada
metade de D14.

## Escopo

- [ ] rota `/painel/(bloqueavel)/cardapios` (o paywall de assinatura já se aplica por posição)
      + `CardapiosClient` — casca fina sobre `Card`, `Button`, `Switch` e `AlertDialog`;
- [ ] `npx shadcn add alert-dialog` se ele ainda não existir em `components/ui/` — gerado pelo
      CLI, **nunca** editado à mão;
- [ ] estado por cardápio com `BadgeStatus` e os rótulos do design §13.3:
      `Aberto agora` (verde) · `Abre sábado às 11:00` (neutro) · `Expira em 3 dias` (âmbar, a
      partir de 7 dias do fim; abaixo de 24h vira `Expira hoje às 23:59`) · `Expirado` /
      `Desligado` (neutro — vermelho fica fora);
- [ ] sob o badge "Aberto agora", em `text-xs text-texto-muted`, a frase de efeito
      *"aparecendo como seção no topo da sua loja"* (D16: o lojista precisa saber o que o
      cliente está vendo);
- [ ] o estado é **SSR**, recalculado a cada render — nunca `setInterval`, nunca coluna
      "expirado" mantida em dia, nunca job;
- [ ] `aria-label` completo quando o texto é abreviado
      (`aria-label="Expira em 3 dias, em 23/09 às 23:59"`);
- [ ] `AlertDialog` de **desligar** com as duas frases de RN-03: *"N produtos **do menu**
      continuam aparecendo e vendendo normalmente."* + *"M produtos são **exclusivos deste
      cardápio** e vão **sumir da vitrine**."* — **permitido**;
- [ ] `AlertDialog` de **remover** com as mesmas duas frases + a saída a um clique
      **"converter os M para o menu"**, e a recusa aparecendo **no mesmo diálogo**, nunca como
      toast depois do clique;
- [ ] o `Switch` de desligar **não pode** ter ajuda dizendo "os produtos voltam a vender" — é
      falso para o exclusivo (RN-03);
- [ ] alvo de toque `min-h-[44px] min-w-[44px]` **literal**, nunca `min-h-11` nem
      `size="icon-sm"` (`design-system.md` §5, base de fonte 120%).

## Fora de escopo

`contarProdutosEscondidos` e o **aviso** de cardápio expirado/desligado escondendo produtos
(issue 264) — esta issue consome os dois números nos diálogos; o aviso na linha e as duas saídas
a um clique são a fatia 15. O form de vigência e a rota de detalhe (issues 257–259). UI de
arrastar para reordenar cardápios (§Fora do Escopo). Nenhum vermelho no badge de expirado.

## Reuso esperado

- `BadgeStatus` (`components/vitrine/BadgeStatus.tsx`) — o único componente que já cruza os dois
  mundos (`design-system.md` §7) e já existe para dizer estado do sistema com **cor de sistema +
  texto**, nunca cor do tema da loja (§8). **Não** criar um badge novo.
- `Card`, `Button`, `Switch`, `AlertDialog`, `Badge` de `components/ui/` — gerados pelo shadcn
  CLI, não editar à mão.
- `descreverVigencia` (issue 254) para toda frase de janela — nenhuma redação escrita no JSX.
- O padrão de confirmação destrutiva que diz o que será afetado (`design-system.md` §6).

## Segurança

- Todo número mostrado é **preview de UX**, recalculado no servidor a cada render: o cliente não
  o envia e **nenhuma decisão depende dele**.
- A autorização é a RLS da issue 242 mais o `loja_id` da issue 255 — a tela não é a proteção.
- Erro interno não vaza: mensagem genérica na UI, detalhe no log do servidor.

## Critério de aceite

- [ ] os cinco estados do badge aparecem com os rótulos literais do design;
- [ ] o diálogo de desligar mostra **os dois números**, na ordem "o que some antes do que fica";
- [ ] o diálogo de remover mostra a recusa e o botão de conversão no **mesmo** diálogo;
- [ ] `grep -rn "voltam a vender" src/` **não devolve nada**;
- [ ] `grep -rn "min-h-11\|size=\"icon-sm\"" src/app/(painel)/painel/(bloqueavel)/cardapios`
      não devolve nada;
- [ ] `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
