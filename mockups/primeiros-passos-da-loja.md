# Mockup — Primeiros passos da loja (issue 368)

Preview: `mockups/primeiros-passos-da-loja.html` (abra no navegador; os quadros têm 360 px e um quadro desktop no fim).
Textos finais: seção `## UX` de `tasks/368-primeiros-passos-da-loja-antes-do-painel.md`. Este arquivo descreve layout, componentes e o porquê.

## Gate de reuso

- shadcn/ui varridos: `button`, `card`, `badge`, `input`, `label`, `separator`, `accordion`, `sheet`, `dialog`, `alert-dialog`
- Componentes vitrine/painel: `CabecalhoPagina`, `AvisoEstadoBloqueado`, `NavPainel` (`BotaoLogout`, cabeçalho com logo), `PerfilClient` (cartão de publicação, seção de endereço), `HorariosClient`, `EntregasClient`, `PagamentosClient`, `ProdutosClient`, `OpcionaisClient`
- Tokens: `.superficie-painel` (`--border: #8a8a8a`, ring do card), `--cor-fundo` (creme), `primary`, `muted-foreground`, `destructive`, `font-heading`; paleta `amber` do Tailwind (já usada em `PerfilClient`)

Decisão: **REUSAR + ADAPTAR**. Nenhum componente shadcn novo, nenhum token novo.
Justificativa: as 6 etapas são as telas do painel como estão (DD5); o que é novo (progresso, navegação, checklist, aviso) é composição de `Card` + `Button` + `Badge`.

## Layout — 360 px

```
┌──────────────────────────────────────┐  ChromeAssistente (header, bg-card, border-b)
│ (L) Lanchonete Exemplo        [Sair] │  logo 32px ou inicial · nome truncado · Sair ≥44px
│     Primeiros passos                 │
├──────────────────────────────────────┤  main.superficie-painel (creme) p-4
│ ┌──────────────────────────────────┐ │  ProgressoAssistente (Card)
│ │ Etapa 2 de 7 · Horários          │ │
│ │ ▰▰▱▱▱▱▱                          │ │  7 segmentos, aria-hidden
│ │ ▸ Ver todas as etapas            │ │  <details>; aberto = lista de 7 links ≥44px
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ (página reusada do painel,       │ │  h1 vem da própria tela (PerfilClient,
│ │  com o próprio h1 e o próprio    │ │  HorariosClient…); a etapa não duplica h1
│ │  botão Salvar)                   │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │  NavegacaoEtapas (Card)
│ │ Salve as alterações antes de     │ │
│ │ seguir.                          │ │
│ │ [ Voltar ]   [ Próximo: Entregas →]│  ghost / outline; nunca primary
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

Lista aberta do progresso (cada linha é `<a>` de 44 px, `aria-current="step"` na atual):

```
 1  Perfil                     [! Falta]
 2  Horários                   ← atual (fundo muted, borda esquerda)
 3  Entregas
 4  Pagamentos                 [! Falta]
 5  Produtos                   [! Falta]
 6  Opcionais        (pode pular)
 7  Revisar e publicar
```

Revisar e publicar:

```
┌──────────────────────────────────┐ Card
│ Revisar e publicar           (h1)│
│ Resolva os 2 itens marcados para │
│ publicar a loja.                 │
├──────────────────────────────────┤ Card (checklist, <ul>)
│ ✓ Nome e WhatsApp        Pronto  │
│ ! Endereço                       │
│   Preencha CEP e número do ...   │
│   [Ir para Perfil]               │
│ ○ Localização no mapa            │
│   Complete o endereço para ...   │  aguardando: sem botão
│ ✓ Forma de pagamento     Pronto  │
│ ! Produto disponível             │
│   Cadastre ao menos um ...       │
│   [Ir para Produtos]             │
├──────────────────────────────────┤ CartaoPublicacao
│ Status da vitrine  [Rascunho]    │
│ <bloqueio D10 da 1ª pendência>   │  id = aria-describedby do botão
│ [      Publicar loja (desab.)  ] │  w-full, primary
└──────────────────────────────────┘
```

Quando falta só o par, a linha "Localização no mapa" carrega `<BotaoLocalizarEndereco>` (outline, w-full, ícone MapPin) e, abaixo dele, a última mensagem de erro do botão em `aria-live="polite"`.

Aviso D15 no painel (topo do `<main>`, antes de `children`, em toda página):

```
┌──────────────────────────────────┐ Card, role="status"
│ ⌖ Complete o endereço da loja    │ ícone MapPin (aria-hidden) + título font-medium
│ Sua loja segue no ar. Preencha…  │ text-muted-foreground
│ [ Completar endereço ]           │ (a) Link com estilo Button outline, ≥44px
└──────────────────────────────────┘
(b) mesmo cartão, título "Localize sua loja no mapa" e <BotaoLocalizarEndereco>.
```

## Desktop (≥ lg)

Grade `lg:grid-cols-[15rem_1fr]` com `gap-6`: progresso vira coluna fixa à esquerda (`lg:sticky lg:top-6`), sempre aberta (o `<details>` só existe abaixo de `lg`), conteúdo em `max-w-2xl`. Chrome segue só header; sem sidebar (D4).

## Componentes e classes

| Peça | Base | Classes-chave |
|---|---|---|
| `ChromeAssistente` | header + `main.superficie-painel` | `h-14 border-b bg-card px-4`; nome `truncate font-heading font-semibold`; `BotaoLogout className="min-h-[44px] w-auto"` |
| `ProgressoAssistente` | `Card` + `<nav aria-label="Etapas da configuração">` + `<ol>` | segmento `h-1.5 rounded-full bg-primary` / `bg-muted`; linha `min-h-[44px] rounded-md px-3 focus-visible:ring-2`; atual `bg-muted font-medium`; selo `Badge variant="outline"` com `border-amber-300 bg-amber-50 text-amber-800` + ícone |
| `NavegacaoEtapas` | `Card` + 2 `Button` | `Voltar` = `variant="ghost"`, `Próximo` = `variant="outline"`, ambos `min-h-[44px]`; em 360 px `grid grid-cols-2 gap-2` |
| Checklist (revisar) | `Card` + `<ul>` + `Separator` | ícone `CheckCircle2` (pronto, `text-foreground`), `CircleAlert` (`text-amber-800`), `Circle` (aguardando, `text-muted-foreground`); link `Button variant="outline" size="sm"` com `min-h-[44px]` |
| `CartaoPublicacao` | `Card` + `Badge` + `Button` | botão `w-full` em 360 px, `sm:w-auto`; texto `text-sm text-muted-foreground` com `id` ligado por `aria-describedby` |
| `BotaoLocalizarEndereco` | `Button variant="outline"` | `min-h-[44px] w-full sm:w-auto`; `Loader2 animate-spin` + `aria-busy` |
| `AvisoEnderecoLoja` | `Card` | `flex gap-3`; nunca `destructive` |

## Notas de UX (decisões que o plano técnico não cobria)

1. **Progresso em 360 px.** Sete rótulos não cabem numa linha. Mobile mostra "Etapa N de 7 · Rótulo" + barra de 7 segmentos e uma lista recolhida ("Ver todas as etapas") com os 7 links; a navegação livre (D6) fica a um toque. A partir de `lg` a lista fica sempre visível na coluna esquerda.
2. **Selo honesto.** `ProgressoAssistente` só recebe `pendentes`. Etapa sem pendência **não** ganha "concluída" nem check: horários, entregas e opcionais nunca têm pendência, e marcar como feito o que o lojista nem abriu seria falso. Só "Falta" (amber, ícone + texto) e "atual".
3. **Hierarquia de botões.** Cada tela reusada já tem o seu `Salvar` primário. "Próximo" é `outline` e "Voltar" é `ghost`, para não competir; o único primário da revisão é "Publicar loja". "Próximo" mostra o nome da etapa seguinte ("Próximo: Entregas").
4. **Próximo não salva.** As telas reusadas salvam pelo próprio botão; a navegação só troca de rota. Texto fixo acima dos botões: "Salve as alterações antes de seguir." Interceptar alteração não salva fica fora de escopo (exigiria mexer nos clients reusados).
5. **Opcionais.** O avanço vira "Pular para revisar" (contém "Pular", como pede D6) e ganha a linha "Adicione opcionais agora ou depois, pelo painel."
6. **Checklist da revisão com 5 linhas fixas**, não só as pendências: o lojista vê o que já está pronto. "Localização no mapa" tem um terceiro estado, "aguardando", quando o endereço está incompleto (o gate só emite `localizacao` com endereço completo); nesse estado não aparece o botão D14.
7. **Publicar fica no fim da revisão**, depois do checklist, com o texto do bloqueio ligado ao botão por `aria-describedby`. O botão desabilitado sai da ordem de tabulação, por isso o texto é sempre visível, nunca só tooltip.
8. **Erro do botão D14 persiste na tela.** Além do `toast.error`, a última mensagem fica abaixo do botão em `aria-live="polite"` até a próxima tentativa: o toast some, e a mensagem diz o que fazer (esperar ou conferir).
9. **Aviso D15 é neutro, não destrutivo.** A loja está no ar; vermelho (`AvisoEstadoBloqueado`) diria "fora do ar". Usa `Card` branco da §10.2 regra 4, ícone `MapPin`, sem cor nova. Não tem botão de fechar (persistente por D15).
10. **Rótulo "Logradouro" vira "Rua"** no perfil, para casar com o rótulo da mensagem D10 ("Preencha CEP e rua…"). Nenhum teste afirma "Logradouro" hoje.
11. **Obrigatório visível.** Os 6 campos ganham `*` (`aria-hidden`) no rótulo e o atributo `required` (que o leitor de tela anuncia); a seção diz "Campos com * são obrigatórios."

## Acessibilidade

- Alvos ≥44×44 px com valor literal (`min-h-[44px]`), por causa da base de 120% (§5).
- Foco: `focus-visible:ring-2 ring-ring ring-offset-2` em todo link/botão; `<summary>` do progresso também.
- Contraste medido sobre branco: `muted-foreground` #737373 = 4,74:1; `amber-800` #92400e sobre `amber-50` #fffbeb = 6,8:1; texto do header #171717 = 17:1. Botão desabilitado é isento, o texto ao lado não.
- Não depende de cor: selo "Falta" tem ícone e texto; checklist diz "Pronto" por extenso.
- `role="status"` no aviso D15 e `aria-live="polite"` na linha de erro do D14 (não interrompem); toast continua para o feedback imediato.
- Erro do form de perfil: validação nativa por `required` antes do `safeParse`; nenhum modal de geocoding para quem não preencheu (D13).
