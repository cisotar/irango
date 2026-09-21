# Desenho UX/UI — vigência por item do cardápio (issues 275→279)

**Escopo:** uma passada de desenho para as cinco superfícies da spec
`specs/vigencia-por-item-do-cardapio.md`. **Não implementa.** Tudo aqui é layout, estado, copy e
acessibilidade; nenhuma regra de vigência é redigida neste documento (elas moram em
`vigenciaCardapio.ts` e `descreverVigencia.ts`, de [273]).

Legenda usada nas seções: **[spec]** = já fixado pela spec/issue · **[UX]** = decisão deste
documento, aberta a veto do dono · **[⚠]** = ponto em que o desenho diverge da issue e precisa de
decisão explícita (reunidos em §8).

---

## Gate de reuso

- **shadcn/ui varridos** (`src/components/ui/`): `accordion`, `alert-dialog`, `badge`, `button`,
  `card`, `checkbox`, `dialog`, `input`, `label`, `menu`, `radio-group`, `separator`, `sheet`,
  `switch`, `textarea`. **Não há `toggle` nem `toggle-group` instalados** — o padrão de pílula do
  projeto é `<button type="button" aria-pressed>` (já é assim em `FormVigencia.tsx:286` e nas
  pílulas de dia do mês). Nenhum componente novo do CLI precisa ser gerado.
- **Componentes painel/vitrine varridos:** `FormVigencia.tsx` (pílulas inline + `ALVO` literal),
  `rascunhoCardapio.ts` (`DIAS_DA_SEMANA`), `PreviewVigencia.tsx`, `SeletorProdutosDoCardapio.tsx`,
  `DialogoLoteCardapio.tsx`, `BarraSelecaoLote.tsx`, `useLoteDeProdutos.tsx`, `contrato-lote.ts`,
  `FormProduto.tsx` (bloco "Está em:" e o aviso âmbar de produto órfão),
  `ProdutosClient.tsx` (chip de cardápio + aviso âmbar RN-12), `SecaoCatalogo.tsx`,
  `CatalogoVitrine.tsx`, `CardProduto.tsx`, `ItemProdutoLista.tsx`.
- **Tokens (`globals.css` `@theme`):** `--color-texto-muted`, `--color-primaria/fundo/destaque`
  (tema da loja — **não usados no painel**), `--color-promo-*`, `--color-indisponivel-*`, `--radius`,
  `--ring`, `--destructive`, `--muted`, `--primary`. O âmbar de aviso **não é token**: hoje é a
  tripla literal `border-amber-300 bg-amber-100 text-amber-900`, usada em `FormProduto.tsx:715` e em
  `ProdutosClient.tsx` (aviso RN-12). Este desenho **repete a tripla existente** em vez de criar
  token — consolidar `--color-aviso-*` é higiene separada, fora destas cinco issues.

**Decisão: REUSAR + CRIAR um (1) componente.**
Justificativa: só `PilulasDeDias` é novo, e ele é **extração** do bloco que já existe em
`FormVigencia.tsx:286` para uma segunda superfície ([275] exige "duas superfícies, uma
implementação"); todo o resto é prop nova e frase nova em componente existente.

---

## 1. `PilulasDeDias` — o único componente novo

### 1.1 Contrato

```ts
export type PilulasDeDiasProps = {
  /** 0=dom..6=sáb. Vazio = "sem restrição por este eixo". Controlado: sem estado interno. */
  valor: number[];
  onChange: (dias: number[]) => void;
  /** Texto do `aria-label` do `role="group"`. Obrigatório: o grupo nunca é anônimo. */
  rotulo: string;
  /** Uma linha de 7 em vez de 4+3 no mobile, e iniciais no lugar de "Dom/Seg". */
  compacto?: boolean;
  desabilitado?: boolean;
  /** id do texto que explica/erra o grupo (`aria-describedby`). */
  descritoPor?: string;
};
```

- **Controlado, puro, sem `useState`, sem action dentro.** Quem salva é o consumidor. É isso que
  permite a mesma instância servir rascunho local (`FormVigencia`), escrita otimista por linha
  ([276]) e payload de lote ([277]).
- **`DIAS_DA_SEMANA` de `rascunhoCardapio.ts:81` é a única tabela.** A inicial do modo compacto é
  `dia.rotulo.charAt(0)` — derivação, não segunda tabela ([spec], mandato 2).
- O `aria-label` de cada pílula precisa do **nome completo** ("domingo"). `DIAS_LONGOS` já existe em
  `descreverVigencia.ts:45` mas é `const` privada. **[UX]** expor dali um
  `rotuloLongoDoDia(d: number): string` — nenhuma tabela nova, e o `.tsx` continua sem redigir dia.

### 1.2 Layout

```
compacto={false}  (FormVigencia — comportamento de hoje, byte a byte)
mobile (<sm): grid-cols-4            sm+: grid-cols-7
┌──────┬──────┬──────┬──────┐        ┌────┬────┬────┬────┬────┬────┬────┐
│ Dom  │ Seg  │ Ter  │ Qua  │        │Dom │Seg │Ter │Qua │Qui │Sex │Sáb │
├──────┼──────┼──────┼──────┤        └────┴────┴────┴────┴────┴────┴────┘
│ Qui  │ Sex  │ Sáb  │      │
└──────┴──────┴──────┴──────┘

compacto={true}   (linha do vínculo e diálogo de lote)
┌───┬───┬───┬───┬───┬───┬───┐   D S T Q Q S S  ← visível
│ D │ S │ T │ Q │ Q │ S │ S │   aria-label: "domingo", "segunda-feira", …
└───┴───┴───┴───┴───┴───┴───┘   aria-pressed: false/true
```

Classes (herdadas do bloco atual, sem invenção):

| Parte | Classe |
|---|---|
| grupo | `role="group"` + `aria-label={rotulo}` + `grid gap-1` (`grid-cols-4 sm:grid-cols-7`, ou `grid-cols-7` no compacto) |
| pílula | `min-h-[44px] min-w-[44px] rounded-lg border text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50` |
| marcada | `border-primary bg-primary text-primary-foreground` |
| desmarcada | `bg-background hover:bg-muted` |
| desabilitado | `disabled:opacity-60 disabled:pointer-events-none` (**não** esconde: o lojista precisa continuar lendo a agenda enquanto salva) |

**Contraste:** `primary` × `primary-foreground` é o par do shadcn (oklch 0.205 × 0.985 ≈ 16:1) e o
painel **não usa o tema da loja** — nenhum risco de `primaria` clara sobre fundo branco aqui (§4 do
design-system só vale na vitrine). A pílula desmarcada é `foreground` sobre `background` (≈ 15:1).

**Estado marcado não depende só de cor:** `aria-pressed` para leitor de tela [spec §5] e, **[UX]**,
`font-semibold` + borda `border-primary` (peso + borda + fundo = três sinais).

### 1.3 Teclado (obrigatório, [UX] no detalhe)

O bloco de hoje é um grid de 7 botões independentes — cada um é uma parada de Tab. Com 7 pílulas ×
N produtos na linha do vínculo, isso vira uma armadilha de teclado prática ([276]).

**Padrão adotado: roving tabindex** (o mesmo de `ModoReordenar`, que já é testável sem jsdom):

| Tecla | Efeito |
|---|---|
| `Tab` | entra no grupo **uma vez** (só a pílula ativa tem `tabIndex={0}`; as outras `-1`) e sai dele |
| `←` / `→` | move o foco entre as 7, com wrap |
| `Home` / `End` | primeira / última |
| `Espaço` / `Enter` | alterna a pílula focada (`onChange`) |

**[UX]** o movimento de seta **não** marca (`selection-follows-focus` desligado): com escrita
otimista por linha ([276]), navegar com seta gravando seria 7 escritas sem intenção.

### 1.4 Estados

| Estado | O que a tela mostra |
|---|---|
| vazio (`valor: []`) | nenhuma pílula marcada + a frase do consumidor (§2 e §3: "Nenhum dia marcado = todos os dias" / "Todos os dias do cardápio") |
| parcial | as marcadas em `primary` |
| 7 marcados | 7 em `primary`; a **prévia** (não o componente) lê "Aparece todos os dias" — RN-07, vinda de `descreverVigencia` [spec] |
| `desabilitado` | opacidade, `pointer-events-none`, `aria-busy` no container do consumidor |

O componente **não** tem estado de erro próprio: erro é toast do consumidor (`sonner`) + reversão.

---

## 2. `FormVigencia` — "Todos os dias" ([275])

Troca do bloco inline por `<PilulasDeDias compacto={false} …>`; **zero mudança de comportamento**
[spec]. O que entra é o atalho.

```
┌─ Dias da semana ──────────────────────── opcional ─┐
│ ┌──────┬──────┬──────┬──────┐                      │
│ │ Dom  │ Seg  │ Ter  │ Qua  │   (4 cols no mobile) │
│ ├──────┼──────┼──────┼──────┤                      │
│ │ Qui  │ Sex  │ Sáb  │      │                      │
│ └──────┴──────┴──────┴──────┘                      │
│ [ Todos os dias ]  [ Limpar ]        ← linha nova   │
│ Nenhum dia marcado = todos os dias.                 │
└─────────────────────────────────────────────────────┘
```

- **Posição:** *abaixo* das pílulas, *acima* da nota. Acima delas o atalho disputaria a primeira
  leitura com os dias; abaixo ele lê como "ou faça isto de uma vez". **[UX]**
- **`Button variant="outline" size="sm" className="min-h-[44px]"`** — o mesmo par visual dos botões
  "Selecionar os N" / "Limpar" de `SeletorProdutosDoCardapio`. Não é CTA: o CTA da rota continua
  sendo "Salvar cardápio", e um `variant="default"` aqui competiria com ele.
- **"Limpar"** (`variant="ghost"`) é o par reversível do atalho. **[UX]** — a issue pede só "Todos
  os dias"; sem o par, desfazer custa 7 cliques. Limpar deixa o eixo vazio, e o erro de
  `cardapios_recorrente_tem_eixo` já é redigido pelo zod no submit (nada novo).
- **Alternância, não toggle:** com os 7 marcados o botão continua "Todos os dias" e fica
  `aria-pressed={true}` + `disabled` — **[UX]** não vira "Nenhum dia", que confundiria o gesto de
  limpar.
- Prévia: `PreviewVigencia` já consome `fraseDoRascunho`; com 7 marcados ela passa a ler
  **"Aparece todos os dias"** sem nenhuma mudança de componente (RN-07, função pura) [spec].

---

## 3. Linha do vínculo no detalhe do cardápio ([276])

Superfície: `SeletorProdutosDoCardapio.tsx` (lojista) e a mesma instância no `CardapioAdminClient`.

### 3.1 Anatomia da linha

```
┌ Pratos executivos ───────── [Selecionar os 4] [Limpar] [Adicionar a categoria inteira] ┐
│ ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│ │ [✓] Feijoada da casa        (Exclusivo de cardápio) (Neste cardápio)              │  │
│ │     Aparece: qua e sáb                          ← frase do SERVIDOR               │  │
│ │     ┌───┬───┬───┬───┬───┬───┬───┐                                                 │  │
│ │     │ D │ S │ T │[Q]│ Q │ S │[S]│               ← PilulasDeDias compacto          │  │
│ │     └───┴───┴───┴───┴───┴───┴───┘                                                 │  │
│ └──────────────────────────────────────────────────────────────────────────────────┘  │
│ │ [ ] Virado à paulista                            (Neste cardápio)                 │  │
│ │     Todos os dias do cardápio                   ← estado VAZIO                    │  │
│ │     ┌───┬───┬───┬───┬───┬───┬───┐                                                 │  │
│ │     │ D │ S │ T │ Q │ Q │ S │ S │                                                 │  │
│ │     └───┴───┴───┴───┴───┴───┴───┘                                                 │  │
│ │ [ ] Dobradinha                                   ← NÃO vinculado: sem pílulas      │  │
│ └──────────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Pílulas em segunda linha, nunca na mesma linha do nome.** A linha já carrega checkbox de 44px +
  nome + até dois badges; 7 alvos a mais estouram 360px. Regra registrada em design-system §5:
  *comprimir, não estourar*. **[UX]**
- **Produto não vinculado não mostra pílulas nem frase** [spec]. Sem placeholder, sem pílulas
  desabilitadas: agenda é do vínculo.
- **Hierarquia:** nome (`text-sm font-medium`) > frase de agenda (`text-xs text-texto-muted`) >
  pílulas. A pílula marcada é o único elemento em `primary` na linha — é ela que o olho acha.
- `aria-label` do grupo: **`Dias em que Feijoada da casa aparece neste cardápio`** — inclui o nome do
  produto, porque a mesma tela tem N grupos idênticos. **[UX]**

### 3.2 Estados da linha

| Estado | Visual | Acessibilidade |
|---|---|---|
| **vazio** (dias `null`/`[]`) | nenhuma pílula marcada + `Todos os dias do cardápio` em `text-xs text-texto-muted` | a frase é o texto do `aria-describedby` do grupo |
| **com dias** | pílulas marcadas + `Aparece: qua e sáb` (`descreverVigencia`, servidor) | idem |
| **salvando** | pílulas já no estado novo (otimista) + `aria-busy="true"` no `<li>` + o grupo `desabilitado` enquanto a escrita está em voo | região `aria-live="polite"` da linha anuncia `Salvando…` |
| **sucesso** | grupo reabilita; `router.refresh()` recalcula a frase e o aviso no servidor | `aria-live` anuncia `Dias salvos.` **[UX]** — sem toast de sucesso (ver abaixo) |
| **erro** | pílulas **voltam ao estado anterior** + `toast.error(resultado.erro)` = `MSG_DIAS_DO_VINCULO` ("Não foi possível salvar os dias deste item.") | o foco **fica** na pílula clicada; nada é movido |
| **nunca abre (RN-06)** | faixa âmbar abaixo das pílulas (§3.3) | `role="status"` |

**Sem toast de sucesso, [UX].** Marcar 3 dias = 3 escritas = 3 toasts empilhados sobre a barra de
seleção fixa do mobile. Toast fica **só** para o erro, que é raro e precisa de atenção. O sucesso é
anunciado pela `aria-live` da própria linha e é visível na pílula.

**Por que o grupo desabilita durante a escrita ([UX], diverge do "reversível com o mesmo clique" na
letra):** dois cliques rápidos na mesma linha produziriam duas escritas concorrentes do array
inteiro, e o vencedor é o último a chegar no servidor — não necessariamente o último clicado. A
janela é de ~200 ms, o estado otimista continua visível e nada pisca. Alternativa se o dono recusar:
fila por linha (serializa, mantém clicável) — mais código, mesmo resultado visível.

### 3.3 Aviso de RN-06 — agenda que nunca abre

```
│     ┌───┬───┬───┬───┬───┬───┬───┐
│     │ D │ S │ T │[Q]│ Q │ S │ S │
│     └───┴───┴───┴───┴───┴───┴───┘
│     ┌────────────────────────────────────────────────────────────────┐
│     │ Este item nunca aparece: o cardápio só abre aos sábados e       │
│     │ domingos.                                                       │
│     └────────────────────────────────────────────────────────────────┘
```

- **Âmbar, nunca vermelho nem `destructive`:** requer ação, não é falha — o mesmo argumento já
  registrado no aviso RN-12 de `ProdutosClient` e no aviso de produto órfão de `FormProduto.tsx:715`.
  **Classes idênticas às de lá**, sem token novo:
  `rounded-lg border border-amber-300 bg-amber-100 p-3 text-xs text-amber-900`.
  Contraste `amber-900` (#78350f) × `amber-100` (#fef3c7) ≈ 8,9:1 — AA e AAA para texto normal.
- **Não bloqueia nada** [spec]: sem `disabled`, sem `aria-invalid`, sem foco roubado.
- `role="status"` (polite), não `alert`: o lojista acabou de causar o estado, não precisa ser
  interrompido.
- **Frase vem de função pura no servidor** [spec] — o `.tsx` recebe `string | null` e só decide
  renderizar. **[⚠]** o aviso é SSR: depois de um clique otimista ele fica um render atrás até o
  `router.refresh()` voltar. Aceitável porque **nada depende dele** (RN-06), mas é um estado
  observável — registrado em §8.
- **Sem ação de conserto na faixa.** O consertável é a vigência do cardápio, que está **na mesma
  rota, acima** — um link "Ajustar o cardápio" seria uma âncora para 400px acima. **[UX]**

---

## 4. "Definir dias" na ação em lote ([277])

Fluxo, sem inventar um segundo caminho de escrita nem uma segunda confirmação:

```
barra de seleção (já existe)                     diálogo de alcance (já existe)
┌──────────────────────────────────────┐         ┌──────────────────────────────────────┐
│ 12 produtos selecionados             │  prevê  │ Definir os dias em 12 produtos?       │
│ [Adicionar ao cardápio] [Tirar do…]  │ ──────► │ Feijoada, Virado, Dobradinha          │
│ [Definir dias]  ← botão novo         │         │ e mais 9.                             │
│ [Limpar]                             │         │                                       │
└──────────────────────────────────────┘         │ Em que dias estes itens aparecem?     │
                                                 │ ┌───┬───┬───┬───┬───┬───┬───┐         │
                                                 │ │ D │ S │ T │[Q]│ Q │ S │[S]│         │
                                                 │ └───┴───┴───┴───┴───┴───┴───┘         │
                                                 │ Nenhum dia marcado = todos os dias    │
                                                 │ do cardápio.                          │
                                                 │ Especiais do Dia · aparece todos os   │
                                                 │ dias            ← descricao existente │
                                                 │        [Cancelar] [Definir os dias    │
                                                 │                    em 12 produtos]    │
                                                 └──────────────────────────────────────┘
```

- **A prévia continua sendo de alcance, não de dias.** `preverLoteAction` roda no clique do botão da
  barra, como nas outras ações; as pílulas são **payload**, escolhido dentro do diálogo já aberto, e
  não mudam a contagem [spec: "não mudar a contagem da prévia"].
- **O número vai dentro do rótulo do botão** [spec]: `Definir os dias em 12 produtos`. Com o grupo
  vazio o rótulo vira `Voltar 12 produtos para todos os dias` **[UX]** — a redação, como todas as
  outras, mora em `copiaLotePromocao.ts` (`perguntaLote` ganha a variante `"dias"`), **nunca** no
  `.tsx`; `DialogoLoteCardapio` hoje não escreve nenhuma frase e continua assim.
- `AlertDialog` (não `Dialog`): o gesto muda o que a vitrine mostra para todos os clientes — o mesmo
  critério já aplicado às outras ações de lote.
- **Foco:** o `AlertDialog` do shadcn/Base UI já prende foco e fecha no ESC. Com as pílulas dentro, o
  foco inicial deve ir para **a primeira pílula**, não para "Cancelar" **[UX]**: é o campo que o
  lojista veio preencher. As setas ←/→ do roving tabindex não conflitam com o diálogo (ele não usa
  setas).
- `desabilitado={pendente}` no grupo enquanto a escrita está em voo; os dois botões do rodapé já
  desabilitam hoje.
- **Erro:** `toast.error` com a frase da action, diálogo permanece aberto com os dias preservados —
  padrão atual de `useLoteDeProdutos`. **Sucesso:** um toast só, `Dias atualizados.`, e
  `onConcluido()` limpa a seleção e dá refresh (padrão atual).
- **[⚠]** "Definir dias" só alcança pares **já vinculados** a este cardápio (`count === 0` por par
  não vinculado). A prévia existente conta produtos selecionados, não vínculos — o número do botão
  pode prometer mais do que a escrita alcança. Ver §8.

---

## 5. Leitura nos produtos do painel ([278])

Somente leitura nas duas superfícies; a agenda é editada onde vive.

**`FormProduto.tsx:744` — a linha "Está em:"**

```
Está em: Especiais do Dia (qua e sáb), Cardápio de Inverno.
```

- Mantém `text-xs text-muted-foreground` e a construção `join(", ")`; muda só o item, que passa a ser
  `nome` + ` (dias)` quando `dias != null`. Vínculo sem dias → **nada** é anexado [spec] — nunca
  "(todos os dias)", que seria ruído em toda loja que não usa a feature. **[UX]**
- Sem controle, sem link por cardápio: a linha já é um resumo, e o gesto de editar tem casa própria.

**`ProdutosClient.tsx` — o chip de cardápio**

```
Feijoada da casa
R$ 42,00  (Disponível)  (Exclusivo de cardápio)
┌───────────────────────────────┐ ┌──────────────────────┐
│ Especiais do Dia · qua e sáb  │ │ Cardápio de Inverno  │
└───────────────────────────────┘ └──────────────────────┘
            ↑ fora da janela agora entra como 3º trecho quando for o caso
```

- `Badge variant="outline" className="font-normal"` — **o chip que já existe**, com um trecho a mais
  separado por `·`, exatamente como o sufixo `· fora da janela agora` já faz hoje.
- **Ordem dos trechos:** `nome · dias · fora da janela agora`. Dias antes do estado porque o estado é
  consequência. **[UX]**
- **360px:** o chip pode ficar com três trechos. A `ul` já é `flex-wrap`; **[UX]** acrescentar
  `whitespace-normal` ao `Badge` para quebrar em duas linhas em vez de esticar a linha do produto.
  Dias curtos (`qua e sáb`, vindos de `DIAS_CURTOS` + `enumerar`) mantêm o trecho curto por
  construção.
- Cor: nenhuma. O chip é `outline`/neutro — agenda não é status, e colorir aqui competiria com os
  badges de disponibilidade e de promoção.

---

## 6. Vitrine ([279]) — nada de novo, e é esse o ponto

**Nenhum componente de vitrine é tocado** [spec]. O desenho aqui é só a confirmação de que o
resultado visual continua correto e acessível:

```
quarta-feira                                  domingo (nenhum item do dia)
┌─ Especiais do Dia ───────────────┐          (a seção não existe — nem o título,
│ [Feijoada da casa]  R$ 42,00 [+] │           nem a pílula no trilho de categorias)
└──────────────────────────────────┘
┌─ Pratos executivos ──────────────┐          ┌─ Pratos executivos ───────────────┐
│ [Feijoada]     R$ 42,00      [+] │          │ [Feijoada]  ⨯ Só às quartas e     │
│ [Virado]  ⨯ Só às segundas       │          │             sábados               │
│ [Dobradinha] ⨯ Só às terças      │          │ [Virado]    ⨯ Só às segundas      │
└──────────────────────────────────┘          └───────────────────────────────────┘
```

- A seção some pelo `.filter(secao => secao.produtos.length > 0)` que já existe — **nenhuma linha
  nova de filtro** [spec], e o trilho `NavCategorias` deixa de ganhar uma pílula que não leva a
  lugar nenhum.
- O item fora do dia continua na categoria, `disabled`, com o selo já existente lendo os dias do
  **item** (RN-08) [spec, decisão (a)]. Nenhum estilo novo, nenhum motivo novo em
  `MotivoNaoCompravel`.
- **Contraste do selo × tema da loja:** o selo de indisponível usa `--indisponivel-fundo/texto`
  (#fff × #111 ≈ 18,9:1), fixos e **fora** do tema — continua AA em qualquer loja. Nada neste loop
  encosta em `primaria`/`fundo`/`destaque`.
- **Não depende só de cor:** o card marcado combina texto do selo + `disabled` + `aria-label` — já é
  o comportamento de hoje.
- **[⚠]** Efeito colateral a observar: numa loja cujo catálogo é quase todo de destaque, um dia sem
  itens pode derrubar o número de seções abaixo de `MINIMO_CATEGORIAS = 3` e esconder o trilho de
  navegação. É o comportamento correto do trilho (não há o que navegar), mas é uma mudança visível
  dia a dia — registrado, não "consertado".

---

## 7. Acessibilidade — checklist fechado

| Item | Onde | Situação |
|---|---|---|
| Alvo ≥ 44×44px literal | todas as pílulas, botões novos | `min-h-[44px] min-w-[44px]` — **exceto** o eixo X do modo compacto em < 360px, §8-A |
| Contraste ≥ 4,5:1 | pílula marcada (≈16:1), pílula normal (≈15:1), aviso âmbar (≈8,9:1), chip outline (herdado) | OK |
| Foco visível | `focus-visible:ring-3 focus-visible:ring-ring/50` em toda pílula (classe já usada) | OK |
| Estado sem depender de cor | `aria-pressed` + peso + borda | OK |
| Grupo rotulado | `role="group"` + `aria-label` com o nome do produto | OK |
| Nome completo do dia | `aria-label` por pílula via `rotuloLongoDoDia` | depende de expor a função (§1.1) |
| Teclado | roving tabindex, ←/→/Home/End/Espaço/Enter | §1.3 |
| Modal | `AlertDialog` do shadcn: `role="dialog"`, foco preso, ESC | reuso, nada recriado |
| Anúncio de mudança assíncrona | `aria-live="polite"` por linha ("Salvando…" / "Dias salvos.") | §3.2 |
| Erro | toast `sonner` + reversão do estado + foco preservado | §3.2 |
| Empty state | "Todos os dias do cardápio" na linha; nenhuma tela em branco | §3.2 |
| 360px | pílulas em segunda linha; chip com `whitespace-normal`; diálogo com 7 pílulas em uma linha | §8-A |

---

## 8. Divergências e decisões que precisam de OK

**A — 44px literal nas 7 pílulas em uma linha (contra a letra de [275]).**
A issue exige `min-h-[44px] min-w-[44px]` **literal**. Em 360px, sete alvos de 44px + 6 gaps não
cabem dentro de um `<li>` que já tem padding de card. O `FormVigencia` resolveu isso quebrando em
`grid-cols-4 sm:grid-cols-7` — e é o que o modo **não compacto** continua fazendo. No modo
**compacto** (linha do vínculo, diálogo de lote), o desenho recomendado mantém **altura 44 literal**
e deixa a **largura** cair para `flex-1` com piso `min-w-[40px]` abaixo de `sm`, invocando a regra
registrada em design-system §5 (*comprimir, não estourar*). Alternativa sem cessão: 4+3 também na
linha do vínculo, ao custo de ~96px de altura por produto numa lista de dezenas.
**Precisa de OK do dono** e, se aprovado, de uma linha em `design-system.md` §5 registrando a
exceção — senão vira o precedente não escrito que a próxima tela copia errado.

**B — "Definir dias" em lote pode prometer mais do que alcança ([277]).**
A prévia conta **produtos selecionados**; a escrita alcança **vínculos**. Selecionando 12 produtos
dos quais 4 não estão no cardápio, o botão diz "12" e 4 escritas terminam em `count === 0`.
Mudar a contagem da prévia está **fora do escopo** da 277. Saídas possíveis, em ordem de custo:
(1) o botão "Definir dias" só aparece habilitado quando **toda** a seleção está no cardápio (o
cliente já sabe `noCardapio` por produto, e isso é UI, não autoridade); (2) o corpo do diálogo ganha
a frase "só vale para quem já está neste cardápio" (redação em `copiaLotePromocao.ts`);
(3) prévia por vínculo — fora de escopo. **Recomendo (1) + (2).**

**C — "Limpar" ao lado de "Todos os dias" ([275]).**
A issue pede só o atalho. Sem o par reversível, desfazer custa 7 cliques. **Recomendo incluir.**

**D — Grupo desabilitado durante a escrita ([276]).**
A issue diz "reversível com o mesmo clique". O desenho desabilita o grupo por ~200 ms para evitar
escritas concorrentes do array inteiro. Reversível continua sendo (basta reclicar depois do
retorno), mas não **durante**. **Recomendo manter; alternativa é fila por linha.**

**E — Aviso de RN-06 um render atrasado.**
SSR + escrita otimista ⇒ a faixa âmbar só reflete o clique depois do `router.refresh()`. Nada
depende dela [spec], mas o lojista pode marcar "qua" e levar ~1 s para ver o aviso aparecer.
Alternativa (não recomendada): duplicar a função pura no cliente — seria uma segunda avaliação de
dia no browser, exatamente o que a spec proíbe.

**F — `rotuloLongoDoDia` exportado de `descreverVigencia.ts`.**
Sem ele, o `aria-label` da pílula ou fica com "Dom" (ruim para leitor de tela) ou nasce uma segunda
tabela de dias (proibido, mandato 2). **É uma exportação, não uma tabela nova.**

**G — Redação do lote em `copiaLotePromocao.ts`.**
"Definir os dias em N produtos" e "Voltar N produtos para todos os dias" são **frases novas**. Elas
não são uma "segunda redação de confirmação" (que a spec proíbe) — são a redação da **ação nova**,
no mesmo módulo puro e no mesmo formato das existentes. Registrado aqui para que a revisão não
confunda as duas coisas.

---

**Decisões da sessão (2026-09-21, gate G1 já aprovado com defaults):** A — aceito: abaixo de `sm`
as pílulas cedem só o eixo X (`min-w-[40px]`, altura 44 intacta); registrar a exceção na issue 275.
B — aceito: "Definir dias" habilitado só com a seleção inteira vinculada ao cardápio, com a frase
no corpo do diálogo; a prévia do lote não muda nesta issue.
