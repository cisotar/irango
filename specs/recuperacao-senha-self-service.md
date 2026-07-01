# Spec: Recuperação de Senha (Self-Service Password Reset)

**Versão:** 0.1.0 | **Atualizado:** 2026-07-01

## Visão Geral

Permite que o **lojista** redefina a própria senha sem intervenção do suporte, usando o fluxo nativo do **Supabase Auth** (`resetPasswordForEmail` + `updateUser`). Resolve o problema de recuperação de acesso quando o lojista esquece a senha — hoje não existe fluxo, a única alternativa é criar outra conta (bloqueada por RN-01: 1 conta = 1 loja) ou pedir suporte manual.

Vive no **mundo auth** (`src/app/(auth)/`), ao lado de `login` e `cadastro`. Só afeta contas de lojista (Supabase Auth email/senha). Cliente final da vitrine não tem login (ver `architecture.md` §4) — está fora do escopo. Contas criadas via Google OAuth não têm senha própria; o fluxo trata isso sem revelar o método de login (anti-enumeração).

O SaaS não processa pagamento e esta feature não toca valor monetário — o eixo de segurança aqui é **identidade, token e anti-enumeração**, não recálculo de preço.

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|--------------------|
| **iRango (SaaS)** | Fornece as páginas, as Server Actions e o template de e-mail configurado no Supabase. Não vê nem armazena senha (Supabase Auth cuida do hash). |
| **Lojista** | Solicita o link de recuperação, recebe por e-mail, define nova senha. |
| **Cliente** | Não participa — não tem conta. |

## Páginas e Rotas

### Recuperar Senha — `/recuperar-senha`
**Mundo:** auth (sem sessão obrigatória; se já logado, pode redirecionar para `/painel`)
**Descrição:** Formulário de um campo (e-mail). Ao enviar, o lojista sempre vê a **mesma** mensagem genérica de sucesso ("Se existe uma conta com esse e-mail, enviamos um link para redefinir a senha."), exista ou não a conta. Nunca revela se o e-mail está cadastrado nem se a conta usa senha ou Google.

**Componentes:** (reuso do padrão de `LoginForm.tsx`)
- `FormRecuperarSenha` (Client Component novo, `src/app/(auth)/recuperar-senha/FormRecuperarSenha.tsx`) — react-hook-form + validação zod client (só UX), Card/Input/Label/Button do shadcn/ui, `sonner` para toast, `Loader2` do lucide-react. Espelha o layout do `LoginForm`.
- `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Input`, `Label`, `Button` — shadcn/ui existentes.
- `page.tsx` (Server Component) — renderiza o form dentro do `(auth)/layout.tsx` existente.

**Behaviors:**
- [ ] Digitar e-mail e validar formato no cliente (UX instantânea). Garantido em: cliente (UX) — a autoridade é a Server Action.
- [ ] Submeter o formulário. Garantido em: **Server Action `solicitarRedefinicaoSenha`** — rate limit + `resetPasswordForEmail`.
- [ ] Receber sempre a mesma mensagem genérica de sucesso, independente de a conta existir. Garantido em: **Server Action** (resposta idêntica em todos os caminhos — anti-enumeração, `seguranca.md` §17 "Anti-enumeração no login").
- [ ] Ser barrado ao exceder o limite de solicitações. Garantido em: **Server Action + rate limit por IP** (`rateLimit.ts`).
- [ ] Navegar de volta para `/login` via link "Voltar para o login". Garantido em: cliente (navegação).

---

### Nova Senha — `/nova-senha`
**Mundo:** auth (a sessão de recuperação é estabelecida pelo link do Supabase, não é sessão de painel comum)
**Descrição:** Página de destino do link enviado por e-mail. O Supabase, ao seguir o link, troca o código de recuperação por uma **sessão temporária de recuperação** (via cookies HttpOnly, fluxo PKCE do `@supabase/ssr`). A página exibe formulário de nova senha + confirmação. Se não houver sessão de recuperação válida (link expirado, já usado, adulterado), mostra estado de erro com CTA para `/recuperar-senha` — nunca o formulário.

**Componentes:**
- `route.ts` de callback de recuperação (reuso do padrão `auth/callback/route.ts`) — troca `code` por sessão via `exchangeCodeForSession`, sanitiza `next`/`redirectTo` (anti open-redirect, mesma função `sanitizarNext`), redireciona para `/nova-senha`. Ver "Fluxo do token" abaixo.
- `FormNovaSenha` (Client Component novo, `src/app/(auth)/nova-senha/FormNovaSenha.tsx`) — dois campos (senha + confirmação), toggle mostrar/ocultar (padrão do `LoginForm`), medidor/hint de força só como UX.
- `page.tsx` (Server Component) — verifica server-side se há sessão de recuperação (`supabase.auth.getUser()`); sem ela, renderiza o estado de erro em vez do form.

**Behaviors:**
- [ ] Chegar via link do e-mail e ter a sessão de recuperação estabelecida. Garantido em: **Route Handler de callback** (`exchangeCodeForSession` server-side + cookies HttpOnly).
- [ ] Ver estado de erro se o link é inválido/expirado/já usado. Garantido em: **Server Component** (`getUser()` sem sessão → erro; nunca renderiza o form).
- [ ] Digitar nova senha + confirmação, com validação de força e igualdade no cliente. Garantido em: cliente (UX) — não autoritativo.
- [ ] Submeter a nova senha. Garantido em: **Server Action `confirmarNovaSenha`** — revalida força no servidor + `updateUser({ password })` na sessão de recuperação. **crítico (TDD red-first).**
- [ ] Após sucesso, ser redirecionado para `/login?redefinida=1` com toast de confirmação. Garantido em: cliente (navegação) após retorno ok da action.
- [ ] Não conseguir reutilizar o mesmo link para uma segunda troca. Garantido em: **Supabase Auth** (token de uso único) + ausência de sessão de recuperação na 2ª visita.

---

### Login — `/login` (alteração)
**Mundo:** auth
**Descrição:** Adiciona o link "Esqueci minha senha?" e um banner de sucesso quando `?redefinida=1` está presente na URL.

**Componentes:**
- `LoginForm.tsx` (existente) — adicionar `<Link href="/recuperar-senha">` abaixo do campo de senha e banner condicional de sucesso.

**Behaviors:**
- [ ] Clicar em "Esqueci minha senha?" e ir para `/recuperar-senha`. Garantido em: cliente (navegação).
- [ ] Ver banner "Senha redefinida com sucesso. Entre com a nova senha." quando `?redefinida=1`. Garantido em: cliente (leitura de query param, cosmético).

---

## Modelos de Dados

**Nenhuma tabela nova. Nenhuma migration de schema. Nenhuma política RLS nova.**

O fluxo é 100% delegado ao **Supabase Auth** (`auth.users`, gerenciado pelo GoTrue). Senha, hash, expiração e uso-único do token vivem no Supabase — o iRango nunca lê nem grava em `auth.users` diretamente para esta feature. Não há estado de aplicação a persistir (`schema.md` inalterado).

**Configuração no Supabase (não é migration, é config do projeto — documentar no PR):**
- Template de e-mail **"Reset Password"** no painel Supabase Auth → deve apontar o link para o Route Handler de callback com `token_hash`/`code` + `type=recovery`, e definir `redirectTo` para a URL canônica do iRango.
- **Allow List de Redirect URLs** no Supabase Auth: incluir apenas a origem do iRango (`https://<dominio>/auth/callback` e equivalente de recuperação). Isso é a defesa de plataforma contra open-redirect no `redirectTo` — o Supabase recusa redirecionar para origem fora da lista.
- Expiração do token de recuperação: manter curta (padrão Supabase ~1h; avaliar reduzir). Uso único é garantido pelo GoTrue.

## Regras de Negócio

| # | Regra | Camada que garante |
|---|-------|--------------------|
| RN-01 | Resposta de `/recuperar-senha` é **idêntica** exista ou não a conta (mesma string, mesmo status, mesmo tempo aproximado). | **Server Action** — retorna sempre `{ ok: true }` genérico; não ramifica a resposta pela existência do e-mail. |
| RN-02 | Nunca revelar se a conta usa senha ou Google OAuth. | **Server Action** — mesma resposta genérica; `resetPasswordForEmail` para conta OAuth-only simplesmente não gera login utilizável, sem mensagem distinta. |
| RN-03 | Solicitação de recuperação é rate-limited por IP (anti-spam de e-mail). | **Server Action + `rateLimit.ts`** (nova chave `recuperarSenha` em `LIMITES`, sliding window por IP; IP via `extrairIp(headers())`, não forjável — `seguranca.md` §12). |
| RN-04 | Força mínima de senha revalidada no **servidor** (min 8, max 72 — limite bcrypt do GoTrue), nunca só no cliente. | **Server Action + zod** (reusa/estende `schemaCadastro.senha`: `z.string().min(8).max(72)`). O medidor de força no client é só UX. |
| RN-05 | Troca de senha só ocorre com **sessão de recuperação válida** (token trocado por sessão via callback). | **Route Handler (`exchangeCodeForSession`) + Server Action** (`updateUser` opera sobre a sessão atual; sem sessão de recuperação, falha). |
| RN-06 | Token de recuperação é de **uso único** e **expiração curta**. | **Supabase Auth (GoTrue)** — plataforma; o iRango não reimplementa. |
| RN-07 | `redirectTo`/`next` do link nunca causa open-redirect. | **Route Handler** (reusa `sanitizarNext`: só path interno, rejeita `//` e URLs absolutas) **+ Redirect Allow List do Supabase** (defesa em profundidade). |
| RN-08 | Erro interno nunca vaza detalhe ao cliente. | **Server Action** — `console.error` no servidor, mensagem genérica ao usuário (`seguranca.md` §14). |

### Fronteira cliente ↔ servidor (identidade/permissão, não dinheiro)
Esta feature não tem valor monetário — não há recálculo de preço/frete/desconto. O dado sensível é **identidade e senha**. O cliente **nunca** é autoritativo: quem pode trocar a senha é comprovado pela **sessão de recuperação** (estabelecida server-side a partir do token do e-mail), não por qualquer campo do payload. A senha em si é validada e persistida pelo Supabase Auth server-side; o iRango só orquestra.

## Segurança (obrigatório)

- **Dado sensível que entra/sai:** e-mail (PII) na solicitação; nova senha na confirmação. Nenhuma chave Pix, cupom ou valor monetário. E-mail e senha **nunca** aparecem em log, `exception.value` ou breadcrumb — o scrubber do Sentry (`seguranca.md` §21) é a última linha, não substituto de logging cuidadoso. Nunca `console.error(email)` nem `console.error(senha)`.
- **User enumeration (risco central):** `/recuperar-senha` responde idêntico exista ou não a conta (RN-01/RN-02). Espelha o padrão já decidido em `seguranca.md` §17 ("Anti-enumeração no login"). Diferença deliberada em relação ao **cadastro** (que revela "e-mail já cadastrado" por necessidade de UX) — aqui a recuperação **não** revela nada.
- **Token:** entregue via link do Supabase (fluxo PKCE / código de recuperação), trocado por sessão **no servidor** (`exchangeCodeForSession` no Route Handler, mesmo padrão de `auth/callback/route.ts`). Expiração curta + uso único garantidos pelo GoTrue (RN-06). A validação acontece **antes** de qualquer `updateUser`: sem sessão de recuperação, `/nova-senha` nem renderiza o form.
- **Rate limiting:** obrigatório na Server Action de solicitação (RN-03). Nova chave em `LIMITES` (`rateLimit.ts`). Fail-open é aceitável aqui (contenção de abuso/custo, não gate de autorização — `seguranca.md` §12). IP extraído server-side via `extrairIp`, nunca do payload.
- **Validação de força no servidor:** RN-04 — zod no servidor é a autoridade; o hint de força no cliente é cosmético.
- **Sessão após troca (invalidar demais sessões):** decisão de segurança — após `updateUser({ password })`, o Supabase Auth deve **invalidar as demais sessões ativas** do usuário (revogar refresh tokens), forçando novo login em outros dispositivos. Isso limita o dano de um sequestro anterior de conta. Verificar a config `Security → "Revoke other sessions on password change"` no painel Supabase Auth (ou revogar explicitamente via `signOut({ scope: 'others' })` na Server Action após o update). A sessão do dispositivo que redefiniu é encerrada e o fluxo termina em `/login` (novo login obrigatório).
- **Redirect seguro (open redirect):** RN-07 — dupla defesa: `sanitizarNext` no Route Handler + Redirect Allow List do Supabase. Nunca aceitar origem/URL absoluta vinda de query param.
- **API externa com key?** Não. Tudo via Supabase Auth (anon key no client é ok por design; service_role **não** é necessário — o fluxo usa a sessão de recuperação do próprio usuário, não elevação de privilégio).
- **Tabela nova → RLS?** Não há tabela nova; nenhuma política RLS a criar.

### Issues críticas (exigem TDD red-first — `crítica: SIM`)
- **`confirmarNovaSenha`** (troca de senha sob token): autorização por sessão de recuperação + revalidação de força + invalidação de sessões. Autenticação/permissão → **TDD red-first obrigatório**.
- **`solicitarRedefinicaoSenha`** (anti-enumeração + rate limit): a invariante "resposta idêntica exista ou não a conta" é testável e é o coração da segurança → **TDD red-first obrigatório** (teste que falha se a resposta ramificar pela existência do e-mail).
- **Route Handler de callback de recuperação** (troca de token + `sanitizarNext` anti open-redirect): se reusar `auth/callback` já testado, cobrir os novos caminhos; se novo handler, red-first no `sanitizarNext` e no caminho sem `code`.

Páginas e forms (UI) e a alteração no `LoginForm` são não-críticos (cosméticos/navegação) — teste padrão, não red-first.

## Fora do Escopo (v1)

- **Recuperação de conta de cliente final** — cliente da vitrine não tem login (`architecture.md` §4). Nunca terá senha na v1.
- **Reset de senha para contas Google OAuth** — conta sem senha própria; o fluxo responde genérico mas não cria/altera senha para login social. Vincular senha a conta OAuth é fora do escopo.
- **Fluxo de "trocar senha estando logado"** (dentro de `/painel/configuracoes`) — é feature distinta (usuário autenticado, sem token de e-mail). Não faz parte desta spec.
- **2FA / MFA / magic link como login primário** — não está no roadmap da Fase 1 (`modelo-negocio.md` §8).
- **E-mail transacional próprio (SMTP/domínio custom, template rico)** — v1 usa o remetente e template padrão do Supabase Auth. Provedor SMTP dedicado é follow-up.
- **Notificação ao lojista de "sua senha foi alterada"** — desejável para segurança, mas depende de e-mail transacional próprio; fase 2.
- **Bloqueio/lockout de conta após N tentativas** — v1 cobre só rate limit por IP na solicitação; lockout por conta é follow-up.
