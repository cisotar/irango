## Plano Técnico

### Correção de premissa (importante — a issue estava errada)

O `PerfilClient.tsx` **NÃO usa `react-hook-form`**. O form é 100% `useState`
controlado + um único `schemaPerfil.safeParse(montarPayload())` dentro de
`salvar()` (`PerfilClient.tsx`, função `salvar`). `react-hook-form` só aparece
em `src/app/(auth)/login/LoginForm.tsx`, `src/app/(auth)/cadastro/CadastroForm.tsx`
e `src/app/admin/assinantes/nova/FormNovaLoja.tsx`.

**Consequência:** não há `defaultValues`, `register`, `Controller` nem `watch`
para reusar aqui. Introduzir RHF só para um booleano seria refatorar um form de
~15 campos fora do escopo desta issue. **Decisão: seguir o padrão vigente do
arquivo — `useState` + `Switch` controlado.** Onde o texto original da issue diz
"react-hook-form / defaultValues / register", leia-se "`useState` inicializado a
partir de `inicial` / `checked` + `onCheckedChange`".

### Análise do Codebase

**Já existe — SERÁ REUSADO (nada de arquivo novo):**

- `src/components/ui/switch.tsx` — wrapper shadcn sobre `@base-ui/react/switch`
  (`^1.5.0`). API: `checked`, `onCheckedChange(v)`, `disabled`. **Não criar toggle.**
- `src/components/ui/label.tsx` — `Label` já importado no `PerfilClient`.
- **Precedente de booleano com `Switch` no projeto (existe, e é consistente):**
  - `configuracoes/pagamentos/PagamentosClient.tsx`: `<Switch checked={ativo}
    disabled={salvando} onCheckedChange={(v) => alternar(tipo, v === true, ...)}
    aria-label={...} />`
  - `configuracoes/entregas/EntregasClient.tsx`, `produtos/opcionais/OpcionaisClient.tsx`,
    `components/painel/GerenciarCategorias.tsx`, `admin/.../ModulosImpressaoAdmin.tsx`.
  - Padrão comum: `checked` de estado local, `onCheckedChange` com coerção
    `v === true`, `aria-label` no `Switch`. **Nenhum deles usa `Controller`.**
- `src/lib/validacoes/loja.ts` → `schemaPerfil.whatsapp_envio_automatico:
  z.boolean().optional()` (issue 122) — já aceita o campo, sem `.default`.
  Também reusado como predicado por-campo: o arquivo já faz
  `schemaPerfil.shape.slug.safeParse(slug).success` — mesmo truque será usado
  para o WhatsApp (`schemaPerfil.shape.whatsapp`).
- `src/lib/actions/patches-loja.ts` → `DadosPerfil` + `montarPatchPerfil` já
  gravam a coluna quando `!== undefined` (issue 122).
- `src/lib/actions/loja.ts` → `salvarPerfil`: **zero mudança**. Ele faz
  `schemaPerfil.safeParse(payload)` → `montarPatchPerfil(dados)` →
  `supabase.from("lojas").update(patch).eq("id", loja.id)` no client AUTENTICADO.
  O campo flui sozinho. Confirmado por leitura.
- `src/lib/supabase/queries/lojas.ts` → `buscarLojaDoDono` faz
  `.from("lojas").select("*").maybeSingle()` e devolve `LojaCompleta =
  Tables<"lojas">`; `src/lib/database.types.ts:404` já tem
  `whatsapp_envio_automatico: boolean` na Row. **Confirmado: a coluna já chega
  ao SSR, sem tocar em query.**
- `src/app/admin/assinantes/actions/admin-perfil.ts` → `CHAVES_PERFIL` derivada
  de `Object.keys(schemaPerfil.shape)` (issue 122) — já deixa o campo passar
  pela via admin.
- `src/lib/utils/publicacao.ts` → `podePublicarLoja(nome, whatsapp)` — predicado
  já existente, **não** serve aqui (é "nome + whatsapp", regra de publicação).
  Não reusar nem estender.

**Precisa ser criado:** nada. Nem arquivo, nem componente, nem helper, nem
migration (coluna já existe e é gravável — verificado por PostgREST na 121/122),
nem dependência.

### Onde o campo entra no formulário (decisões fechadas)

**1. Estado e valor inicial (o "defaultValue").**
- `PerfilInicial` (exportado por `PerfilClient.tsx`) ganha
  `whatsapp_envio_automatico: boolean` — **obrigatório**, não opcional. A coluna
  é `NOT NULL DEFAULT true`, então o SSR sempre tem valor real; um `?? true` no
  cliente seria um segundo default fora do banco (mesmo erro que a 122
  deliberadamente evitou no zod).
- `page.tsx` do lojista passa `whatsapp_envio_automatico: loja.whatsapp_envio_automatico`
  dentro de `inicial` (loja vem de `buscarLojaDoDono`).
- Dentro do componente: `const [envioAutomatico, setEnvioAutomatico] =
  useState(inicial.whatsapp_envio_automatico);` — mesma forma dos outros campos.

**2. `Controller` / `setValue`?** Não, e não por atalho: não há RHF no arquivo.
O `Switch` do base-ui é controlado por `checked` + `onCheckedChange`, exatamente
como nos 5 usos já existentes no projeto. **Padrão definido para o repo:**
booleano em form = `useState` + `checked`/`onCheckedChange` com coerção
`v === true`. (Se um dia este form migrar para RHF, aí sim `Controller` — fora
de escopo.)

**3. Detalhes do `Switch` dentro de um `<form>` (checados no código do base-ui).**
- `SwitchRoot` roda com `nativeButton = false` e o `onClick` interno chama
  `event.preventDefault()` → **não dispara submit acidental** do form de perfil.
  Não é necessário `type="button"`.
- O root recebe `role="switch"` + `aria-checked`; o `<input type="checkbox">`
  interno é `aria-hidden`/`tabIndex -1` e só ganha `name` se a prop `name` for
  passada — **não passar `name`** (o payload é montado à mão em `montarPayload`).
- Acessibilidade: como o root não é um elemento rotulável nativo, `Label htmlFor`
  sozinho não associa. Usar:
  `<Label id="perfil-envio-automatico-rotulo">…</Label>` +
  `<Switch id="perfil-envio-automatico"
     aria-labelledby="perfil-envio-automatico-rotulo"
     aria-describedby={podeAtivarEnvio ? undefined : "perfil-envio-automatico-dica"} />`
  e a dica em `<p id="perfil-envio-automatico-dica" className="text-xs
  text-muted-foreground">`. Mesmo molde do `aria-describedby` já usado no campo
  de CEP deste arquivo.

**4. Posição na árvore:** bloco novo logo **abaixo** do `<div>` do campo
WhatsApp e **acima** do bloco Telefone (spec 5: "logo abaixo do campo de
WhatsApp"). Layout: `flex items-center justify-between gap-3` com texto à
esquerda e `Switch` à direita — mesmo arranjo de `PagamentosClient`.

**5. Envio no payload.** Em `montarPayload()`, **sempre** enviar o booleano
(sem spread condicional):
`whatsapp_envio_automatico: envioAutomatico`.
Justificativa: o que o lojista vê no Switch é o que fica gravado — sem ramo
surpresa. A trilha `undefined` continua existindo em `montarPatchPerfil` como
rede de segurança para *outros* chamadores (payloads sem a chave preservam a
coluna), mas o `PerfilClient` não depende dela.

### Regra de UX do desabilitar (decisão + justificativa)

**Reage ao valor ATUAL do formulário (`whatsapp` do `useState`), não ao valor do
SSR.** Como não há RHF, isso é literalmente o estado controlado — não é preciso
`watch`.

Justificativa (as duas alternativas quebram):
- **Só SSR:** o lojista que digita o WhatsApp agora continuaria com o Switch
  travado até salvar + recarregar — beco sem saída de UX no *primeiro* cadastro,
  que é justamente quando ele quer ligar o envio automático.
- **Só SSR (caso inverso):** quem apaga o WhatsApp veria o Switch habilitado
  mentindo que o envio vai acontecer, enquanto o servidor é fail-closed.
- **Valor atual:** feedback imediato nos dois sentidos, e o Switch nunca promete
  algo que o servidor não vai cumprir.

**Predicado (reuso do schema, sem regex nova):**
```ts
const whatsappDigitos = apenasDigitos(whatsapp);
const podeAtivarEnvio =
  schemaPerfil.shape.whatsapp.safeParse(`55${whatsappDigitos}`).success;
```
Isso casa exatamente com a condição de o payload carregar `whatsapp` e com o
`reWhatsapp` (`^55\d{10,11}$`) que o servidor exige — evita habilitar o toggle
num número pela metade. Mesmo padrão do `slugValido` já no arquivo.

Quando `!podeAtivarEnvio`: `<Switch disabled>` + dica
**"Cadastre um WhatsApp para ativar o envio automático"** (texto exato da spec 5
/ RN-A3), em `text-xs text-muted-foreground`.

**O valor do estado NÃO é zerado ao desabilitar.** O Switch fica desabilitado
exibindo o estado real da coluna. Motivo: se apagássemos para `false`, o lojista
que recadastrasse o WhatsApp veria o envio automático inexplicavelmente
desligado — perda silenciosa de preferência.

### Cenários

**Caminho feliz**
1. Lojista abre `/painel/configuracoes/perfil`; o Server Component lê
   `buscarLojaDoDono` (RLS `lojas_leitura_propria`) e passa
   `whatsapp_envio_automatico` em `inicial`.
2. O Switch renderiza refletindo a coluna (loja nova = `true`, DEFAULT do banco).
3. Lojista desliga; `setEnvioAutomatico(false)`.
4. Submit → `montarPayload()` inclui `whatsapp_envio_automatico: false` →
   `schemaPerfil.safeParse` (gate de UX) → `onSalvar` (`salvarPerfil`).
5. `salvarPerfil` revalida com o MESMO schema, monta o patch por allowlist e faz
   `UPDATE lojas ... .eq("id", loja.id)` sob RLS `lojas_update_proprio`.
6. `router.refresh()` → SSR relê → Switch permanece desligado.

**Casos de borda**
- **WhatsApp vazio / incompleto:** Switch desabilitado + dica. O valor da coluna
  continua sendo enviado no payload e regravado com o mesmo valor (no-op).
- **Lojista apaga o WhatsApp e salva com a flag LIGADA:** `montarPayload` só
  inclui `whatsapp` quando há dígitos → a chave é omitida → `montarPatchPerfil`
  **não** toca em `lojas.whatsapp` (comportamento pré-existente do form: este
  form nunca limpa o WhatsApp no banco — não mudar isso aqui). Na prática o
  WhatsApp antigo continua no banco e o envio segue funcionando. Se algum dia o
  WhatsApp de fato ficar `NULL`, **o servidor já é fail-closed**:
  `montarLinkWhatsappPedido` devolve `null` sem WhatsApp e `criarPedido` não
  emite `whatsappHref` (RN-A2/RN-A3, issue 125). Portanto **isso é só UX** —
  nenhuma invariante de segurança depende desta tela. Nada de forçar `false`
  no servidor.
- **Payload sem a chave (via admin, ou chamador legado):** `montarPatchPerfil`
  ignora `undefined` → coluna **preservada**. **Confirmado como comportamento
  desejado** (é exatamente por isso que a 122 deixou o zod sem `.default`). O
  `PerfilClient`, ainda assim, sempre envia o valor.
- **Slug inválido:** botão Salvar já desabilitado — nada muda.
- **Falha de rede / erro do servidor:** `salvarPerfil` devolve `{ok:false, erro}`
  genérico → `toast.error`; o Switch mantém o estado local não persistido (o
  lojista pode tentar de novo). Sem estado fantasma: `router.refresh()` só roda
  no sucesso.
- **Loja inexistente:** `salvarPerfil` já devolve `ERRO_SEM_LOJA`; a page redireciona
  para onboarding antes disso.

**Tratamento de erros:** inalterado — mensagem genérica ao usuário
(`ERRO_GENERICO`/`ERRO_VALIDACAO`), detalhe só no `console.error` do servidor
(`seguranca.md` §14). Nenhum novo caminho de erro nasce nesta issue.

### Camada de garantia (cliente ↔ servidor)

| Invariante | Onde é garantida |
|---|---|
| Ler a flag da própria loja | **RLS** `lojas_leitura_propria` (`auth.uid() = dono_id`) via `buscarLojaDoDono` |
| Gravar a flag na própria loja | **RLS** `lojas_update_proprio` + `UPDATE` no client autenticado em `salvarPerfil` |
| Só colunas permitidas entram no `UPDATE` | **Server Action** — `schemaPerfil.strict()` + allowlist coluna-a-coluna de `montarPatchPerfil` |
| Decisão de emitir o link do WhatsApp | **Server Action** `criarPedido` (issue 125) — a flag do cliente aqui nunca decide nada |
| Switch desabilitado sem WhatsApp | **Cliente (UX apenas)** — o servidor já é fail-closed sem `lojas.whatsapp` |

**Sem valor monetário nesta issue** → nenhum recálculo servidor-side novo.
**Sem tabela nova** → nenhuma RLS nova. **Sem migration.**

### Validação (zod)
Schema único `schemaPerfil` (`src/lib/validacoes/loja.ts`), o MESMO no
`PerfilClient.salvar()` (gate de UX) e em `salvarPerfil`/`salvarPerfilAdmin`
(autoridade). Nada a alterar — a 122 já entregou o campo.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:** nenhum.

**Modificar:**
1. `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient.tsx`
   — `import { Switch }`; `PerfilInicial` ganha `whatsapp_envio_automatico: boolean`;
   `useState` do campo; `podeAtivarEnvio`; bloco `Label`+`Switch`+dica abaixo do
   WhatsApp; campo sempre presente em `montarPayload()`.
2. `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/page.tsx`
   — passar `whatsapp_envio_automatico: loja.whatsapp_envio_automatico` em `inicial`.
3. `src/app/admin/assinantes/[lojaId]/configuracoes/perfil/page.tsx`
   — **obrigatório por tipagem**: `PerfilInicial` é compartilhado com
   `PerfilAdminClient`, que reusa o MESMO `PerfilClient`. Passar
   `whatsapp_envio_automatico: loja.whatsapp_envio_automatico` (a loja vem de
   `carregarLojaAdminBase`, service_role escopado por `lojaId`). Sem isso o
   `npm run build` quebra.
4. `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient.test.tsx`
   — a fixture `INICIAL: PerfilInicial` precisa do campo novo (senão TS/teste quebra).
   Aproveitar para adicionar os asserts do item "Testes" abaixo.

**Nota de fronteira com a issue 124:** como o admin reusa `PerfilClient`, o
Switch **aparece automaticamente** no admin ao fim desta issue, e `CHAVES_PERFIL`
(derivada do schema) já o deixa passar. A issue **124 permanece necessária** e
passa a ser: teste de binding por tenant (`escopo.atualizarLoja` grava a
loja-alvo) + verificação de paridade — não "adicionar o toggle no admin".
Registrar isso na 124.

**NÃO tocar:**
- `src/components/ui/switch.tsx` e qualquer coisa em `components/ui/` (shadcn
  gerado — `architecture.md` §"não editar manualmente").
- `src/lib/validacoes/loja.ts`, `src/lib/actions/patches-loja.ts`,
  `src/app/admin/assinantes/actions/admin-perfil.ts` — prontos na 122.
- `src/lib/actions/loja.ts` (`salvarPerfil`) — confirmado por leitura que o campo
  flui sem alteração. Só **verificar**, não editar.
- `src/lib/supabase/queries/lojas.ts` — `.select("*")` já traz a coluna.
- `supabase/migrations/` — coluna já existe no cloud.
- `src/lib/actions/admin-loja.ts` (`CAMPOS_LOJA_SOMENTE_SERVIDOR`) — a flag fica
  FORA da blocklist por design (é preferência, não billing).

### Testes

Restrição real do repo: **não há `jsdom` nem `@testing-library/react`** em
`package.json`. `PerfilClient.test.tsx` usa `renderToStaticMarkup` +
stubs — não há clique. Portanto:
- **Viável (adicionar em `PerfilClient.test.tsx`):** renderizar com
  `whatsapp: null` e afirmar que o markup contém `role="switch"` com `disabled`
  e a dica "Cadastre um WhatsApp para ativar o envio automático"; renderizar com
  WhatsApp válido + `whatsapp_envio_automatico: false` e afirmar
  `aria-checked="false"` sem `disabled`; e o inverso com `true`.
- **Fora do alcance (documentar no cabeçalho do teste, como o arquivo já faz
  para o `UploadLogoLoja`):** provar o toggle→submit→payload exige DOM real.
  A cobertura do payload já existe a montante em `patches-loja.test.ts` e
  `admin-perfil.test.ts` (issue 122); o resto se prova em `/verificar` manual.

Issue **não é crítica** (sem dinheiro, sem RLS nova, sem cross-tenant) → **sem
fase RED obrigatória**; os testes acima entram junto com a implementação.

### Dependências Externas
Nenhuma nova. Já instalados: `@base-ui/react ^1.5.0` (Switch —
https://base-ui.com/react/components/switch), `zod`, `react-imask ^7.6.1`,
`sonner`. Next.js App Router — Server Component lê, Client Component só exibe.

### Ordem de Implementação
1. `PerfilClient.tsx`: `PerfilInicial` + `useState` + `podeAtivarEnvio` +
   `montarPayload` (o contrato de tipo primeiro — é ele que revela os call sites).
2. `PerfilClient.tsx`: bloco visual `Label` + `Switch` + dica, com o
   `aria-labelledby`/`aria-describedby` descritos acima.
3. `page.tsx` do lojista: repassar o valor do SSR.
4. `page.tsx` do admin: repassar o valor (destrava a compilação).
5. Fixture + novos asserts em `PerfilClient.test.tsx`.
6. `npx vitest run "src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient.test.tsx"`
   e `npx vitest run src/lib/actions/patches-loja.test.ts`.
7. `npm run build` (constraint `use-server-export-constraint`) — obrigatório
   antes de fechar.
8. Atualizar a issue 124 com a nota de fronteira acima.
