# [336] Validações e auth do cliente: cadastro, login, recuperação por link, Google com `contexto=cliente`

**crítica:** SIM (TDD red-first)
**vetor:** V3 (auth · input)
**Mundo:** auth
**Depende de:** 335 (`atribuir_papel_inicial(…,'cliente')` e `clientes.ultimo_acesso_em`)
**Spec:** specs/cliente-identidade.md
**Branch:** feat/clientes-identidade
**Plano:** P15 (RED B3/B4) → execução

## Objetivo
Entregar os schemas zod do cliente e as Server Actions/ajustes de callback que criam a conta, autenticam e
recuperam a senha por **link** (decisão 10 alterada — sem OTP), sem jamais dar `lojista` ou loja à porta cliente.

## Behaviors do spec que esta issue fecha
- Entrar: "Clicar Continuar com Google e voltar ao `next`"; "Conta Google nova … recebe `cliente`, nunca `lojista`";
  "Conta Google nova sem perfil é levada a `/conta/completar`" (destino do callback); "Erro no Google volta para
  `/conta/entrar?erro=google`"; "Entrar com e-mail e senha"; "E-mail não confirmado → recusa"; "Credencial inválida →
  mensagem genérica única"; "Entrar com conta só-lojista … sem mudar papel"; "Atualizar `ultimo_acesso_em`".
- Cadastro: "Criar conta por e-mail"; "Nenhum dado de perfil antes da confirmação"; "Campo extra → rejeitado";
  "E-mail já cadastrado → mensagem, sem `deleteUser`"; "Ver o estado Confirme seu e-mail; nenhuma sessão";
  "Link de confirmação cai em `/conta/completar`, nunca `/painel`" (camada callback); "Mensagens genéricas".
- Recuperar senha: os 5 behaviors (pedir link, callback com sessão de recuperação, nova senha, link inválido,
  destino pós-redefinição) na camada servidor.
- RN-03, RN-05, RN-06, RN-07, RN-14, RN-15, RN-16.

## Escopo
- [ ] **Utilitário base:** extrair `sanitizarNext` do callback para `src/lib/utils/` sem mudar a regra
  (callback passa a importar; `route.test.ts` continua verde). Reusado por 337 e 339.
- [ ] `src/lib/validacoes/cliente.ts`: `schemaCadastroCliente` (e-mail + senha 8–72, `.strict()`),
  `schemaEntrarCliente`, `schemaRecuperacaoCliente`, `schemaNovaSenhaCliente` (com confirmação), e os schemas de
  perfil/endereço usados por 337: `schemaPerfilCliente` (nome ≤120, telefone regex de `pedido.ts:112`,
  `data_nascimento` 18+/não futura/≤120 com data de referência injetável), `schemaCompletarPerfil`
  (+ `aceiteTermos: z.literal(true)` + endereço), `schemaEnderecoCliente` (= `schemaEnderecoCheckout` + rótulo
  `.trim().min(1).max(30)` sem `\n`, complemento ≤100). Todos `.strict()`.
- [ ] `src/lib/utils/rateLimit.ts`: chaves `cadastroCliente`, `loginCliente`, `recuperacaoCliente` ≤5/min.
- [ ] `src/lib/actions/clienteAuth.ts`: `cadastrarCliente`, `entrarCliente`, `solicitarRecuperacaoCliente`,
  `redefinirSenhaCliente`, conforme o spec.
- [ ] `src/lib/auth/googleOAuth.ts`: opções `{ contexto?: "cliente"; next?: string }` → `redirectTo`
  `/auth/callback?contexto=cliente&next=…`; sem opções = comportamento atual. `BotaoGoogle.tsx` aceita e repassa.
- [ ] Callback `src/app/(auth)/auth/callback/route.ts`: só o literal `contexto=cliente` troca o papel inicial para
  `cliente`; destino sem perfil → `/conta/completar`; erro → `/conta/entrar?erro=google`; `ultimo_acesso_em` quando há
  perfil (service_role); caminho `next=/conta/recuperar?etapa=nova-senha` sem atribuir papel a conta existente.
- [ ] `src/lib/utils/papeis.ts` `destinoPadraoPorPapel`: ramo cliente → `/minha-conta`.

## Fora de escopo
- Ações de perfil/endereços/exclusão e `completarPerfilCliente` (337). Telas e modal (339). Template de e-mail
  (não muda). Troca de e-mail/senha logado (fora do Marco B).

## Reuso esperado
- `atribuirPapelInicial`, `buscarPapeisDoUsuario` (Marco A); `verificarRateLimit`; `schemaCadastro` (regra de senha);
  `schemaEnderecoCheckout` (`src/lib/validacoes/pedido.ts`) — estender, não copiar.
- Padrão de `src/lib/actions/auth.ts` (lojista) e de `specs/arquivo/`/recuperação por link do lojista.
- `googleOAuth.test.ts` como molde do teste do helper.

## Segurança
- Anti-enumeração em login e recuperação (`seguranca.md` §17); PII nunca em log (§21).
- `signUp` sem `options.data`; nunca chama `criarLoja`/`garantir_loja_do_dono`; nunca `deleteUser` de compensação.
- `contexto` controlado pelo dono da conta e protegido por PKCE; aceitar só o literal.

## RED (fatias B3/B4 ajustadas pelas alterações 23–24 — capturar `FAIL` antes do código)
`src/lib/validacoes/cliente.test.ts`:
- [ ] Rótulo `.trim().min(1).max(30)` sem `\n`; nome `.max(120)`; complemento `.max(100)`; campo extra → rejeitado.
- [ ] `data_nascimento` com menos de 18 anos, futura ou acima de 120 anos → rejeitada; borda do 18º aniversário com
  data fixa (sem depender do relógio).
- [ ] `schemaCadastroCliente` rejeita `aceiteTermos`, `nome`, `telefone`, `papel`, `loja_id`, `id`, `cliente_id`.
- [ ] `schemaCompletarPerfil` sem `aceiteTermos === true` → rejeitado.
`src/lib/actions/clienteAuth.test.ts`:
- [ ] `cadastrarCliente` nunca chama `criarLoja`/`garantir_loja_do_dono`; chama `signUp` sem `options.data` e com
  `emailRedirectTo` contendo `contexto=cliente`; grava papel `cliente`; e-mail existente → mensagem, sem `deleteUser`.
- [ ] `solicitarRecuperacaoCliente` devolve a MESMA resposta para e-mail existente, inexistente e conta Google, e
  chama `resetPasswordForEmail` em todos os casos.
- [ ] `LIMITES.cadastroCliente`/`loginCliente`/`recuperacaoCliente` ≤ 5/min.
- [ ] `redefinirSenhaCliente` sem sessão de recuperação → erro genérico, sem `updateUser` efetivo.
- [ ] `entrarCliente` com e-mail não confirmado → mensagem da decisão 18, sem sessão (faz `signOut` se houver);
  inexistente e senha errada → mesma mensagem.
- [ ] `.strict()` rejeita `papel`/`loja_id` injetados em todas as actions.
`googleOAuth.test.ts` / `route.test.ts` (casos novos, sem alterar asserção existente):
- [ ] `entrarComGoogle({contexto:"cliente", next})` monta o `redirectTo` esperado; sem opções = atual.
- [ ] Callback com `contexto=cliente` chama `atribuir_papel_inicial(…,'cliente')`; com `contexto` ausente/vazio/
  outro valor → `lojista` (como hoje); erro com `contexto=cliente` → `/conta/entrar?erro=google`.
- Fora do RED: modal da decisão 13 (UX, sem jsdom — checklist da 339).

## Critério de aceite
- [ ] RED com `FAIL` capturado; depois verde; `git diff` não altera asserção existente em `route.test.ts`/
  `googleOAuth.test.ts`/`auth.test.ts`.
- [ ] `tsc`, lint, suíte e build verdes.

## Dúvidas
- Issue 334 (item 2) trata `atribuir_papel_inicial` em conta **não confirmada** no `cadastrar` do lojista. O spec
  manda `cadastrarCliente` gravar `cliente` logo após o `signUp` (antes da posse do e-mail), o mesmo padrão. Se a 334
  mudar a regra, `cadastrarCliente` deve seguir o resultado dela — decidir a ordem 334 × 336 no `planejar`.
- Spec fala em "rate limit por IP"; confirmar que `verificarRateLimit` já chaveia por IP para as novas chaves.
