# Spec: Desconto por produto e pratos promocionais

**Versão:** 0.4.0 | **Atualizado:** 2026-09-20

> **Fatia A de duas.** Esta spec fecha o **preço**: desconto por produto, a apresentação
> "pratos promocionais" na vitrine, o modal de abertura, a regra nova de cupom (base elegível)
> e o snapshot de preço no pedido. A fatia B (`specs/cardapio-sazonal.md`, ainda não escrita)
> fecha o **calendário** — cardápio sazonal, vigência por dia/horário, produto marcado e não
> comprável. **Esta spec é a dona do contrato de catálogo** (§Contrato de catálogo); a B o
> consome e estende pelo ponto de extensão definido lá, sem reabrir nada daqui.
>
> Contrato de negócio de origem: D1, D5, D5-a, D5-b, D6, D7 transcritos em
> `plan/loop-descontos-promocoes-cardapio-sazonal.md` §0, **mais D8 a D15**, decididas
> com o dono do produto em cima das ambiguidades que a v0.1.0 desta spec levantou e transcritas
> aqui em §Contrato de negócio — D8 a D15. **Todas são decisões fechadas** — esta spec as mapeia
> contra o codebase, não as reabre. Sugestões que apareceram no caminho e foram recusadas estão em
> §Fora do Escopo.
>
> **Mudança da v0.1.0 para a v0.2.0:** D9 **reverteu** a base elegível de "por linha" para
> **"por componente"**. Quem leu a v0.1.0 precisa reler RN-09-a, RN-10-c, RN-10-d, RN-10-e e a
> fatia crítica 3.
>
> **Mudança da v0.2.0 para a v0.3.0:** **D12** tira o par "de/por" da comanda da cozinha (vira selo
> sem valor, preservando RN-P1) e **D13** traz para esta fatia a correção de um bug vivo de
> `disponivel` na vitrine. Releia RN-14, RN-14-a, RN-19 e a página "Pedidos do painel". Entram
> também as referências cruzadas a `plan/design-promocoes-e-vigencia.md` (o "como" de UI) e a
> `specs/cardapio-sazonal.md` (os dois pontos de acoplamento).
>
> **Mudança da v0.3.0 para a v0.4.0:** **D15** transforma em requisito o débito que a v0.3.0 tinha
> registrado como "encostado e não consertado" — o total de linha exibido diverge do cobrado quando
> `quantidade > 1` e há opcional. Leia **RN-20** e a **fatia crítica 8**; a seção
> "Débito pré-existente que este trabalho encosta", do §Fora do Escopo, **deixou de existir**.

> **Documentos irmãos, e quem manda em quê.**
>
> | Documento | Papel | Relação com esta spec |
> |---|---|---|
> | `plan/design-promocoes-e-vigencia.md` | o **como** de UI: tokens, anatomia, copy em módulo puro, 9 mecanismos anti-erro (M1–M9) | **consome** esta spec; não é autoridade de regra. Onde ele pediu ampliação de contrato, a decisão está aqui (RN-10-e, RN-12-a, §Fora do Escopo). Onde ele apontou uma lacuna real, esta spec foi corrigida (RN-17 foco, RN-19 `disponivel`) |
> | `specs/cardapio-sazonal.md` (Spec B) | o **calendário**: cardápio, vigência, produto fora da janela | **consome** o contrato de catálogo daqui. Dois pontos de acoplamento acordados: o módulo `lib/utils/fusoLoja.ts` (RN-03) e a assinatura de `projetarProdutoVitrine` (§Contrato de catálogo, nota da regra 2) |
>
> Regra de precedência, para quem for implementar: **em conflito entre esta spec e qualquer um dos
> dois, esta spec vence** — e o conflito vira issue, não interpretação de quem estiver com o arquivo
> aberto.

---

## Visão Geral

Hoje o iRango não tem nenhum conceito de desconto por item: `pedidos.desconto` é desconto de
**cupom, no nível do pedido**, e `produtos.preco` é o único preço que existe. Esta feature dá ao
lojista um mecanismo de promoção por produto — percentual ou valor em reais, com prazo opcional —
e dá ao cliente a leitura imediata disso na vitrine ("de R$ 100,00 por R$ 80,00", selo no card,
modal de abertura listando o que está em promoção).

O problema que resolve: o lojista que quer fazer promoção hoje só tem a opção destrutiva de
**editar o preço do produto**, o que apaga o preço de tabela, não tem prazo, não comunica nada ao
cliente ("por que isso está barato?") e não deixa rastro no histórico de pedidos. Depois da
promoção ele precisa lembrar de voltar o preço na mão.

**Mundos em que vive:**

| Mundo | O que muda |
|---|---|
| Vitrine pública (`/loja/[slug]`, `/loja/[slug]/pedido`, `/loja/[slug]/confirmacao`) | selo e preço riscado no catálogo e na busca, modal de promoções, preview de carrinho/cupom com base elegível **por componente** (D9) |
| Painel do lojista (`/painel/produtos`, `/painel/configuracoes/perfil`, `/painel/pedidos`) | configuração do desconto no produto, toggle do modal, exibição "de/por" na comanda, no detalhe e no recibo |
| Hub admin (`/admin/assinantes/[lojaId]/*`) | paridade obrigatória: o admin edita produto em nome do lojista e não pode ser um caminho mais frouxo (§Segurança) |
| Auth | nada muda |

**O que NÃO é:** "pratos promocionais" **não é entidade nova** (D1). É a apresentação, na vitrine,
dos produtos cujo desconto está ativo **naquele instante**. Não existe tabela de promoção, não
existe curadoria manual da lista, não existe promoção que não seja desconto de produto.

---

## Atores Envolvidos

| Ator | O que faz nesta feature |
|---|---|
| **iRango (SaaS)** | fornece o mecanismo. Não aprova, não modera e não precifica promoção. Não toca dinheiro: o pagamento continua 100% fora da plataforma (`modelo-negocio.md` §3). Garante que o preço cobrado é sempre o do banco e que loja A nunca lê nem escreve desconto da loja B. |
| **Lojista** | liga o desconto de um produto (percentual ou R$), define prazo opcional, desliga quando quiser; liga/desliga o modal de promoções da própria loja; vê no painel, na comanda e no recibo o preço de tabela e o preço pago. |
| **Cliente** | vê selo e preço riscado na vitrine e na busca; vê o modal de promoções no máximo 1× por dia por dispositivo; paga o preço com desconto; recebe no WhatsApp/recibo a linha "de R$ 100,00 por R$ 80,00". Nunca informa preço nenhum. |

---

## Contrato de negócio — D8 a D15 (fechado)

Decididas com o dono do produto a partir das ambiguidades que as versões anteriores desta spec
levantaram (D8–D11 em 2026-09-19; D12, D13 e D15 em 2026-09-20).

> **Não existe D14 nesta spec.** A numeração do contrato é global ao trabalho, e D14 não foi
> atribuída à fatia A — o salto é intencional, não uma decisão perdida. Quem procurar por ela aqui
> não vai achar, e não deve inventá-la. **Mesmo status de D1–D7: contrato fechado.** Nenhum agente deste trabalho tem licença
para reabrir, reinterpretar ou "melhorar" nenhuma delas. Transcritas aqui na íntegra porque o
levantamento original é efêmero e a implementação acontece em outra sessão.

- **D8 — Desconto incide só sobre `produtos.preco`. Opcional nunca é descontado.**
  O adicional entra sempre a preço cheio.
  Pizza R$ 100,00 com 20% + borda recheada R$ 10,00 ⇒ linha = R$ 80,00 + R$ 10,00 = **R$ 90,00**.

- **D9 — A base elegível do cupom é por COMPONENTE, não por linha.**
  Sai da base **só o componente que efetivamente recebeu desconto** — o preço do produto. O
  opcional **nunca** recebeu desconto, então **sempre** entra na base elegível, inclusive quando
  está grudado numa linha cujo produto está em promoção.

  ```
  base_elegivel = Σ_linhas [ (produto tem desconto ativo ? 0 : preco_produto × qtd)
                           + (Σ preco_opcionais × qtd) ]
  ```

  Caso canônico:
  ```
  LINHA 1  pizza 80,00 (de 100, −20%) + borda recheada 10,00  =  90,00
  LINHA 2  refrigerante                                        =  50,00
  subtotal                                                     = 140,00
  base elegível = 0 (pizza em promo) + 10 (borda) + 50 (refri) =  60,00
  gate D5-a: o mínimo confere contra o SUBTOTAL 140,00, não contra a base
  desconto = 10% de 60,00                                      =   6,00
  total                                                        = 134,00 + frete
  ```

  **D9 é generalização compatível de D5, não substituição.** O caso canônico de D5
  (130 / 50 / 5 / 125) permanece **válido e inalterado** sob esta fórmula — ver a verificação
  explícita em RN-10-a.

- **D10 — Preço abaixo do desconto fixo: a gravação é RECUSADA.** A mensagem nomeia os dois
  números e as duas saídas (ajustar o desconto, ou desligá-lo). **O sistema não ajusta dinheiro
  sozinho.**

- **D11 — Expiração entre carrinho e envio.** Preço **sobe** ⇒ **reconfirmação explícita**, com
  de/para e novo total. Preço **cai** ⇒ **só avisa**, o pedido segue.

- **D12 — A comanda da cozinha mostra SELO, nunca valor. RN-P1 não é revertida.** A comanda marca
  que o item é promocional com um selo ao lado do nome, **sem nenhum valor em reais**. O par
  "de R$ 100,00 por R$ 80,00" vai só para o `ReciboCliente`, o detalhe do pedido no painel e o
  WhatsApp. **RN-P1 é preservada na letra** (`ComandaCozinha.tsx:17-22`, "ZERO informação
  financeira"), e os três testes verdes de `ComandaCozinha.test.tsx:135-151` continuam verdes
  **sem nenhuma edição**. Ver RN-14 e RN-14-a.

- **D13 — O bug vivo de `disponivel` na vitrine é corrigido NESTE trabalho.** `SecaoCatalogo` monta
  o objeto do modal sem `disponivel` e `ItemProdutoLista` sequer conhece o campo: produto esgotado
  abre, entra no carrinho e só é recusado no fim, pelo servidor. **Severidade correta: não é brecha
  de dinheiro nem compra indevida — é um beco sem saída de UX.** A correção mora aqui porque esta é
  a fatia que introduz `ProdutoVitrine` nas quatro superfícies (custo marginal ~zero) e porque é o
  **mesmo formato de bug** que o `"fora_da_janela"` do Spec B repetiria. Ver RN-19.

- **D15 — A conta do total de linha é consertada NESTE trabalho.** Quatro superfícies exibem
  `(preco + Σ opcionais) × quantidade`, enquanto o cobrado é
  `(preco × quantidade) + Σ opcionais` (opcional soma **uma vez por linha**, issue 090). Com
  `quantidade > 1` **e** opcional, a linha do recibo **não fecha com o subtotal do próprio recibo**.
  2 pizzas de R$ 50,00 + 1 borda de R$ 10,00: **cobrado R$ 110,00, exibido R$ 120,00**.
  **O valor cobrado sempre esteve correto** — isto é exibição, não cobrança; nenhum cliente foi
  cobrado a mais. A correção é **uma função pura só**, consumida pelas quatro superfícies **e** por
  `calcularSubtotal`, com a invariante `Σ totalDaLinha === calcularSubtotal` travada em teste.
  Ver RN-20.

**Aceitas como esta spec as propôs — fechadas, não reabrir:**

- **Cupom aceito com desconto R$ 0,00 não consome uso.** `usos_contagem` não incrementa e
  `cupom_codigo` fica nulo no pedido (RN-10.3).
- **Desligar o desconto preserva tipo, valor e prazo** — coluna `desconto_ativo` separada (RN-07).
- **Prazo é comparação instante↔instante em `timestamptz`**; o fuso da loja entra só na escrita e
  na exibição (RN-03).

---

## Páginas e Rotas

### Vitrine da loja — `/loja/[slug]`

**Mundo:** vitrine pública (sem auth)

**Descrição:** o catálogo passa a distinguir produto com desconto vigente. O card mostra o preço
de tabela riscado, o preço efetivo em destaque e um selo com a economia. Na primeira visita do
dia, se a loja tiver ao menos um produto em promoção **agora** e o lojista não tiver desligado o
recurso, abre o modal de promoções.

A página **continua sem cache** — `carregarLoja` é `cache()` do React (dedup por request), e o
comentário de `src/app/(publica)/loja/[slug]/page.tsx:30–42` diz explicitamente que a vitrine
carrega dado vivo, **não** é ISR/`revalidate`/`'use cache'`. Desconto com prazo entra nessa mesma
categoria: uma vitrine cacheada entre requests serviria promoção expirada. **Nenhuma proposta de
cache do catálogo faz parte desta spec.** A preocupação legítima de custo do filtro de vigência é
nota para o agente `acelerar` depois do `executar` — não licença para cachear.

**Componentes:**
- `CardProduto` (`components/vitrine/CardProduto.tsx`) — **modificar**: bloco de preço passa de um
  número para o par "riscado + efetivo" + selo. Reuso: `formatarMoeda`, `fotoSegura`,
  `TextoRealcado` — nada novo.
- `ItemProdutoLista` (`components/vitrine/ItemProdutoLista.tsx`) — **modificar**: mesma regra na
  variante textual (categoria com `exibir_imagens = false`) **e correção do D13** — hoje o
  componente nem conhece `disponivel` e a linha é `role="button"` sempre clicável (RN-19).
- `ProdutoModal` (`components/vitrine/ProdutoModal.tsx`) — **modificar**: mesmo par de preços no
  cabeçalho; o total do modal (com opcionais) parte do **preço efetivo**; e **cai o
  `produto.disponivel ?? true` da linha 139** (RN-19) — o default silencioso é o bug.
- `SecaoCatalogo` (`components/vitrine/SecaoCatalogo.tsx`) — **modificar**: o tipo
  `ProdutoCatalogo` é substituído pelo contrato de catálogo (§Contrato de catálogo), e `abrirModal`
  (linhas 89-100) para de montar um objeto parcial à mão — **repassa o `ProdutoVitrine` inteiro**.
  É essa troca que torna o D13 impossível de reintroduzir (RN-19).
- `BuscaProdutos` (`components/vitrine/BuscaProdutos.tsx`) — **verificar, não reescrever**: ela
  filtra a mesma lista de objetos já projetada no servidor. O selo e o preço riscado precisam
  valer **também no resultado de busca**; a única exigência é que `filtrarCatalogo` continue
  repassando o objeto inteiro, sem re-montar um shape reduzido.
- `ModalPromocoes` (`components/vitrine/ModalPromocoes.tsx`) — **criar**. Usa `Dialog` do
  shadcn (`components/ui/dialog`), que já entrega `role="dialog"`, foco preso e ESC
  (`design-system.md` §5: "não recriar modal ad-hoc").
- `SeloDesconto` (`components/vitrine/SeloDesconto.tsx`) — **criar**, pequeno, apresentação pura.
  Segue o princípio de `BadgeStatus` (`design-system.md` §8): **cor de sistema, não cor do tema da
  loja**, e **cor + texto**, nunca cor sozinha. O selo precisa significar a mesma coisa em qualquer
  loja e não pode depender do contraste de um tema custom (`design-system.md` §4, "Contraste do
  tema custom — risco conhecido"). Aparência final é decidida pelo agente `desenhar`
  (`plan/design-promocoes-e-vigencia.md`); esta spec fixa só o contrato e as invariantes.
- `VitrineClient` (`components/vitrine/VitrineClient.tsx`) — **modificar**: passa a montar também
  o `ModalPromocoes`. Não mexer no comportamento do carrinho (ver behavior do modal).

**Behaviors:**
- [ ] **Ver o preço efetivo de um produto em promoção** — o card exibe o preço de tabela riscado e
  o preço com desconto em destaque. Garantido em: **Server Action/SSR** — o preço efetivo é
  calculado no servidor por `precoEfetivo()` a partir de `produtos.preco` + colunas de desconto; o
  cliente recebe o número já pronto e **nunca** recalcula desconto. O que o cliente faz com esse
  número é preview de UX.
- [ ] **Ver o selo de desconto** ("-20%" ou "-R$ 10,00") no card, na linha textual, no modal de
  produto e no resultado de busca. Garantido em: **SSR** (o rótulo vem do mesmo objeto projetado).
- [ ] **Não ver selo nem risco quando o desconto não está vigente** (desligado, ainda não começou,
  já terminou). Garantido em: **SSR** — a vigência é decidida no servidor, no instante do request.
- [ ] **Não conseguir abrir um produto esgotado pela lista textual** (categoria com imagens
  desligadas) — a linha deixa de ser clicável e mostra "Esgotado", como o card já faz. Correção do
  bug vivo de D13. Garantido em: **SSR** (`compravel`) + **`tsc`** (objeto obrigatório impede a
  superfície de ignorar o campo) — ver RN-19.
- [ ] **Ver o modal de produto respeitar "Esgotado"** — o modal para de se achar disponível por
  default. Correção do bug vivo de D13. Garantido em: **SSR** + **`tsc`** (RN-19). A recusa no
  servidor (`pedido.ts:174`) continua sendo a proteção real, inalterada.
- [ ] **Adicionar ao carrinho um produto em promoção** — o carrinho guarda o **preço efetivo** como
  preview. Garantido em: **cliente (UX)** para o número exibido; **Server Action + RPC
  `criar_pedido`** para o valor cobrado.
- [ ] **Ver o modal de promoções na abertura** — abre no máximo 1× por dia por dispositivo, só se
  existir produto com desconto ativo agora e só se o lojista não tiver desligado. Garantido em:
  **SSR** para as duas condições de negócio (toggle da loja e existência de promoção);
  **cliente (UX)** para o "1× por dia" (`localStorage`, por definição não autoritativo — ver
  §Regras de Negócio RN-18).
- [ ] **Fechar o modal** por X, ESC ou clique fora, e **não vê-lo de novo** naquele dia/dispositivo.
  Garantido em: **cliente (UX)**.
- [ ] **Ir do modal para as promoções** — o CTA "Ver promoções" fecha o modal e rola até o
  primeiro produto em promoção. Garantido em: **cliente (UX)**. Não navega para outra rota, não
  adiciona nada ao carrinho, não abre o carrinho.
- [ ] **Continuar navegando normalmente se o `localStorage` falhar** (aba privativa, storage
  bloqueado) — no pior caso o modal reaparece; a vitrine nunca quebra. Garantido em:
  **cliente (UX)**, com `try/catch` (RN-18).

---

### Checkout — `/loja/[slug]/pedido`

**Mundo:** vitrine pública (sem auth)

**Descrição:** o resumo do pedido passa a mostrar quanto o cliente economizou nos itens em
promoção, e o cupom passa a obedecer a regra de não-acumulação (D5). A mudança estrutural aqui é
**o que o cliente envia**: hoje o wizard manda um `subtotal_preview` numérico para a action de
cupom (`EtapaItens.tsx:85` → `validarCupomAction(lojaId, cod, subtotal)`). Com base elegível, um
número vindo do cliente decidiria **qual parcela do carrinho é descontável** — é a definição de
oráculo generoso que `seguranca.md` §10-A proíbe. O cliente passa a mandar só `produto_id`,
`quantidade` e os opcionais escolhidos; o servidor deriva subtotal e base elegível do banco.

**Componentes:**
- `EtapaItens` (`components/vitrine/checkout/EtapaItens.tsx`) — **modificar**: chama
  `revisarCarrinhoAction` em vez de `validarCupomAction`; repassa os três estados de cupom
  (A/B/C de RN-10-e) para o resumo.
- `ResumoValores` (`components/vitrine/checkout/ResumoValores.tsx`) — **modificar**: ganha a linha
  opcional "Você economizou R$ X,XX" (desconto de **produto**) e a **máquina de três estados do
  cupom** de RN-10-e — desconto cheio (sem frase), desconto parcial (frase nomeando o valor sobre
  o qual incidiu, "adicionais incluídos") e desconto zero (sem linha de desconto, só a frase de
  estado). Os três números que a frase cita vêm prontos do servidor; o componente não recalcula
  nada.
- `Carrinho` (`components/vitrine/Carrinho.tsx`) — **modificar**: mesma linha de economia no drawer.
- `useCarrinho` (`hooks/useCarrinho.ts`) — **modificar com cuidado**: o `preco` guardado na linha
  passa a ser o **preço efetivo**. `linhaCarrinhoId` **não muda** — a chave de dedup continua sendo
  `produtoId | opcionais | observação`. Preço não entra na chave e não pode entrar: duas adições do
  mesmo produto antes e depois da promoção expirar são a mesma linha.
- `calcularSubtotal` (`lib/utils/calcularTotal.ts`) — **reusar sem alterar**. Ele já soma
  `preco × qtd + Σ opcionais`; quem muda é o `preco` que entra.

**Behaviors:**
- [ ] **Ver o resumo do carrinho com os preços promocionais** — subtotal já com desconto de produto.
  Garantido em: **cliente (UX)** no que está na tela; **Server Action** no que é cobrado.
- [ ] **Aplicar um cupom** — o servidor responde se o cupom vale e quanto desconta. Garantido em:
  **Server Action** `revisarCarrinhoAction` — o desconto é derivado da base elegível calculada do
  banco, nunca de valor enviado pelo cliente. Mesma função pura do caminho autoritativo (D5-b).
- [ ] **Ver o cupom aceito mas sem desconto** quando não sobrou **nenhum componente** fora da
  promoção — nem produto, nem adicional (D9). Mensagem explicativa, sem linha de
  "Desconto R$ 0,00". Garantido em: **Server Action** (o veredito) + **cliente (UX)** (a redação).
  Ver RN-10 e RN-10-e.
- [ ] **Entender por que o cupom descontou menos que o percentual do total** — o resumo nomeia o
  valor sobre o qual o desconto incidiu e diz que adicionais entram nele (D9). Garantido em:
  **Server Action** (os números e o estado A/B/C) + **cliente (UX)** (a frase). Ver RN-10-e.
- [ ] **Ver o cupom recusado por pedido mínimo** — a régua continua sendo o **subtotal**, não a base
  elegível (D5-a). Garantido em: **Server Action** (`validarUsoCupom` + `calcularDesconto`, os dois
  recebendo o subtotal como gate).
- [ ] **Ver o preço mudar na revisão porque a promoção terminou** — a revisão do carrinho devolve os
  preços do banco naquele instante; se algum mudou, a tela atualiza e avisa qual item mudou e por
  quê, e o cliente precisa confirmar de novo. Garantido em: **Server Action** (RN-12).
- [ ] **Finalizar o pedido** — o pedido nasce com o preço do banco no momento do envio.
  Garantido em: **Server Action + RPC `criar_pedido` + RLS** (`seguranca.md` §10; payload zod `.strict()`
  continua sem nenhum campo monetário).

---

### Confirmação do pedido — `/loja/[slug]/confirmacao`

**Mundo:** vitrine pública (sem auth, leitura por `id` + `token_acesso`)

**Descrição:** a confirmação é a **primeira tela autoritativa** que o cliente vê. Ela exibe os
valores gravados no pedido — incluindo, por item com promoção, o par "de R$ 100,00 por R$ 80,00"
vindo de `itens_pedido.preco_original` / `itens_pedido.preco`.

**Componentes:**
- `confirmacao/page.tsx` — **modificar**: a linha de item ganha o par de/por (RN-14) **e** troca a
  aritmética do total de linha pela função única (linhas 169-173 — RN-20). É uma das quatro
  superfícies do D15.
- `LinhaItemPedido` — **criar** um helper de apresentação compartilhado (§Regras de Negócio RN-14)
  para não espalhar a regra "mostra `de/por` quando `preco_original` não é NULL" por cinco arquivos.

**Behaviors:**
- [ ] **Ver o que foi efetivamente cobrado por item**, com o preço de tabela quando houve promoção.
  Garantido em: **banco** (snapshot imutável gravado pela RPC).
- [ ] **Ver que o total da confirmação pode diferir do preview** quando a promoção expirou entre o
  carrinho e o envio — a tela mostra os valores do pedido, sem pedir desculpa e sem sugerir erro.
  Garantido em: **banco** (RN-12).
- [ ] **Conferir que a soma das linhas bate com o subtotal** — o total de cada linha passa a sair da
  mesma função que produz o subtotal cobrado (D15). Garantido em: **Server Action** (`totalDaLinha`,
  a mesma de `calcularSubtotal`) + **teste de invariante** (RN-20, fatia crítica 8).

---

### Produtos do painel — `/painel/produtos`

**Mundo:** painel (auth obrigatório, sob `(bloqueavel)` — o paywall de assinatura já se aplica)

**Descrição:** o formulário de produto ganha um bloco "Promoção": ligar/desligar, tipo
(percentual ou R$), valor e prazo opcional (início e fim). A lista de produtos mostra quais estão
em promoção agora.

**Componentes:**
- `FormProduto` (`components/painel/FormProduto.tsx`) — **modificar**: bloco de promoção com
  `Switch`, `Select`/`RadioGroup` de tipo, `Input` de valor e dois `datetime-local`. Validação com
  **o mesmo `schemaProduto` estendido** (`lib/validacoes/produto.ts`), react-hook-form + zod, como
  já é o padrão (`design-system.md` §6). Nada de schema paralelo.
- `TabelaProdutos` / `ProdutosClient` — **modificar**: indicador de promoção ativa por linha,
  reusando `SeloDesconto` ou o padrão de badge já existente no painel.
- `Switch`, `Select`, `Input`, `Form`, `AlertDialog` — **reuso** de `components/ui/` (shadcn,
  gerado pelo CLI, não editar).

**Behaviors:**
- [ ] **Ligar uma promoção percentual em um produto** — Garantido em: **Server Action + RLS + CHECK**
  (`produtos_acesso_proprio` escopa por `loja_id`; o CHECK de 0–100 é defesa em profundidade).
- [ ] **Ligar uma promoção de valor fixo em reais** — Garantido em: **Server Action + RLS + CHECK**
  (fixo nunca maior que o preço, RN-05).
- [ ] **Definir um prazo (início e/ou fim) ou deixar sem prazo** — sem prazo = vigente até desligar
  (D1). Garantido em: **Server Action** (conversão do horário local da loja para instante, RN-03) +
  **CHECK** de coerência (`fim > inicio`).
- [ ] **Desligar a promoção sem perder a configuração** — o desconto para de valer imediatamente e
  os valores continuam salvos para a próxima vez. Garantido em: **Server Action + RLS**.
- [ ] **Ver o preview "de R$ 100,00 por R$ 80,00" enquanto digita** — Garantido em:
  **cliente (UX)**. O preview usa a mesma função pura `precoEfetivo()` do servidor (isomórfico,
  como `calcularFrete`), nunca uma segunda fórmula.
- [ ] **Ser impedido de baixar o preço abaixo de um desconto fixo já configurado** — mensagem
  explícita com os dois números e as duas saídas (ajustar o desconto ou desligá-lo). Garantido em:
  **Server Action** (mensagem) + **CHECK** (backstop; ver RN-06 para o racional de não corrigir
  sozinho).
- [ ] **Não conseguir tocar em produto de outra loja**, nem por `id` forjado no payload.
  Garantido em: **RLS** (`produtos_acesso_proprio`) + **Server Action** (`loja_id` derivado de
  `buscarLojaDoDono`, nunca do payload — padrão já usado em `cupom.ts`).

---

### Configurações · Perfil — `/painel/configuracoes/perfil`

**Mundo:** painel (auth obrigatório)

**Descrição:** um toggle "Mostrar modal de promoções na abertura da loja", **ligado por padrão**
(D6). É preferência operacional da loja — mesma família de `whatsapp_envio_automatico`, que já
vive nessa tela.

**Componentes:**
- `page.tsx` de perfil + `montarPayloadPerfil.ts` — **modificar**: mais um campo booleano.
- `Switch` do shadcn — **reuso**.
- `montarPatchPerfil` (`lib/actions/patches-loja.ts`) — **modificar**: mais uma entrada na
  **allowlist explícita**, com o mesmo cuidado já documentado lá (`!== undefined`, nunca
  truthiness — `false` precisa ser gravado, ausente precisa preservar).

**Behaviors:**
- [ ] **Desligar o modal de promoções da própria loja** — Garantido em: **Server Action**
  (allowlist de coluna em `montarPatchPerfil`) + **RLS** (`lojas_update_proprio`).
- [ ] **Não conseguir desligar o modal de outra loja** — Garantido em: **RLS** (o `UPDATE` só
  alcança a linha cujo `dono_id = auth.uid()`).
- [ ] **Ver a loja nova já com o modal ligado** — Garantido em: **banco** (`DEFAULT true`).

---

### Pedidos do painel — `/painel`, `/painel/pedidos`, comanda e recibo

**Mundo:** painel (auth obrigatório)

**Descrição:** onde hoje aparece uma linha de item com um preço, passa a aparecer o par
"de R$ 100,00 por R$ 80,00" **quando e somente quando** `itens_pedido.preco_original` não é NULL —
**exceto na comanda da cozinha**, que recebe só o selo `[PROMO]`, sem valor nenhum (D12, RN-14-a).

**Componentes (todos existentes, todos só modificados):**
- `ComandaCozinha` (`components/painel/ComandaCozinha.tsx:52`) — **selo `[PROMO]` depois do nome do
  item; nenhum valor.** RN-P1 preservada, os três testes de `ComandaCozinha.test.tsx:135-151` ficam
  intactos (RN-14-a).
- `DetalhePedido` (`components/painel/DetalhePedido.tsx:195–217`) — par completo **+ RN-20** (a
  aritmética do total de linha, linhas 202-205 e 216-218).
- `ReciboCliente` (`components/painel/ReciboCliente.tsx:82–95`) — par completo **+ RN-20**
  (linhas 87 e 95). É o documento onde a linha hoje não fecha com o próprio subtotal.
- `whatsappPedido` (`lib/utils/whatsappPedido.ts:74–85`) — par completo **+ RN-20** (linhas 76-80),
  passando a usar `mapearOpcionaisExibicao` em vez de ler `preco_snapshot` na mão.
- `paraLinhaPedido` (`lib/utils/paraLinhaPedido.ts`) — **não muda, e a exclusão é deliberada.** Ele
  projeta `PedidoComItens → PedidoLinha` para a `TabelaPedidos`, cujo shape é
  `{ id, nome_cliente, total, status, criado_em }` — **não tem linha de item**, e D7 pede o par na
  **linha do item**, não um agregado no pedido. O inventário inicial deste trabalho o listava entre
  as superfícies do D7; esta spec o exclui **desde a v0.1.0**, e a exclusão foi confirmada pelo dono
  do produto (a origem da listagem era um engano de inventário, não uma exigência de D7). Ele só
  passaria a mudar se um dia a lista de pedidos ganhar uma coluna de economia — que está em
  §Fora do Escopo. `plan/design-promocoes-e-vigencia.md` §11 chega à mesma conclusão de forma
  independente.

**Behaviors:**
- [ ] **Ver na comanda da cozinha que o item é promocional, sem nenhum valor** — o selo `[PROMO]`
  ao lado do nome. Garantido em: **banco** (`preco_original != null` é o gatilho) + **teste de
  regressão** que afirma o selo **e** a ausência de `R$` no mesmo `it` (D12, RN-14-a).
- [ ] **Ver no detalhe do pedido o par de preços por item** — Garantido em: **banco**.
- [ ] **Imprimir/entregar o recibo com o par de preços** — Garantido em: **banco**.
- [ ] **Enviar a mensagem de WhatsApp com "de R$ 100,00 por R$ 80,00"** — Garantido em: **banco**.
  O texto é montado no servidor a partir do snapshot; nada é recalculado na hora do envio.
- [ ] **Ler um recibo cuja soma das linhas fecha com o subtotal** — 2 pizzas de R$ 50,00 com uma
  borda de R$ 10,00 passam a exibir R$ 110,00, o valor cobrado, e não R$ 120,00 (D15).
  Garantido em: **Server Action** (`totalDaLinha`, a mesma função de `calcularSubtotal`) + **teste de
  invariante** (RN-20, fatia crítica 8).

---

### Paridade do hub admin — `/admin/assinantes/[lojaId]/produtos` e `.../configuracoes/perfil`

**Mundo:** painel admin (auth obrigatório + `verificarAdminSaaS()`, service_role)

**Descrição:** o admin edita produto e perfil **em nome do lojista** via `service_role`, que tem
`BYPASSRLS`. Toda regra nova que existir só no caminho do lojista é uma regra que o caminho admin
não tem. Isso não é "nice to have": `admin-produtos.ts:56,94` já usa `schemaProduto`, então herdar
a extensão é quase automático — mas precisa ser **verificado por teste**, porque a RLS não protege
esse caminho.

**Behaviors:**
- [ ] **Admin configura desconto de um produto da loja-alvo** — Garantido em: **Server Action**
  (`verificarAdminSaaS()` + `validarLojaIdAdmin` + `escopo.*` por `loja_id`, padrão já existente) +
  **CHECK** no banco. A RLS **não** é defesa aqui (service_role bypassa) — o escopo por `loja_id` e
  o schema zod são.
- [ ] **Admin liga/desliga o modal de promoções da loja-alvo** — Garantido em: **Server Action**
  (mesma allowlist `montarPatchPerfil`, compartilhada entre painel e admin).
- [ ] **Admin NÃO ganha uma regra monetária mais generosa** — o caminho admin usa exatamente os
  mesmos `schemaProduto`, `precoEfetivo` e CHECKs. Garantido em: **teste de paridade**
  (`crítica: SIM`, §Fatias críticas).

---

## Contrato de catálogo

**Esta spec é a dona deste contrato. O Spec B o consome e o estende SÓ pelo ponto de extensão
declarado abaixo.** O objetivo desta seção é que o Spec B não precise reabrir o A depois de
mergeado.

### O objeto

É o objeto de produto que o **servidor** devolve para a vitrine. Substitui o
`ProdutoCatalogo` de `components/vitrine/SecaoCatalogo.tsx:19–29` e a projeção inline hoje feita em
`src/app/(publica)/loja/[slug]/page.tsx` (`categoriasComProdutos`). Mora em um módulo neutro —
proposta: `src/lib/utils/catalogoVitrine.ts` — para poder ser importado por Server Component,
Server Action e componente client sem arrastar fronteira.

```ts
/**
 * Contrato de catálogo v1 — dono: specs/desconto-por-produto-e-pratos-promocionais.md
 * Produzido SEMPRE no servidor. Todo número monetário aqui já é autoritativo na
 * origem; o que o cliente faz com ele depois é preview (seguranca.md §10).
 */
export type ProdutoVitrine = {
  // ── identidade e apresentação (o que já existia) ───────────────────────────
  id: string;
  nome: string;
  descricao: string | null;
  foto_url: string | null;
  categoria_id: string | null;

  // ── preço (D1) ─────────────────────────────────────────────────────────────
  /** Preço de tabela — `produtos.preco`. SEMPRE presente. */
  preco: number;
  /** Preço que o cliente paga AGORA. Sem desconto vigente ⇒ === preco. NUNCA < 0. */
  precoEfetivo: number;
  /** true ⟺ existe desconto vigente NESTE instante. `precoEfetivo < preco`. */
  temDesconto: boolean;
  /** Rótulo do selo já pronto ("-20%" | "-R$ 10,00"); null quando !temDesconto. */
  seloDesconto: string | null;
  /** Fim da vigência em ISO-8601, quando há prazo. null = sem prazo. Só exibição. */
  descontoFim: string | null;

  // ── comprabilidade — PONTO DE EXTENSÃO DO SPEC B ───────────────────────────
  /** false ⇒ aparece no catálogo, mas sem botão de compra. */
  compravel: boolean;
  /** Por que não é comprável. null quando compravel === true. */
  motivoNaoCompravel: MotivoNaoCompravel | null;
};

/** v1 tem um membro só. O Spec B ACRESCENTA membros; não remove nem renomeia. */
export type MotivoNaoCompravel = "esgotado";
```

### Como é produzido

```ts
// Função PURA. Único lugar do projeto onde desconto de produto vira preço.
precoEfetivo(produto: ProdutoComDesconto, agora: Date): ResultadoPrecoEfetivo

// Projeção do catálogo. Pura; `agora` injetado (determinismo no teste).
projetarProdutoVitrine(produto: Produto, agora: Date): ProdutoVitrine
```

Três consumidores, **uma** implementação — é isso que dá a garantia de D5-b:

| Consumidor | Caminho | Papel |
|---|---|---|
| SSR da vitrine | `src/app/(publica)/loja/[slug]/page.tsx` → `buscarProdutosPublicos` → `projetarProdutoVitrine` | o que o cliente vê |
| Preview de carrinho/cupom | `revisarCarrinhoAction` → `buscarProdutosPorIds` → `precoEfetivo` | o que o cliente vê antes de enviar |
| Recálculo autoritativo | `criarPedido` → `buscarProdutosPorIds` → `precoEfetivo` | o que o cliente paga |

`buscarProdutosPorIds` (`src/lib/supabase/queries/produtos.ts`, ~linha 158) já é o ponto
autoritativo de recálculo e já declara, no comentário das linhas 153–157, que devolve
"preco/disponivel/loja_id **REAIS**" e que **não filtra** por `disponivel` porque "o recálculo
precisa enxergar o indisponível para recusá-lo". **A mesma decisão vale para desconto**: ela
continua devolvendo `select("*")`, portanto já traz as colunas novas, e **não** deve ganhar filtro
de vigência — o recálculo precisa enxergar o preço cheio **e** a configuração de desconto para
decidir sozinho o que vale agora.

### Regras do contrato (as que o Spec B não pode quebrar)

1. **`preco` e `precoEfetivo` são do Spec A.** O Spec B **não** altera nenhum dos dois, não
   introduz um terceiro preço e não cria desconto próprio de cardápio.
2. **O ponto de extensão é `compravel` + `motivoNaoCompravel`, e só ele.** Em v1,
   `compravel === disponivel` e `motivoNaoCompravel === disponivel ? null : "esgotado"`.
   O Spec B acrescenta o membro `"fora_da_janela"` à union e passa a compor `compravel` com a
   vigência do cardápio (`compravel = disponivel && dentroDaJanela`). Acrescentar membro a uma
   union é aditivo: o `switch` de apresentação ganha um `case`, os callers existentes compilam.

   > **Nota para o `quebrar` — não é conflito entre os specs.** Compor exige o insumo, então na
   > fatia do Spec B a **assinatura** de `projetarProdutoVitrine` ganha dois parâmetros
   > **obrigatórios** (`cardapios: CardapioVigencia[]` e `timezone: string`), ficando
   > `projetarProdutoVitrine(produto, cardapios, agora, timezone)`. **O objeto `ProdutoVitrine` não
   > muda** — muda quem alimenta a projeção. Obrigatórios de propósito, pelo mesmo motivo da regra 5
   > e de RN-19: sem jsdom, parâmetro opcional com default "dentro da janela" produziria em silêncio
   > um catálogo inteiro comprável fora da janela, e nada pegaria. Esta spec implementa a versão de
   > 2 parâmetros (`produto`, `agora`); o B amplia. `specs/cardapio-sazonal.md` já registra a mesma
   > leitura dos dois lados.
   >
   > O Spec B também **respeita** esta regra onde seria tentador furá-la: o rótulo "Só aos sábados e
   > domingos" **não** vira campo novo do objeto — viaja num mapa `produto_id → rótulo` ao lado,
   > como `opcionaisPorCategoria` já faz na mesma cadeia de componentes.
3. **`motivoNaoCompravel` é ordenado por precedência, decidida no servidor.** Se um produto for
   esgotado **e** fora da janela, o servidor escolhe um motivo e manda um só — a UI nunca compõe
   dois motivos. A precedência entre `"esgotado"` e `"fora_da_janela"` é decisão do Spec B.
4. **`oculto = true` continua ganhando de tudo** e nem chega a virar `ProdutoVitrine` — o filtro
   `.eq("oculto", false)` de `buscarProdutosPublicos` + a RLS pública são anteriores à projeção.
5. **Nenhum campo do contrato é opcional por conveniência, e as superfícies recebem o OBJETO, não
   campos avulsos.** Campo ausente vira `undefined` em componente client e produz "R$ NaN"
   silencioso — ou pior. **Isto não é hipótese: é o bug vivo de D13** (`SecaoCatalogo.tsx:89-100`
   monta o objeto do modal sem `disponivel`, `ProdutoModal.tsx:139` faz `?? true`, e o modal se acha
   disponível). Todos obrigatórios; nulabilidade explícita; sem default silencioso. Sem jsdom no
   repo, o `tsc` é a única trava possível (RN-19).
6. **O contrato é produzido uma vez, no servidor, por request.** Componente client **nunca**
   recalcula desconto nem vigência a partir das colunas cruas — as colunas cruas de desconto
   (`desconto_tipo`, `desconto_valor`, `desconto_inicio`, `desconto_fim`, `desconto_ativo`) **não
   trafegam** para o cliente na vitrine. Mesmo princípio da issue 201 sobre `foto_url` em categoria
   com imagens desligadas: o que a UI não precisa, o payload RSC não carrega.

---

## Modelos de Dados

Referência: `references/schema.md`. Tudo abaixo é **campo novo → migration nova**. Nenhuma tabela
nova é criada nesta fatia (o que significa que **nenhuma política RLS nova é necessária** — as
colunas entram em tabelas que já têm política; ver §Segurança).

### `produtos` — colunas novas (migration 1)

```sql
alter table public.produtos
  add column desconto_ativo  boolean     not null default false,
  add column desconto_tipo   text,
  add column desconto_valor  numeric(10,2),
  add column desconto_inicio timestamptz,
  add column desconto_fim    timestamptz;

-- Enum inline, convenção do projeto (schema.md §5: CHECK, não CREATE TYPE).
alter table public.produtos add constraint produtos_desconto_tipo_check
  check (desconto_tipo is null or desconto_tipo in ('percentual','fixo'));

-- Coerência: promoção ligada exige tipo e valor.
alter table public.produtos add constraint produtos_desconto_coerente_check
  check (desconto_ativo = false or (desconto_tipo is not null and desconto_valor is not null));

-- Percentual dentro de 0–100 (exigência 4 do contrato).
alter table public.produtos add constraint produtos_desconto_percentual_check
  check (desconto_tipo is distinct from 'percentual'
         or (desconto_valor > 0 and desconto_valor <= 100));

-- Valor fixo nunca maior que o preço (exigência 4). Cross-column: legal no Postgres.
alter table public.produtos add constraint produtos_desconto_fixo_check
  check (desconto_tipo is distinct from 'fixo' or desconto_valor <= preco);

-- Prazo coerente quando os dois lados existem.
alter table public.produtos add constraint produtos_desconto_prazo_check
  check (desconto_inicio is null or desconto_fim is null or desconto_fim > desconto_inicio);
```

`desconto_valor` sem CHECK de positividade próprio porque os dois CHECKs por tipo já o cobrem
(`> 0` no percentual, `<= preco` combinado com a validação zod `> 0` no fixo). Se o `migrar` achar
mais limpo um `desconto_valor > 0` separado, é equivalente — decisão de implementação, não de spec.

**Nota de migration:** a tabela tem dados em produção. Os CHECKs são satisfeitos trivialmente pelas
linhas existentes (todas nascem `desconto_ativo = false` e com os quatro campos NULL), então
`add constraint` direto é seguro. Ainda assim, se o `migrar` preferir `not valid` + `validate
constraint` em passo separado, é compatível com esta spec.

**Índice (opcional, decisão do `acelerar`):**
```sql
create index on public.produtos (loja_id) where desconto_ativo;
```
Parcial e pequeno. **Não é necessário para a vitrine** — a existência de promoção ativa é derivada
do catálogo que a página **já** carregou (RN-11), sem segunda query. Serve só a filtros do painel.

### `lojas` — coluna nova (migration 2)

```sql
alter table public.lojas
  add column modal_promocoes boolean not null default true;   -- D6: default LIGADO
```

**Classificação de segurança:** `modal_promocoes` **não é billing e não é PII**. É preferência
operacional, mesma família de `lojas.whatsapp_envio_automatico`. Portanto:
- **fica FORA** de `CAMPOS_LOJA_SOMENTE_SERVIDOR` e **fora** da lista de 14 colunas protegidas por
  `lojas_protege_billing()` (`seguranca.md` §2);
- é gravável pelo lojista via `lojas_update_proprio` e pelo admin via `escopo.atualizarLoja`;
- entra na allowlist explícita de `montarPatchPerfil` (`lib/actions/patches-loja.ts`) — **allowlist,
  nunca spread do payload** (regra de allowlist do `patches-loja.ts`, `seguranca.md` §2).

### `public.vitrine_lojas` — recriação da view (migration 3)

A vitrine lê a loja **exclusivamente** pela view `vitrine_lojas` (`seguranca.md` §19, exceção
aprovada) — nunca `public.lojas`. Para o SSR saber se o modal está ligado, a coluna precisa entrar
na projeção pública.

```sql
drop view if exists public.vitrine_lojas;
create view public.vitrine_lojas with (security_invoker = false) as
  select id, slug, nome, telefone, whatsapp, ativo,
         endereco_rua, endereco_numero, endereco_bairro, endereco_cidade,
         endereco_estado, endereco_cep, tema, horarios, timezone,
         assinatura_status, assinatura_fim_periodo,
         logo_url, taxa_entrega_fora_zona,
         modal_promocoes                      -- <- nova
    from public.lojas
   where ativo = true;
grant select on public.vitrine_lojas to anon, authenticated;
```

> ⚠️ **Três armadilhas conhecidas, todas já documentadas no projeto — em ordem de risco real:**
> 1. 🔴 **A lista de colunas.** Ela precisa ser conferida contra a definição **vigente** no momento
>    da implementação: `logo_url` e `taxa_entrega_fora_zona` entraram em migrations posteriores à
>    `20260614005000_vitrine_lojas_assinatura.sql`, e o `drop` + `create` reescreve a view inteira.
>    **Recriar a view com uma coluna a menos quebra a vitrine em silêncio** — sem erro de migration,
>    sem falha de CI, e o `tsc` não pega porque `LojaPublica` é `Tables<"vitrine_lojas">`, gerado
>    *depois*. **Este é o risco principal desta migration.**
> 2. 🔴 **O `grant select` some junto.** `drop` + `create` recria os privilégios do zero, então
>    `grant select on public.vitrine_lojas to anon, authenticated` **tem de ser re-aplicado na mesma
>    migration** — sem ele, a vitrine pública para de carregar para todo mundo.
> 3. 🟡 **Escrita pela view definer auto-atualizável.** `seguranca.md` §19 e a migration
>    `20260702140000_vitrine_lojas_revoke_escrita.sql` tratam do vetor de `anon` ganhar
>    INSERT/UPDATE/DELETE **na tabela `lojas`** por rebote na view. **Ressalva importante, para a
>    spec não superestimar o risco:** o §2 daquela mesma migration já rodou
>    `alter default privileges in schema public revoke insert, update, delete on tables from anon,
>    authenticated`, então uma view nova criada pelo `postgres` **não** reganha escrita
>    automaticamente. O revoke explícito continua valendo como cinto-e-suspensório, e **o teste de
>    `anon` tentando `UPDATE` na view fica** — como defesa em profundidade, não como remendo de um
>    buraco aberto.
>
> `create or replace view` **não** permite mudar a lista de colunas: é `drop` + `create`
> obrigatoriamente, como a migration `20260614005000` já teve de fazer. As três armadilhas acima
> são consequência disso, não escolhas.

**Avaliação de exposição:** `modal_promocoes` revela apenas uma preferência de UI da loja. Não é
PII, não é billing, não revela nada sobre o dono, o plano ou o cliente. Risco de tenant: nenhum.

### `itens_pedido` — coluna nova (migration 4)

```sql
alter table public.itens_pedido
  add column preco_original numeric(10,2);   -- D7: NULL quando não houve desconto

alter table public.itens_pedido add constraint itens_pedido_preco_original_check
  check (preco_original is null or preco_original >= preco);
```

Mesma família de snapshot imutável de `nome`, `preco` e `observacao` (`schema.md` §6). O CHECK
`>= preco` impede o snapshot sem sentido ("de R$ 80 por R$ 100"): promoção nunca sobe preço.

### `public.criar_pedido` — nova versão (migration 5)

**Aditiva e sem overload novo.** `preco_original` viaja **dentro do jsonb `p_itens`**, que já
carrega `nome`, `preco`, `quantidade`, `observacao` e `opcionais`. A assinatura de 17 argumentos
(`20260913121000_rpc_criar_pedido_frete_a_combinar.sql`) **não muda** — só o `insert into
public.itens_pedido` do laço ganha a coluna:

```sql
insert into public.itens_pedido
  (pedido_id, produto_id, nome, preco, quantidade, observacao, preco_original)
values (
  v_pedido_id,
  (v_item->>'produto_id')::uuid,
  v_item->>'nome',
  (v_item->>'preco')::numeric,
  (v_item->>'quantidade')::int,
  left(nullif(trim(v_item->>'observacao'), ''), 200),
  (v_item->>'preco_original')::numeric   -- chave ausente ⇒ NULL, que é o default correto
);
```

Por que isso importa: durante a janela de deploy da Vercel, lambdas **antigas** continuam chamando
a mesma assinatura com um jsonb **sem** `preco_original`. `->>` em chave ausente devolve NULL, que
é exatamente "não houve desconto". Nenhum pedido quebra, nenhum overload novo, nenhum
`function is not unique`. A assinatura legada de 16 args continua intocada, como a própria
migration 20260913121000 decidiu.

**O que a RPC NÃO ganha:** nenhuma regra de desconto. `preco` e `preco_original` chegam já
decididos pela Server Action a partir do banco — a RPC é transacional, não é o oráculo de preço.
Isso preserva o desenho atual (`seguranca.md` §10, "RPC transacional").

---

## Regras de Negócio

> Legenda da coluna "camada": **cliente (preview)** = estética, nunca autoritativo ·
> **Server Action** = recalculado do banco · **RPC** = dentro da transação de pedido ·
> **RLS** = isolamento por linha · **CHECK** = defesa em profundidade no banco ·
> **zod** = validação isomórfica (mesmo schema no form e na action).

### Preço

**RN-01 — Existe um único mecanismo de desconto (D1).** Desconto é por **produto**, percentual ou
valor em reais, com prazo opcional. Não existe desconto por categoria, por cardápio, por cliente,
nem "promoção" como entidade separada.
→ Camada: **schema** (não há onde modelar outro).

**RN-02 — Preço efetivo.**
`percentual` → `arredondar2(preco − preco × valor / 100)`.
`fixo` → `arredondar2(preco − valor)`.
Sempre com piso: `Math.max(0, …)`. **Desconto nunca produz preço negativo**, mesmo que uma linha
inconsistente escape de todos os CHECKs.
→ Camada: **Server Action** (`precoEfetivo()`, pura, usada também como preview isomórfico).

**RN-03 — Vigência.** O desconto está vigente quando, **e só quando**:
`desconto_ativo = true` **e** (`desconto_inicio is null` ou `desconto_inicio <= agora`) **e**
(`desconto_fim is null` ou `agora < desconto_fim`). Fim **exclusivo**, início **inclusivo** — a
mesma convenção de `lojaAberta` (`minutos >= abre && minutos < fecha`) e de `validarUsoCupom`
(`expira_em <= agora` esgota).

> **Sobre o fuso da loja** (fechado — §Contrato de negócio, "Aceitas como esta spec as propôs").
> `desconto_inicio`/`desconto_fim` são `timestamptz` — **instantes
> absolutos** (`schema.md` §6: todo campo de data é `timestamptz`, nunca `timestamp`). Comparar
> instante com instante não precisa de fuso, e introduzir aritmética de fuso nessa comparação seria
> criar um bug. O fuso da loja (`lojas.timezone`) entra em **exatamente dois lugares**, ambos de
> borda:
> 1. **Escrita** — o lojista digita "31/12 às 23:59" num `datetime-local`; a Server Action converte
>    esse horário local **no fuso da loja** para o instante gravado.
> 2. **Exibição** — "válido até 31/12, 23:59" é renderizado no fuso da loja.
>
> Os dois usam `Intl`, e **não** se escreve aritmética de fuso nova: `lojaAberta.ts` já resolve
> instante → partes no fuso da loja em `partesNoFuso`, hoje privada ao módulo. A implementação
> **extrai** esse helper para **`src/lib/utils/fusoLoja.ts`** e faz `lojaAberta` importá-lo —
> extensão, nunca uma segunda cópia (mandato 2). Extrair sem mudar comportamento é `safe-refactor`:
> a suíte existente de `lojaAberta` tem de passar **sem edição**.
>
> **Escopo exato da extração, acordado com o Spec B** (`specs/cardapio-sazonal.md`, §"As duas
> mudanças de assinatura"): saem **`partesNoFuso` e `paraMinutos`** — o segundo (`"HH:MM"` →
> minutos, hoje privado no mesmo arquivo) sai junto porque, se ficar, o Spec B escreve um segundo
> parser de hora para a faixa de horário do cardápio. O nome do módulo **não é mais proposta, é
> acordo**: os dois specs mandam criar `lib/utils/fusoLoja.ts`, e nomes diferentes produziriam dois
> módulos de aritmética de fuso — exatamente o que o mandato 2 proíbe.
> Na fatia do Spec B, `partesNoFuso` ganha **`diaDoMes`** no retorno, de forma **aditiva**
> (`lojaAberta` segue lendo só `diaIndex` e `minutos`). Isso é trabalho do B; esta spec só precisa
> **não impedir** — daí a extração nascer como módulo próprio, e não como export solto.

→ Camada: **Server Action** (a decisão) + **cliente (preview)** (o texto "válido até").

**RN-04 — Percentual fora de 0–100 é rejeitado.**
→ Camada: **zod** (`schemaProduto`, primeira barreira, exatamente como `cupomSchema` já faz "1..100"
para cupom percentual) + **CHECK** (`produtos_desconto_percentual_check`, defesa em profundidade) +
**clamp** em `precoEfetivo` (terceira camada: mesmo uma linha impossível não produz preço negativo).

**RN-05 — Valor fixo maior que o preço é rejeitado.**
→ Camada: **zod** (`superRefine` cross-field em `schemaProduto`) + **CHECK**
(`produtos_desconto_fixo_check`) + **clamp** em `precoEfetivo`.

**RN-06 — Baixar o preço abaixo de um desconto fixo já configurado (D10).** O lojista tem Feijoada
a R$ 100,00 com desconto fixo de R$ 30,00 e resolve baixar o preço para R$ 25,00.
**D10: a gravação é RECUSADA, com mensagem que nomeia os dois números e oferece as duas saídas
("reduza o desconto para no máximo R$ 25,00" / "desligue a promoção"). O sistema NÃO corrige
sozinho.**
Racional: as duas alternativas são piores. Reduzir o desconto automaticamente muda, sem o lojista
pedir, **quanto os clientes pagam** — é mudança de dinheiro silenciosa, o oposto do mandato 1.
Desligar a promoção automaticamente esconde da vitrine um produto que o lojista acredita estar em
promoção. Recusar é a única saída em que a decisão monetária continua sendo do lojista.
Sem o CHECK, o caminho PostgREST direto gravaria o par incoerente; com ele, vira `23514`. A Server
Action **verifica antes** e devolve a mensagem legível — o `23514` é o backstop, e é mapeado para
mensagem genérica ao cliente com detalhe no log (`seguranca.md` §14), nunca para o texto cru do
Postgres.
→ Camada: **Server Action** (mensagem) + **CHECK** (backstop).

**RN-07 — Desligar preserva a configuração** (fechado — §Contrato de negócio, "Aceitas como esta
spec as propôs"). `desconto_ativo = false` mantém tipo, valor e prazo gravados. Desligar não é apagar. Ligar de novo restaura a mesma promoção.
→ Camada: **Server Action** + **CHECK** de coerência (que só exige tipo/valor quando ligado).

**RN-08 — Desconto incide só sobre `produtos.preco`, nunca sobre opcionais (D8).** Pizza
R$ 100,00 com 20% + borda recheada R$ 10,00 ⇒ linha = R$ 80,00 + R$ 10,00 = **R$ 90,00**. O
opcional entra a preço cheio.
Racional: o desconto é configurado no campo de preço do produto; aplicá-lo ao acréscimo daria
desconto em itens que o lojista nunca marcou (`opcionais.preco` é autoridade própria, RN-O1/O2).

**D8 e D9 são o mesmo princípio, lido nas duas pontas:** o opcional **não recebe** desconto de
produto (D8), **logo** ele continua descontável pelo cupom (D9). Uma regra que descontasse o
opcional e ainda o mantivesse na base elegível daria desconto duas vezes sobre o mesmo dinheiro;
uma que não o descontasse e ainda o tirasse da base o penalizaria duas vezes. O par D8+D9 é o
único arranjo em que cada real do pedido recebe desconto exatamente uma vez.
→ Camada: **Server Action** (`precoEfetivo` recebe o produto, não a linha) + **cliente (preview)**.

### Cupom (a mudança monetária)

**RN-09 — Cupom não acumula com desconto de produto (D5 + D5-a + D9).** `calcularDesconto` passa
a trabalhar com **dois números**, hoje o mesmo:

| Número | O que é | Quem o usa |
|---|---|---|
| `subtotal` | soma de tudo, **já com desconto de produto** (produtos + opcionais) | **só** o gate de `pedido_minimo` |
| `baseElegivel` | soma **apenas dos componentes que não receberam desconto**: o preço dos produtos **sem** desconto ativo **mais todos os opcionais**, inclusive os de linha promocional (D9) | o cálculo do desconto **e** o clamp |

Assinatura nova, deliberadamente **por objeto nomeado**, não posicional:

```ts
calcularDesconto(cupom: CupomCalculo, bases: { subtotal: number; baseElegivel: number })
```

Racional da forma: `(cupom, subtotal, baseElegivel)` são dois `number` adjacentes — trocá-los de
ordem compila, passa no `tsc` e produz desconto errado em produção. A chave nomeada obriga o caller
a declarar qual número é qual. Este é **o ponto de maior blast radius do trabalho inteiro**: a
função é pura, tem teste próprio e três importadores de produção.

Corpo (o que muda em relação a `src/lib/utils/calcularDesconto.ts:28–46`):
- linha 32, gate: `if (subtotal < cupom.pedido_minimo)` → **permanece olhando o `subtotal`** (D5-a);
- linhas 36–41, cálculo: `percentual` passa a incidir sobre **`baseElegivel`**;
- linha 43, clamp: `Math.min(Math.max(bruto, 0), baseElegivel)` — o teto passa a ser a base
  elegível, não o subtotal. Sem isso, um cupom fixo de R$ 50,00 descontaria R$ 50,00 de uma base
  elegível de R$ 20,00;
- o resultado ganha `baseElegivel: number`, para que o caller consiga explicar um desconto zero sem
  refazer a conta (RN-10).

`aplicado` continua significando **"passou no gate de pedido mínimo"** — não "descontou dinheiro".
Não sobrecarregar esse booleano é o que mantém `validarUsoCupom` (que também recebe o subtotal
como régua de mínimo) coerente com `calcularDesconto` sem duplicar regra.

→ Camada: **Server Action** (autoritativo, `criarPedido`) **e** **Server Action** (preview,
`revisarCarrinhoAction`) — **a mesma função pura nos dois**, que é literalmente o mecanismo que
implementa D5-b.

**RN-09-a — A base elegível é por COMPONENTE, e é derivada uma vez, por uma função só (D9).**

A unidade da base elegível **não é a linha do carrinho — é o componente**. Sai da base só o
componente que efetivamente recebeu desconto: o **preço do produto**. O opcional nunca recebeu
desconto (D8), então **sempre** entra na base, inclusive quando está numa linha cujo produto está
em promoção.

```ts
/** Componentes de UMA linha do carrinho, já resolvidos a partir do BANCO. */
export type ComponentesLinha = {
  /** Preço EFETIVO do produto, por unidade (já com desconto de produto aplicado). */
  precoProduto: number;
  /** Quantidade do PRODUTO nesta linha. */
  quantidade: number;
  /** true ⟺ o preço do produto recebeu desconto (=== ProdutoVitrine.temDesconto). */
  produtoTemDesconto: boolean;
  /** Opcionais desta linha. `quantidade` aqui é a DO OPCIONAL — ver a armadilha abaixo. */
  opcionais: { preco: number; quantidade: number }[];
};

derivarBasesCupom(linhas: ComponentesLinha[]): { subtotal: number; baseElegivel: number }
```

```
baseElegivel = Σ_linhas [ (produtoTemDesconto ? 0 : arred2(precoProduto × quantidade))
                        + Σ_opcionais arred2(opcional.preco × opcional.quantidade) ]
```

**`subtotal` não é recalculado aqui:** `derivarBasesCupom` **reusa `calcularSubtotal`**
(`lib/utils/calcularTotal.ts`) para o subtotal e só calcula a base elegível por conta própria. Se
as duas somas divergirem em um centavo de arredondamento, o gate de `pedido_minimo` passa a olhar
um número que não é o que o pedido grava — e isso não aparece em teste de caso feliz. Uma soma, uma
implementação (mandato 2).

> ⚠️ **Armadilha do `× qtd` — vale dinheiro.** O `qtd` que multiplica o opcional é a **quantidade
> do opcional**, não a do produto. `calcularTotal.ts` documenta a regra do projeto (issue 090):
> *"Opcionais são POR LINHA do item: somam UMA vez, sem multiplicar pela quantidade do produto"*.
> Multiplicar o opcional pela quantidade do produto **infla a base elegível** ⇒ desconto maior que
> o devido ⇒ prejuízo do lojista. O RED da fatia crítica 3 cobre uma linha com `quantidade > 1`
> exatamente por isso (RN-10-d, variação B).

Toda `ComponentesLinha` é montada **sempre** a partir de `buscarProdutosPorIds` + `precoEfetivo` +
`buscarOpcionaisPorIds`. Nenhum campo dela vem do cliente: do cliente vêm apenas `produto_id`,
`quantidade`, `opcional_id` e a quantidade do opcional.
→ Camada: **Server Action**. Nunca no cliente, nunca a partir de número enviado pelo cliente.

**RN-10 — Cupom válido cujo desconto dá R$ 0,00 (caso puro de D5).** Carrinho com um único produto
de R$ 100,00 a 20%, **sem nenhum adicional**, + cupom de 10% ⇒ base elegível R$ 0,00 ⇒ desconto
R$ 0,00 ⇒ total R$ 80,00.

> Sob D9 o caso zero ficou **mais raro e mais estreito**: basta um adicional de R$ 5,00 numa linha
> promocional para a base virar R$ 5,00 e o desconto virar R$ 0,50. "Zero" agora significa
> literalmente **não existe nenhum componente fora da promoção no carrinho** — nem produto, nem
> adicional. A UI precisa dizer isso com precisão, e não "todos os itens estão em promoção".

**Decisões, e o porquê de cada uma:**

1. **O cupom é ACEITO, não recusado.** D5-a é explícito: a régua do pedido mínimo é o subtotal, e o
   subtotal passa. Recusar seria inventar um critério que o contrato não tem. Também seria instável:
   bastaria o cliente adicionar um refrigerante para o mesmo cupom passar a valer — o veredito não
   pode oscilar por uma razão que a tela não explica.
2. **A UI NÃO mostra uma linha "Desconto R$ 0,00".** Uma linha de R$ 0,00 no resumo lê como bug e
   convida a chamada de suporte "o cupom não funcionou". No lugar dela, o resumo mostra o cupom
   aplicado com uma frase de estado: *"Cupom PROMO10 aplicado. Sem desconto neste pedido: não há
   nada fora da promoção para descontar — cupom não acumula com promoção."* Estado + motivo, não
   um zero mudo. A redação **não** diz "todos os itens estão em promoção": sob D9 isso seria falso
   sempre que houvesse um adicional (que entraria na base e geraria desconto). Ver RN-10-e.
3. **O cupom NÃO é consumido.** Quando o desconto autoritativo é `0`, `criarPedido` chama a RPC com
   `p_cupom_id = null` e `p_cupom_codigo = null` — nenhum incremento em `usos_contagem`, nenhum
   `cupom_codigo` gravado no pedido.
   Racional: `usos_contagem` é um recurso escasso do lojista (`usos_maximos`). Queimar um uso de um
   cupom limitado em troca de R$ 0,00 prejudica o cliente e o lojista, e grava no pedido um cupom
   que não deu desconto nenhum — um registro que não sobrevive a uma conferência. É a mesma família
   da decisão já tomada na RPC ("cupom esgotado na corrida ⇒ anula desconto e recompõe o total, não
   rejeita o pedido"): quando não há valor, não se mexe no contador.
   > Fechado: o dono do produto aceitou esta decisão como proposta (ver §Contrato de negócio —
   > D8 a D15, "Aceitas como esta spec as propôs").
→ Camada: **Server Action** (o veredito e o não-consumo) + **cliente (preview)** (a redação).

**RN-10-a — Cenário numérico obrigatório (carrinho misto, D5 + D5-a).** Este é o caso de aceite
literal; o teste RED usa estes números.

| Linha | Preço de tabela | Desconto | Preço efetivo | Qtd | Total da linha |
|---|---|---|---|---|---|
| Feijoada | R$ 100,00 | 20% | **R$ 80,00** | 1 | R$ 80,00 |
| Refrigerante | R$ 50,00 | — | R$ 50,00 | 1 | R$ 50,00 |

```
subtotal          = 80,00 + 50,00                  = R$ 130,00   (preços já com desconto)
base elegível     = 50,00                          = R$  50,00   (só as linhas sem desconto ativo)
cupom PROMO10     = percentual 10%, pedido_minimo R$ 100,00
gate (D5-a)       : 130,00 >= 100,00               → CUPOM ACEITO
desconto (D5)     = 10% de 50,00                   = R$   5,00
total             = 130,00 − 5,00                  = R$ 125,00   + frete
```

Repare no que **não** acontece: o desconto **não** é 10% de R$ 130,00 (R$ 13,00), e o cupom **não**
é recusado por R$ 50,00 < R$ 100,00. Os dois números vivem em papéis separados, e são exatamente os
dois erros que a assinatura nomeada de RN-09 existe para impedir.

> ✅ **Verificação obrigatória: este caso sobrevive INTACTO a D9.** Aplicando a fórmula por
> componente a este mesmo carrinho:
> `base = (feijoada tem desconto ⇒ 0) + (sem adicionais ⇒ 0) + (refri sem desconto ⇒ 50,00) +
> (sem adicionais ⇒ 0) = R$ 50,00`. Idêntico ao valor de D5. O carrinho de D5 **não tem nenhum
> opcional**, e é exatamente por isso que as duas leituras coincidem: a diferença entre "por linha"
> e "por componente" só aparece quando existe opcional grudado numa linha promocional.
> **D9 é generalização compatível de D5, não substituição** — não há nenhuma leitura em que os dois
> casos se contradigam, e os dois entram juntos no mesmo RED (fatia crítica 3).

**RN-10-b — Cenário do clamp.** Mesmo carrinho, cupom `fixo` de R$ 80,00 e `pedido_minimo` R$ 0,00:
gate passa (130 ≥ 0); bruto = R$ 80,00; clamp pela base elegível ⇒ desconto = **R$ 50,00**;
total = R$ 80,00 + frete. Com o clamp antigo (teto no subtotal) o desconto seria R$ 80,00 e o
total R$ 50,00 — **R$ 30,00 de prejuízo do lojista por pedido**. É o caso que prova que o clamp
mudou de número, não só o cálculo.

**RN-10-c — Cenário do caso puro.** Carrinho só com a Feijoada de R$ 100,00 a 20%, **sem nenhum
adicional**, + cupom de 10%: subtotal R$ 80,00; base elegível R$ 0,00; gate passa (se o mínimo for
≤ 80); desconto R$ 0,00; total **R$ 80,00**; cupom aceito, não consumido, e a UI explica (RN-10).
A cláusula "sem nenhum adicional" passou a ser **parte do enunciado** com D9: com uma borda de
R$ 10,00 nessa mesma linha, a base seria R$ 10,00 e o desconto R$ 1,00 — o caso deixaria de ser o
caso puro.

**RN-10-d — Cenário canônico de D9 (base por componente).** Segundo caso de aceite literal; o RED
da fatia crítica 3 prova **este e o de RN-10-a**, não um dos dois.

| Linha | Componentes | Total da linha |
|---|---|---|
| 1 | pizza R$ 80,00 (de R$ 100,00, −20%) + borda recheada R$ 10,00 | R$ 90,00 |
| 2 | refrigerante R$ 50,00, sem desconto, sem adicional | R$ 50,00 |

```
subtotal          = 90,00 + 50,00                              = R$ 140,00
base elegível     = 0 (pizza em promoção)
                  + 10,00 (borda — NUNCA recebeu desconto, D8)
                  + 50,00 (refrigerante)                       = R$  60,00
cupom PROMO10     = percentual 10%
gate (D5-a)       : o mínimo confere contra o SUBTOTAL 140,00, não contra a base
desconto (D9)     = 10% de 60,00                               = R$   6,00
total             = 140,00 − 6,00                              = R$ 134,00   + frete
```

Os dois erros que este caso existe para pegar: descontar **R$ 14,00** (10% de 140,00 — ignorou a
promoção) e descontar **R$ 5,00** (10% de 50,00 — tirou a borda da base junto com a pizza, que é
exatamente a regra "por linha" que D9 reverteu).

**Variação B — a armadilha do `× qtd`.** Mesma linha 1, mas com **2 pizzas** e 1 borda:
`subtotal da linha = 80,00 × 2 + 10,00 = R$ 170,00`; `base elegível da linha = 0 + 10,00 =
R$ 10,00` — e **não** R$ 20,00. O opcional soma uma vez por linha, não uma por unidade do produto
(RN-09-a). Uma base de R$ 20,00 aqui viraria o dobro de desconto sobre a borda.

**RN-10-e — Como a UI explica um desconto que não é "o percentual do total" (D9).** Esta é a
mensagem mais difícil da feature: o cliente vê um cupom de 10% num pedido de R$ 140,00 e recebe
R$ 6,00, não R$ 14,00. Sem explicação, isso lê como erro de cálculo — e vira chamada de suporte
para o lojista, que não tem como responder.

**Três estados, três redações. A que a implementação deve usar, literal:**

| Estado | Condição (decidida no **servidor**) | O que o resumo mostra |
|---|---|---|
| **A — desconto cheio** | `baseElegivel === subtotal` (nada em promoção) | `Cupom PROMO10 · −R$ 14,00` — **sem** frase extra. Nada a explicar. |
| **B — desconto parcial** | `0 < baseElegivel < subtotal` | `Cupom PROMO10 · −R$ 6,00` + linha secundária: *"Não acumula com promoção: o desconto valeu sobre R$ 60,00 do pedido — o que não está em promoção, **adicionais incluídos**."* |
| **C — desconto zero** | `baseElegivel === 0` | **sem** linha de desconto + frase de estado: *"Cupom PROMO10 aplicado. Sem desconto neste pedido: não há nada fora da promoção para descontar — cupom não acumula com promoção."* (RN-10) |

Por que esta redação, e não outra:

- **Diz o número, não a regra.** "O desconto valeu sobre **R$ 60,00**" é verificável: o cliente
  soma o que não tem selo de promoção e confere. "O desconto incide sobre a base elegível" é
  jargão interno e não confere nada. **A palavra "base elegível" nunca aparece na vitrine** — ela é
  vocabulário desta spec e do código, não do cliente.
- **"adicionais incluídos" é a frase que carrega D9.** É o único trecho que distingue a regra por
  componente da regra por linha, e é justamente onde o cliente erraria a conta sozinho (ele
  presumiria que a linha inteira da pizza ficou de fora). Duas palavras compram a diferença inteira.
- **Não culpa o cliente e não pede desculpa.** É uma condição do cupom, dita uma vez, no lugar onde
  o número aparece.
- **Nunca aparece quando não há o que explicar** (estado A). Frase permanente vira ruído e ensina o
  cliente a não ler o resumo.
- **O carrinho já mostra a outra metade da explicação.** Cada linha em promoção tem selo e o par
  "de R$ 100,00 por R$ 80,00" (RN-14 e a vitrine). A frase do resumo e o selo da linha se
  sustentam: o cliente consegue apontar **qual** item ficou de fora, não só **quanto**.

**Detalhamento "Como calculamos" — ADOTADO, e o contrato é ampliado para ele existir.** O
`desenhar` (`plan/design-promocoes-e-vigencia.md` §6.4) desenhou o disclosure fechado por padrão,
só no estado B, e pediu ao Spec A dois números. **Esta spec concede**, porque a alternativa seria o
browser somar as duas parcelas — a mesma regra de componente de RN-09-a reimplementada no cliente,
que é a duplicação que D5-b proíbe:

```ts
derivarBasesCupom(linhas) → {
  subtotal: number;
  baseElegivel: number;
  baseProdutos: number;    // parcela dos produtos SEM desconto
  baseOpcionais: number;   // parcela dos opcionais — TODOS eles (D9)
}
// invariante: baseElegivel === arred2(baseProdutos + baseOpcionais)
```

Custo real: **zero.** `derivarBasesCupom` já soma as duas parcelas separadamente para chegar à base;
o que muda é devolvê-las em vez de descartá-las. A invariante `baseElegivel === baseProdutos +
baseOpcionais` entra no RED da fatia crítica 3 — é ela que impede as parcelas de virarem um segundo
cálculo que diverge do primeiro.

**`economiaProdutos` — também concedido** (`plan/design-promocoes-e-vigencia.md` §12, item 2). A
linha "Você economizou R$ X,XX" precisa de `Σ (preco − precoEfetivo) × qtd`, e o carrinho do cliente
guarda **só o preço efetivo** (RN-12 / `useCarrinho`); colocar o preço de tabela no `sessionStorage`
criaria um segundo número monetário no browser sem nenhuma necessidade. `revisarCarrinhoAction`
devolve `economiaProdutos` pronto. Sem ele, a linha simplesmente não é renderizada — **nunca**
calculada no cliente.

**`estadoCupom` como union discriminada.** Os estados A/B/C **não** são decididos pelo componente
comparando `baseElegivel` com `subtotal`: a Server Action devolve o estado já escolhido, e o
componente só ramifica (mecanismo **M4** do design). E a copy das três redações vive em módulo puro
(`lib/utils/copiaCupom.ts`, **M5**), que é a única forma de travar texto por teste num repo sem
jsdom. **A autoridade da redação continua sendo esta spec** (a tabela acima); o módulo é onde ela
mora para poder ser afirmada byte a byte.

**Fronteira:** o texto é montado no **cliente**, mas **todos os números que ele cita
(`desconto`, `baseElegivel`, `subtotal`) vêm prontos do servidor**, no retorno de
`revisarCarrinhoAction`. O cliente **não** recalcula nada para escrever a frase — se recalculasse,
teria de reimplementar a regra de componente no browser, que é a duplicação que D5-b proíbe.
→ Camada: **Server Action** (os três números e a escolha do estado A/B/C) + **cliente (UX)** (a
renderização da frase).

**RN-11 — Preview e autoritativo dizem a mesma coisa (D5-b).** Garantido **estruturalmente**, não
por disciplina:
- `revisarCarrinhoAction` (preview) e `criarPedido` (autoritativo) chamam **a mesma**
  `buscarProdutosPorIds`, **a mesma** `precoEfetivo`, **a mesma** `derivarBasesCupom` e **a mesma**
  `calcularDesconto`;
- a regra por componente (D9) vale **igual** nos dois caminhos: é a mesma `derivarBasesCupom`
  somando os mesmos componentes a partir do mesmo `buscarProdutosPorIds` + `buscarOpcionaisPorIds`.
  D5-b **não afrouxa** com D9 — ao contrário, a regra ficou mais fácil de divergir (um preview que
  esquecesse de somar os opcionais da linha promocional daria **menos** desconto que o autoritativo,
  e o cliente veria o total cair na confirmação sem explicação), então a unicidade da função é a
  única defesa que escala;
- o preview **deixa de receber qualquer número monetário do cliente**. Hoje
  `validarCupomAction(loja_id, codigo, subtotal_preview)` recebe o subtotal do browser
  (`EtapaItens.tsx:85`). Com base elegível isso viraria um oráculo: bastaria mandar um subtotal
  inflado e "sem itens promocionais" para descobrir um desconto que o autoritativo jamais daria.
  O input novo é `{ loja_id, codigo?, itens: [{ produto_id, quantidade, opcionais? }] }`, zod
  `.strict()`, com `.max(MAX_ITENS_PEDIDO)` (mesmo teto de cardinalidade de `pedido.ts`, CWE-770);
- o rate limit existente continua (`rateLimit.ts`: `validarCupom` ~20/min por IP), e a resposta a
  cupom inexistente continua genérica (anti-enumeração, `seguranca.md` §6).

> 🔴 **`validarCupom` (`src/lib/actions/cupom.ts:132`) não tem nenhum caller de produção hoje**
> (grep em `src/`, ignorando testes: só o próprio arquivo e comentários). Mas é uma função exportada
> de um arquivo `'use server'` — ou seja, **um endpoint RPC vivo**, alcançável por quem souber o id
> da action. Deixá-la com a assinatura antiga enquanto o resto do sistema passa a usar base elegível
> é deixar armado exatamente o oráculo generoso que D5-b proíbe. A issue **tem** de fechar essa
> porta: migrar para o contrato novo **ou** removê-la. Manter as duas versões não é opção.
→ Camada: **Server Action** (as duas) + **teste** que prova que preview e autoritativo dão o mesmo
número para o carrinho de RN-10-a **e** para o de RN-10-d (o que tem opcional em linha
promocional — é ele que pega a divergência de componente).

### Pedido

**RN-12 — Corrida de vigência: vale o preço do banco no momento do pedido (D11).** Se a promoção
expirou entre o carrinho e o envio, `criarPedido` cobra o preço de tabela. **O cliente pode ver o
preço mudar, e isso está correto — não é bug.** D11 fixa os dois sentidos: preço **sobe** ⇒
**reconfirmação explícita**, com de/para e novo total; preço **cai** ⇒ **só avisa**, o pedido segue.
Como a UI comunica, em duas camadas:
1. **Antes do envio (janela larga, minutos ou horas).** Ao entrar na etapa final do checkout e ao
   submeter, `revisarCarrinhoAction` devolve os preços do banco daquele instante. Se algum diferir
   do que o carrinho guarda, a tela **atualiza os valores** e mostra um aviso inline nomeando o
   item, o **de/para** e o **novo total** — *"A promoção da Feijoada terminou: de R$ 80,00 para
   R$ 100,00. Novo total: R$ 150,00."* Preço para cima **exige um segundo clique explícito** para
   enviar (D11). O cliente nunca é levado a um pedido mais caro por um clique que ele deu achando
   outra coisa.
2. **Entre a revisão e o INSERT (janela de segundos).** Não há como fechar essa janela sem trancar
   preço, o que esta spec não faz (ver §Fora do Escopo). O pedido nasce com o preço do banco, e a
   **confirmação é a tela autoritativa**: mostra o que foi cobrado, por item, com `de/por` quando
   houve promoção. Sem pop-up de desculpa e sem linguagem de erro — o valor exibido ali é o valor.
O caminho inverso (a promoção **começou** entre o carrinho e o envio) é sempre a favor do cliente:
ele paga menos que o preview. **Só avisa, sem segundo clique** (D11) — travar um pedido para
confirmar um desconto que o cliente não pediu é atrito sem contrapartida.
→ Camada: **Server Action** (a verdade) + **cliente (preview)** (o aviso).

**RN-12-a — O "segundo clique" de D11 é garantido no SERVIDOR, não na UI.** Sem jsdom, "o
componente exige reconfirmação" não é afirmável por teste — é convenção. O `desenhar` propôs um
token de revisão (`revisaoId` devolvido por `revisarCarrinhoAction` e exigido por `criarPedido`,
§12 item 4, mecanismo **M9**). **Esta spec adota o objetivo e troca o mecanismo por um mais barato**,
que não exige assinatura HMAC nem tabela nova:

Cada item do payload passa a carregar **`promocaoExibida: boolean`** — a afirmação do cliente sobre
**o que a tela mostrou**, não sobre quanto custa. `criarPedido` compara com o `temDesconto` real do
banco e:

| Cliente afirmou | Servidor apurou | Ação |
|---|---|---|
| `true` | `true` | segue (preview e realidade concordam) |
| `false` | `false` | segue |
| `false` | `true` | **segue** — a promoção começou no meio do caminho, o cliente paga **menos** que viu (D11: "preço cai ⇒ só avisa") |
| `true` | `false` | **RECUSA** com código de revisão: a promoção terminou e o cliente pagaria **mais** que viu (D11: "preço sobe ⇒ reconfirmação explícita") |

Recusado, o checkout chama `revisarCarrinhoAction`, mostra o de/para e o novo total, e o cliente dá
o segundo clique — que agora envia `promocaoExibida: false` e passa.

**Por que isto é seguro, e por que NÃO viola `seguranca.md` §10:**
- **não é campo monetário.** É um booleano de exibição; o preço continua vindo 100% do banco, e os
  campos `preco`/`subtotal`/`desconto`/`taxa_entrega`/`total` continuam **ausentes** do schema
  `.strict()`;
- **a assimetria é a prova.** O campo só pode **recusar** o pedido, nunca baratear: mentir `false`
  quando o servidor diz `true` faz o pedido seguir **pelo preço do banco** (com desconto, como
  sempre); mentir `true` quando o servidor diz `false` **recusa**. Não existe valor que o cliente
  possa enviar para pagar menos. Um campo que só sabe travar não é superfície de ataque de valor;
- **fail-closed por default:** ausente ⇒ tratado como `false` ⇒ nunca recusa por engano um cliente
  antigo durante a janela de deploy (o pedido segue pelo preço do banco, que é a regra de sempre).

**Custo de infraestrutura: zero** — nenhuma tabela, nenhum segredo, nenhum round-trip novo.
→ Camada: **Server Action** (a comparação e a recusa) + **cliente (UX)** (o de/para e o segundo
clique) + **zod** (booleano, `.strict()`).

**RN-13 — Snapshot do pedido (D7).** Para cada item:
- `itens_pedido.preco` = **preço efetivo pago** (R$ 80,00);
- `itens_pedido.preco_original` = **preço de tabela** (R$ 100,00) quando houve desconto,
  **NULL** quando não houve;
- os dois vêm do **banco**, dentro do mesmo recálculo — **nunca** do payload do cliente, que
  continua sem nenhum campo monetário (`.strict()`, `seguranca.md` §10);
- são **imutáveis**: editar o produto depois não muda pedido nenhum (`schema.md` §6).
→ Camada: **Server Action** (deriva) + **RPC** (grava na mesma transação) + **CHECK**
(`preco_original >= preco`).

**RN-14 — Exibição "de/por" (D7 + D12).** `preco_original != null` ⇒ exibe o par; `null` ⇒ exibe um
preço só, **exatamente como hoje**. A regra vive em **um** helper de apresentação (architecture.md
§8, DRY), mas **as superfícies não são todas iguais**:

| Superfície | O que mostra quando `preco_original != null` |
|---|---|
| `ReciboCliente` | par completo: "de R$ 100,00 por R$ 80,00" |
| `DetalhePedido` (painel) | par completo |
| `whatsappPedido` | par completo |
| Confirmação (vitrine) | par completo |
| **`ComandaCozinha`** | **só o selo `[PROMO]`, nenhum valor** (D12, RN-14-a) |

A v0.2.0 desta spec listava a comanda entre as superfícies do par e já registrava que ali "o preço
de tabela é secundário". **D12 leva isso até o fim:** na comanda o preço não é secundário, é
proibido.

**O par é UNITÁRIO — e continua unitário depois de D15, agora por mérito e não por desvio.** Na
v0.3.0 a escolha tinha um motivo defensivo declarado: manter o par fora da aritmética de linha, que
estava errada. Com RN-20 consertando essa conta, o desvio deixou de ser necessário — e a escolha se
sustenta sozinha, por três razões:

1. **É o que D7 diz, literalmente.** `itens_pedido.preco` = R$ 80,00 pago, `preco_original` =
   R$ 100,00 de tabela, exibidos como "de R$ 100,00 por R$ 80,00". São **preços unitários**; as duas
   colunas guardam valor por unidade, não por linha.
2. **É o número que o cliente reconhece.** R$ 100,00 é exatamente o preço riscado que ele viu no
   card da vitrine. Um par de linha ("de R$ 110,00 por R$ 90,00") mostraria um "de" que **nunca
   apareceu em lugar nenhum** — nem na vitrine, nem no carrinho.
3. **Um par de linha misturaria três coisas numa só.** Quantidade, desconto de produto e opcionais
   (que **não** são descontados, D8) entrariam no mesmo par, e a diferença entre "de" e "por"
   deixaria de ser legível como "o desconto deste produto".

Com RN-20 aplicada, o par unitário e o total da linha são **dois números independentes e ambos
corretos** na mesma linha do documento: "2× Pizza · de R$ 50,00 por R$ 40,00 · R$ 90,00". Antes de
D15 essa convivência era o problema; depois, é a leitura completa.
→ Camada: **cliente/servidor (apresentação)** — sem decisão monetária; a origem do dado é que é
crítica.

**RN-14-a — O selo da comanda e o critério que escolhe o rótulo (D12).**

A comanda da cozinha tem hoje uma regra contrária ao par de/por, **explícita e verde**:
`ComandaCozinha.tsx:17-22` declara *"RN-P1: ZERO informação financeira"*, e
`ComandaCozinha.test.tsx:135-151` tem três testes que a afirmam. **RN-P1 não é revertida e nenhum
desses testes é editado** — a trava de regressão do plano do loop é explícita: *"teste antigo
ajustado para caber no código novo é sinal de regressão, não de progresso"*.

**Rótulo escolhido: `[PROMO]`**, renderizado **depois do nome do item**, dentro do próprio elemento.

**O critério de escolha é mecânico, e é este:** o rótulo só é admissível se os três testes atuais
continuarem verdes sem edição. Para isso a string renderizada — **incluindo atributos como
`aria-label` e `title`** — precisa satisfazer, simultaneamente:

1. **não conter `"R$"`** (teste 1, que roda sobre o HTML cru);
2. **não conter, em minúsculas**, nenhum de `subtotal`, `desconto`, `taxa`, `total`, `pagamento`,
   `troco` (teste 2, que roda sobre `html.toLowerCase()`);
3. **não conter o código literal do cupom** — no fixture, `"PROMO10"` (teste 3, HTML cru).

`[PROMO]` passa nos três: não tem `R$`; em minúsculas é `[promo]`, que não contém nenhum dos seis
termos; e não forma `PROMO10`. **Os colchetes não são decoração** — o `]` garante que nenhum dígito
possa encostar em `PROMO` e formar `PROMO10` por acidente de markup (a linha do item já renderiza
`{item.quantidade}×` num `<span>` vizinho). É defesa contra um falso negativo futuro, não estilo.

**Rótulos recusados, e por quê:**

| Rótulo | Recusado porque |
|---|---|
| `[DESCONTO]` | contém `desconto` ⇒ **derruba o teste 2** |
| `[-R$ 10,00]` | contém `R$` ⇒ **derruba o teste 1**, e é valor, não marca |
| `[-20%]` | ⚠️ **passa nos três testes** e mesmo assim está recusado: é **valor** (a margem da promoção), e RN-P1 é sobre informação financeira, não sobre a string `"R$"`. **O critério mecânico é necessário, não suficiente** — os testes são o piso, o julgamento de RN-P1 é o teto. A cozinha não precisa saber a margem |
| `[PROMO10]` | é o código do cupom ⇒ **derruba o teste 3**, e vaza estratégia comercial para a bancada |
| `aria-label="Item com desconto"` | mesmo que o texto visível passe, **o atributo entra no HTML** e derruba o teste 2. Se for preciso texto acessível, use *"Item em promoção"* |

**Teste de regressão NOVO, não substituto** — um único `it`, com **as duas asserções juntas**:

```
it("mostra [PROMO] no item com preco_original E continua sem nenhum valor monetário", …)
  → expect(html).toContain("[PROMO]")        // a metade que o D12 acrescenta
  → expect(html).not.toContain("R$")          // a metade que o RN-P1 protege
```

As duas no mesmo teste **de propósito**: separadas, alguém "conserta" uma e a outra fica órfã — o
selo vira preço sem ninguém perceber, ou o selo some e o teste de RN-P1 continua verde sozinho,
declarando sucesso sobre uma comanda que perdeu a informação.
→ Camada: **cliente/servidor (apresentação)**; a origem do dado (`preco_original`) é do banco.

**RN-20 — O total de linha exibido passa a ser o total de linha cobrado (D15).**

**O defeito, confirmado no código.** O cobrado e o exibido usam aritméticas diferentes:

| Onde | Fórmula |
|---|---|
| **Cobrado** — `calcularSubtotal` (`lib/utils/calcularTotal.ts:39-52`, issue 090) | `(preco × qtd) + Σ(opcional.preco × opcional.qtd)` — opcional soma **uma vez por linha** |
| Exibido — `ReciboCliente.tsx:87,95` | `(preco + Σ opcionais) × qtd` |
| Exibido — `DetalhePedido.tsx:202-205,216-218` | idem |
| Exibido — `whatsappPedido.ts:76-80` | idem |
| Exibido — `confirmacao/page.tsx:169-173` | idem |

```
2 pizzas de R$ 50,00 + 1 borda recheada de R$ 10,00

cobrado:  (50,00 × 2) + 10,00   = R$ 110,00   ✓
exibido:  (50,00 + 10,00) × 2   = R$ 120,00   ✗  inflado em R$ 10,00
```

Com `quantidade = 1` as duas contas coincidem (R$ 60,00), e é por isso que o defeito sobreviveu: só
aparece quando há **quantidade > 1 e opcional na mesma linha**.

> **Severidade, com a mesma honestidade de RN-19: o valor COBRADO sempre esteve correto.** O
> subtotal, o total e o que o lojista recebe saem de `calcularSubtotal`, que está certo. Nenhum
> cliente foi cobrado a mais. O dano é de **documento**: a linha do recibo não fecha com o subtotal
> do mesmo recibo, e o cliente lê um papel que se contradiz. Quem tenta conferir a conta conclui que
> foi cobrado a mais — e liga para o lojista, que também não consegue explicar. Esta spec **não deve
> ser lida como relato de cobrança indevida**.

**A correção — e por que não é "trocar a fórmula em quatro arquivos".** Trocar quatro cópias por
outra fórmula escrita quatro vezes deixa a porta aberta para divergirem de novo, e **sem jsdom não
há teste de DOM que pegue**. Mesma doutrina de D13/RN-19: muda-se o desenho, não a disciplina.

```ts
// lib/utils/calcularTotal.ts — ao lado de calcularSubtotal, que já é a autoridade
export function totalDaLinha(item: ItemCalculo): number {
  const somaOpcionais = (item.opcionais ?? []).reduce(
    (s, op) => s + arredondar(op.preco * op.quantidade), 0,
  );
  return arredondar(arredondar(item.preco * item.quantidade) + somaOpcionais);
}

export function calcularSubtotal(itens: ItemCalculo[]): number {
  return arredondar(itens.reduce((acc, item) => acc + totalDaLinha(item), 0));
}
```

**`calcularSubtotal` CONSEGUE consumi-la, com zero mudança de comportamento** — e isso foi
verificado, não presumido: o corpo atual já calcula, por linha, exatamente
`arredondar(arredondar(preco × qtd) + Σ arredondar(op.preco × op.qtd))`. `totalDaLinha` é esse
trecho extraído, não uma fórmula nova. **Critério de aceite do refactor: a suíte atual de
`calcularTotal.test.ts` passa sem uma única edição** — mesma régua da extração de `partesNoFuso`
(RN-03). Se algum teste precisar mudar, o refactor mudou comportamento e está errado.

**A invariante, e por que ela é a trava certa neste repo:**

```
para qualquer carrinho:  Σ totalDaLinha(item) === calcularSubtotal(itens)
```

Não são quatro asserções de tela — é **uma propriedade de dinheiro**, verificável em
`environment: node`, sem jsdom, sem Playwright. Ela vale por construção depois do refactor, e é
justamente isso que a torna útil: no dia em que alguém reescrever uma das quatro telas com a
fórmula antiga, a soma do que se exibe deixa de bater com o que se cobra e o teste cai. O RED
**tem de incluir o caso `quantidade > 1` com opcional** — é o único onde as duas contas divergem; um
teste só com `quantidade = 1` passa nas duas fórmulas e não prova nada.

**Reuso nas quatro superfícies, sem mapper novo:** `ReciboCliente` e `DetalhePedido` já normalizam
os opcionais com `mapearOpcionaisExibicao` (`lib/utils/rotulosPedido.ts:46-55`), que devolve
`{ preco, quantidade }` — exatamente o shape de `ItemCalculo.opcionais`. `whatsappPedido` e a
confirmação leem `preco_snapshot` na mão; passam a usar **o mesmo mapper que já existe**. Nenhuma
função nova além de `totalDaLinha`.

**Efeito colateral bom, de graça:** as quatro cópias também não arredondam por multiplicação, ao
contrário de `calcularSubtotal`. Ao passarem pela função única, o float drift some junto — sem ser
um segundo trabalho.
→ Camada: **Server/cliente (apresentação)** para o que é exibido, mas o refactor toca
`calcularTotal.ts`, que está no **caminho autoritativo** — ver a justificativa de criticidade na
fatia 8.

---

### Vitrine

**RN-15 — "Pratos promocionais" é derivado, não armazenado (D1).** A lista é
`produtosDoCatalogo.filter(p => p.temDesconto)`, calculada **no servidor** sobre o catálogo **que a
página já carregou**. Zero query nova, zero tabela nova, zero risco de N+1 por causa do modal.
→ Camada: **SSR**.

**RN-16 — Modal de promoções (D6).** Abre quando, **e só quando**, as três condições valem:
1. `loja.modal_promocoes === true` (SSR, via `vitrine_lojas`);
2. existe ao menos um produto com `temDesconto === true` **neste request** (SSR, RN-15);
3. o dispositivo ainda não viu o modal **hoje** (cliente, `localStorage`).

Sem promoção ativa, **nunca abre** — mesmo com o toggle ligado. A condição 3 é a única que vive no
cliente, e é o único lugar onde isso é aceitável: "1× por dia por dispositivo" é preferência de UX
por dispositivo, não permissão e não dinheiro. Um cliente que limpe o `localStorage` vê o modal de
novo, e isso não tem consequência nenhuma.

**A decisão é pura e testável sem jsdom** (o repo não tem jsdom, e o projeto já usa esse padrão 4×
— `architecture.md` §8, "mecânica de browser ... objeto global injetado por parâmetro"):

```ts
// módulo NEUTRO (sem 'use client'), em components/vitrine/decisaoModalPromocoes.ts
decidirModalPromocoes(entrada: {
  toggleDaLoja: boolean;
  temPromocaoAtiva: boolean;
  diaDeHojeNaLoja: string;     // "YYYY-MM-DD" no fuso da loja
  ultimaVisualizacao: string | null;
  scrollY: number;
}): boolean
```

O "dia de hoje" é calculado **no fuso da loja** (mesmo primitivo de RN-03), não no fuso do
dispositivo: o cliente que vira a meia-noite no próprio fuso não deve reabrir o modal de uma loja
onde ainda é o mesmo dia.

**RN-17 — O modal não rouba o gesto de navegação.** O PR #139 corrigiu exatamente esse erro no
carrinho, que passou a abrir **só por clique explícito** em "Ver carrinho"
(`VitrineClient.tsx`). As travas, todas verificáveis:
- **decisão única, na montagem.** Um `useEffect` com deps `[]`. O modal **não** reabre por mudança
  de estado, por busca, por adição ao carrinho, por rolagem ou por voltar para a aba;
- **sem `setTimeout`.** Modal que aparece depois de N segundos é exatamente o que intercepta o
  toque no meio do gesto. A decisão é tomada na montagem ou não é tomada;
- **`scrollY > 0` ⇒ não abre.** Se o cliente já começou a rolar, ele já está navegando — a janela de
  abrir passou;
- **marca como visto no instante da decisão**, não no fechamento. Fechar por ESC, por X, por clique
  fora ou por recarregar a página tem todos o mesmo efeito: não aparece de novo hoje;
- **nunca abre o carrinho, nunca navega para outra rota, nunca adiciona item.** O único CTA é "Ver
  promoções", que fecha o modal e rola até a primeira promoção — uma âncora, não uma transação;
- **`Dialog` do shadcn**, com ESC, foco preso e clique-fora de graça (`design-system.md` §5);
- **o foco tem para onde voltar — prop obrigatória.** Lacuna que a v0.2.0 não cobria e que o
  `desenhar` apontou (`plan/design-promocoes-e-vigencia.md` §5.3): este modal abre **sem trigger**
  (ninguém clicou em nada), então, ao fechar, o foco cairia no `<body>` e o cliente de teclado ou de
  leitor de tela seria jogado para o topo do documento — **o mesmo dano do gesto roubado, só que na
  navegação por teclado**. O componente recebe um `destinoFoco` **obrigatório** (o `<main>` da
  vitrine, com `tabIndex={-1}`), que é para onde o foco volta **e** para onde o CTA "Ver promoções"
  rola — um alvo só, para foco e scroll nunca divergirem. Obrigatório, não opcional, pelo mesmo
  motivo de RN-19: foco perdido é invisível em revisão de código e não é testável sem jsdom;
- **nada é renderizado no SSR** para o modal, e o catálogo atrás dele continua completo e
  interativo. Se o JS falhar, a vitrine funciona inteira e o modal simplesmente não existe.

**RN-18 — `localStorage` pode falhar e isso não pode quebrar a vitrine (D6).** Aba privativa,
storage bloqueado por política, cota estourada: **toda** leitura e **toda** escrita ficam em
`try/catch`, com o objeto de storage **injetado por parâmetro** (nunca lido de `window` dentro da
função — mesmo padrão dos 4 casos já citados em `architecture.md` §8). Leitura que falha devolve
`null`; escrita que falha é engolida. **Pior caso: o modal reabre.** Nunca uma exceção, nunca uma
vitrine em branco. Chave: `irango:promo:<slug>` — **por slug**, porque um dispositivo pode visitar
várias lojas no mesmo dia e cada uma tem seu próprio "1× por dia" (D6). `sessionStorage` **não**
serve aqui (o carrinho usa `sessionStorage`, mas "1× por dia" precisa sobreviver ao fechamento da
aba).

**RN-19 — Correção do beco sem saída de `disponivel` (D13).** Bug **vivo hoje**, encontrado pelo
agente `desenhar` e confirmado no código:

| Arquivo | Estado atual |
|---|---|
| `SecaoCatalogo.tsx:89-100` (`abrirModal`) | monta `ProdutoModalDados` **sem** o campo `disponivel` |
| `ProdutoModal.tsx:139` | `const disponivel = produto.disponivel ?? true` ⇒ **o modal sempre se acha disponível** |
| `CardProduto.tsx:46,95` | **trata** `disponivel`: clique bloqueado, botão `disabled`, pílula "Esgotado" — por este caminho o bug não passa |
| `ItemProdutoLista.tsx:30-53` | **não conhece `disponivel`**: a linha inteira é `role="button"`, sempre clicável. É o componente da categoria com `exibir_imagens = false` |
| `pedido.ts:174` | **recusa** o item indisponível no servidor |

**Severidade, com todas as letras para ninguém reclassificar depois: não é brecha de dinheiro e não
é compra indevida.** O servidor recusa o item esgotado no recálculo autoritativo, sempre. O dano é
**um beco sem saída de UX**: o cliente abre um produto esgotado, escolhe opcionais, escreve
observação, monta o carrinho e só descobre no fim — com uma mensagem genérica, porque erro interno
não vaza detalhe (`seguranca.md` §14). Perde o pedido inteiro no último passo.

**Por que a correção mora nesta spec, e não numa issue de bug à parte:**
1. esta é exatamente a fatia que troca campos avulsos por `ProdutoVitrine` nas **quatro**
   superfícies (card, lista, modal, busca) — o custo marginal de corrigir junto é ~zero, e corrigir
   depois significaria mexer nos mesmos quatro arquivos uma segunda vez;
2. é o **mesmo formato de bug** que o `"fora_da_janela"` do Spec B repetiria: um estado de
   "aparece mas não compra" que uma superfície conhece e outra não. Consertar o formato agora é o
   que impede o Spec B de reintroduzi-lo com outro nome.

**A trava é o `tsc`, não a revisão de código.** As quatro superfícies passam a receber **um objeto
obrigatório** `produto: ProdutoVitrine` — não campos avulsos, e **sem nenhum campo opcional com
default** (regra 5 do contrato de catálogo). Campo faltando vira **erro de compilação**, que é o
primeiro passo do CI. Isso não é preferência estética: **o repo não tem jsdom**
(`environment: node`, sem Docker, sem Playwright), então "o modal trata esgotado" não é afirmável
por teste de DOM. Proteção que depende de alguém lembrar não é travável aqui — a saída é mudar o
desenho para que o erro não compile (é o mecanismo **M2** de
`plan/design-promocoes-e-vigencia.md` §1).

Em v1, `compravel === disponivel` e `motivoNaoCompravel === disponivel ? null : "esgotado"`, e
**`ItemProdutoLista` passa a tratar os dois** com o mesmo padrão visual de `esgotado` que
`CardProduto` já usa — nunca o de `oculto`.
→ Camada: **SSR** (decide) + **`tsc`** (impede a superfície de ignorar) + **Server Action**
(`pedido.ts` continua recusando, inalterado — a UI nunca foi a proteção).

---

## Segurança (obrigatório)

Base: `references/seguranca.md` §2 (RLS), §6 (inputs), §10 e §10-A (recálculo no servidor), §14
(erros), §19 (views). Mandato 1 do `CLAUDE.md`: nunca confiar no cliente.

### Que dado sensível entra ou sai

| Dado | Classificação | Tratamento |
|---|---|---|
| Configuração de desconto de um produto | dado comercial do lojista, **não público em cru** | as colunas cruas **nunca** trafegam para o cliente na vitrine; só o `ProdutoVitrine` projetado (regra 6 do contrato) |
| `modal_promocoes` | preferência de UI, não PII, não billing | exposto na view pública; avaliação de exposição em §Modelos de Dados |
| PII de cliente | **inalterado** | esta feature não lê, não escreve e não exibe nenhum campo novo de cliente |
| Chave Pix / dado de pagamento | **inalterado** | o SaaS continua sem tocar em pagamento (`modelo-negocio.md` §3) |
| Código de cupom | inalterado | continua escopado por `(loja_id, codigo)` via `service_role`, com resposta genérica para inexistente (anti-enumeração) |

### Valor monetário → recálculo no servidor obrigatório

Sim, em cinco pontos, e **todos** já mapeados acima:

1. **Preço efetivo** — nunca vem do cliente. `criarPedido` continua lendo `buscarProdutosPorIds` e
   agora aplica `precoEfetivo` sobre o resultado. O payload zod continua `.strict()` e continua sem
   declarar `preco`/`subtotal`/`desconto`/`taxa_entrega`/`total` — **nenhum campo monetário novo é
   acrescentado ao schema do pedido**. O cliente continua enviando só `produto_id` + `quantidade` +
   opcionais (`seguranca.md` §10, tabela "O que o cliente PODE enviar").
2. **Base elegível (por componente, D9)** — derivada no servidor por `derivarBasesCupom` a partir
   de componentes montados do banco (`buscarProdutosPorIds` + `precoEfetivo` +
   `buscarOpcionaisPorIds`). O cliente **não** envia subtotal, **não** envia base, **não** envia
   quais itens são promocionais e **não** decide se um adicional é descontável.
3. **Elegibilidade e valor do cupom** — `validarUsoCupom` + `calcularDesconto`, no servidor, com o
   gate no subtotal e o cálculo na base elegível.
4. **Total de linha exibido (D15/RN-20)** — a correção extrai `totalDaLinha` de dentro de
   `calcularSubtotal` e faz as duas usarem o mesmo código. **Isso coloca um refactor dentro do
   caminho autoritativo de preço**: `calcularSubtotal` é chamada por `criarPedido` (`pedido.ts:229`)
   e pelo preview. O critério que mantém a mudança segura é mecânico — **a suíte atual de
   `calcularTotal.test.ts` passa sem edição** — e a invariante `Σ totalDaLinha === calcularSubtotal`
   entra no RED (fatia crítica 8). Nenhum número novo passa a vir do cliente.
5. **Preview do checkout** — **mesma** cadeia de funções do autoritativo. A mudança de contrato do
   `validarCupomAction` (parar de receber `subtotal_preview` e passar a receber os itens) é
   **requisito de segurança, não refactor cosmético**: `seguranca.md` §10-A já registra a mesma
   lição no frete ("o preview não revela zonas baratas que o autoritativo rejeitaria"). Preview que
   aplica regra mais generosa que o autoritativo é oráculo.

### Tabela nova? Políticas RLS necessárias

**Nenhuma tabela nova nesta fatia** — portanto **nenhuma política RLS nova**. As colunas entram em
`produtos`, `lojas` e `itens_pedido`, todas já com RLS habilitada e política por `loja_id`
(`seguranca.md` §2). Mas há três conferências obrigatórias, porque "sem política nova" não é o
mesmo que "sem trabalho de RLS":

1. **`produtos` — escrita.** `produtos_acesso_proprio` isola por dono. As colunas novas entram nela
   automaticamente (RLS filtra **linha**, não coluna). Teste em pglite (`tests/helpers/pglite.ts`,
   `asAnon`/`asUser`): lojista A **não** liga desconto em produto da loja B, nem via PostgREST
   direto. Além do SQLSTATE, o teste **afirma o fragmento da mensagem** — lição já registrada no
   projeto: trava de escopo passa por acidente aritmético quando só se checa o código do erro.
2. **`produtos` — leitura pública.** `produtos_leitura_publica` (oculto=false + `loja_esta_ativa`)
   passa a devolver também as colunas de desconto ao `anon`. É **aceitável** (preço promocional é
   informação pública da vitrine, por definição), mas a **projeção** continua obrigatória: o
   `ProdutoVitrine` é o que trafega ao cliente, não a row crua (regra 6 do contrato).
3. **`vitrine_lojas` — recriação da view.** Detalhada em §Modelos de Dados. O `drop` + `create`
   recria privilégios do zero. O vetor de escrita por view definer auto-atualizável
   (`seguranca.md` §19) está **em grande parte fechado a montante**: o §2 da migration
   `20260702140000_vitrine_lojas_revoke_escrita.sql` já alterou os *default privileges* do schema,
   de modo que uma view nova criada pelo `postgres` **não** reganha INSERT/UPDATE/DELETE para
   `anon`/`authenticated`. O risco residual, portanto, é **disponibilidade e não escalonamento**:
   perder o `grant select` ou uma coluna da projeção derruba a vitrine em silêncio.
   **Testes obrigatórios:** `anon` **lê** a view (todas as colunas anteriores presentes) e `anon`
   **não** consegue `UPDATE` nela — o segundo como defesa em profundidade.

### Caminho admin (service_role) — o oráculo generoso mais fácil de esquecer

`service_role` tem `BYPASSRLS`. Toda regra nova que more **só** na RLS não existe no hub admin.
Por isso:
- `admin-produtos.ts` usa `schemaProduto` (linhas 56 e 94) — estender o schema propaga a validação,
  **desde que** a issue confira que nenhum caminho admin monta patch por spread. O `escopo.*` por
  `loja_id` continua sendo o isolamento real ali;
- `admin-perfil.ts` compartilha `montarPatchPerfil`, então a allowlist de `modal_promocoes` vale nos
  dois mundos de uma vez;
- **`admin-cupom.ts` não muda e não deve mudar.** Contrariando a suposição inicial deste trabalho,
  ele **não é caller de `calcularDesconto`**: a única ocorrência ali (linha 24) é um comentário, e o
  arquivo só persiste a **definição comercial** do cupom (`cupomSchema`), nunca calcula desconto. A
  regra D5 não tem onde aterrissar nesse arquivo. **A exigência que permanece é negativa e explícita:
  nenhum cálculo de desconto pode ser acrescentado ao caminho admin.** O dia em que o hub admin
  ganhar um preview de valor de cupom, ele usa `calcularDesconto` com base elegível como todo mundo.

### API externa com key

Nenhuma. Esta feature não chama serviço externo. ViaCEP e Nominatim seguem exatamente como estão.

### Erros

Falha de banco, `23514` de CHECK ou qualquer exceção interna: **mensagem genérica na UI, detalhe no
log do servidor** (`seguranca.md` §14). O texto de um CHECK violado nunca chega ao cliente — nem ao
lojista. A exceção é a mensagem **deliberadamente redigida** de RN-06, que é decidida pela Server
Action antes da escrita, não extraída de um erro do Postgres.

---

## Fatias críticas (`crítica: SIM` — TDD red-first obrigatório)

Seleção para o agente `quebrar` selar. Critério do `CLAUDE.md` (mandato 3): dinheiro, RLS,
autorização, token. Cada uma exige teste **vermelho com output `FAIL` capturado** antes de qualquer
código de produção.

| # | Fatia | Por que é crítica | O que o RED precisa provar |
|---|---|---|---|
| 1 | **`precoEfetivo` + vigência** (`lib/utils/precoEfetivo.ts`) | dinheiro | 100 @ 20% ⇒ 80; 100 − R$ 30 ⇒ 70; piso em 0; fora do prazo ⇒ preço cheio; início inclusivo / fim exclusivo; `desconto_ativo = false` ⇒ preço cheio mesmo com prazo vigente |
| 2 | **Contrato de catálogo** (`projetarProdutoVitrine`) **+ correção do D13** | dinheiro exibido; é o insumo do Spec B; e é a fatia que fecha o beco sem saída de `disponivel` | todo campo presente e não-opcional; `temDesconto ⇔ precoEfetivo < preco`; `compravel === disponivel` e `motivoNaoCompravel === "esgotado"` quando indisponível; colunas cruas de desconto **ausentes** do objeto projetado. **D13:** as quatro superfícies recebem `produto: ProdutoVitrine` **obrigatório** — a prova é o `tsc` (primeiro passo do CI), não teste de DOM, porque não há jsdom; some o `?? true` de `ProdutoModal.tsx:139` e some a montagem parcial de `SecaoCatalogo.tsx:89-100` |
| 3 | **`calcularDesconto` + `derivarBasesCupom` (base elegível **por componente**, D9)** — *a fatia mais perigosa do trabalho inteiro* | dinheiro; muda uma função pura com teste próprio e 3 importadores de produção, e a unidade da base mudou de linha para componente | **os DOIS casos canônicos, não um deles:** (a) RN-10-a — subtotal 130 / base 50 / desconto 5 / total 125; (b) RN-10-d — subtotal 140 / base 60 / desconto 6 / total 134, com a borda de R$ 10,00 **dentro** da base apesar de estar numa linha promocional. Mais: a invariante `baseElegivel === arred2(baseProdutos + baseOpcionais)` em todos os casos (RN-10-e — as parcelas do disclosure não podem ser um segundo cálculo que diverge do primeiro); o clamp de RN-10-b (desconto 50, não 80); o caso puro de RN-10-c (total 80, desconto 0, **sem adicionais**); a variação B de RN-10-d (2 pizzas + 1 borda ⇒ base 10, não 20 — armadilha do `× qtd`); o gate de D5-a **nos dois sentidos** (aceito com 130 ≥ 100; recusado com subtotal abaixo do mínimo); e que `derivarBasesCupom.subtotal === calcularSubtotal(...)` para todos eles |
| 4 | **Preview = autoritativo** (`revisarCarrinhoAction`) | D5-b; o preview recebe ids do cliente ⇒ vetor IDOR/cross-loja; com D9 a regra tem mais superfície para divergir | preview e `criarPedido` devolvem **o mesmo desconto** para o carrinho de RN-10-a **e** para o de RN-10-d (é o que tem opcional em linha promocional — o único que pega divergência de componente); `produto_id` **e `opcional_id`** de **outra loja** são recusados, afirmando o **fragmento da mensagem** além do SQLSTATE; nenhum campo monetário é aceito no input (`.strict()`); teto de cardinalidade |
| 5 | **`criar_pedido` + snapshot `preco`/`preco_original` + a trava de D11 (RN-12-a)** | dinheiro; snapshot do banco, nunca do cliente; e é onde o "segundo clique" deixa de ser convenção de UI | pedido de RN-10-a grava `preco = 80` + `preco_original = 100` na Feijoada e `preco_original = NULL` no refrigerante; corrida de RN-12 (desconto expirado entre carrinho e envio ⇒ grava 100); desconto 0 ⇒ `cupom_id`/`cupom_codigo` NULL e `usos_contagem` **inalterado** (RN-10.3); jsonb **sem** a chave `preco_original` ⇒ coluna NULL, sem erro (janela de deploy). **RN-12-a: as quatro células da matriz**, com ênfase nas duas que importam — `promocaoExibida: true` + servidor `false` ⇒ **recusa**; `false` + servidor `true` ⇒ **segue, e cobra o preço com desconto** (prova de que o campo não barateia nada); e ausente ⇒ tratado como `false` |
| 6 | **RLS + CHECKs das colunas de desconto** | isolamento multitenant | pglite: lojista A não liga/edita desconto em produto da loja B (mensagem afirmada, não só SQLSTATE); percentual 101 recusado; fixo > preço recusado; `desconto_ativo = true` sem tipo/valor recusado; `preco_original < preco` recusado |
| 7 | **`vitrine_lojas` recriada + allowlist de `modal_promocoes`** | a view é a **única** porta de leitura pública da loja: recriá-la errado quebra a vitrine inteira em silêncio; escrita por view definer auto-atualizável é defesa em profundidade | **a view continua devolvendo TODAS as colunas anteriores** (risco principal) e o `grant select to anon, authenticated` foi re-aplicado — a vitrine carrega sob `anon`; `anon` **não** consegue `UPDATE`/`INSERT`/`DELETE` na view (defesa em profundidade, `seguranca.md` §19); `modal_promocoes` grava `false` corretamente (`!== undefined`, não truthiness) |

| 8 | **`totalDaLinha` + a invariante de soma (D15, RN-20)** | **dinheiro** — ver a justificativa abaixo | a invariante `Σ totalDaLinha(item) === calcularSubtotal(itens)` para vários carrinhos, **incluindo obrigatoriamente `quantidade > 1` com opcional**; o caso literal de RN-20 (2 × R$ 50,00 + borda R$ 10,00 ⇒ **R$ 110,00**, nunca R$ 120,00); `quantidade = 1` continua dando o mesmo de antes; e — critério de aceite do refactor — **`calcularTotal.test.ts` passa sem uma única edição** |

**Por que a fatia 8 é `crítica: SIM`** (a pergunta é legítima: o defeito é de exibição, e exibição
costuma ser `NÃO`). Três razões, em ordem de peso:

1. 🔴 **O refactor entra no caminho autoritativo.** No momento em que `calcularSubtotal` passa a
   consumir `totalDaLinha`, isto deixa de ser mudança de tela: um erro ali muda **o subtotal
   cobrado** de todo pedido do sistema. `calcularSubtotal` é chamada por `criarPedido`
   (`pedido.ts:229`) e pelo preview do carrinho. O mandato 3 do `CLAUDE.md` é explícito — dinheiro
   exige teste vermelho antes do código.
2. **A prova é uma invariante de dinheiro, não uma asserção de pixel.**
   `Σ exibido === cobrado` é exatamente o formato que este repo consegue travar
   (`environment: node`, sem jsdom). Uma fatia cuja garantia é uma propriedade monetária pertence ao
   TDD red-first por construção.
3. **É valor monetário que o cliente lê e usa para conferir.** O recibo e a mensagem de WhatsApp são
   os documentos que ele confronta com o que pagou. Errado, geram disputa com o lojista — que é o
   dano que o SaaS existe para não criar.

O que **não** pesou na decisão: a origem do bug ser anterior a este trabalho. Criticidade é sobre o
que a mudança pode quebrar, não sobre quem escreveu o defeito.

**Esperado `crítica: NÃO`:** selo e preço riscado no card / lista / modal / busca; o modal de
promoções e o `localStorage`; o bloco de promoção no `FormProduto`; o toggle na tela de perfil; a
exibição "de/por" no detalhe, no recibo e no WhatsApp, e o selo `[PROMO]` na comanda (a **origem**
do dado é crítica — fatia 5; a **renderização** não).

> ⚠️ **Uma exigência de teste que não depende do selo de criticidade.** A fatia do selo da comanda é
> `crítica: NÃO`, **mas o teste de regressão de RN-14-a é obrigatório e vem antes do código** — ele
> nasce vermelho naturalmente (o selo ainda não existe). Um `it` só, com as duas asserções:
> `toContain("[PROMO]")` **e** `not.toContain("R$")`. E os três testes atuais de RN-P1
> (`ComandaCozinha.test.tsx:135-151`) **não podem ser tocados** — se o rótulo escolhido derrubar
> algum deles, troca-se o rótulo, nunca o teste (RN-14-a).

---

## Ambiguidades — levantadas na v0.1.0, TODAS resolvidas

As sete ambiguidades que a v0.1.0 desta spec levantou foram levadas ao dono do produto e **fechadas
em 2026-09-19**. Nenhuma continua aberta. A tabela existe para que ninguém reabra por engano uma
pergunta já respondida — e para deixar registrado **qual** resposta veio de fora e qual foi apenas
confirmada.

| # | Pergunta (v0.1.0) | Resolução | Onde vive agora |
|---|---|---|---|
| 1 | Desconto × opcionais | **D8** — confirma a proposta: desconto só sobre `produtos.preco`, opcional sempre a preço cheio | RN-08 |
| 2 | Opcionais × base elegível | **D9 — CORRIGE a proposta.** A base é **por componente**, não por linha: o opcional sempre entra na base, mesmo em linha promocional | RN-09-a, RN-10-d, RN-10-e |
| 3 | Consumo de uso com desconto R$ 0,00 | **aceita como proposta** — não consome `usos_contagem`, não grava `cupom_codigo` | RN-10.3 |
| 4 | Desligar preserva ou apaga a config | **aceita como proposta** — coluna `desconto_ativo`, desligar preserva | RN-07 |
| 5 | Preço abaixo do desconto fixo | **D10** — confirma a proposta: recusa a gravação, sistema não ajusta dinheiro sozinho | RN-06 |
| 6 | Fuso da loja no prazo | **aceita como proposta** — comparação instante↔instante em `timestamptz`; fuso só na escrita e na exibição | RN-03 |
| 7 | Expiração com pedido em andamento | **D11** — confirma a proposta: preço sobe ⇒ reconfirmação com de/para e novo total; preço cai ⇒ só avisa | RN-12 |

**A única correção foi a #2.** A v0.1.0 tinha assumido "a linha inteira sai da base elegível, com
os opcionais junto", com o racional de que o cliente confere o carrinho olhando o valor da linha.
D9 reverteu: a unidade é o **componente**, porque o opcional nunca recebeu desconto e portanto não
há por que negar-lhe o cupom. O custo dessa correção é uma explicação mais difícil na tela — que é
justamente o que RN-10-e resolve, e por isso RN-10-e existe.

**Nenhuma ambiguidade nova foi introduzida por D8–D11.** As duas leituras candidatas a conflito
foram verificadas e são compatíveis:
- o caso canônico de D5 (130 / 50 / 5 / 125) **sobrevive intacto** à fórmula por componente, porque
  aquele carrinho não tem nenhum opcional (verificação escrita em RN-10-a);
- o `× qtd` do opcional na fórmula de D9 é a **quantidade do opcional**, que é como
  `calcularTotal.ts` já soma opcional desde a issue 090 ("por linha, sem multiplicar pela quantidade
  do produto"). A fórmula de D9 e o código existente concordam; a leitura errada (multiplicar pela
  quantidade do produto) está travada por teste em RN-09-a e na fatia crítica 3.

---

## Fora do Escopo (v1)

### É do Spec B (`specs/cardapio-sazonal.md`) — não desenhar nada disso aqui

- Entidade `cardapios` e o vínculo N:N com produto (D2).
- Vigência recorrente (dias da semana, dias do mês, faixa de horário) e prazo fixo com presets (D3).
- Produto que aparece **marcado e não comprável** fora da janela, e a recusa do item fora da janela
  no servidor (D4).
- Ação em lote no painel: seleção múltipla de produtos e aplicação a uma categoria inteira (D2).
- O membro `"fora_da_janela"` de `MotivoNaoCompravel` — o **lugar** dele está definido aqui
  (§Contrato de catálogo, ponto de extensão); o **conteúdo** é do Spec B.

### Recusado por contrato (D1–D7 são fechadas)

Sugestões que apareceram ao mapear a feature e **não viram feature**:

- **Cupom que incide, ainda que parcialmente, sobre o preço de um produto em promoção** (ex.:
  "cupom vale metade sobre item promocional"). D5 é binário **no componente**: o preço de um
  produto com desconto ativo **nunca** entra na base do cupom.
  ⚠️ Não confundir com D9: o **adicional** de uma linha promocional entrar na base **não** é
  acumulação — aquele adicional nunca recebeu desconto nenhum (D8), então o cupom é o **primeiro**
  desconto que ele recebe, não o segundo.
- **Desconto por categoria** ou por loja inteira. D1: o mecanismo é **um só**, por produto.
- **Cardápio com desconto próprio.** Preço é do Spec A; calendário é do Spec B; nenhum dos dois
  herda a régua do outro.
- **Fila/job de expiração de promoção.** A vigência é avaliada **por request, no servidor**. Não há
  worker, não há cron, não há coluna "expirada" para manter em dia.
- **Cache do catálogo** (`revalidate`, `'use cache'`, ISR) para amortizar o filtro de vigência. A
  vitrine é dado vivo por decisão documentada (`page.tsx:30–42`); um catálogo cacheado serve
  promoção expirada. Custo de performance é assunto do `acelerar`, **depois** do `executar`.
- **Trancar o preço do carrinho** por N minutos (reserva de preço). RN-12 já decidiu: vale o preço
  do banco no momento do pedido.
- **Token de revisão assinado (`revisaoId`) devolvido por `revisarCarrinhoAction` e exigido por
  `criarPedido`** — proposta de `plan/design-promocoes-e-vigencia.md` §12, item 4. **O objetivo foi
  aceito; o mecanismo, não.** RN-12-a atinge a mesma garantia de servidor com um booleano de
  exibição assimétrico, sem HMAC, sem tabela de revisões e sem round-trip novo. Se um dia a
  reconfirmação precisar cobrir mais do que promoção (frete, disponibilidade, opcional removido), o
  token volta à mesa — aí ele passa a pagar por si.

### Débito que ENTROU no escopo (era "fora" até a v0.3.0)

A divergência entre o total de linha **exibido** e o **cobrado** (achado de
`plan/design-promocoes-e-vigencia.md` §13) estava aqui, marcada como fora do escopo. **D15 a trouxe
para dentro:** virou **RN-20** e a **fatia crítica 8**. Esta entrada fica para quem leu a v0.3.0 não
procurar por ela no lugar errado.

> ⚠️ **O alerta continua útil, invertido.** Até a v0.3.0 o risco era alguém "corrigir de passagem"
> um bug fora do escopo. Agora o risco é o oposto: **corrigir só uma das quatro telas.** Quatro
> correções independentes reproduzem exatamente a situação que criou o defeito — quatro cópias da
> mesma aritmética, livres para divergir de novo. Por isso RN-20 não é "trocar a fórmula": é **uma
> função pura só**, consumida pelas quatro superfícies **e** por `calcularSubtotal`, com a invariante
> `Σ totalDaLinha === calcularSubtotal` travada em teste. Uma issue que conserte uma tela e deixe as
> outras três está **errada**, mesmo que a tela dela fique certa.

### Fora por escopo de produto (v1)

- **Histórico de promoções / relatório de quanto foi descontado.** `preco_original` deixa o dado
  gravado e permite construir isso depois; a tela é fase 3 (`modelo-negocio.md` §8, "Relatórios de
  vendas").
- **Notificação ao cliente de promoção nova** (push, e-mail, WhatsApp em massa). Depende de
  notificação em tempo real, que é fase 2, e de base de contatos, que o SaaS não mantém.
- **Promoção agendada com várias janelas** ("toda sexta"), promoção por quantidade ("leve 3 pague
  2"), preço por faixa de horário (happy hour) e cupom de primeira compra. Nenhuma está em D1–D7.
- **Economia acumulada na `TabelaPedidos`** ("este pedido economizou R$ X"). D7 pede o par de preços
  na **linha do item**, não um agregado no pedido; `paraLinhaPedido` só muda se essa coluna for
  pedida um dia.
- **Selo de promoção no manifest/PWA ou no metadata de SEO** da loja.
