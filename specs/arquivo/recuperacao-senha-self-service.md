# Spec: Recuperação de Senha do Lojista (Self-Service Password Reset)

**Versão:** 0.2.0 | **Atualizado:** 2026-11-01

## Visão Geral

Permite que o **lojista** redefina a própria senha sem intervenção do suporte, usando o fluxo nativo do **Supabase Auth** (`resetPasswordForEmail` + `updateUser`). Hoje não existe fluxo: o login (`/login`) não tem "Esqueci minha senha?", o painel não tem troca de senha e o callback não tem ramo de recuperação para a porta do lojista. A única saída é o suporte manual (criar outra conta é bloqueado por RN-01 do cadastro: 1 conta = 1 loja).

Vive no **mundo auth** (`src/app/(auth)/`), ao lado de `login` e `cadastro`. O SaaS não processa pagamento e esta feature não toca valor monetário — o eixo de segurança é **identidade, sessão, token e anti-enumeração**.

**Contas compartilhadas.** Lojista e cliente são a mesma base `auth.users`: uma pessoa tem uma conta, com um ou mais papéis (`lojista`, `cliente`). A senha é uma só. Trocar a senha por `/recuperar-senha` (porta lojista) ou por `/conta/recuperar` (porta cliente) troca a mesma credencial. Nenhuma das duas portas revela se o e-mail existe, qual papel a conta tem ou se ela foi criada por senha ou Google.

**O fluxo do cliente já existe** (`/conta/recuperar`, `solicitarRecuperacaoCliente`/`redefinirSenhaCliente` em `src/lib/actions/clienteAuth.ts`, descrito em `specs/cliente-identidade.md` RN-14). Esta spec reusa as peças dele e incorpora as correções que ele recebeu depois da v0.1.0 desta spec (sessão de recuperação por `amr`, latência mínima, rate limit nas duas etapas).

### Decisões desta revisão (v0.2.0)

| # | Decisão | Origem |
|---|---------|--------|
| D1 | Troca de senha exige sessão aberta **pelo link de recuperação** (`amr` contém `recovery`), não qualquer sessão. Login normal não troca senha sem a atual. | Achado P18 (já aplicado no cliente) |
| D2 | Depois de trocar a senha, o servidor encerra **todas** as sessões da conta (`signOut({ scope: 'global' })`), inclusive a de recuperação, e o fluxo termina em `/login?redefinida=1`. Comportamento do código, não de configuração do painel Supabase. | Avaliação 2026-11-01 |
| D3 | Pedido de link com latência mínima de 1,5 s (mesmo valor do cliente), para o tempo de resposta não revelar se a conta existe. | B2 do cliente |
| D4 | Rate limit por IP nas **duas** etapas: pedido do link e troca da senha. | Paridade com o cliente |
| D5 | Callback ganha ramo de recuperação da porta lojista: decidido pela sessão trocada (`amr`), destino fixo `/nova-senha`, **não atribui papel**. Link inválido/expirado → `/recuperar-senha?erro=link`. | Avaliação 2026-11-01 |
| D6 | **[aprovado pelo usuário, 2026-11-01]** Conta criada só com Google que redefine a senha passa a entrar **também** por e-mail + senha; o Google continua funcionando. Coerente com o cliente. Quem recebe o link prova posse do e-mail. | Decisão do usuário (opção a) |

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|--------------------|
| **iRango (SaaS)** | Fornece as páginas, as Server Actions e o ramo do callback. Não vê nem armazena senha (o GoTrue cuida do hash). |
| **Lojista** | Pede o link, recebe por e-mail, define a nova senha, entra de novo. |
| **Cliente** | Não usa esta porta (tem `/conta/recuperar`), mas pode: a conta é a mesma. Se usar, a senha trocada vale para as duas portas e a resposta é a mesma de qualquer outro e-mail. |
| **Supabase Auth (GoTrue)** | Gera, envia, expira e consome o token (uso único); grava a senha. |

## Páginas e Rotas

### Recuperar Senha — `/recuperar-senha`
**Mundo:** auth. Funciona igual com ou sem sessão (não redireciona logado para `/painel`).
**Descrição:** Formulário de um campo (e-mail). Ao enviar, a pessoa sempre vê a **mesma** mensagem: "Se existe uma conta com esse e-mail, enviamos um link para redefinir a senha. Abra o link neste mesmo navegador." — exista ou não a conta, use ela senha ou Google, seja ela de lojista ou de cliente. Com `?erro=link` (vindo do callback), mostra acima do form: "Link inválido ou expirado. Peça um novo link e abra-o neste mesmo navegador."

O "mesmo navegador" é exigência do PKCE: o `code_verifier` fica em cookie do navegador que pediu o link. É também uma defesa — link aberto em outro navegador não abre sessão.

**Componentes:**
- `FormRecuperarSenha` (Client Component novo, `src/app/(auth)/recuperar-senha/FormRecuperarSenha.tsx`) — layout do `LoginForm`, comportamento do `FormRecuperarCliente` (react-hook-form, zod só como UX, `AlertaErro`, `sonner`, `Loader2`). Campo com `type="email"` e `autocomplete="email"`.
- `page.tsx` (Server Component) — renderiza o form dentro do `(auth)/layout.tsx`; lê `?erro=link`.

**Behaviors:**
- [x] Digitar o e-mail e validar o formato no cliente. Garantido em: cliente (UX) — a autoridade é a Server Action.
- [x] Pedir o link. Garantido em: **Server Action `solicitarRedefinicaoSenha`** — rate limit por IP → `safeParse` `.strict()` → `resetPasswordForEmail` sempre chamado → latência mínima.
- [x] Receber a mesma mensagem, no mesmo tempo aproximado, para e-mail existente, inexistente, só-Google, de cliente e com falha do GoTrue. Garantido em: **Server Action** (RN-01, RN-02, RN-03).
- [x] Ser barrado ao exceder o limite de pedidos. Garantido em: **Server Action + `rateLimit.ts`** (chave `recuperacaoLojista`).
- [x] Ver o aviso de link inválido quando chega com `?erro=link`. Garantido em: Server Component (leitura do query param, cosmético).
- [x] Voltar para `/login` pelo link "Voltar para o login". Garantido em: cliente (navegação).

---

### Callback — `/auth/callback` (alteração: ramo de recuperação da porta lojista)
**Mundo:** auth (Route Handler existente, `src/app/(auth)/auth/callback/route.ts`).
**Descrição:** O `redirectTo` do pedido é `<origem>/auth/callback?next=/nova-senha`. O callback troca o `code` por sessão (`exchangeCodeForSession`, cookies HttpOnly) como hoje. A porta cliente (`contexto=cliente`) não muda.

Na porta lojista, depois da troca:
- **Sessão de recuperação** (`amr` contém `recovery`, lido da sessão trocada — nunca de parâmetro da URL) → redireciona para **`/nova-senha`**, destino fixo, ignorando `next`. **Não chama `atribuirPapelInicial`**: redefinir senha nunca cria papel (e, por consequência, nunca dispara a auto-cura que cria loja no painel). Chama `reconciliarPosConfirmacao` como hoje — o link de recuperação também prova posse do e-mail, e o helper já exige `email_confirmed_at`, resolve a loja por `user.id` e é no-op para conta sem loja.
- **Qualquer outra sessão** → comportamento atual, inalterado.

Erros antes ou durante a troca (`?error=`, sem `code`, troca falha) com `next=/nova-senha` ou `error_code=otp_expired` → `/recuperar-senha?erro=link`. Demais erros seguem para `/login?erro=…` como hoje. Esse `next` só escolhe a **tela de erro**; nunca abre sessão nem decide papel.

**Behaviors:**
- [x] Clicar o link do e-mail e chegar em `/nova-senha` com sessão de recuperação. Garantido em: **Route Handler** (`exchangeCodeForSession` + ramo por `amr`).
- [x] O ramo de recuperação não atribui papel a nenhuma conta (com ou sem papel prévio). Garantido em: **Route Handler** (teste: `atribuirPapelInicial` não é chamado). **crítico (TDD red-first).**
- [x] O destino da recuperação é sempre `/nova-senha`, mesmo com `next` adulterado (`//evil.com`, URL absoluta, outro path interno). Garantido em: **Route Handler** (destino fixo; `sanitizarNext` continua nos demais ramos). **crítico (TDD red-first).**
- [x] Sessão que **não** é de recuperação, chegando com `next=/nova-senha`, segue o fluxo normal (papel + destino por papel), sem desvio. Garantido em: **Route Handler** (ramo decidido pela sessão, não pela URL).
- [x] Link expirado/usado/aberto em outro navegador → `/recuperar-senha?erro=link`. Garantido em: **Route Handler**.
- [x] Porta cliente inalterada (os testes `route.cliente*.test.ts` continuam verdes sem edição). Garantido em: suíte existente.

---

### Nova Senha — `/nova-senha`
**Mundo:** auth (exige a sessão de recuperação aberta pelo callback).
**Descrição:** Formulário de nova senha + confirmação. Só renderiza com sessão de recuperação (`getUser()` válido **e** `amr` com `recovery`). Sem sessão, ou com sessão comum de login (lojista logado no painel que abre `/nova-senha`), mostra o estado de erro — "Link inválido ou expirado. Peça um novo link e abra-o neste mesmo navegador." — com CTA "Pedir novo link" → `/recuperar-senha`. Nunca o form.

**Componentes:**
- `FormNovaSenha` (Client Component novo, `src/app/(auth)/nova-senha/FormNovaSenha.tsx`) — padrão do `FormNovaSenhaCliente`: dois campos com `autocomplete="new-password"`, toggle mostrar/ocultar (padrão do `LoginForm`), hint de força só como UX.
- `page.tsx` (Server Component) — usa o helper compartilhado de "tem sessão de recuperação" (ver Reuso).

**Behaviors:**
- [x] Ver o form só com sessão de recuperação; sem sessão ou com sessão comum, ver o estado de erro. Garantido em: Server Component (UX — a autoridade é a action).
- [x] Digitar nova senha + confirmação, com validação de força e igualdade no cliente. Garantido em: cliente (UX).
- [x] Trocar a senha. Garantido em: **Server Action `confirmarNovaSenha`** — rate limit por IP → `safeParse` `.strict()` (senha 8–72 + igualdade) → `getUser()` → `amr` com `recovery` → `updateUser({ password })` → `signOut({ scope: 'global' })`. **crítico (TDD red-first).**
- [x] Sessão comum de login (senha ou Google) **não** troca a senha, mesmo chamando a action direto. Garantido em: **Server Action** (D1). **crítico (TDD red-first).**
- [x] Depois da troca, todas as sessões da conta caem, inclusive em outros dispositivos e a de recuperação. Garantido em: **Server Action** (`signOut({ scope: 'global' })` chamado **só depois** de `updateUser` ok — teste trava a ordem) + guard do painel (usa `getUser()`, que consulta o GoTrue, então a sessão revogada cai na próxima requisição). **crítico (TDD red-first).**
- [x] Ser barrado ao exceder o limite de tentativas. Garantido em: **Server Action + `rateLimit.ts`** (chave `novaSenhaLojista`).
- [x] Após sucesso, ir para `/login?redefinida=1`. Garantido em: **Server Action** (destino fixo devolvido pelo servidor, sem `next`).
- [x] Não conseguir usar o mesmo link duas vezes. Garantido em: **Supabase Auth** (uso único) + sessão de recuperação já revogada pela 1ª troca.

---

### Login — `/login` (alteração)
**Mundo:** auth
**Descrição:** Link "Esqueci minha senha?" abaixo do campo de senha e banner de sucesso com `?redefinida=1`.

**Componentes:** `LoginForm.tsx` (existente) — `<Link href="/recuperar-senha">` e banner condicional.

**Behaviors:**
- [x] Clicar em "Esqueci minha senha?" e ir para `/recuperar-senha`. Garantido em: cliente (navegação).
- [x] Ver "Senha redefinida. Entre com a nova senha." quando `?redefinida=1`. Garantido em: cliente (query param, cosmético).

---

## Modelos de Dados

**Nenhuma tabela nova. Nenhuma migration. Nenhuma política RLS nova.** Senha, hash, expiração e uso único do token vivem no GoTrue (`auth.users`); o iRango nunca lê nem grava em `auth.users` diretamente nesta feature. Duas chaves novas em `LIMITES` (`rateLimit.ts`), que é código, não schema.

**Configuração do Supabase (não é migration — documentar no PR):**
- **Template "Reset Password" é único no projeto** e já é usado pela porta cliente. Fica o padrão (`{{ .ConfirmationURL }}`), **sem mudança**: com PKCE, o GoTrue verifica o token e redireciona para o `redirectTo` com `?code=`. Qualquer mudança futura no template afeta as duas portas e exige testar as duas.
- **Redirect Allow List:** só origens do iRango com o caminho `/auth/callback`. É a barreira contra host forjado — a origem do `redirectTo` vem dos headers da requisição (`origemDaRequisicao`). Conferir e listar no corpo do PR.
- **Expiração do link:** "Email OTP Expiration" (padrão 1 h) vale para todos os links de e-mail, inclusive confirmação de cadastro. Reduzir afeta o cadastro; manter 1 h salvo decisão explícita.
- **Frequência por usuário do GoTrue** (padrão: 1 e-mail de recuperação por conta a cada 60 s) é defesa em profundidade contra bombardeio de e-mail; o erro 429 dele é engolido pela action (resposta neutra).

## Regras de Negócio

| # | Regra | Camada que garante |
|---|-------|--------------------|
| RN-01 | Resposta de `/recuperar-senha` é **idêntica** exista ou não a conta: mesma string, mesmo formato, latência mínima de 1,5 s. | **Server Action** — `resetPasswordForEmail` sempre chamado; erro do GoTrue só no log; espera até o piso antes de responder. |
| RN-02 | Nunca revelar se a conta usa senha ou Google, nem se é de lojista ou de cliente. | **Server Action** (RN-01) + **callback** (destino da recuperação não depende de papel) + **action de troca** (destino fixo `/login?redefinida=1`). |
| RN-03 | Pedido de link e troca de senha têm rate limit por IP. | **Server Actions + `rateLimit.ts`** (`recuperacaoLojista` e `novaSenhaLojista`, 5/min cada, mesma régua do cliente; IP por `extrairIp(headers())`, não forjável — `seguranca.md` §12). Fail-open aceito (contenção de abuso, não gate de autorização). |
| RN-04 | Senha de 8 a 72 caracteres (72 = limite bcrypt do GoTrue), revalidada no servidor. | **Server Action + zod** — mesma regra de `schemaCadastro.shape.senha`, sem cópia. |
| RN-05 | Só sessão aberta pelo link de recuperação troca a senha. | **Server Action** (`getUser()` + `amr` com `recovery`). A página só espelha isso como UX. |
| RN-06 | Token de uso único, expiração curta, preso ao navegador que pediu (PKCE). | **Supabase Auth (GoTrue)** — o iRango não reimplementa. |
| RN-07 | Nenhum redirect da recuperação é controlado pelo usuário. | **Callback** (destino fixo `/nova-senha`) + **action** (destino fixo `/login?redefinida=1`) + `sanitizarNext` nos demais ramos + Redirect Allow List. |
| RN-08 | Troca de senha encerra todas as sessões da conta. | **Server Action** (`signOut({ scope: 'global' })` após `updateUser` ok). Falha no encerramento vai ao log com tag própria e não desfaz a troca (a resposta continua sucesso — mostrar erro levaria a pessoa a repetir com a sessão de recuperação viva). |
| RN-09 | Recuperação nunca cria papel nem loja. | **Callback** (ramo de recuperação não chama `atribuirPapelInicial`). |
| RN-10 | Conta só-Google que redefine a senha ganha login por e-mail + senha, mantendo o Google (D6). | **Supabase Auth** — comportamento nativo de `updateUser({ password })`; o iRango não bloqueia nem distingue. |
| RN-11 | Erro interno nunca vaza detalhe. | **Server Actions/callback** — `console.error` só com `status`/`code`/`name` do erro; mensagem genérica (`seguranca.md` §14). Exceção deliberada: `weak_password` e `same_password` do GoTrue viram instrução ("Escolha uma senha mais forte." / "Escolha uma senha diferente da anterior.") — quem os recebe já provou ser dono da conta. |

## Segurança (obrigatório)

- **Dado sensível:** e-mail (PII) no pedido; nova senha na troca. Nunca em log, `exception.value` ou breadcrumb — logar só `status`/`code`/`name` (o scrubber do Sentry, `seguranca.md` §21, é a última linha, não o substituto). O e-mail nunca vai para a URL (nada de `?email=` pré-preenchido), para não cair em histórico, log de acesso ou `Referer`.
- **Enumeração (risco central):** resposta e tempo idênticos (RN-01/RN-02). Diferença deliberada em relação ao cadastro, que revela "e-mail já cadastrado" por necessidade de UX (`auth.ts`, D5 do cadastro). O piso de 1,5 s precisa ficar acima do p99 do envio do GoTrue; se o SMTP próprio for mais lento, o piso sobe nas duas portas juntas.
- **Tomada de conta por sessão comum (P18):** sem o teste de `amr`, quem achasse o painel aberto ou roubasse um cookie trocaria a senha sem saber a atual. RN-05 fecha isso na action; a página só espelha.
- **Sessões após a troca:** RN-08. O guard do painel valida com `getUser()` (consulta o GoTrue), então refresh token revogado + sessão removida derrubam os outros dispositivos na próxima requisição. Validar com dois navegadores na loja de teste.
- **Token:** PKCE; troca no servidor (`exchangeCodeForSession` no callback). Ramo de recuperação decidido pela sessão trocada, nunca por parâmetro da URL.
- **Open redirect:** RN-07.
- **Papel e loja:** RN-09. A auto-cura do painel (`garantir_loja_do_dono`) só roda para papel `lojista`, então sem papel novo não há loja criada sem aceite dos Termos.
- **Contas compartilhadas:** trocar a senha por uma porta troca nas duas; nenhuma resposta diz qual papel a conta tem.
- **Service role:** não é usado no pedido nem na troca. O callback continua usando onde já usa (`reconciliarPosConfirmacao`).
- **Tabela nova / RLS:** não há.

### Issues críticas (TDD red-first — `crítica: SIM`)
- **`solicitarRedefinicaoSenha`** — teste que falha se a resposta ramificar pela existência do e-mail, pelo método de login ou por erro do GoTrue; que falha se a resposta sair antes do piso; que falha se o e-mail aparecer em `console.error`; `redirectTo` sempre `/auth/callback?next=/nova-senha` na origem da requisição.
- **`confirmarNovaSenha`** — sessão comum é recusada sem chamar `updateUser`; sem sessão idem; `signOut({ scope: 'global' })` chamado só depois de `updateUser` ok e nunca quando ele falha; destino fixo; payload com campos extras (`next`, `user_id`, `email`) recusado pelo `.strict()`.
- **Ramo de recuperação do callback** — não chama `atribuirPapelInicial`; destino fixo com `next` adulterado; sessão não-recuperação com `next=/nova-senha` segue o fluxo normal; erros vão para `/recuperar-senha?erro=link`.

Páginas, forms e a alteração no `LoginForm` são não-críticos (UX/navegação) — teste padrão. A extração das peças compartilhadas (abaixo) não é crítica, mas a suíte do cliente tem de passar sem edição.

## Reuso (não reinventar)

Extraídos de `src/lib/actions/clienteAuth.ts` e da página `/conta/recuperar` para uso das duas portas, sem mudar o comportamento do cliente:

| Peça | Hoje | Destino |
|------|------|---------|
| `origemDaRequisicao(headers)` | função local em `clienteAuth.ts` | `src/lib/utils/` |
| Espera até o piso de latência (`TEMPO_MINIMO_RECUPERACAO_MS` + `setTimeout`) | inline em `solicitarRecuperacaoCliente` | `src/lib/utils/` |
| "Tem sessão de recuperação?" (`getUser()` + `getClaims()` + `ehSessaoDeRecuperacao`) | função local em `conta/recuperar/page.tsx` e repetida em `redefinirSenhaCliente` | `src/lib/auth/` |
| Schema de nova senha (senha 8–72 + confirmação + igualdade) | `schemaNovaSenhaCliente` | base compartilhada em `src/lib/validacoes/`; o do cliente acrescenta `next` |

Usados como estão: `ehSessaoDeRecuperacao`, `sanitizarNext`, `extrairIp`/`verificarRateLimit`, `AlertaErro`, componentes shadcn do `LoginForm`.

## Pendências de ambiente (bloqueiam a entrega, não são código)

- **SMTP próprio.** O SMTP embutido do Supabase só entrega para membros da equipe do projeto e tem limite baixo por hora. Confirmar em Auth → SMTP Settings que o projeto usa provedor próprio antes de liberar; sem isso, o link não chega a lojista real.
- **Redirect Allow List** conferida e listada no corpo do PR.

## Cruzamento com `cliente-identidade` (dívida registrada)

A porta cliente (`redefinirSenhaCliente`) **não** encerra as sessões depois da troca: mantém a sessão de recuperação e segue para `/minha-conta`. Outros dispositivos continuam logados, e a sessão de recuperação continua podendo trocar a senha sem a atual. É a mesma classe de risco de D2 e fica como issue própria, fora desta spec, para não misturar porta cliente com a entrega do lojista.

## Fora do Escopo (v1)

- **Trocar senha estando logado** (`/painel/configuracoes`) — feature distinta, sem token de e-mail; quando for feita, exige a senha atual (reautenticação). Issue separada.
- **Bloquear redefinição para conta só-Google** — descartado por D6.
- **MFA / magic link como login primário** — fora da Fase 1 (`modelo-negocio.md` §8).
- **Template de e-mail próprio** — v1 usa o template padrão, compartilhado com o cliente.
- **Aviso "sua senha foi alterada"** — desejável; antes de depender de e-mail transacional próprio, verificar se o Supabase oferece notificação de segurança nativa para troca de senha.
- **Lockout por conta após N tentativas** — v1 cobre rate limit por IP; lockout por conta é follow-up.
