# Mockup — Entregas por faixa de km (painel do lojista)

**Tela:** `/painel/configuracoes/entregas`
**Arquivos alvo:** `src/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/EntregasClient.tsx`, `src/components/painel/FormZona.tsx`
**Preview:** `mockups/entregas-faixas-km.html`
**Status:** proposta de design, sem issue/spec aberta. Nenhum código de produção alterado.

---

## Gate de reuso

- **shadcn/ui varridos** (`src/components/ui/`): `accordion`, `badge`, `button`, `card`, `checkbox`, `dialog`, `input`, `label`, `menu`, `radio-group`, `separator`, `sheet`, `switch`, `textarea`. **Não existe** `alert`, `table`, `select`, `tabs`, `form`, `tooltip`.
- **Componentes painel/vitrine varridos:** `AvisoEstadoBloqueado` (padrão de aviso já estabelecido no painel), `FormZona`, `EntregasClient`, `TabelaPedidos`, `TabelaFaturas`, `FormCupom`, `GerenciarCategorias`, `LinhaCategoriaReordenavel`, `BadgeStatus`.
- **Tokens** (`src/app/globals.css` `@theme`): `background`, `foreground`, `card`, `muted`, `muted-foreground`, `secondary`, `border`, `input`, `ring`, `primary`, `destructive`, `--radius: 0.625rem`, `html { font-size: 120% }`.
- **Lógica de frete varrida:** `lib/utils/calcularFrete.ts`, `lib/utils/freteDegradado.ts`, `lib/actions/frete.ts`, `lib/actions/distanciaFrete.ts`, `lib/validacoes/entrega.ts` (`schemaZonaCompleta`).

**Decisão: ADAPTAR + CONSOLIDAR.**

**Justificativa:** o aviso reusa o padrão visual de `AvisoEstadoBloqueado` em variante informativa (nenhum `Alert` novo), a lista de faixas reusa `Card` + `Input` + `Switch` + `Button` + `AlertDialog` já em uso na tela, e o seletor de incremento reusa `RadioGroup`; a mudança real é consolidar os três tipos de zona (`bairro`/`faixa_cep`/`raio_km`) numa única construção incremental por raio, eliminando o `<select>` ad-hoc do `FormZona.tsx:162-171` e a `selectClassName` artesanal de `FormZona.tsx:41`.

---

## Achado que precede o design (bloqueante para o `/fluxo`)

`calcularFrete.ts` resolve empate escolhendo **a zona de MENOR taxa entre as que atendem** (`calcularFrete.ts`, passo 2 do docblock). E `zonaAtende` para `raio_km` testa `dist <= raio_max_km` — ou seja, cada zona é um **círculo a partir do 0**, não um anel.

Consequência: um cliente a 0,5 km casa com **todas** as faixas cadastradas (1 km, 2 km, 3 km…), e vence a mais barata. Isso funciona **desde que o preço seja não-decrescente** com a distância — que é o caso natural. Mas se o lojista digitar 3 km = R$ 4,00 com 1 km = R$ 6,00, o cliente de 0,5 km paga R$ 4,00.

**Portanto o design não precisa mexer em `calcularFrete`** (nada de anel `raio_min`), mas a UI **precisa** avisar quando o lojista quebra a monotonia de preço. Está no mockup como aviso inline âmbar na linha ofensora + resumo no rodapé do card. Alternativa (mais cara): validar no `schemaZonaCompleta` e recusar o salvamento — decidir no `/fluxo`.

---

## Layout

### Estado vazio (loja nova)

```
┌───────────────────────────────────────────────────────────┐
│  Zonas de entrega                                          │
├───────────────────────────────────────────────────────────┤
│ ⓘ  Cobre sua área por distância, não por CEP ou bairro     │
│    Faixa de km não exige cadastro item a item: você        │
│    define até onde entrega e o preço de cada faixa.        │
│    Por CEP ou por bairro, cada CEP e cada bairro           │
│    precisa ser cadastrado um por um.                       │
├───────────────────────────────────────────────────────────┤
│ ┌ Faixas de distância ───────────────────────────────────┐ │
│ │ Tamanho da faixa                                        │ │
│ │  ( • ) 1 em 1 km     (   ) 2 em 2 km                    │ │
│ │  Dá para trocar depois; as faixas são recalculadas.     │ │
│ │ ─────────────────────────────────────────────────────── │ │
│ │                                                          │ │
│ │            Nenhuma faixa cadastrada ainda.               │ │
│ │       Comece pela mais perto da loja e vá somando        │ │
│ │       até onde você entrega.                             │ │
│ │                                                          │ │
│ │            [ + Adicionar faixa 0–1 km ]                  │ │
│ │                                                          │ │
│ │ ─────────────────────────────────────────────────────── │ │
│ │ Sem faixa cadastrada, a vitrine mostra "entrega          │ │
│ │ indisponível" — só retirada.                             │ │
│ └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

### Estado preenchido — desktop (≥ 768px)

```
┌ Faixas de distância ─────────────────────────────────────────────────────┐
│ Tamanho da faixa   ( • ) 1 em 1 km   (   ) 2 em 2 km                      │
│ ─────────────────────────────────────────────────────────────────────────│
│  Faixa        Preço do frete     Frete grátis a partir de       Ativa     │
│ ─────────────────────────────────────────────────────────────────────────│
│  0–1 km       R$ [  4,00 ]       (○) desligado                  (  ●)  🗑 │
│  1–2 km       R$ [  6,00 ]       (●) R$ [ 60,00 ]               (  ●)  🗑 │
│  2–3 km       R$ [  8,00 ]       (●) R$ [ 80,00 ]               (  ●)  🗑 │
│  3–4 km       R$ [ 12,00 ]       (○) desligado                  (○  )  🗑 │
│ ─────────────────────────────────────────────────────────────────────────│
│  [ + Adicionar faixa 4–5 km ]                                             │
│ ─────────────────────────────────────────────────────────────────────────│
│  Você entrega até 3 km. Acima disso, a vitrine mostra                     │
│  "fora da área de entrega".                        [ Salvar faixas ]      │
└───────────────────────────────────────────────────────────────────────────┘
```

O texto do rodapé é **derivado**: maior borda superior entre as faixas **ativas** (3 km, porque a de 3–4 km está desativada).

### Estado preenchido — mobile (360px): uma faixa = um card

```
┌──────────────────────────────┐
│ 0–1 km            (  ●)   🗑 │
│ Preço do frete               │
│ R$ [ 4,00                  ] │
│ Frete grátis (○) desligado   │
└──────────────────────────────┘
┌──────────────────────────────┐
│ 1–2 km            (  ●)   🗑 │
│ Preço do frete               │
│ R$ [ 6,00                  ] │
│ Frete grátis (●) a partir de │
│ R$ [ 60,00                 ] │
└──────────────────────────────┘
   [ + Adicionar faixa 2–3 km ]
```

Nunca scroll horizontal — cumpre design-system §9 ("painel mobile: tabela vira lista de cards").

### Aviso de preço fora de ordem (inline, na linha)

```
│  2–3 km       R$ [  5,00 ]  ⚠ Mais barato que a faixa de 1–2 km (R$ 6,00). │
│               Quem está a 1,5 km vai pagar R$ 5,00.                        │
```

---

## Componentes

| Elemento | Origem | Classe / token |
|---|---|---|
| Banner "cobre por distância" | **ADAPTAR** `AvisoEstadoBloqueado.tsx:26-28` para variante informativa | `role="note"` + `flex items-start gap-3 rounded-lg border border-border bg-muted/60 p-4 text-sm`, ícone `Info` (lucide) `aria-hidden` |
| Card das faixas | `ui/card` (`Card`, `CardContent`) | já usado em `EntregasClient.tsx:127` |
| Seletor 1km / 2km | `ui/radio-group` (`RadioGroup`, `RadioGroupItem`) + `ui/label` | dois `<label>` clicáveis, `min-h-[44px]` literal |
| Preço da faixa | `ui/input` + `ui/label` | `inputMode="decimal"`, prefixo "R$" fora do input |
| Frete grátis | `ui/switch` + `ui/input` condicional | mesmo par `taxa`/`pedido_minimo_gratis` de `FormZona.tsx:174-195` |
| Faixa ativa | `ui/switch` | mesmo padrão de `EntregasClient.tsx:156-161` |
| Remover faixa | `ui/button` `variant="ghost"` + `Trash2` | `aria-label="Remover faixa 3–4 km"`, alvo `min-h-[44px] min-w-[44px]` |
| Confirmar remoção | `AlertDialog` (Base UI) | reusa o bloco de `EntregasClient.tsx:219-253` |
| Adicionar faixa | `ui/button` `variant="outline"` + `Plus` | rótulo diz a faixa que será criada |
| Salvar | `ui/button` default + `Loader2` | padrão de submit de `FormZona.tsx:270-273` |
| Aviso de preço fora de ordem | mesmo padrão de aviso, variante âmbar | `role="status"` + ícone `AlertTriangle` + texto (nunca só cor) |

**Componente novo proposto:** `src/components/painel/FaixasEntregaKm.tsx` — substitui o uso de `FormZona` nesta tela. `FormZona` permanece apenas se ainda for necessário para admin/legado; como confirmado que nenhuma loja usa CEP/bairro, o caminho limpo é o `FaixasEntregaKm` assumir a tela inteira.

### Anatomia proposta

```
FaixasEntregaKm
├── AvisoDistancia            (role="note")
├── Card
│   ├── SeletorIncremento     (RadioGroup: 1 | 2)
│   ├── ListaFaixas
│   │   └── LinhaFaixa[]      (rótulo derivado, preço, frete grátis, ativa, remover)
│   ├── BotaoAdicionarFaixa   (rótulo derivado da próxima borda)
│   └── RodapeLimite          (limite derivado + Salvar)
└── AlertDialog remoção
```

### Props

| Prop | Tipo | Papel |
|---|---|---|
| `faixasIniciais` | `FaixaKm[]` | vem do server, derivada de `zonas_entrega` + `taxas_entrega` |
| `incrementoInicial` | `1 \| 2` | derivado do espaçamento das zonas existentes; default `1` |
| `acoes` | `{ salvarFaixas }` | **obrigatória, sem default** — mesma convenção da issue 160 (`EntregasClient.tsx:36-43`) |

`FaixaKm = { id?: string; ateKm: number; preco: number; gratisAcima: number | null; ativo: boolean }`. O `ateKm` é a borda superior e vira `taxas_entrega.raio_max_km`; a borda inferior é só rótulo de UI (derivada da faixa anterior), não vai para o banco — por isso `calcularFrete` não muda.

---

## Notas UX

1. **Faixas são contíguas por construção.** O lojista não digita "de/até": ele só adiciona a próxima. Isso elimina buraco entre faixas e sobreposição inconsistente — a classe de erro mais provável no cadastro manual.
2. **Remover só a última faixa é livre.** Remover uma do meio reconstrói os rótulos das seguintes; o `AlertDialog` precisa dizer isso ("as faixas seguintes serão renumeradas"), não só "não pode ser desfeita".
3. **Trocar 1 km → 2 km com faixas já criadas** é destrutivo: 4 faixas de 1 km viram 2 de 2 km e preços precisam ser remapeados. No mockup, a troca com faixas existentes pede confirmação e propõe manter o preço da faixa superior de cada par. Decidir a regra exata no `/fluxo`.
4. **Não existe raio máximo do sistema.** O limite é a borda superior da maior faixa ativa, exibido em texto no rodapé — o lojista lê o efeito da configuração dele sem precisar somar de cabeça.
5. **Desativar faixa ≠ remover.** Desativar a 3–4 km encolhe o limite para 3 km, e o rodapé reflete na hora.
6. **Margem de geocoding continua verdadeira.** A ajuda de `FormZona.tsx:208-212` (CEP cai no centro do bairro; para atender 5 km reais, configure 7–8) migra para o rodapé do card — o conselho vale para o conjunto de faixas, não para uma faixa isolada.
7. **Preço não-decrescente é conselho, não bloqueio,** enquanto `calcularFrete` escolher a menor taxa. Ver "Achado que precede o design".
8. **Salvamento em lote.** Editar 5 preços não deve disparar 5 Server Actions. Uma action `salvarFaixas(faixas[])` escopada por `loja_id`, transacional, revalidando `schemaZonaCompleta` por faixa.

## Acessibilidade (WCAG 2.1 AA)

- Alvo de toque **44px literal** (`min-h-[44px] min-w-[44px]`) em switches, lixeira e opções do radio. Atenção: `size="icon-sm"` do shadcn dá 33,6px com a base de 120% — **proibido aqui** (design-system §5). Hoje `EntregasClient.tsx:164` e `:172` usam `icon-sm` — a refatoração corrige.
- Cada input tem `<label>` real com `htmlFor` único por faixa (`faixa-3-preco`), nunca placeholder como rótulo.
- O switch de frete grátis controla um input; usa `aria-controls` + o input some do fluxo de foco quando desligado.
- Preço inválido: `aria-invalid="true"` + `aria-describedby` apontando a mensagem da linha.
- O rodapé do limite é `aria-live="polite"`: mudar uma faixa anuncia o novo limite.
- Aviso de preço fora de ordem: ícone + texto, nunca só o âmbar.
- Remoção via `AlertDialog` (foco preso, ESC fecha) — já garantido pelo Base UI.
- Contraste: painel usa só tokens de sistema (`foreground` #252525 sobre `background` #ffffff ≈ 15:1). O tema da loja **não se aplica ao painel**.

## Fora de escopo deste mockup

Migração dos dados de `bairro`/`faixa_cep` (confirmado: nenhuma loja em produção usa), mudança em `calcularFrete`/`freteDegradado`/`distanciaFrete`, e a tela de coordenadas da loja (pré-requisito de `raio_km`, ver `lojaTemRaioSemCoords`).
