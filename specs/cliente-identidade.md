# Spec: Identidade do cliente (conta única iRango)

**Versão:** 0.1.0 | **Atualizado:** 2026-10-02

> Origem: passo P9 de `plan/loop-cadastro-de-clientes.md` (Marco B). Base técnica: ADR aprovado
> `plan/tecnico-identidade-cliente.md` (Marco A entregue no PR #171: `papeis_usuario`, `atribuir_papel_inicial`,
> trigger `lojas_exige_dono_lojista`, callback da porta `(auth)` dando `lojista` a conta sem papel).
> Decisões 1–22 do plano e L1 = (A) são restrições, não são rediscutidas aqui.
> Linhas marcadas **[DECISÃO PROPOSTA — aprovar]** são escolhas que o plano delegou a este spec.
> Dúvidas não delegadas estão em `## Perguntas ao usuário` (fim do arquivo) e bloqueiam a aprovação.

## Visão Geral

Cria a **conta de cliente do iRango**: uma conta única (decisão 1) com a qual a pessoa compra em qualquer loja.
Nesta entrega o cliente consegue **criar conta** (Google primeiro, e-mail/senha como alternativa), **entrar**,
**recuperar a senha por código de 6 dígitos** enviado por e-mail, **manter perfil e até 3 endereços** e
**excluir a própria conta**. Lojista e admin podem **ativar o perfil de cliente** na mesma conta, sem perder o
papel atual (decisão 15).

Mundos:
- **mundo cliente** (novo route group `src/app/(cliente)/`): telas neutras do iRango, não temáticas de loja
  (decisão 21). Subdividido em telas de entrada (sem sessão: `/conta/*`) e área logada (`/minha-conta/*`).
- **vitrine pública**: não muda nesta entrega, exceto o ponto em aberto da P-1 (`## Perguntas ao usuário`).
- **admin**: só a mensagem de recusa de `criarLojaAdmin` para conta só-cliente (L1 = A).
- **páginas públicas** `/termos` e `/privacidade`: texto atualizado (decisão 22).

Esta entrega **não** liga a conta ao pedido: checkout, histórico e cupom por cliente são Marco C
(`specs/cliente-vinculo-pedido.md`); base de clientes do lojista é Marco D. O SaaS não processa pagamento e
nada aqui calcula valor monetário: o eixo de segurança é **identidade, papel, PII e RLS**.

## Atores Envolvidos

| Ator | Nesta feature |
|---|---|
| **iRango (SaaS)** | Hospeda as telas, as Server Actions, as funções SQL e o template de e-mail. Nunca vê senha (GoTrue). Grava papel só por `service_role`. |
| **Cliente** | Cria conta (Google ou e-mail), confirma e-mail, entra, recupera senha por código, edita perfil e endereços, exclui a conta. Só vê o próprio perfil. |
| **Lojista** | Continua entrando no `/painel`. Pode ativar o perfil de cliente na mesma conta. Não vê nenhum dado de cliente nesta entrega (RLS = 0 linhas). |
| **Admin do SaaS** | Pode ativar o próprio perfil de cliente como qualquer usuário. Não lê `clientes` pelo app. `criarLojaAdmin` recusa conta só-cliente (L1 = A). |

## Conceitos

- **Conta**: linha em `auth.users`. Uma por e-mail.
- **Papel**: linha em `public.papeis_usuario` (`lojista` | `cliente`), acumulável; admin vem da env
  `SAAS_ADMIN_USER_ID` (ADR b/g). Escrito só por `atribuir_papel_inicial` (primeiro papel) e pela nova
  `adicionar_papel_cliente` (só acrescenta `cliente`).
- **Perfil de cliente**: linha em `public.clientes` (+ `clientes_enderecos`). Uma conta pode ter papel `cliente`
  sem perfil ainda (Google no meio do onboarding; lojista que ainda não ativou). O guard da área logada exige os
  dois.
- **Porta cliente**: todo fluxo iniciado em `/conta/*` (Google com `contexto=cliente` no `redirectTo`; cadastro
  por e-mail via `cadastrarCliente`). Porta `(auth)` = lojista, inalterada.

## Como a porta cliente evita o `lojista` do callback (achado médio do `auditar` do Marco A)

O callback atual (`src/app/(auth)/auth/callback/route.ts`) chama `atribuir_papel_inicial(user, 'lojista')`
para toda conta. Como a função **só grava se a conta não tem papel** (lock por usuário, ADR f / I4), basta que a
porta cliente **grave `cliente` antes de qualquer passagem pelo callback com o papel `lojista`**:

| Caminho | Onde `cliente` é gravado | Por que o `lojista` do callback não pega |
|---|---|---|
| Cadastro por e-mail | `cadastrarCliente`, **logo após o `signUp`**, via `atribuirPapelInicial(svc, id, 'cliente')` — antes de o e-mail de confirmação poder ser clicado | Quando o link de confirmação passa pelo callback a conta já tem `cliente`; `atribuir_papel_inicial` não muda nada. Além disso o `emailRedirectTo` leva `contexto=cliente` (defesa em profundidade, cobre a falha da RPC no cadastro — ver RN-05). |
| Google (conta nova) | Callback, lendo `contexto=cliente` do `redirectTo`, chama `atribuir_papel_inicial(user, 'cliente')` **no lugar** de `'lojista'` | Uma única chamada por callback, com o papel da porta. Sem `contexto=cliente` (porta `(auth)`) o comportamento do Marco A não muda. |
| Google (conta existente) | Nenhum | `atribuir_papel_inicial` nunca muda conta que já tem papel (I4). Lojista entrando pela vitrine continua lojista e só ganha `cliente` por `adicionar_papel_cliente` (ativação, decisão 15). |
| Trigger de `lojas` | n/a | Conta só-cliente → `raise`. Nenhuma loja nasce para ela por nenhum caminho (I2). |

`contexto` só escolhe o **primeiro** papel de conta **sem papel**; é controlado por quem inicia o fluxo, que é o
dono da conta escolhendo entre dois cadastros públicos (ADR f). O callback aceita apenas o literal `cliente`;
qualquer outro valor (ausente, vazio, desconhecido) = porta `(auth)` = `lojista`, como hoje.

## Páginas e Rotas

Rotas propostas: `/conta/entrar`, `/conta/cadastro`, `/conta/completar`, `/conta/recuperar`, `/minha-conta`,
`/minha-conta/enderecos`, sob `src/app/(cliente)/`. **[DECISÃO PROPOSTA — aprovar]** Justificativa: `/conta/*`
e `/minha-conta` são os nomes já usados pelo plano (P16, P17, P20) e pelo ADR (c/d); `/conta/completar` é a única
rota nova, necessária para o passo complementar pós-Google e para a ativação do perfil por lojista/admin (mesma
tela, decisões 13, 15 e 19).

Layout comum: `src/app/(cliente)/layout.tsx` neutro iRango (mesmo padrão visual de `src/app/(auth)/layout.tsx`,
sem tema de loja). O **guard** fica em `src/app/(cliente)/minha-conta/layout.tsx` (não no middleware — padrão de
`architecture.md` §5). **[DECISÃO PROPOSTA — aprovar]** Guard só na subárvore `/minha-conta`, porque `/conta/*`
precisa abrir sem sessão.

**"Voltar para <nome da loja>"** (decisão 21): todas as telas `/conta/*` aceitam `?next=`. O servidor aplica
`sanitizarNext` (mesma função do callback, extraída para `src/lib/utils/` para reuso — sem mudar a regra) e, se o
caminho sanitizado casar `/loja/<slug>`, busca o nome da loja pela query pública existente de loja por slug e mostra
o link "Voltar para <nome>". Slug inexistente ou `next` fora do padrão → link não aparece, `next` continua valendo
como destino pós-login se for interno. **[DECISÃO PROPOSTA — aprovar]** Derivar a loja só do `next` (sem
parâmetro `loja=` separado) evita um segundo dado controlado pelo usuário.

---

### Entrar — `/conta/entrar`
**Mundo:** cliente · entrada (sem sessão obrigatória; com sessão → redireciona para `next` sanitizado ou `/minha-conta`)
**Descrição:** Botão "Continuar com Google" como **primeira** opção, com hierarquia visual acima do formulário
(decisão 13). Abaixo, separador e formulário e-mail + senha. Links "Esqueci minha senha" (`/conta/recuperar`) e
"Criar conta" (`/conta/cadastro`), ambos preservando `next`. **Sem modal** aqui (decisão 13: modal só no cadastro
por e-mail).

**Componentes:**
- `BotaoGoogle` (`src/app/(auth)/BotaoGoogle.tsx`) — **reuso**, parametrizado com `contexto="cliente"` e `next`; nada
  duplicado.
- `entrarComGoogle` (`src/lib/auth/googleOAuth.ts`) — **reuso**, ganha opções `{ contexto?: "cliente"; next?: string }`
  que montam o `redirectTo` `/auth/callback?contexto=cliente&next=<next>`. Sem opções = comportamento atual (porta
  lojista; `googleOAuth.test.ts` continua valendo).
- `FormEntrarCliente` (novo, Client Component) — mesmo padrão de `LoginForm.tsx`: react-hook-form + zod (UX),
  shadcn `Card`, `Input`, `Label`, `Button`, `sonner`.
- `LinkVoltarLoja` (novo, Server Component pequeno) — "Voltar para <nome>".

**Behaviors:**
- [ ] Clicar "Continuar com Google" e voltar autenticado ao `next` sanitizado (ou `/minha-conta`). Garantido em: callback (Route Handler) — `next` por `sanitizarNext`; papel pela RPC.
- [ ] Conta Google nova iniciada aqui recebe papel `cliente`, nunca `lojista`, e nunca ganha loja. Garantido em: callback (`contexto=cliente` → `atribuir_papel_inicial(…,'cliente')`) + banco (trigger `lojas_exige_dono_lojista`).
- [ ] Conta Google nova sem perfil é levada a `/conta/completar` (preservando `next`). Garantido em: guard de `/minha-conta` + destino do callback.
- [ ] Erro/consentimento negado no Google volta para `/conta/entrar?erro=google` (não para `/login`) quando `contexto=cliente`. Garantido em: callback. **[DECISÃO PROPOSTA — aprovar]** manter o cliente no mundo dele também no erro.
- [ ] Entrar com e-mail e senha. Garantido em: Server Action `entrarCliente` (rate limit `loginCliente` ≤5/min + `safeParse` `.strict()` + `signInWithPassword`).
- [ ] E-mail não confirmado → recusa com "Confirme seu e-mail para entrar. Enviamos um link para você.", sem sessão (decisão 18). Garantido em: Server Action (mapeia o erro do GoTrue; se por algum caminho houver sessão com `email_confirmed_at` nulo, faz `signOut` antes de responder).
- [ ] Credencial inválida → mensagem genérica única ("E-mail ou senha incorretos."), igual para e-mail inexistente e senha errada. Garantido em: Server Action (anti-enumeração, `seguranca.md` §17).
- [ ] Entrar com conta só-lojista funciona (é a mesma conta, decisão 1) e cai em `/conta/completar` para ativar o perfil, sem mudar papel. Garantido em: Server Action não grava papel; guard redireciona.
- [ ] Atualizar `clientes.ultimo_acesso_em` em login bem-sucedido (e-mail ou Google) quando há perfil. Garantido em: servidor (`service_role`), coluna não escrevível pelo usuário.
- [ ] Clicar "Voltar para <loja>" e voltar à vitrine com o carrinho intacto (sessionStorage, mesma aba). Garantido em: cliente (navegação) — sem dado sensível.

---

### Cadastro — `/conta/cadastro`
**Mundo:** cliente · entrada (com sessão → redireciona como em `/conta/entrar`)
**Descrição:** "Continuar com Google" primeiro (decisão 13). Abaixo, formulário de cadastro por e-mail com
**todos** os dados obrigatórios: e-mail, senha, nome completo, telefone, data de nascimento, 1 endereço (rótulo
livre com sugestões Casa/Trabalho/Outro; os outros 2 se cadastram depois em `/minha-conta/enderecos`), opt-in de
marketing (desmarcado) e aceite de Termos/Privacidade (links). Ao submeter um formulário válido, **antes** de
concluir, abre o modal da decisão 13. Concluído, a tela troca para o estado "Confirme seu e-mail" (sem sessão).

**[DECISÃO PROPOSTA — aprovar]** Coleta (o plano delega "quando telefone, nascimento e endereço são coletados"):
- **E-mail:** tudo num formulário só, inclusive o 1º endereço — a decisão 13 exige os mesmos dados obrigatórios
  dos dois caminhos e a decisão 8 exige mínimo 1 endereço no cadastro. Endereços 2 e 3 ficam para `/minha-conta`.
- **Google:** em `/conta/completar`, logo após o primeiro callback (próximo item).
- **Ativação por lojista/admin:** a mesma `/conta/completar`.

**Componentes:**
- `BotaoGoogle` + `entrarComGoogle({ contexto: "cliente", next })` — reuso.
- `FormCadastroCliente` (novo, Client Component) — padrão de `CadastroForm.tsx`; máscara de telefone com
  `react-imask` (já em `package.json`); data de nascimento com `Input type="date"`.
- `FormEndereco` (`src/components/vitrine/FormEndereco.tsx`) — **reuso** para o bloco de endereço (ViaCEP via
  `buscarCep.ts`), acrescido do campo rótulo. Se o componente não aceitar o rótulo sem mudar seu contrato atual com o
  checkout, o rótulo fica num `Input` irmão — não editar `FormEndereco` de forma que altere o checkout (Marco C).
- `AlertDialog` (`src/components/ui/alert-dialog.tsx`, shadcn) — **reuso** para o modal. Proibido modal artesanal.
- `LinkVoltarLoja` — reuso.

**Modal de confirmação (copy literal da decisão 13, não alterar):**
- Título: **"Tem certeza que quer usar essa forma de cadastro?"**
- Texto: **"Prefira cadastrar-se com sua conta Google: é mais seguro, mais rápido e mais prático."**
- Ação primária: continuar com Google → `entrarComGoogle({ contexto: "cliente", next })`. O que foi digitado no
  formulário é descartado (o Google não recebe esses dados; o passo complementar pede de novo).
- Ação secundária: prosseguir com e-mail → chama `cadastrarCliente` com o formulário já validado.
- Fechar o modal (Esc / fora) = voltar ao formulário, sem enviar.
- Rótulos dos botões: "Continuar com Google" / "Prosseguir com e-mail". **[DECISÃO PROPOSTA — aprovar]** a decisão
  13 fixa título e texto, não os rótulos; estes repetem o nome das duas saídas que ela descreve.

**Behaviors:**
- [ ] Ver "Continuar com Google" como primeira opção, acima do formulário. Garantido em: cliente (UX). Prova: checklist de clique (P20).
- [ ] Preencher o formulário com validação instantânea (formato, 18+, tetos). Garantido em: cliente (UX) — preview; a autoridade é a Server Action.
- [ ] Submeter formulário válido abre o modal com a copy literal; o cadastro **não** é enviado antes de "Prosseguir com e-mail". Garantido em: cliente (UX) — persuasão, não trava de segurança. Prova: checklist P20 (sem jsdom, `tasks/176`).
- [ ] No modal, "Continuar com Google" inicia o fluxo Google com `contexto=cliente` e `next`. Garantido em: cliente dispara; papel no callback.
- [ ] No modal, "Prosseguir com e-mail" conclui o cadastro (o modal nunca bloqueia). Garantido em: cliente (UX).
- [ ] Criar conta por e-mail. Garantido em: **Server Action `cadastrarCliente`**: rate limit `cadastroCliente` ≤5/min → `schemaCadastroCliente.safeParse` (`.strict()`, `aceiteTermos: z.literal(true)`, 18+) → `signUp` com `emailRedirectTo` = `/auth/callback?contexto=cliente&next=<next sanitizado>` → `atribuirPapelInicial(svc, id, 'cliente')`. **Nunca** chama `criarLoja` nem `garantir_loja_do_dono`.
- [ ] Os dados do perfil só viram linha em `clientes` depois da confirmação do e-mail (ver RN-06). Garantido em: callback + RPC `criar_perfil_cliente` (service_role).
- [ ] Data de nascimento com menos de 18 anos → "Você precisa ter 18 anos ou mais para criar uma conta."; data futura ou mais de 120 anos → recusada. Garantido em: Server Action (zod) **e** banco (trigger em `clientes`, decisão 17).
- [ ] Sem aceite de termos → recusado. Garantido em: Server Action (`z.literal(true)`).
- [ ] Campo extra no payload (`papel`, `loja_id`, `cliente_id`, `id`) → rejeitado. Garantido em: Server Action (`.strict()`).
- [ ] E-mail que já é conta de lojista (ou já é cliente) → "Este email já está cadastrado.", sem alterar a conta e **sem** compensação `deleteUser`. Garantido em: Server Action (papéis devolvidos pela RPC não contêm `cliente` recém-gravado / `signUp` devolve erro) — padrão do ADR f.
- [ ] Ver o estado "Confirme seu e-mail" após concluir; nenhuma sessão é aberta. Garantido em: Server Action (não retorna sessão; Confirm email ligado no projeto).
- [ ] Clicar o link de confirmação e cair no mundo do cliente (`next` sanitizado ou `/minha-conta`), nunca em `/painel`. Garantido em: callback (`contexto=cliente`, papel `cliente`, `destinoPadraoPorPapel` com ramo cliente → `/minha-conta`).
- [ ] Mensagens de erro na UI genéricas; detalhe só no log do servidor, sem PII. Garantido em: Server Action (`seguranca.md` §14/§21).

---

### Completar perfil / Ativar perfil de cliente — `/conta/completar`
**Mundo:** cliente · exige sessão (sem sessão → `/conta/entrar?next=/conta/completar`); conta que já tem perfil →
`/minha-conta`.
**Descrição:** Passo complementar único para três situações: (1) conta Google nova da porta cliente; (2) lojista
ou admin ativando o perfil de cliente (decisão 15); (3) conta de cliente por e-mail cuja criação do perfil no
callback falhou (RN-06). Pede nome (pré-preenchido com o nome do Google quando houver, editável), telefone, data de
nascimento, 1 endereço, opt-in de marketing (desmarcado) e aceite de termos (decisão 19). Para lojista/admin, uma
linha explica: "Seu acesso ao painel continua o mesmo." **[DECISÃO PROPOSTA — aprovar]** (copy curta; não muda
regra).

**Componentes:** `FormPerfilCliente` (novo; compartilha campos com `FormCadastroCliente` — extrair os campos de
perfil num componente comum em vez de duplicar) · `FormEndereco` (reuso) · shadcn `Card`/`Input`/`Checkbox`/`Button`.

**Behaviors:**
- [ ] Concluir o passo complementar cria o perfil. Garantido em: **Server Action `completarPerfilCliente`** (rate limit `salvarPerfil` existente, `.strict()`, `aceiteTermos: z.literal(true)`, 18+) → RPC `criar_perfil_cliente(auth.uid(), …)` via `service_role`, numa transação: `adicionar_papel_cliente` + INSERT `clientes` + INSERT 1º endereço. O id vem da sessão (`getUser()`), nunca do payload.
- [ ] Sem aceite de termos → rejeitado e **nenhuma** linha em `clientes` (decisão 19). Garantido em: Server Action + RPC (aceite é parâmetro obrigatório).
- [ ] Lojista/admin ativando o perfil continua com `lojista`, continua entrando no `/painel` e não ganha segunda conta. Garantido em: banco (`adicionar_papel_cliente` só acrescenta `cliente`; nenhuma função remove papel — ADR h/I5).
- [ ] Ativar perfil nunca concede `lojista` a conta só-cliente. Garantido em: banco (não existe função que acrescente `lojista` a conta com papel; trigger em `lojas`).
- [ ] Menor de 18 → mesma mensagem da decisão 17; continua podendo comprar como convidado. Garantido em: Server Action + trigger.
- [ ] Abandonar o passo complementar: a conta fica com papel `cliente` e sem perfil; `/minha-conta` sempre traz de volta a esta tela; o checkout continua tratando como convidado (Marco C). Garantido em: guard.
- [ ] Ao concluir, ir para `next` sanitizado ou `/minha-conta`. Garantido em: Server Action (redirect com `sanitizarNext`).

---

### Recuperar senha por código — `/conta/recuperar`
**Mundo:** cliente · entrada (sem sessão)
**Descrição:** Três etapas na mesma tela: (1) e-mail → (2) código de 6 dígitos recebido por e-mail → (3) nova
senha. Fluxo 100% do Auth nativo: `resetPasswordForEmail` + template "Reset Password" com `{{ .Token }}` +
`verifyOtp({ email, token, type: "recovery" })` + `updateUser({ password })`. Nenhuma tabela de token artesanal
(expiração, uso único e hash são do GoTrue). Cruzamento: o fluxo do lojista (`specs/recuperacao-senha-self-service.md`)
segue separado, por link — ver P-2 sobre o template compartilhado.

**Componentes:** `FormRecuperarCliente` (novo; padrão do form de recuperação do lojista) · `InputOTP`, se já gerado
em `components/ui/`; senão `Input` com `inputMode="numeric"` e `maxLength={6}` (não gerar componente shadcn novo
só para isso sem o `desenhar` pedir).

**Behaviors:**
- [ ] Pedir o código. Garantido em: **Server Action `solicitarCodigoRecuperacao`** (rate limit `otpCliente` ≤5/min por IP, `.strict()`). Resposta **idêntica** para e-mail existente, inexistente e conta só-Google: "Se existe uma conta com esse e-mail, enviamos um código." (anti-enumeração por mensagem; o tempo de resposta não depende de existir — a chamada ao GoTrue acontece em todos os casos).
- [ ] Digitar o código e a nova senha (8–72, regra de `schemaCadastro`). Garantido em: **Server Action `redefinirSenhaComCodigo`**: rate limit `otpCliente` → `verifyOtp(type:"recovery")` → `updateUser({ password })` → `signOut` das outras sessões não é exigido nesta entrega.
- [ ] Código inválido, expirado ou já usado → erro genérico ("Código inválido ou expirado. Peça um novo."), sem sessão. Garantido em: GoTrue + Server Action.
- [ ] Após redefinir, entrar com a nova senha e ir para `next` sanitizado ou `/minha-conta`. Garantido em: Server Action.
- [ ] Reenviar código (volta à etapa 1; mesmo rate limit). Garantido em: Server Action.

---

### Minha conta (perfil) — `/minha-conta`
**Mundo:** cliente · área logada. Guard em `src/app/(cliente)/minha-conta/layout.tsx`, fail-closed, nesta ordem:
sem sessão (`getUser()`) → `/conta/entrar?next=<rota>`; e-mail não confirmado → `signOut` + `/conta/entrar` com a
mensagem da decisão 18; sem papel `cliente` ou sem linha em `clientes` → `/conta/completar`; erro de leitura →
`/conta/entrar?erro=sessao`. Papéis lidos da tabela (`buscarPapeisDoUsuario`), nunca do JWT.
**Descrição:** Dados do perfil (nome, telefone, data de nascimento, opt-in de marketing), e-mail só leitura,
atalho para endereços, botão "Sair" e zona "Excluir conta".

**Componentes:** `FormPerfilCliente` (reuso do passo complementar, sem aceite) · `AlertDialog` (confirmação de
exclusão) · shadcn `Card`/`Switch` ou `Checkbox`/`Button`.

**Behaviors:**
- [ ] Ver os próprios dados e nenhum dado de outro cliente. Garantido em: **RLS** (`clientes` SELECT `id = auth.uid()`) + query com o client da sessão.
- [ ] Editar nome, telefone, data de nascimento. Garantido em: **Server Action `salvarPerfilCliente`** (rate limit `salvarPerfil`, `.strict()`, tetos) → UPDATE com client da sessão + **RLS** (só a própria linha) + **trigger** de idade (decisão 17).
- [ ] Ligar/desligar opt-in de marketing (padrão desligado). Garantido em: Server Action + RLS.
- [ ] Tentar mudar `id`, `criado_em`, `ultimo_acesso_em`, `consentimento_*` por payload ou PostgREST direto → sem efeito/erro. Garantido em: Server Action (`.strict()`) + banco (grant de UPDATE só nas colunas editáveis).
- [ ] Sair (encerra a sessão; volta ao `next` ou `/`). Garantido em: servidor (`signOut`).
- [ ] Excluir a conta (ver bloco "Exclusão" abaixo).

**Exclusão de conta:**
- Confirmação em `AlertDialog` com texto do que acontece (dados apagados, irreversível). **[DECISÃO PROPOSTA —
  aprovar]** sem redigitar senha: Google não tem senha e a sessão já foi validada por `getUser()`.
- [ ] Conta **só-cliente**: apaga perfil e conta. Garantido em: **Server Action `excluirConta`** — usa só `auth.uid()` da sessão (id no payload é ignorado; schema `.strict()` vazio) → `anonimizar_cliente(uid)` via `service_role` → `auth.admin.deleteUser(uid)` (cascade em `papeis_usuario`) → `signOut` → `/`. Se `deleteUser` falhar depois da anonimização, o perfil já sumiu e o erro vai ao log; a conta sem perfil volta a `/conta/completar` se a pessoa entrar de novo.
- [ ] Conta **lojista+cliente** (ou admin+cliente): remove **só o perfil de cliente** (`anonimizar_cliente`); `auth.users`, loja, assinatura e as linhas de `papeis_usuario` permanecem; o `/painel` continua igual. **[DECISÃO PROPOSTA — aprovar]** Justificativa: a decisão 15 proíbe que o perfil de cliente tire o papel de lojista, e o ADR (h/I5) proíbe função que remova papel; a conta fica com `cliente` sem perfil, estado já tratado pelo guard (reativar = `/conta/completar`). Excluir a conta do lojista continua sendo atendimento manual (`/privacidade`).
- [ ] Após excluir (só-cliente), tentar entrar de novo falha (credencial inválida genérica). Garantido em: GoTrue.
- [ ] Decisão 16 (bloqueio com pedido em aberto) **não** se aplica neste marco: ainda não há vínculo cliente↔pedido. Entra no Marco C.

---

### Endereços — `/minha-conta/enderecos`
**Mundo:** cliente · área logada (mesmo guard).
**Descrição:** Lista de até 3 endereços com rótulo livre (sugestões Casa/Trabalho/Outro como chips que
preenchem o campo), marcação de padrão, editar, remover, "Adicionar endereço" (some/desabilita ao chegar em 3).

**Componentes:** `FormEndereco` (reuso, ViaCEP) + campo rótulo · `AlertDialog` para remover · shadcn `Badge` para
"Padrão".

**Behaviors:**
- [ ] Listar só os próprios endereços. Garantido em: **RLS** (`cliente_id = auth.uid()`).
- [ ] Adicionar endereço (rótulo `.trim().min(1).max(30)` sem `\n`; campos = `schemaEnderecoCheckout`; complemento ≤100). Garantido em: **Server Action `salvarEnderecoCliente`** (`.strict()`, `cliente_id` = `auth.uid()` do servidor) + **RLS** (WITH CHECK `cliente_id = auth.uid()`).
- [ ] 4º endereço → recusado ("Você pode ter até 3 endereços."). Garantido em: Server Action (mensagem) **e** banco (trigger BEFORE INSERT com lock por cliente — vale também para POST direto no PostgREST).
- [ ] Editar endereço próprio; id de endereço alheio no payload → 0 linhas, erro genérico. Garantido em: **RLS** (USING + WITH CHECK).
- [ ] Marcar um endereço como padrão (desmarca o anterior na mesma operação). Garantido em: Server Action (transação via RPC ou duas escritas ordenadas) + banco (índice único parcial `(cliente_id) where padrao`).
- [ ] O primeiro endereço nasce padrão. Garantido em: RPC `criar_perfil_cliente`.
- [ ] Remover endereço; o último endereço **não** pode ser removido ("Mantenha pelo menos um endereço."). **[DECISÃO PROPOSTA — aprovar]** Justificativa: decisão 8 exige mínimo 1 no cadastro; manter o mínimo depois evita perfil incompleto que o Marco C teria de tratar. Garantido em: Server Action + trigger BEFORE DELETE (exceto quando a remoção vem de `anonimizar_cliente`/cascade da conta).
- [ ] Remover o endereço padrão promove outro a padrão. Garantido em: Server Action/RPC. **[DECISÃO PROPOSTA — aprovar]** promover o mais antigo restante.
- [ ] Rótulo, complemento e demais textos renderizados por JSX (escape padrão), nunca `dangerouslySetInnerHTML`. Garantido em: cliente (render) + gate `grep` (P17).

---

### Termos e Privacidade — `/termos`, `/privacidade`
**Mundo:** público (SSG). Texto final é de `escriba`/jurídico; aqui só **o que muda** (decisão 22), mantendo o aviso
"revisar com jurídico".

**Pontos que mudam:**
1. `/privacidade` deixa de afirmar "Não solicitamos CPF nem data de nascimento" (`privacidade/page.tsx:60-61`):
   passa a declarar coleta de **data de nascimento** com finalidade (confirmar 18+ e aniversário); CPF continua não
   coletado.
2. Dados do cliente com conta: nome, e-mail, telefone, até 3 endereços, opt-in de marketing (desmarcado por padrão).
3. Login com Google: dados recebidos do Google = nome e e-mail.
4. Exclusão de conta **autosserviço** em `/minha-conta`, além do e-mail de atendimento (hoje `:95-98` promete só
   o manual). Para quem é lojista e cliente: o autosserviço remove o perfil de cliente; a conta de lojista segue
   pelo atendimento.
5. Retenção: conta enquanto existir; pedido anonimizado 5 anos; conta inativa 24 meses entra em fila de
   anonimização (decisão 4). A menção a pedido vale já no texto, ainda que o vínculo venha no Marco C.
6. Idade mínima de 18 anos para criar conta; menor compra como convidado.
7. `/termos`: existência da conta de cliente, responsabilidade pelas credenciais, idade mínima.

**Behaviors:**
- [ ] Ler as páginas com o texto novo e a versão nova exibida. Garantido em: estático; versão vem de `VERSAO_TERMOS`.
- [ ] `VERSAO_TERMOS` (`src/lib/constants/termos.ts`) sobe na mesma entrega e é a versão gravada no aceite do cliente. Garantido em: servidor (RPC recebe a constante do servidor, nunca do payload).
- [ ] Lojista que aceitou versão anterior **não** é obrigado a re-aceitar. Garantido em: nada muda em `lojas.consentimento_versao`.

---

### Admin — recusa de loja para conta só-cliente (L1 = A)
**Mundo:** admin (`/admin/assinantes`, onboarding assistido existente).

**Behaviors:**
- [ ] Admin tenta criar loja para e-mail de conta só-cliente → recusado com mensagem específica "Este e-mail pertence a uma conta de cliente e não pode ser dono de loja." **[DECISÃO PROPOSTA — aprovar]** (o ADR L1-A permite trocar a mensagem genérica; texto proposto aqui). Garantido em: **banco** (trigger `lojas_exige_dono_lojista`) + Server Action `criarLojaAdmin` (consulta papéis via `service_role` antes de `criarLoja` só para escolher a mensagem; a barreira é o trigger).

---

## Modelos de Dados

Migrations novas (P12), todas depois de `<ts>_papel_cliente.sql` do Marco A. Toda tabela nasce com RLS ligada,
`revoke all from anon, authenticated` e grants explícitos (molde `20260923060457_pedidos_remove_insert_publico.sql`).
Funções `SECURITY DEFINER` com `set search_path = ''` e `revoke execute … from public, anon, authenticated`
(default privileges do projeto dão EXECUTE a todos — `20260614008500:31`).

### `public.clientes` (nova)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | `references auth.users(id) on delete cascade`; = `auth.uid()` |
| `nome` | `text not null` | `char_length` 1–120 (CHECK) |
| `telefone` | `text not null` | regex `^\+?[\d\s()-]{8,20}$` (mesma de `pedido.ts:112`), CHECK |
| `data_nascimento` | `date not null` | trigger BEFORE INSERT/UPDATE: ≥18 anos em `current_date`, não futura, ≤120 anos (decisão 17; CHECK não serve) |
| `aceita_marketing` | `boolean not null default false` | |
| `consentimento_em` | `timestamptz not null` | **[DECISÃO PROPOSTA — aprovar]** coluna não listada no P9, necessária para provar o aceite das decisões 19/22; espelha `lojas.consentimento_*` |
| `consentimento_versao` | `text not null` | idem; valor = `VERSAO_TERMOS` do servidor |
| `criado_em` | `timestamptz not null default now()` | |
| `ultimo_acesso_em` | `timestamptz not null default now()` | base da retenção de 24 meses |

E-mail **não** é duplicado aqui: vive em `auth.users` (fonte única).

RLS / grants:
- SELECT: `authenticated` com `id = (select auth.uid())`.
- UPDATE: `authenticated`, USING/WITH CHECK `id = (select auth.uid())`; `grant update (nome, telefone,
  data_nascimento, aceita_marketing)` — só essas colunas.
- INSERT e DELETE: **revogados** de `anon`/`authenticated`; só via `criar_perfil_cliente` /
  `anonimizar_cliente` (`service_role`). **[DECISÃO PROPOSTA — aprovar]** INSERT só por RPC garante que perfil e
  papel `cliente` nascem juntos e que o aceite é gravado com a versão do servidor (o P9 diz "cliente escreve só o
  próprio"; aqui ele escreve por UPDATE, e cria pela Server Action).
- `anon`: nenhum privilégio. Lojista: 0 linhas (não é dono da linha). Marco D cria acesso escopado próprio.

### `public.clientes_enderecos` (nova)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `cliente_id` | `uuid not null` | `references public.clientes(id) on delete cascade` |
| `rotulo` | `text not null` | 1–30, sem `\n`/`\r` (CHECK) |
| `cep`, `rua`, `numero`, `bairro`, `cidade`, `uf`, `complemento` | `text` | mesmos campos e tetos de `schemaEnderecoCheckout`/`pedido.ts:70-81`; `uf` 2 chars; `complemento` ≤100; CHECKs de tamanho |
| `padrao` | `boolean not null default false` | índice único parcial `(cliente_id) where padrao` |
| `criado_em` | `timestamptz not null default now()` | |

RLS / grants: SELECT, INSERT, UPDATE, DELETE para `authenticated` com `cliente_id = (select auth.uid())`
(USING e WITH CHECK). Trigger BEFORE INSERT com `pg_advisory_xact_lock` por `cliente_id` (molde
`20260927124000_modais_sazonais_teto_por_loja.sql`) recusa o 4º. Trigger BEFORE DELETE recusa remover o último
endereço quando o autor é usuário final (não vale para cascade/`service_role`).

### Funções novas

| Função | Executa | Faz |
|---|---|---|
| `adicionar_papel_cliente(p_usuario uuid)` | `service_role` | Acrescenta `cliente` a `papeis_usuario` (idempotente, lock por usuário — mesmo lock de `atribuir_papel_inicial`). Única função que acrescenta papel a conta com papel; só `cliente` (ADR h). |
| `criar_perfil_cliente(p_usuario uuid, p_nome, p_telefone, p_data_nascimento, p_aceita_marketing, p_versao_termos, p_endereco jsonb)` | `service_role` | Numa transação: `adicionar_papel_cliente` + INSERT `clientes` + INSERT 1º endereço (`padrao = true`). Falha em qualquer parte desfaz tudo. Recusa se o perfil já existe. **[DECISÃO PROPOSTA — aprovar]** (nome e forma; o ADR h pede "mesma transação"). |
| `anonimizar_cliente(p_usuario uuid)` | `service_role` | Marco B: DELETE de `clientes` (cascade em endereços). Não toca `papeis_usuario`, `lojas`, `auth.users`. Marco C estende para `pedidos` (nome "Cliente removido", PII nula). |
| `anonimizar_clientes_inativos()` | `service_role` | Chama `anonimizar_cliente` para perfis com `ultimo_acesso_em < now() - interval '24 months'`. **Sem agendador nesta entrega** (plano P9). **[DECISÃO PROPOSTA — aprovar]** remove só o perfil de cliente, não `auth.users` (SQL não deve escrever no schema `auth`; ADR b1). |

### Tabelas existentes afetadas
- `papeis_usuario` (Marco A): sem mudança de schema; ganha escritor `adicionar_papel_cliente`.
- Nenhuma mudança em `pedidos`, `cupons`, `lojas` neste marco.

### Código afetado (para o `quebrar`)
- `src/app/(auth)/auth/callback/route.ts` — ler `contexto=cliente`; papel da porta; ramo de criação de perfil
  pós-confirmação (RN-06); `ultimo_acesso_em`; destino de erro por contexto.
- `src/lib/utils/papeis.ts` — `destinoPadraoPorPapel`: ramo cliente → `/minha-conta` (ADR c/d).
- `src/lib/auth/googleOAuth.ts` + `BotaoGoogle.tsx` — opções `contexto`/`next`.
- `src/lib/utils/rateLimit.ts` — chaves `cadastroCliente`, `loginCliente`, `otpCliente` (5/min).
- Novos: `src/lib/validacoes/cliente.ts`, `src/lib/actions/clienteAuth.ts`, `src/lib/actions/cliente.ts`,
  `src/lib/supabase/queries/clientes.ts`, telas em `src/app/(cliente)/`.
- `src/app/admin/assinantes/actions.ts` — mensagem L1.
- `/termos`, `/privacidade`, `src/lib/constants/termos.ts`.

## Regras de Negócio

| # | Regra | Camada |
|---|---|---|
| RN-01 | Conta única por e-mail; mesmo usuário pode ser lojista, cliente e admin (decisões 1, 15) | GoTrue + `papeis_usuario` (PK composta) |
| RN-02 | Conta só-cliente nunca é dona de loja, por nenhum caminho, inclusive admin (decisão 12, L1 = A) | **Banco** (trigger `lojas_exige_dono_lojista`) |
| RN-03 | Porta cliente grava `cliente` antes de qualquer callback com `lojista`; contexto só decide o 1º papel de conta sem papel | Server Action (`cadastrarCliente`) + callback + **banco** (`atribuir_papel_inicial`, lock) |
| RN-04 | Ganhar/excluir perfil de cliente nunca dá nem tira `lojista` | **Banco** (só `adicionar_papel_cliente` acrescenta; nenhuma função remove; DELETE revogado) |
| RN-05 | Se a RPC de papel falhar em `cadastrarCliente`, a conta não é apagada (pode ser conta pré-existente); o link de confirmação carrega `contexto=cliente`, então o callback atribui `cliente` antes de qualquer outro caminho | Server Action + callback |
| RN-06 | Dados do cadastro por e-mail ficam guardados até a confirmação e só viram perfil no callback de confirmação (`contexto=cliente`, e-mail confirmado) via `criar_perfil_cliente`; depois são apagados do armazenamento temporário. **[DECISÃO PROPOSTA — aprovar]** armazenamento temporário = `user_metadata` do `signUp` (`options.data`), lido **só** como dado de perfil (revalidado por zod + trigger), **nunca** para autorização. Justificativa: (a) decisão 18 (conta só vale após confirmar) — nada de perfil antes; (b) responde ao risco 5.1 do ADR ("apagar o perfil não confirmado no vínculo"): se a dona real do e-mail entrar com Google antes da confirmação, o GoTrue remove a identidade não confirmada e sobrescreve `user_metadata` com os dados do Google — os dados digitados pelo terceiro somem e o perfil nunca é criado com eles; ela cai em `/conta/completar`. Limpeza: o callback zera `options.data` via `auth.admin.updateUserById` após criar o perfil. | Callback + RPC + trigger |
| RN-07 | E-mail precisa estar confirmado para entrar e para abrir `/minha-conta`; conta Google já vem confirmada (decisão 18) | Server Action `entrarCliente` + guard |
| RN-08 | 18+ (zod e trigger), não futura, ≤120 anos (decisão 17) | Server Action + **banco** |
| RN-09 | Aceite de termos obrigatório em todo caminho que cria perfil (decisão 19); versão = `VERSAO_TERMOS` do servidor | Server Action + RPC |
| RN-10 | Máximo 3 endereços, 1 padrão, mínimo 1 enquanto houver perfil (decisão 8) | Server Action + **banco** (triggers + índice único parcial) |
| RN-11 | `data_nascimento` é o único campo; aniversário é derivado (decisão 7) | Modelo |
| RN-12 | Opt-in de marketing desmarcado por padrão | **Banco** (default false) + UI |
| RN-13 | Exclusão: só-cliente apaga perfil + conta; lojista/admin+cliente apaga só o perfil (decisões 3, 15) | Server Action (`auth.uid()` da sessão) + `anonimizar_cliente` (`service_role`) |
| RN-14 | Recuperação de senha por OTP do GoTrue, sem tabela própria; resposta idêntica exista ou não a conta (decisão 10) | GoTrue + Server Action |
| RN-15 | `next` só caminho interno (`sanitizarNext`), em todas as telas e no callback (decisão 21) | Servidor |
| RN-16 | Rate limit por IP: `cadastroCliente`, `loginCliente`, `otpCliente` ≤5/min | Server Action (`verificarRateLimit`) |
| RN-17 | Inatividade de 24 meses → `anonimizar_clientes_inativos()` disponível, sem agendador (decisão 4) | Banco (função) |

## Segurança (obrigatório)

**Dado autoritativo do servidor × preview no cliente.** Não há valor monetário nesta entrega. O que é
autoritativo no servidor/banco: papel (tabela, nunca JWT/metadata), `cliente_id`/`id` (sempre `auth.uid()` da
sessão via `getUser()`), idade (zod + trigger), teto/padrão/mínimo de endereços (triggers + índice), versão do
aceite (constante do servidor), destino pós-login (`sanitizarNext`). Preview no cliente: validação de formulário,
cálculo de idade na tela, contador "x de 3 endereços", modal da decisão 13 (persuasão, sem valor de segurança).

**PII que entra/sai:** nome, e-mail, telefone, data de nascimento, até 3 endereços, opt-in. Nunca em
`console.*`/Sentry (`seguranca.md` §21) — logs só com id/código de erro. Nenhum dado real em seed/teste/comentário.
`user_metadata` com PII temporária (RN-06) é limpo após criar o perfil; ver P-3 sobre contas nunca confirmadas.

**RLS nova (antes de produção, `seguranca.md` §2):** `clientes` (SELECT/UPDATE próprio, colunas limitadas;
INSERT/DELETE revogados), `clientes_enderecos` (CRUD próprio). `anon` = 0 em ambas; lojista = 0. Testes de
isolamento A×B, anon, lojista, IDOR em endereço, teto via PostgREST, idade na borda (fatias B1/B2).

**Funções `SECURITY DEFINER`:** `adicionar_papel_cliente`, `criar_perfil_cliente`, `anonimizar_cliente`,
`anonimizar_clientes_inativos` — EXECUTE só `service_role`; `asUser` → permission denied (teste).

**Auth:** `.strict()` em todos os schemas (rejeita `papel`, `loja_id`, `id`, `cliente_id`); anti-enumeração em
login e recuperação; `signUp` de e-mail existente nunca apaga nem altera a conta (ADR f); PKCE protege o
`contexto` do callback; `contexto` só aceita o literal `cliente`.

**Linking Google × e-mail (P18 audita):** conta e-mail confirmada + login Google com o mesmo e-mail → mesma conta,
mesmo papel, sem tomada; conta e-mail não confirmada de terceiro → GoTrue remove a identidade não confirmada
(RN-06 garante que os dados do terceiro não viram perfil). Conta que era só-lojista entrando por Google com
`contexto=cliente` continua só-lojista (I4).

**Pré-requisito humano (ADR risco 2):** conferir na allowlist de Redirect URLs do Supabase que
`/auth/callback?contexto=cliente&next=…` é aceito em produção antes de P17.

**API externa:** ViaCEP (já usado, sem key). Google via Supabase (provider já configurado).

## Fora do Escopo (v1)

- Vínculo cliente↔pedido, `cliente_id` em `pedidos`, histórico, pré-preenchimento no checkout, cupom com limite por
  cliente, bloqueio de exclusão com pedido em aberto (decisão 16) — **Marco C**.
- Base de clientes do lojista e filtro de aniversariantes — **Marco D**.
- Motor de campanha, cupom pessoal, e-mail/WhatsApp de aniversário (decisão 5) → débito em `specs/_debito-produto-*`.
- Verificação de telefone por SMS; vincular pedido antigo de convidado (decisão 20).
- Outros providers (Apple, Facebook…).
- Agendador da anonimização por inatividade.
- Re-consentimento automático de lojista após bump de `VERSAO_TERMOS`.
- Autosserviço de exclusão da conta de **lojista**.
- Troca de e-mail e troca de senha logado em `/minha-conta`.
- Texto jurídico final de `/termos` e `/privacidade`.
- Cobrança (nada aqui toca assinatura).

## Perguntas ao usuário

**P-1 · Por onde o cliente chega a `/conta/entrar` a partir da vitrine?** A decisão 21 pressupõe vir de uma loja
("Voltar para <loja>"), mas o plano não diz se o Marco B põe um ponto de entrada na vitrine (P16 trava "não toca
vitrine"; o checkout logado é Marco C).
- (a) Link "Entrar" no `HeaderLoja` já no Marco B, com `next=/loja/<slug>`. Impacto: toca `src/components/vitrine/HeaderLoja.tsx` (+ teste), pequeno; "Voltar para <loja>" fica testável no checklist P20.
- (b) Nenhum ponto de entrada no Marco B; só no Marco C (checkout). Impacto: no Marco B as telas só são alcançadas por URL direta; o "Voltar para <loja>" só é exercitado no Marco C.

**P-2 · Template "Reset Password" é global no Supabase.** O cliente precisa de `{{ .Token }}` (decisão 10); o
lojista hoje recebe link (`specs/recuperacao-senha-self-service.md`). Não há template por papel.
- (a) Um template com os dois: código de 6 dígitos **e** o link. Impacto: lojista passa a ver um código que o fluxo dele não usa; cliente vê um link que leva ao fluxo de link (funciona, mas cai na tela do lojista `/redefinir-senha`, salvo ajuste).
- (b) Migrar o lojista também para código. Impacto: muda uma feature entregue (spec arquivado/ativo do lojista); amplia o Marco B.
- (c) Só código; o fluxo por link do lojista deixa de funcionar. Impacto: regressão do lojista — não recomendável.

**P-3 · Conta de cliente por e-mail nunca confirmada.** Fica em `auth.users` com papel `cliente` e com a PII do
formulário em `user_metadata` (RN-06), indefinidamente (o Supabase não expira). A decisão 4 fala de conta inativa
24 meses, mas não de conta nunca confirmada.
- (a) Aceitar nesta entrega e anotar como débito. Impacto: PII de quem desistiu retida sem prazo.
- (b) Incluir em `anonimizar_clientes_inativos()` a limpeza de `user_metadata` de conta não confirmada há N dias (sem agendador). Impacto: precisa de N e de escrita via Admin API (não SQL), logo vira Server Action/rota de manutenção, não função SQL.
- (c) Guardar o formulário só em `sessionStorage` e pedir os dados de novo após a confirmação (sem PII no servidor antes de confirmar). Impacto: o cliente digita duas vezes, e se confirmar em outra aba perde tudo (mesmo limite aceito na decisão 21 para o carrinho); elimina a retenção.

**P-4 · Ver o próprio e-mail de login em `/minha-conta` e trocá-lo.** Fora de escopo proposto acima (troca de e-mail),
mas a decisão 22 menciona só dados; confirme que trocar e-mail/senha logado pode ficar para depois.
- (a) Fica fora (proposto). Impacto: quem quer outro e-mail exclui e recria.
- (b) Entra no Marco B. Impacto: mais um fluxo de confirmação (`updateUser({email})` com dupla confirmação) e testes.
