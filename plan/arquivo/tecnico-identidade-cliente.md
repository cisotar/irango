# Plano técnico — identidade e papel (lojista × cliente × admin)

Produzido pelo `arquitetar` no passo P1 de `plan/loop-cadastro-de-clientes.md` (Marco A). Aplicado em
`tasks/332-gate-de-papel-no-painel.md`. Base conferida: `main` @ `a1ad354` (nenhum arquivo do Marco A mudou
desde `50789b8`). **Status: aprovado (2026-10-01); Marco A entregue no PR #171.**

> Versionado após o fix (PR #171) estar em produção.

As decisões 1–22 do plano são restrições e não são rediscutidas aqui. Este documento escolhe só o que o plano
delegou (itens a–h) e diz, para cada invariante, em que camada ela é garantida.

## Resumo para aprovação

| Item | Recomendação |
|---|---|
| (a) pool × contrato | Pool único de `auth.users` com papel explícito. Já fechado pelas decisões 1 e 15. |
| (b) onde o papel mora | Tabela `public.papeis_usuario (usuario_id, papel)`, escrita só por função `SECURITY DEFINER` executável por `service_role`. Nem `app_metadata`, nem papel derivado de linha. Admin continua sendo a env `SAAS_ADMIN_USER_ID`. |
| (c) gate | `decidirAcessoBase` recebe os papéis e ganha a decisão `"sem-papel-lojista"`. O layout nunca chama `garantirLojaDoDono` sem papel lojista e redireciona pelo destino do papel (Marco A: admin → `/admin`, demais → `/`). |
| (d) callback | `next` sanitizado vence. Sem `next`: admin → `/admin`, lojista → `/painel`, demais → `/` (no Marco B, cliente → entrada do mundo cliente). Quem não é lojista nunca vai para `/painel`. |
| (e) migration | Sim: `<ts>_papel_cliente.sql` (tabela, RLS, função de atribuição, trigger em `lojas`, backfill). Vai ao cloud antes do código e funciona com o código que está em produção hoje. |
| (f) marcar sem corrida | Um único primitivo, `atribuir_papel_inicial(usuario, papel)`: dá o primeiro papel a conta sem papel, com lock por usuário, e nunca altera conta que já tem papel. Usado por `cadastrar`, pelo callback (porta `(auth)` = lojista; no Marco B, `contexto=cliente`), por `cadastrarCliente` e pelo trigger de `lojas`. |
| (g) backfill | Toda conta pré-existente sem papel recebe `lojista` na mesma migration (até o Marco B toda conta nasceu num fluxo de lojista). O admin não precisa, porque o papel dele vem da env. |
| (h) papéis acumuláveis | Uma única função acrescenta papel a conta que já tem papel: `adicionar_papel_cliente` (Marco B), chamada com a sessão do próprio usuário. Ela só acrescenta `cliente`; nada remove papel e nada acrescenta `lojista`. Precedência de destino: admin > lojista > cliente. |

**Decidido pelo usuário (2026-10-01):** L1 = (A) recusar. Ordem do RED: P3 (`tdd`, RED de banco e de aplicação) antes de
P2 (`migrar`). Versionar ADR e issue só depois de a brecha estar fechada em produção.

## 1. Diagnóstico

**A brecha.** Em `src/app/(painel)/painel/layout.tsx:65-85`, o ramo `"onboarding"` de `decidirAcessoBase`
(`src/lib/utils/acessoPainel.ts:84-87`: sessão, e-mail confirmado e nenhuma loja) chama `garantirLojaDoDono`
(`:74`). Essa chamada executa a RPC `SECURITY DEFINER` `garantir_loja_do_dono`
(`supabase/migrations/20260615011500_garantir_loja_do_dono.sql`) via `service_role` e cria uma loja para o
`user.id`, sem nenhuma outra condição. O callback (`src/app/(auth)/auth/callback/route.ts:46`) manda para
`/painel` todo usuário que não é admin.

**O mesmo fato em dois caminhos que o plano não cita:**
- `supabase/migrations/20260614001000_rls_lojas.sql:29-31` (`lojas_insert_proprio`, `WITH CHECK (auth.uid() =
  dono_id)`), somado ao `GRANT ALL` dado a `authenticated` (`20260614008500_grants_roles_supabase.sql:20`):
  qualquer conta autenticada insere a própria loja direto pelo PostgREST, com as colunas de billing nos valores
  padrão. `tests/migrations/trigger_protege_billing_v3.test.ts:298-304` ([128-11]) trava isso como
  comportamento legítimo. Nenhum código do app usa esse caminho: todo INSERT de loja passa por `service_role`.
- `src/app/admin/assinantes/actions.ts:46-99` (`criarLojaAdmin`): o admin cria loja para qualquer conta que
  encontrar pelo e-mail (`resolverDonoPorEmail`), gravando via `criarLoja` sob `service_role`.

Hoje os três caminhos são inofensivos, porque toda conta é de lojista. Quando existirem contas de cliente
(Marco B), os três passam a transformar cliente em dono de loja, o que a decisão 12 proíbe.

**Causa raiz.** O sistema não tem o conceito de papel. "Conta autenticada" é tratada como "lojista" em três
camadas: o guard do layout, o destino do callback e a RLS de INSERT de `lojas`. A invariante "só lojista é dono
de loja" não está escrita em lugar nenhum. Consertar só o layout deixaria os outros dois caminhos abertos e
continuaria sem dar ao callback um jeito de distinguir quem é quem.

**Por que é complexo.**
1. A mudança toca auth em três pontos (layout, callback e cadastro) e também o banco.
2. O ramo `"onboarding"` não serve só para reparo. Hoje é por ele que a conta Google nova do lojista ganha
   loja (callback → `/painel` → auto-cura). Desligar o ramo quebraria o cadastro do lojista pelo Google.
3. A migration chega ao cloud antes do código e precisa conviver com o código antigo enquanto o deploy não sai.
4. O Marco B (Google como porta principal do cliente) depende de o callback saber por qual porta a conta nasceu.

## 2. Decisões

### (a) Pool único de `auth.users` com papel explícito × contrato separado

**Recomendação: pool único, papel explícito.** As decisões 1 ("conta única no iRango") e 15 ("o mesmo
usuário pode ser lojista E cliente") já fecham este item. Um contrato separado (segundo projeto Supabase, ou
tabela de usuários própria fora do GoTrue) obrigaria o lojista a ter duas contas para comprar, e a decisão 15
proíbe isso. O que sobra decidir é como o papel fica explícito, e isso é o item (b).

### (b) Onde o papel mora

**Recomendação: tabela `public.papeis_usuario`.**

```sql
papeis_usuario (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  papel      text not null check (papel in ('lojista', 'cliente')),
  criado_em  timestamptz not null default now(),
  primary key (usuario_id, papel)          -- papel é conjunto (decisão 15)
)
```

- RLS ligada. A única policy permite SELECT da própria linha para `authenticated`.
- `revoke all` de `anon`/`authenticated` e `grant select` só para `authenticated`. Negar a operação é mais
  forte do que só não ter policy (mesmo molde de `20260923060457_pedidos_remove_insert_publico.sql`).
- Escrita só por funções `SECURITY DEFINER` com `EXECUTE` exclusivo de `service_role` (item f).
- `'cliente'` entra no CHECK já no Marco A. Assim o RED consegue provar "cliente nunca ganha loja" antes de
  existir conta de cliente.
- O admin não vira linha na tabela (item g).

| Opção | Contra | A favor |
|---|---|---|
| (b1) `app_metadata.papeis` | Em todo login OAuth o GoTrue reescreve `raw_app_meta_data` inteiro a partir de uma cópia em memória (`UpdateAppMetaDataProviders` → `UpdateAppMetaData`), e uma escrita nossa feita ao mesmo tempo pode se perder. Gravar pelo Admin API fica fora da transação que cria a loja (a mesma classe de problema do `HACK` de compensação em `auth.ts:130`). Gravar por SQL significa escrever no schema `auth`, que o Supabase gerencia. `auth.jwt()` fica desatualizado até o token renovar. O stub de `auth.users` no pglite não tem `raw_app_meta_data` (`tests/helpers/pglite.ts:20-24`). | Vem pronto no `getUser()`. O usuário não consegue escrever: `PUT /user` recusa `app_metadata` sem privilégio de admin. |
| (b2) papel derivado de linha (`lojas` ⇒ lojista, `clientes` ⇒ cliente) | Não representa o lojista órfão legítimo. A conta Google nova que veio de `/cadastro` fica sem loja e sem perfil até o primeiro `/painel`, igual a um cliente no meio do cadastro pelo Google (decisão 19: sem aceite, sem perfil). Para não travar esse lojista, o gate teria de auto-curar quem não tem linha nenhuma, e a brecha voltaria. | Dispensa migration de papel e backfill. |
| (b3) `papeis_usuario` ✅ | Uma tabela a mais e uma query a mais no layout, feita em paralelo com a da loja. | Fica na mesma transação que cria a loja (via trigger). A leitura é sempre atual, sem depender de JWT. Permite lock por usuário. O `on delete cascade` limpa tudo quando a conta é excluída. Dá para testar no harness atual sem mudar o stub de `auth.users`. É o padrão que a própria documentação do Supabase recomenda para dado de usuário ("create your own user tables in the `public` schema"). |
| (b4) custom access token hook | Só complementa (b3), levando o papel para o JWT. Não resolve onde o papel mora, exige configuração no dashboard e herda o atraso do JWT. | Não é necessário: ninguém lê o papel do JWT. |

**`user_metadata` está fora.** O próprio usuário o escreve (`updateUser({ data })`), e o GoTrue o sobrescreve
com os dados do provedor em todo login OAuth (`external.go:327`, `:392`). A documentação proíbe usá-lo em
autorização.

**Atualidade da marca.** Quem decide acesso lê a marca da tabela, nunca do token:
- o layout lê com o client da sessão (RLS da própria linha);
- o callback e as Server Actions leem pela RPC (`service_role`);
- o banco lê direto (trigger e RPC).

Se algum dia uma policy precisar do papel, ela usa `exists (select 1 from public.papeis_usuario where usuario_id
= (select auth.uid()) and papel = …)`, e não `auth.jwt()`. O gate continua lendo a sessão com `getUser()`, que
consulta o servidor de auth; `getClaims()` e `getSession()` não servem para decidir acesso.

### (c) Gate fail-closed do `/painel`

**Recomendação.** `decidirAcessoBase(user, loja, papeis)` continua uma função pura em `acessoPainel.ts`, ganha
a decisão `"sem-papel-lojista"` e passa a seguir esta precedência:

1. `user === null` → `"login"`
2. `papeis` sem `"lojista"` → `"sem-papel-lojista"`, com ou sem loja e com ou sem e-mail confirmado
3. e-mail não confirmado → `"confirmar-email"`
4. sem loja → `"onboarding"` (lojista órfão legítimo, definido abaixo)
5. caso contrário → `"ok"`

Como o layout se comporta:
- Lê a loja e os papéis em paralelo.
- Em `"sem-papel-lojista"`, faz `redirect(destinoPadraoPorPapel(...))` e nunca chega a `garantirLojaDoDono`.
- Destino no Marco A: admin (pela env) → `/admin`; demais → `/` (a landing). No Marco B, o ramo cliente passa a
  ir para `/minha-conta` (nome final definido no spec P9).
- Nenhum destino desse ramo é `/painel`, então não há loop.
- Se a leitura dos papéis falhar, vale o mesmo `catch` de hoje: `/login?erro=sessao`.

**Por que o papel vem antes do e-mail.** Uma conta sem papel de lojista nunca vê telas do mundo lojista
(`/confirmar-email` é do lojista; o cliente terá regra própria, decisão 18). Para o lojista nada muda: todas as
precedências antigas continuam valendo com `papeis = ["lojista"]`.

**Lojista órfão legítimo** é a conta que tem a linha `lojista` em `papeis_usuario` e nenhuma linha em `lojas`.
São quatro casos:
- conta Google nova que veio de `(auth)`, entre o callback e o primeiro `/painel`;
- `cadastrar` em que `criarLoja` falhou e a compensação também falhou;
- conta pré-existente sem loja (recebe a marca pelo backfill);
- lojista cuja loja foi excluída pelo admin (`excluirLoja`). A auto-cura já recria essa loja hoje e continua
  recriando.

**Barreira no banco, independente do layout.** O trigger `BEFORE INSERT OR UPDATE OF dono_id` em `lojas`
(itens e/f) impede que uma conta só-cliente seja dona de loja por qualquer caminho: a RPC, o `criarLoja` do
cadastro, o `criarLojaAdmin` (que depende da lacuna L1) e o INSERT direto pelo PostgREST. É a camada que a
decisão 11 exige ("garantido por RLS, não por UI oculta").

**Alternativas descartadas:**
- Liberar `"ok"` só por ter loja: uma loja criada por fora do app abriria o painel.
- Apagar o ramo `"onboarding"`: quebra o cadastro do lojista pelo Google e o reparo D2 (`auth.ts:131`).
- Ler o papel do token ou de cookie: o valor fica desatualizado e o cliente controla o cookie.

### (d) Callback: destino por papel

**Recomendação.**
- `next` sanitizado (`sanitizarNext`, sem alteração) sempre vence.
- Sem `next`, o destino é `destinoPadraoPorPapel({ ehAdmin, papeis })`:
  - admin → `/admin`;
  - lojista, com ou sem papel de cliente → `/painel`;
  - demais → `/` (no Marco B, cliente → `/minha-conta`).
- Os papéis vêm do retorno de `atribuir_papel_inicial` (item f), chamada com o `user.id` devolvido por
  `exchangeCodeForSession`, nunca com parâmetro da URL.
- `reconciliarPosConfirmacao` só roda se `papeis` contém `lojista`, porque só lojista pode ter loja e
  assinatura para reconciliar. O helper só lê e vincula assinatura a uma loja que já existe; ele não cria loja.
  Para conta sem loja ele já termina em `reconciliarPosConfirmacao.ts:31-34`.
- Se a RPC falhar → `/login?erro=auth`, com detalhe só no log (o mesmo tratamento da falha na troca de código).
- `data.user` nulo sem erro é um caso degenerado e mantém o comportamento atual.

Com mais de um papel (decisão 15), a ordem é admin > lojista > cliente, e `next` fica acima de todos.

### (e) Exige migration?

**Sim: `supabase/migrations/<ts>_papel_cliente.sql`** (mantém o nome que o plano usa). A migration é
idempotente e faz quatro coisas:

1. cria a tabela `papeis_usuario`, com RLS e grants (item b);
2. cria a função `public.atribuir_papel_inicial(p_usuario_id uuid, p_papel text) returns text[]` (item f);
3. cria a função de trigger `public.lojas_exige_dono_lojista()` e o trigger `BEFORE INSERT OR UPDATE OF dono_id
   ON public.lojas` (itens c/f);
4. faz o backfill (item g).

**`garantir_loja_do_dono` não é recriada.** A barreira fica no trigger, que o INSERT feito pela RPC atravessa.
Recriar a função exigiria repetir o `REVOKE`, porque os default privileges do projeto dão `EXECUTE` a
`anon`/`authenticated` em toda função nova (`20260614008500:31`). Sem recriar, o ACL atual continua valendo
(`20260615011500:133-135`: só `service_role`).

**Ordem de deploy: a migration vai ao cloud ANTES do código do gate.**
- Código sem a tabela: o layout cai no `catch` e todo lojista vai para `/login?erro=sessao`.
- Migration antes do código é seguro: a migration funciona com o código que está em produção, porque o trigger
  marca como `lojista` o dono de toda loja que esse código criar (`cadastrar`, auto-cura, admin). Por isso o `db
  push` de P2 pode acontecer antes do merge sem deixar uma janela quebrada.

**Rollback:** primeiro reverter o código, depois a migration (drop do trigger, das duas funções e da tabela).

### (f) Como cada caminho marca o papel sem corrida

**Primitivo único: `atribuir_papel_inicial(usuario, papel)`.** É `SECURITY DEFINER`, com `set search_path = ''`
e `EXECUTE` só para `service_role`.
- Pega um `pg_advisory_xact_lock` por usuário (mesmo molde de
  `20260927124000_modais_sazonais_teto_por_loja.sql:45-48`).
- Se a conta **não tem nenhum papel**, grava o papel pedido. Se já tem algum, **não muda nada**.
- Devolve os papéis atuais (`text[]`).

**Conta nova × conta existente.** A pergunta vira "a conta tem papel ou não", e o banco responde sob lock.
Heurística por `created_at` ou `last_sign_in_at` não serve: o linking automático do GoTrue acrescenta uma
identidade nova a uma conta antiga, e os timestamps enganam. Depois do backfill toda conta que já existia tem
papel, e todo caminho de criação dá um. "Sem papel" passa a significar conta recém-criada, ou resto de falha,
que se comporta do mesmo jeito.

Quem chama, caminho por caminho:

| Caminho | Papel pedido | Quando | Se a conta já tem outro papel |
|---|---|---|---|
| `cadastrar` (lojista, e-mail), Marco A | `lojista` | logo após o `signUp`, antes de `criarLoja` | Recusa com "Este email já está cadastrado.", sem criar loja e **sem compensação**. Detalhe do caso de e-mail já existente logo abaixo. |
| callback pela porta `(auth)` (Google em `/login`/`/cadastro`, links de e-mail do lojista), Marco A | `lojista` | depois de `exchangeCodeForSession`, em todo login | Nada muda. O destino segue o papel que a conta já tem. |
| trigger em `lojas` (RPC de auto-cura, `criarLoja` do cadastro, `criarLojaAdmin`, PostgREST), Marco A | `lojista` | na mesma transação do INSERT | Conta só-cliente → `raise`, e nada é gravado (no caminho do admin, ver **lacuna L1**). Lojista, com ou sem cliente → segue. Se um usuário final pede loja para **outro** dono, o trigger não consulta o papel alheio e deixa a policy recusar; assim o trigger não vira oráculo de papel. |
| callback pela porta cliente (`redirectTo` com `contexto=cliente`), Marco B | `cliente` | depois de `exchangeCodeForSession` | Nada muda. O lojista que entra pela vitrine continua lojista e só ganha `cliente` pelo item (h). |
| `cadastrarCliente` (e-mail), Marco B | `cliente` | logo após o `signUp` | Conta existente de lojista → "Este email já está cadastrado.", sem compensação. |

**`cadastrar` com e-mail que já tem conta** (`src/lib/actions/auth.ts:73-113`). Hoje a action usa o `user.id`
devolvido pelo `signUp` para criar a loja, sem conferir se a conta é nova. Há três situações:

| Conta já existente | O que o `signUp` devolve | O que acontece com o desenho recomendado |
|---|---|---|
| Confirmada, com **Confirm email** e **Confirm phone** ligados | Usuário mascarado, com id aleatório e sem erro (doc oficial do `signUp`, ver §7) | A RPC falha por FK (o id não existe) → mensagem genérica, sem loja, sem papel e sem `deleteUser`. Hoje a falha acontece no `criarLoja`, com a mesma mensagem. |
| Confirmada, com **Confirm email** ou **Confirm phone** desligado | Erro `User already registered` (mesma doc) | A action já para em `auth.ts:76-81` ("Este email já está cadastrado."), antes do passo de papel. Sem mudança. |
| Ainda não confirmada | A **própria conta existente**, com o id real. O GoTrue não altera a conta (a senha digitada é ignorada) e reenvia o e-mail de confirmação (`signup.go:193-198`, `:250`, `:344`). A doc não cobre esse caso. | `atribuir_papel_inicial` não muda conta que já tem papel e devolve os papéis dela. Se não houver `lojista` (conta só-cliente), a action recusa com "Este email já está cadastrado." **antes** de `criarLoja` e **sem compensação**: ela não criou essa conta e nunca pode apagá-la. Se for conta de lojista, segue o fluxo de hoje (RN-01 recusa a segunda loja). |

Resultado: por este caminho uma conta que já existe como cliente nunca ganha loja nem papel de lojista, mesmo
que a action tenha uma falha (o trigger recusa a loja no banco). O papel não depende da senha nem do payload.

**`criarLojaAdmin`** (`src/app/admin/assinantes/actions.ts:46-99`). O admin cria loja para uma conta que já existe,
achada por e-mail (`resolverDonoPorEmail`), via `criarLoja` sob `service_role`. A marcação fica com o trigger, na
mesma transação:
- conta sem papel → recebe `lojista`;
- conta lojista → segue (o índice único `lojas(dono_id)` já recusa uma segunda loja).

O que fazer com conta só-cliente **não está decidido** e é a **lacuna L1**. Enquanto não houver decisão, o trigger
recusa, que é o estado fail-closed. Isso não pesa no Marco A, porque ainda não existe conta de cliente.

**Parâmetros do `redirectTo`.** Quem inicia o fluxo controla o `contexto` e o `next`. Por isso o `contexto` só
decide o **primeiro** papel de uma conta sem papel. Quem inicia o fluxo que cria a conta é o próprio dono dela,
escolhendo entre dois cadastros que já são públicos. Conta existente nunca ganha papel pelo callback, com ou sem
parâmetro.

No Marco A o callback nem lê `contexto`: a porta `(auth)` vale `lojista`, e `googleOAuth.ts` não muda. O Marco B
acrescenta o parâmetro, com teste garantindo que o botão do mundo cliente sempre o envia. O PKCE impede que
alguém faça o callback de outra pessoa trocar um `code` alheio, porque o code verifier fica no navegador de quem
iniciou o fluxo.

**Corridas:**
- Dois callbacks da mesma conta nova (duas abas): o lock garante um único papel.
- Callback de cliente × criação de loja da mesma conta: o trigger usa a mesma função e o mesmo lock. Se `cliente`
  vence, a loja é recusada; se a loja vence, a conta vira lojista e o callback de cliente não muda nada.
- Loja que falha depois de o trigger dar o papel: o rollback desfaz os dois juntos.

### (g) Backfill dos usuários existentes (decisão 14)

**Recomendação.** Na mesma migration:

```sql
insert into papeis_usuario
select u.id, 'lojista'
from auth.users u
where not exists (/* nenhum papel */)
on conflict do nothing;
```

Até o Marco B, toda conta em `auth.users` nasceu num fluxo de lojista (`cadastrar` ou Google em `(auth)`). Por
isso o backfill cobre:
- quem já tem loja (decisão 14);
- o órfão pré-existente, que hoje ganha loja ao abrir o `/painel` e, sem o backfill, perderia o acesso (contra
  o "não perdem acesso" da decisão 14).

Reaplicado, o backfill não mexe em conta que já tem papel. As contas criadas entre o `db push` e o deploy do
código recebem `lojista` pelo trigger, porque toda loja que o código atual cria passa por ele.

Pré-condição: esta migration roda antes de qualquer migration do Marco B, tanto na ordem dos timestamps quanto
no deploy.

**O admin não precisa de backfill, e nem poderia recebê-lo.** O admin do SaaS não está no banco: ele é um único
user id na env `SAAS_ADMIN_USER_ID` (`src/lib/auth/admin.ts:9-32`), lido em runtime por `ehAdminSaaS`
(fail-safe, usado no callback) e por `verificarAdminSaaS` (fail-closed, usado nas áreas e ações de admin).
- Uma migration SQL roda no banco e não lê a env da Vercel, então não tem como saber quem é o admin.
- O único jeito de marcá-lo pela migration seria escrever o UUID real dele no arquivo, e isso está fora de
  questão: o repo é público e a regra proíbe qualquer id real em arquivo.
- Gravar `admin` na tabela por outro caminho criaria uma segunda fonte de verdade.

A saída é a que a própria decisão 14 prevê ("se o ADR escolher papel derivado, não há backfill"): o papel de
admin continua derivado da env.

O admin pré-existente é uma conta pré-existente como as outras: recebe `lojista` pelo backfill (hoje ele já
ganharia loja ao abrir o `/painel`, então nada muda) e continua indo para `/admin`, porque o callback testa a env
antes do papel.

### (h) Papéis acumuláveis (decisão 15)

**Recomendação.**
- **Onde:** só numa sessão autenticada do próprio usuário. No Marco B é o passo "ativar perfil de cliente", o
  mesmo passo complementar do pós-Google, com aceite de termos (decisão 19). A Server Action usa o `auth.uid()`
  da sessão, nunca e-mail nem payload.
- **Como:** uma função nova do Marco B, `adicionar_papel_cliente(usuario)` (`SECURITY DEFINER`, `EXECUTE` só para
  `service_role`), de preferência na mesma transação que cria o perfil em `clientes`. É a **única** função que
  acrescenta papel a uma conta que já tem papel, e ela só acrescenta `cliente`.
- **Sem perder o papel atual:** nenhuma função remove papel, o `DELETE` está revogado e a linha só some junto
  com a conta (FK `on delete cascade`). Como `lojista` só nasce em conta sem papel (item f), ganhar `cliente`
  nunca dá `lojista` e nunca tira `lojista`.
- **Destino:** admin > lojista > cliente, com `next` sanitizado acima de todos (item d). Lojista+cliente vai para
  `/painel` sem `next`; admin+cliente vai para `/admin`.
- **Admin dando `lojista` a quem já é cliente** (via `criarLojaAdmin`): não está decidido, é a **lacuna L1**. Com
  (A), tudo o que está acima vale como está. Com (B), entra uma segunda função, só do admin, que acrescenta
  `lojista`. O trigger e a regra "ganhar `cliente` nunca dá nem tira `lojista`" continuam valendo nos dois casos.

## 3. Mecânica

### Banco (esboço; o SQL final é escrito em P2)

```sql
create table if not exists public.papeis_usuario ( /* item (b) */ );
alter table public.papeis_usuario enable row level security;
drop policy if exists "papeis_usuario_leitura_propria" on public.papeis_usuario;
create policy "papeis_usuario_leitura_propria" on public.papeis_usuario
  for select to authenticated using (usuario_id = (select auth.uid()));
revoke all on public.papeis_usuario from anon, authenticated;
grant select on public.papeis_usuario to authenticated;
grant all on public.papeis_usuario to service_role;

create or replace function public.atribuir_papel_inicial(p_usuario_id uuid, p_papel text)
returns text[] language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('papeis_usuario'),
                                           pg_catalog.hashtext(p_usuario_id::text));
  if not exists (select 1 from public.papeis_usuario where usuario_id = p_usuario_id) then
    insert into public.papeis_usuario (usuario_id, papel) values (p_usuario_id, p_papel);
  end if;
  return coalesce((select array_agg(papel order by papel) from public.papeis_usuario
                    where usuario_id = p_usuario_id), '{}'::text[]);
end $$;
revoke all on function public.atribuir_papel_inicial(uuid, text) from public, anon, authenticated;
grant execute on function public.atribuir_papel_inicial(uuid, text) to service_role;

create or replace function public.lojas_exige_dono_lojista()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- usuário final pedindo loja de OUTRO dono: a policy recusa; não ler nem gravar papel alheio
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and new.dono_id is distinct from auth.uid() then
    return new;
  end if;
  if not ('lojista' = any (public.atribuir_papel_inicial(new.dono_id, 'lojista'))) then
    raise exception 'loja: conta de cliente não pode ser dona de loja';   -- decisão 12
  end if;
  return new;
end $$;
revoke all on function public.lojas_exige_dono_lojista() from public, anon, authenticated;
drop trigger if exists lojas_exige_dono_lojista_trg on public.lojas;
create trigger lojas_exige_dono_lojista_trg
  before insert or update of dono_id on public.lojas
  for each row execute function public.lojas_exige_dono_lojista();

insert into public.papeis_usuario (usuario_id, papel)                      -- backfill, item (g)
select u.id, 'lojista' from auth.users u
 where not exists (select 1 from public.papeis_usuario p where p.usuario_id = u.id)
on conflict do nothing;
```

O trigger novo roda antes de `lojas_protege_billing_trg` (a ordem é alfabética). Se o trigger de billing
recusar um INSERT, a transação desfaz também o papel gravado. Os testes de banco que já existem
(`rls_lojas`, `trigger_protege_billing_v3` [128-9..12], `trigger_consentimento_somente_servidor` [C-4],
`garantir_loja_do_dono`) continuam verdes sem nenhuma mudança e continuam falhando pelo motivo que afirmam.

### TypeScript (assinaturas)

```ts
// src/lib/utils/papeis.ts — puro
export const PAPEIS = ["lojista", "cliente"] as const;
export type Papel = (typeof PAPEIS)[number];
export function ehPapel(valor: unknown): valor is Papel;
export function destinoPadraoPorPapel(p: { ehAdmin: boolean; papeis: readonly Papel[] }): string;
//   admin → "/admin" · lojista → "/painel" · demais → "/" (Marco B: cliente → mundo cliente)

// src/lib/supabase/queries/papeis.ts — import "server-only"; propaga error (§14); filtra com ehPapel
export function buscarPapeisDoUsuario(client: Client, usuarioId: string): Promise<Papel[]>;
export function atribuirPapelInicial(svc: Client, usuarioId: string, papel: Papel): Promise<Papel[]>;

// src/lib/utils/acessoPainel.ts
export type DecisaoBase = "ok" | "login" | "confirmar-email" | "onboarding" | "sem-papel-lojista";
export function decidirAcessoBase(user: User | null, loja: LojaCompleta | null,
                                  papeis: readonly Papel[]): DecisaoBase;
```

### Invariante × camada

| # | Invariante | Onde é garantida | Reforço |
|---|---|---|---|
| I1 | Só o servidor escreve papel | Banco: `papeis_usuario` sem policy de escrita e com a escrita revogada; `atribuir_papel_inicial` com `EXECUTE` só para `service_role` | Server Action e Route Handler usam `service_role`; `user_metadata`/`app_metadata` nunca são lidos |
| I2 | Conta só-cliente nunca é dona de loja (decisão 12) | Banco: trigger em `lojas` (INSERT e troca de `dono_id`, qualquer role, qualquer caminho). O caminho do admin depende da lacuna L1 | `cadastrar` recusa antes; gate do layout |
| I3 | `/painel` sem papel lojista não auto-cura nem abre | Guard do layout (`decidirAcessoBase` + `layout.tsx`) | I2 no banco |
| I4 | O contexto do fluxo nunca muda o papel de conta existente | Banco: `atribuir_papel_inicial` (lock + "só grava se não há papel") | O callback usa o `user.id` vindo do `exchangeCodeForSession` e o papel fixo da porta |
| I5 | Ganhar `cliente` nunca dá nem tira `lojista` (decisão 15) | Banco: nenhuma função remove papel; só `adicionar_papel_cliente` acrescenta, e só `cliente` | — |
| I6 | `next` sanitizado vence; sem `next`, quem não é lojista nunca vai para `/painel` | Callback (Route Handler) + `destinoPadraoPorPapel`, que é puro | O gate do layout é a barreira real |
| I7 | Contas pré-existentes não perdem acesso (decisão 14) | Banco: backfill + trigger durante a janela de deploy | Gate: lojista + loja → `ok` |
| I8 | Admin = `SAAS_ADMIN_USER_ID` | Servidor: `verificarAdminSaaS` (fail-closed) e `ehAdminSaaS` (fail-safe), ambos sem mudança | — |

**Dependências externas:** nenhuma nova. **Custo:** uma query indexada a mais por render do layout do painel (em
paralelo com a da loja) e uma RPC a mais por callback e por cadastro. Não há custo variável: o Supabase Pro tem
preço fixo.

## 4. RED da fatia A, caso a caso (linha "A" de `## Risco por fatia`)

| Caso (texto do plano) | Como a recomendação atende | Prova (arquivo · fase) |
|---|---|---|
| user autenticado, e-mail confirmado, sem loja, papel ≠ lojista → decisão ≠ `"onboarding"`/`"ok"` | A precedência 2 devolve `"sem-papel-lojista"`, e o layout redireciona sem chamar `garantirLojaDoDono` | `acessoPainel.test.ts` + `painel-layout.guard.test.tsx` · P3 |
| lojista órfão legítimo continua `"onboarding"` | Linha `lojista` sem loja → precedência 4 → auto-cura (o INSERT da RPC passa no trigger) | `acessoPainel.test.ts` (caso existente com `["lojista"]`) + teste do layout · P3 |
| usuário com papéis lojista + cliente continua `"ok"` (decisão 15) | `papeis` contém `lojista` → precedência 5 | `acessoPainel.test.ts` · P3 |
| usuário só-cliente nunca `"ok"` nem `"onboarding"` | Precedência 2, com ou sem loja; além disso o trigger impede que a loja exista | `acessoPainel.test.ts` + `papel_cliente.test.ts` · P3 |
| usuário PRÉ-EXISTENTE com loja continua `"ok"` | O backfill dá `lojista` a toda conta sem papel; no gate, lojista + loja → `"ok"` | `papel_cliente.test.ts`, que reexecuta a migration sobre uma conta pré-existente (P3) + `acessoPainel.test.ts` (P3) |
| admin pré-existente continua indo a `/admin` | O callback testa a env (`ehAdminSaaS`) antes do papel. O gate manda admin sem `lojista` para `/admin`. Pelo backfill o admin recebe `lojista` como qualquer conta pré-existente, então o `/painel` dele também não muda. Nenhum UUID real entra em migration | `route.test.ts`: os 5 casos da issue 148 sem mudança + admin com `["cliente"]` · P3; `painel-layout.guard.test.tsx` (admin sem `lojista` → `/admin`) · P3 |
| após a migration, todo `auth.users` com linha em `lojas` tem papel lojista | Backfill + trigger | `papel_cliente.test.ts` · P3 |
| todo admin tem papel admin | **Substituído**: o admin não está no banco, só na env. Uma migration não lê env e não pode conter o UUID real (item g). A prova passa a ser o callback e o gate (linha acima) | — |
| nenhum fica sem papel | O backfill cobre também o órfão | `papel_cliente.test.ts` · P3 |
| RPC não cria loja para papel cliente | O INSERT da RPC passa pelo trigger | `garantir_loja_do_dono.test.ts` · P3 (ver divergência 4) |
| cliente sem `next` nunca cai em `/painel` | `destinoPadraoPorPapel` só devolve `/painel` quando há `lojista` | `route.test.ts` + `papeis.test.ts` · P3 |

Os casos completos, arquivo por arquivo, estão na issue 332.

## 5. Riscos residuais e observações

1. **Reserva de papel por e-mail não confirmado (Marco B).** Um terceiro cadastra como cliente o e-mail de outra
   pessoa. Quando a dona do e-mail entra com Google, o GoTrue vincula o login à conta existente e remove a
   identidade não confirmada do terceiro (proteção contra pre-account takeover), mas a conta continua `cliente`:
   ela não vira lojista com esse e-mail. Não há tomada de conta. Saídas: excluir a conta de cliente (decisão 3) e
   cadastrar-se como lojista, ou usar outro e-mail. A mesma classe de problema já existe hoje para lojista: um
   cadastro com e-mail alheio cria uma loja inativa. O spec P9 decide se vale apagar o perfil não confirmado no
   momento do vínculo; P18 audita.
2. **Allowlist de redirect (Marco B).** O GoTrue aceita um `redirectTo` com `?contexto=cliente&next=…` quando o
   host bate com a Site URL. Se a Site URL do projeto não for o domínio de produção, a URL precisa casar com um
   padrão da allowlist (`…/**`); caso contrário o GoTrue volta para a Site URL sem dar erro. Conferir no dashboard
   antes de P17 (gate humano curto). O Marco A não muda o `redirectTo`.
3. **O lock por usuário não é provável no pglite,** que tem uma conexão só. Fica para a revisão do `auditar`
   (P5), como já aconteceu em `20260927124000`.
4. **Falha da RPC no callback deixa a sessão ativa sem papel** (o usuário vai para `/login?erro=auth`). Conta sem
   papel não abre `/painel`. O próximo login pela porta `(auth)` atribui `lojista`. Uma conta sem papel que
   inserir loja direto pelo PostgREST vira lojista, o que equivale ao cadastro público de lojista. Comportamento
   documentado.
5. **Pré-existente, fora do escopo:** quando `criarLoja` falha, `cadastrar` ainda faz a compensação `deleteUser`
   numa conta que já era de lojista não confirmada; a loja excluída pelo admin volta pela auto-cura; a rota
   `/confirmar-email`, para onde o gate já redireciona hoje, não existe (dá 404 — relevante para a decisão 18 no
   Marco B); `assinatura-bloqueada/page.tsx:19-21` e `configuracoes/assinatura/page.tsx:43-45` redirecionam para
   `/painel/onboarding`, que também não existe.

## 6. Divergências entre o plano e o código

1. **A brecha tem três caminhos, não um.** Além da auto-cura citada no plano, existem `lojas_insert_proprio`
   (`20260614001000_rls_lojas.sql:29-31`, travado como legítimo em `trigger_protege_billing_v3.test.ts:298-304`)
   e `criarLojaAdmin` (`src/app/admin/assinantes/actions.ts:46-99`). O trigger em `lojas` cobre os três (I2),
   aplicando as decisões 11 e 12, sem mudar nenhum teste de banco existente. No Marco A, nenhum comportamento de
   produção muda, porque ainda não existe conta de cliente. O que o admin pode fazer com conta só-cliente fica na
   lacuna L1.
2. **O ramo `"onboarding"` é o cadastro normal do lojista pelo Google** (callback → `/painel` → auto-cura), e não
   só reparo de órfão. Por isso o callback precisa marcar `lojista` já no Marco A.
3. **"todo admin tem papel admin"** (linha A e decisão 14): uma migration não tem como saber quem é o admin, porque
   a identidade dele vive só na env, e gravar o UUID real numa migration de repo público está fora de questão. O
   ADR usa a saída que a própria decisão 14 oferece (papel derivado, sem backfill), e a prova passa a ser o
   callback e o gate.
4. **RED de banco.** Como P2 rodaria antes de P3, os casos de banco nasceriam verdes. Decisão do usuário
   (2026-10-01): P3 (`tdd`) roda ANTES de P2 e escreve todo o RED, de banco e de aplicação; P2 (`migrar`) só deixa
   o banco verde. P2 continua antes de P4.
5. **"P4 não altera teste existente"** continua cumprido, mas P3 precisa ajustar o setup de três arquivos
   existentes: o 3º argumento de `decidirAcessoBase` e o mock de `rpc` no client `service_role` (no teste do
   callback e em `auth.test.ts`). Nenhuma asserção existente muda. O caso `acessoPainel.test.ts:91-95` ("loja
   null → onboarding") descreve a própria brecha: mantém a asserção, agora com `papeis = ["lojista"]`, e passa a
   representar o lojista órfão legítimo.
6. **Item 19b do plano** (`googleOAuth.ts`/`BotaoGoogle.tsx` em P4): não é necessário no Marco A, porque a porta
   `(auth)` vale lojista sem parâmetro. Fica para P17. `googleOAuth.test.ts:60` continua valendo.
7. **`references/seguranca.md` §17 (l.1116 e l.1141)** diz que `cadastrar` delega a criação da loja à
   `garantir_loja_do_dono`, mas o código usa `criarLoja` direto (`auth.ts:101`). O trigger cobre os dois
   caminhos. P7 corrige esse texto e também precisa atualizar `schema.md` §1/§2/§4 e `seguranca.md` §2 (tabela e
   trigger novos), além do que o plano lista.
8. **Linhas citadas:** o plano diz `layout.tsx:64-84`, mas o ramo `"onboarding"` é `:65-85` (`:64` é o `redirect`
   de `confirmar-email`). As demais linhas conferem. O plano escreve `tests/migrations/<ts>_papel_cliente.test.ts`;
   no repo, os testes de migration não levam timestamp, então o arquivo será `tests/migrations/papel_cliente.test.ts`.

## 7. Fontes

O egress bloqueia `supabase.com`. Por isso a documentação e o código foram lidos nos repositórios oficiais:
`supabase/supabase` @ `7b08726` (docs, 2026-10-01) e `supabase/auth` @ `ce9a8ee` (GoTrue, 2026-09-22).

- `auth.jwt()`: `raw_app_meta_data` não é atualizável pelo usuário, e o JWT "is not always up-to-date" até o
  refresh — `apps/docs/content/guides/database/postgres/row-level-security.mdx:597-623`
  (https://supabase.com/docs/guides/database/postgres/row-level-security).
- `user_metadata` não deve ser usado em autorização — `apps/docs/content/guides/auth/users.mdx:71`
  (https://supabase.com/docs/guides/auth/users).
- Tabelas próprias em `public` referenciando `auth.users on delete cascade`, com RLS —
  `apps/docs/content/guides/auth/managing-user-data.mdx:9-33` (https://supabase.com/docs/guides/auth/managing-user-data).
- `getUser()` versus `getClaims()` — `apps/docs/content/guides/auth/server-side/advanced-guide.mdx:51`
  (https://supabase.com/docs/guides/auth/server-side/advanced-guide).
- Linking automático por e-mail verificado e remoção de identidades não confirmadas —
  `apps/docs/content/guides/auth/auth-identity-linking.mdx:21-25`
  (https://supabase.com/docs/guides/auth/auth-identity-linking); código em `internal/models/linking.go:63-177` e
  `internal/api/external.go:412-417`.
- Redirect: mesmo host da Site URL é aceito; para outros hosts, glob da allowlist sobre a URL sem fragmento —
  `internal/utilities/request.go:94-139`; doc `apps/docs/content/guides/auth/redirect-urls.mdx`
  (https://supabase.com/docs/guides/auth/redirect-urls). O PKCE preserva a query e acrescenta `code` —
  `internal/api/verify.go:535-544`.
- `PUT /user` recusa `app_metadata` sem privilégio de admin — `internal/api/user.go:100-104`. `UpdateAppMetaData`
  faz merge em memória e grava a coluna inteira — `internal/models/user.go:246-259`. Chamada em todo login OAuth —
  `internal/api/external.go:331,395`. `user_metadata` é sobrescrito pelo provedor — `external.go:327,392`.
- `signUp` de conta existente **confirmada**: "When both **Confirm email** and **Confirm phone** … are enabled …,
  an obfuscated/fake user object is returned. When either … is disabled, the error message, `User already
  registered` is returned." Doc oficial de referência (https://supabase.com/docs/reference/javascript/auth-signup),
  gerada do JSDoc em `supabase/supabase-js` @ `ca7960a` (2026-10-01),
  `packages/core/auth-js/src/GoTrueClient.ts:876-878`. Mesmo texto em `apps/docs/spec/supabase_py_v2.yml:165-167`.
  No código: `internal/api/signup.go:293-301` (erro ou `sanitizeUser`) e `:349-352` (id aleatório).
- `signUp` de conta existente **não confirmada**: a doc não cobre. O código devolve a conta real sem alterá-la ("do
  not update the user because we can't be sure of their claimed identity", `signup.go:193-198`), reenvia a
  confirmação (`:250`) e responde com a conta (`:344`).
- Custom access token hook (alternativa b4) — `apps/docs/content/guides/auth/auth-hooks/custom-access-token-hook.mdx`
  (https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).

## Lacunas — decisão do usuário

### L1 — O admin do SaaS pode criar loja para um e-mail que já é conta só-cliente? — **DECIDIDO: (A) recusar** (usuário, 2026-10-01)

**Pergunta.** `criarLojaAdmin` (`src/app/admin/assinantes/actions.ts:46-99`, onboarding assistido) cria loja para
uma conta que já existe, achada por e-mail. A partir do Marco B, esse e-mail pode ser de uma conta só-cliente. As
duas decisões que tocam o assunto não fecham o caso:
- a decisão 12 diz "cliente jamais vira dono de loja";
- a decisão 15 descreve a direção proibida como "ganhar perfil de cliente nunca dá papel de lojista".

Fica em aberto se o **admin** pode dar o papel de lojista a quem já é cliente.

| Opção | O que muda | Impacto |
|---|---|---|
| (A) Recusar | Nada além do desenho recomendado: o trigger recusa loja para conta só-cliente em qualquer caminho, inclusive o do admin. No Marco B, `criarLojaAdmin` pode trocar a mensagem genérica ("Não foi possível criar a loja.") por uma específica. | A decisão 12 vale sem exceção. Quem já é cliente e quer abrir loja, inclusive no onboarding assistido, usa outro e-mail, ou exclui a conta de cliente (decisão 3) e se cadastra como lojista. |
| (B) Permitir só pelo admin | Uma função nova, `adicionar_papel_lojista_pelo_admin(usuario)` (`SECURITY DEFINER`, `EXECUTE` só para `service_role`), chamada por `criarLojaAdmin` depois de `verificarAdminSaaS()` e antes de `criarLoja`, com registro em `admin_acessos`. O trigger não muda: ele passa a ver `lojista` e aceita a loja. Entra no Marco B. | Abre uma exceção à decisão 12 restrita ao admin. As invariantes I4 e I5 ganham "ou por ato do admin". A pessoa vira dona de loja sem ter feito o cadastro de lojista; o aceite dos termos de lojista fica por conta do processo do onboarding assistido (`specs/arquivo/admin-onboarding-assistido.md`: "a pedido ou com ciência do lojista"). |
| (C) Permitir por qualquer caminho de servidor | O trigger passa a dar `lojista` também a conta só-cliente sempre que quem insere for `service_role`. | O banco deixa de barrar conta só-cliente em todo caminho de servidor (RPC de auto-cura, `criarLoja` do cadastro, admin). A recusa passa a depender só das checagens no código (`cadastrar`, gate do layout), o que contraria a decisão 11 (garantia no banco). |

**Quando decidir:** antes do spec do Marco B (P9). O Marco A não depende da resposta, porque ainda não existe
conta de cliente.
- Com (A) ou (B), o trigger e os casos de teste da issue 332 continuam iguais; até a decisão, o trigger já se
  comporta como (A), que é o estado fail-closed.
- Com (C), mudam os casos 5 e 7 do RED da issue 332 (loja para conta só-cliente via `asService` ou via RPC →
  erro) e o item 3 da migration.

Os demais itens da seção 6 não são escolhas em aberto: aplicam decisões já tomadas (11, 12, 14 e 15) ou ajustam a
sequência para o RED continuar honesto. O que depende do Marco B (riscos 1 e 2 da seção 5) fica registrado para o
spec P9 e para o `auditar` P18.
