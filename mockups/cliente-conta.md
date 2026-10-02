# Conta do cliente — telas do Marco B (P10)

Fonte de verdade: `specs/cliente-identidade.md` (seções "Páginas e Rotas" a "Endereços").
Preview: `mockups/cliente-conta.html` (abra no navegador; seletor de tela no topo).
Mundo: **cliente**, neutro iRango (tokens `--cor-primaria`/`--cor-fundo`/`--texto` de `globals.css`, **sem tema de loja**, decisão 21).

Convenção de copy: texto entre aspas com marca **[spec]** é literal do spec. Texto marcado **[proposta]** é
título/rótulo de apoio que o spec não fixa — precisa de OK (ver "Dúvidas").

---

## Gate de reuso

- **shadcn/ui varridos (`src/components/ui/`):** `card`, `input`, `label`, `button`, `separator`, `alert-dialog`,
  `checkbox`, `switch`, `badge`, `toggle-group`, `dialog`, `sheet`, `menu`, `radio-group`, `textarea`.
- **Componentes do projeto:** `src/app/(auth)/layout.tsx` (moldura neutra: `bg-fundo`, `max-w-sm`, marca no topo),
  `src/app/(auth)/login/LoginForm.tsx` (Card + alerta `role="alert"` + olho da senha + `Loader2` + separador "ou"),
  `src/app/(auth)/cadastro/CadastroForm.tsx`, `src/app/(auth)/BotaoGoogle.tsx` (botão branco, logo SVG, `min-h-11`),
  `src/components/vitrine/FormEndereco.tsx` (CEP com `react-imask` + ViaCEP, rua, bairro/cidade, número/complemento).
- **Tokens:** `--color-primaria`, `--color-fundo`, `--color-texto`, `--color-texto-muted`, `--destructive`,
  `--border`, `--radius` (0.625rem), `ring`.
- **Telas varridas:** `/login`, `/cadastro` (porta lojista) — mesmo padrão de card centralizado; nada a consolidar.

**Decisão: REUSAR + ADAPTAR.**
**Justificativa:** toda tela é composição de Card/Input/Label/Button/AlertDialog/Checkbox/Badge + `BotaoGoogle` e
`FormEndereco` existentes; zero cor nova, zero primitivo novo. Únicas adaptações: `BotaoGoogle` ganha `contexto`/`next`
(já previsto no spec) e talvez prop de rótulo (Dúvida 1); layout `(cliente)` copia o de `(auth)` com o link de volta.

---

## Moldura comum `(cliente)/layout.tsx`

```
┌────────────────────────────── 360px ─┐
│ ← Voltar para Padaria Pão Quente      │  LinkVoltarLoja (só /conta/*, só se next=/loja/<slug> válido)
│                                        │
│              iRango                    │  marca, text-primaria, centralizada
│ ┌────────────────────────────────────┐ │
│ │  Card (max-w-sm)                   │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘  bg-fundo, px-4 py-8
```
- `LinkVoltarLoja`: link de texto com ícone `ArrowLeft` (`aria-hidden`), `min-h-11`, `focus-visible:ring-2`.
  Sem loja de origem → não renderiza nada (sem espaço reservado).

## 1. `/conta/entrar`

```
┌────────────────────────────────────┐
│        Entrar na sua conta         │ [proposta]
│ [alerta erro, se houver]           │ role="alert"
│ ┌────────────────────────────────┐ │
│ │ G  Continuar com Google        │ │ BotaoGoogle — PRIMEIRO, topo do card
│ └────────────────────────────────┘ │
│ ───────── ou entre com e-mail ──── │ Separator + texto [proposta]
│ E-mail   [____________________]    │
│ Senha    [________________] (olho) │
│                Esqueci minha senha │ [spec] link → /conta/recuperar?next=
│ ┌────────────────────────────────┐ │
│ │            Entrar              │ │ Button variant="outline" (ver hierarquia)
│ └────────────────────────────────┘ │
│   Não tem conta? Criar conta       │ [spec] link → /conta/cadastro?next=
└────────────────────────────────────┘
```
Hierarquia (decisão 13): Google no topo, **maior peso visual** (ocupa a 1ª dobra, borda + sombra, `min-h-12`);
o submit do e-mail fica abaixo do separador como `outline`. Ordem DOM = ordem visual (Google primeiro no Tab).
Sem modal nesta tela **[spec]**.

Estados de erro (alerta acima do botão Google, padrão `LoginForm`):
- `?erro=google` → mensagem do `LoginForm` atual ("Não foi possível entrar com o Google. Verifique sua conexão e tente novamente.") — Dúvida 3.
- credencial inválida → "E-mail ou senha incorretos." **[spec]**
- e-mail não confirmado → "Confirme seu e-mail para entrar. Enviamos um link para você." **[spec]**
- `?erro=sessao` → Dúvida 3.
Loading: "Entrando…" com `Loader2`, botão `disabled`.

## 2. `/conta/cadastro` + modal

```
│          Criar sua conta           │ [proposta]
│ G  Continuar com Google            │ PRIMEIRO
│ ─────── ou cadastre-se com e-mail ─│
│ E-mail [____]                      │
│ Senha  [____] (olho)               │ ajuda: "Mínimo de 8 caracteres." [proposta]; erro inline 8–72
│ [ Criar conta com e-mail ]         │ outline [proposta]
│   Já tem conta? Entrar             │
```
- **Só e-mail e senha** — sem nome, sem aceite de termos **[spec]**.
- Submit válido → abre `AlertDialog` (não envia nada):

```
┌──────────────────────────────────────┐
│ Tem certeza que quer usar essa forma │  AlertDialogTitle  [spec, literal]
│ de cadastro?                         │
│ Prefira cadastrar-se com sua conta   │  AlertDialogDescription [spec, literal]
│ Google: é mais seguro, mais rápido e │
│ mais prático.                        │
│ ┌──────────────────────────────────┐ │
│ │ G  Continuar com Google          │ │  AlertDialogAction (primária, 1ª, recebe foco inicial)
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │     Prosseguir com e-mail        │ │  2ª ação (outline) — conclui cadastro
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```
- Esc / clique fora = volta ao form sem enviar **[spec]**. Mobile: botões empilhados full-width, Google em cima.
- "Prosseguir com e-mail" mostra loading no próprio botão; o modal nunca bloqueia.
- Estado pós-envio (substitui o card, sem sessão): título "Confirme seu e-mail" **[spec: nome do estado]**, texto
  com o e-mail digitado — corpo do texto é Dúvida 4.
- Erro "Este email já está cadastrado." **[spec, grafia "email" sem hífen — Dúvida 5]** no alerta do form.

## 3. `/conta/completar`

```
│        Complete seu perfil         │ [proposta]
│ (lojista/admin) ⓘ Seu acesso ao    │ [spec, literal] — linha informativa, não alerta
│     painel continua o mesmo.       │
│ Nome            [Maria Souza____]  │ pré-preenchido do Google, editável
│ Telefone        [(11) 9____-____]  │ react-imask, inputmode="tel"
│ Data de nasc.   [dd/mm/aaaa]       │ Input type="date"; erro 18+ [spec]
│ ── Endereço ──                     │
│ Rótulo [Casa____]                  │ Input irmão do FormEndereco
│  (Casa) (Trabalho) (Outro)         │ chips que preenchem o campo
│ FormEndereco: CEP / Rua / Bairro + │ reuso, inalterado
│   Cidade / Número + Complemento    │
│ [ ] Quero receber ofertas…         │ Checkbox DESMARCADO [copy: Dúvida 6]
│ [ ] Li e aceito os Termos de Uso e │ Checkbox obrigatório, links /termos /privacidade
│     a Política de Privacidade      │
│ [        Salvar e continuar      ] │ primário (fill) [proposta]
```
- Erro idade: "Você precisa ter 18 anos ou mais para criar uma conta." **[spec]**
- Sem aceite → erro inline no checkbox (`aria-invalid` + `aria-describedby`); botão **não** fica desabilitado
  (desabilitar esconde o motivo). Copy do erro: Dúvida 6.
- Chips de rótulo: `ToggleGroup`? Não — são atalhos que **escrevem** no input livre; botões simples `type="button"`
  com `aria-pressed` refletindo se o valor do input é igual ao chip. `min-h-11`.
- E-mail não aparece (não editável aqui). Sem "Voltar para loja"? É `/conta/*`, então aparece se houver `next`.

## 4. `/conta/recuperar`

Etapa 1:
```
│        Recuperar senha             │ [proposta]
│ Informe o e-mail da sua conta …    │ [proposta]
│ E-mail [_____________]             │
│ [   Enviar link   ]                │ primário [proposta]
│ Voltar para entrar                 │ link
```
Após enviar (sempre igual, anti-enumeração): caixa neutra (não verde de "sucesso", para não sugerir que a conta
existe) com "Se existe uma conta com esse e-mail, enviamos um link para redefinir a senha." **[spec]**

Etapa 2 `?etapa=nova-senha`: "Nova senha" + "Confirme a nova senha" (olho em ambos, 8–72), botão "Salvar nova senha"
**[proposta]**. Sem sessão de recuperação: estado de erro sem formulário + CTA "Pedir novo link" **[spec]**; texto do
erro: Dúvida 3.

## 5. `/minha-conta`

```
│ Minha conta                 [Sair] │ Sair = Button ghost (spec: botão "Sair")
│ ┌ Dados pessoais ────────────────┐ │
│ │ E-mail  maria@exemplo.com      │ │ só leitura (texto, não input disabled)
│ │ Nome / Telefone / Nascimento   │ │ FormPerfilCliente (sem aceite)
│ │ [x] Quero receber ofertas      │ │ opt-in (Checkbox; Switch alternativo)
│ │ [ Salvar alterações ]          │ │
│ └────────────────────────────────┘ │
│ ┌ Endereços ─────────────────────┐ │
│ │ 2 de 3 cadastrados          >  │ │ link-card → /minha-conta/enderecos
│ └────────────────────────────────┘ │
│ ┌ Excluir conta (zona perigo) ───┐ │ borda destructive/40
│ │ texto curto + [Excluir conta]  │ │ Button variant="destructive" outline
│ └────────────────────────────────┘ │
```
- Sem "Voltar para loja" (o spec só prevê em `/conta/*`) — Dúvida 7.
- `AlertDialog` de exclusão: título "Excluir sua conta?" **[proposta]**, descrição do que acontece (dados apagados,
  irreversível **[spec: conteúdo]**); variante lojista/admin: diz que só o perfil de cliente é removido e o painel
  continua igual **[spec: regra]**. Botões: "Cancelar" (foco inicial) e "Excluir conta" (destructive). Sem redigitar
  senha **[spec]**. Copy exata: Dúvida 8.

## 6. `/minha-conta/enderecos`

```
│ ← Minha conta                      │
│ Meus endereços          2 de 3     │
│ ┌────────────────────────────────┐ │
│ │ Casa  [Padrão]                 │ │ Badge "Padrão" (texto, não só cor)
│ │ Rua das Flores, 120 — Centro   │ │
│ │ São Paulo                      │ │
│ │ [Editar] [Remover]             │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ Trabalho                       │ │
│ │ Av. Paulista, 900, sala 12 …   │ │
│ │ [Tornar padrão][Editar][Remover]│ │
│ └────────────────────────────────┘ │
│ [ + Adicionar endereço ]           │ some/desabilita em 3 [spec]
```
- Em 3: botão some e aparece texto "Você pode ter até 3 endereços." **[spec]** (preferir texto a botão disabled mudo).
- Remover → `AlertDialog` com o rótulo e a rua do endereço no texto. Último endereço: ação "Remover" continua visível;
  erro "Mantenha pelo menos um endereço." **[spec]** — ou esconder o botão? Dúvida 9.
- Remover o padrão: aviso no dialog de que o mais antigo vira padrão **[spec: regra]**.
- Editar/Adicionar: abre o mesmo bloco Rótulo + chips + `FormEndereco` inline no card (ou `Sheet` no mobile) — Dúvida 10.
- Botões de ação: `aria-label` com o rótulo ("Editar endereço Casa").

---

## Acessibilidade (WCAG AA)
- Todo interativo `min-h-11` (44px). **Achado:** `FormEndereco.tsx:155` usa `h-8` nos inputs (32px) — abaixo de 44px.
  Não muda aqui (spec proíbe alterar contrato do checkout); registrar para `/polir`.
- Contraste: `--texto-muted #6b5d4f` sobre `--cor-fundo #f5f0e6` ≈ 5.6:1 (ok); cards brancos ainda melhor.
- Alertas `role="alert"`; caixa de "enviamos um link" `role="status"` (não é erro).
- Erros de campo: `aria-invalid` + `aria-describedby` apontando o `<p id>` do erro.
- `AlertDialog` (Base UI): foco preso, Esc fecha, título/descrição ligados por `aria-labelledby`/`describedby`.
- Ícones sem texto (olho, voltar) com `aria-label`; olho com `aria-pressed` (padrão `LoginForm`).
- Data: `type="date"` com label visível "Data de nascimento".

## Dúvidas (não decidi — precisam de resposta antes do P17)

1. **Rótulo do `BotaoGoogle`:** hoje o componente diz "Entrar com Google"; o spec usa "Continuar com Google" nas telas
   e no modal. Adicionar prop `rotulo` (afeta só a porta cliente) ou mudar para todos (afeta `/login` do lojista)?
2. **Hierarquia Google x submit de e-mail:** desenhei o submit de e-mail como `outline` para o Google dominar.
   O `LoginForm` atual usa submit preenchido. Confirmar que no mundo cliente o submit é secundário.
3. **Copy dos erros não fixados pelo spec:** `?erro=google` em `/conta/entrar`, `?erro=sessao`, e link de recuperação
   inválido/expirado. Usei a frase do `LoginForm` para Google; as outras ficaram como placeholder no HTML.
4. **Texto do estado "Confirme seu e-mail"** após cadastro (o spec só nomeia o estado). Mostrar o e-mail digitado?
   Oferecer "reenviar link"? (reenvio não está no spec — não desenhei).
5. **"Este email já está cadastrado."** — o spec grafa "email" sem hífen, o resto do spec usa "e-mail". Manter literal?
6. **Copy do opt-in de marketing e do aceite de termos** (e da mensagem de aceite ausente). Usei placeholders.
7. **"Voltar para <loja>" em `/minha-conta`:** o spec só prevê em `/conta/*`. Confirmar que a área logada não tem.
8. **Copy do `AlertDialog` de exclusão** (só-cliente e lojista/admin+cliente) — spec fixa o conteúdo, não o texto.
9. **Último endereço:** mostrar "Remover" e recusar com a mensagem, ou esconder/desabilitar com a mensagem visível?
10. **Editar/adicionar endereço:** inline no card, `Sheet` ou rota própria? Spec não diz.
11. **Títulos e rótulos marcados [proposta]** (títulos dos cards, "Salvar e continuar", "Enviar link", "Criar conta com e-mail").
12. **Ordem do "Sair"** e para onde vai sem `next` (spec: `next` ou `/`) — desenhei no topo de `/minha-conta`.
