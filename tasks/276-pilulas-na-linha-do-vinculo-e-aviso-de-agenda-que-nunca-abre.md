# [276] Pílulas por produto vinculado no detalhe do cardápio (lojista + admin) e aviso de agenda que nunca abre

**crítica:** NÃO — a escrita e o escopo já são de [274]; aqui é a superfície que a chama
**Mundo:** painel + painel admin
**Depende de:** [274], [275]
**Spec:** specs/vigencia-por-item-do-cardapio.md — §Detalhe do cardápio, §Cardápio no hub admin, RN-06, RN-13

## Origem

Spec §Detalhe do cardápio: é a tela principal da feature. A 269 já entregou o contrato neutro, as
actions admin, as cargas e o `CardapioAdminClient` — esta issue **espelha**, não abre exceção (RN-14).

## Objetivo

Cada produto **já vinculado** ganha, na própria linha, as 7 pílulas; marcar/desmarcar salva na hora
via `definirDiasDoVinculo`; nenhuma marcada = "Todos os dias do cardápio". E a linha avisa quando a
agenda marcada nunca vai abrir.

## Escopo

- [ ] `SeletorProdutosDoCardapio.tsx`: linha do produto vinculado renderiza `PilulasDeDias`; produto
      **não vinculado** não mostra pílulas (agenda é do vínculo)
- [ ] Salvar sem submit, otimista e reversível com o mesmo clique; falha da action volta ao estado anterior
      e mostra a frase genérica da action
- [ ] Rótulo "Todos os dias do cardápio" quando nenhuma pílula está marcada
- [ ] Função **pura** do aviso de RN-06 (interseção vazia entre os dias do item e os dias em que o
      cardápio abre) devolvendo *"Este item nunca aparece: o cardápio só abre aos sábados e domingos."* —
      a frase mora em função pura, não em `.tsx` (sem jsdom, aviso em componente não é travável)
- [ ] O aviso **não bloqueia** o salvamento; é recalculado no servidor a cada render
- [ ] Paridade admin: `CardapioAdminClient`, `carga-cardapio-detalhe.ts` e a rota
      `/admin/assinantes/[lojaId]/cardapios/[cardapioId]` passam os dias do vínculo e chamam a action admin

## Fora de escopo

- A ação "Definir dias" em lote — [277]
- Leitura em `/painel/produtos` e `FormProduto` — [278]
- Mudar `voltaAAbrir` para resolver a interseção vazia (§Fora do Escopo da spec)
- Qualquer regra nova de escrita: a única via continua sendo [274]

## Reuso esperado

- `PilulasDeDias` ([275]) — não recriar as pílulas
- `definirDiasDoVinculo` / `definirDiasDoVinculoAdmin` ([274]) — único caminho de escrita
- `descreverVigencia.ts` (tabelas de dias e `enumerar`) para a frase do aviso
- `cardapio-contrato.ts` para as mensagens; `rotasCardapios.ts` para as rotas
- Layout e WCAG AA vindos do agente `desenhar`

## Segurança

- Nenhuma decisão nasce no cliente: o `loja_id` continua vindo da sessão/URL na action
- Nenhum dado sensível na linha; o aviso é preview de UX e nada depende dele
- Erro da action nunca vaza detalhe do banco para a UI

## Critério de aceite

- [ ] Teste unitário da função pura do aviso: cardápio `{sáb, dom}` + item `{qua}` ⇒ frase de RN-06;
      cardápio com `dias_mes` que faz a interseção não ser vazia ⇒ sem aviso
- [ ] Teste de que o componente chama a action com `{ cardapio_id, produto_id, dias_semana }` e nada mais
- [ ] `npx vitest run src/components/painel/ src/app/admin/assinantes/[lojaId]/carga-cardapio-detalhe.test.ts` verde
- [ ] `npx tsc --noEmit` = 0 · `npm run lint` = 0 · `npm run build` verde
