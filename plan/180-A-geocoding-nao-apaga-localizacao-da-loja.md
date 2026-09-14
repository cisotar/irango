## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (nada disso se reimplementa):**

- `src/lib/actions/patches-loja.ts:62` — `montarConsultaGeocoding(dados)`. **É a fonte única
  da lista de campos de endereço.** Vira a base da comparação "endereço mudou" (ver decisão
  D-180A-1 abaixo). Módulo neutro (sem `'use server'`, funções puras) — já importado pelos
  dois callers, painel e admin.
- `src/lib/actions/patches-loja.ts:32` — `montarPatchPerfil`, allowlist explícita do 1º
  UPDATE. **Não muda.** `latitude`/`longitude` continuam fora dela (RN-7).
- `src/lib/utils/geocodificarEndereco.ts` — `geocodificarEnderecoComMotivo` →
  `{ coords } | { coords: null, motivo: "transitorio" | "nao_encontrado" }`. **Não muda.**
- `src/lib/supabase/queries/lojas.ts:62` — `buscarLojaDoDono(client)` devolve `LojaCompleta`
  (`select("*")`), ou seja **já traz os 6 campos de endereço + `latitude`/`longitude`**.
  `salvarPerfil` já a chama. **Zero query nova no caminho do painel.**
- `src/lib/supabase/queries/lojas.ts:124` — `buscarLojaAdminPorId(svc, lojaId)`, também
  `select("*")` na tabela base. É a query que falta ao `admin-perfil.ts` — **já existe, não
  criar outra** nem fazer `.from("lojas")` inline.
- `src/components/ui/dialog.tsx` — Dialog shadcn sobre `@base-ui/react/dialog`: focus trap,
  ESC, backdrop. **Já existe em `components/ui/` — nenhum `npx shadcn add` é necessário.**
  Não há `alert-dialog.tsx` no projeto e não precisa haver: o aviso é informativo de uma via
  só (um botão "Entendi"), não uma confirmação destrutiva.
- `src/components/painel/GerenciarAssinaturaClient.tsx:13-20` — precedente de Dialog
  controlado por `useState` no painel (`Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/
  `DialogDescription`/`DialogFooter`/`DialogClose`). Copiar o padrão, não inventar outro.
- `src/lib/actions/loja.test.ts` e `src/app/admin/assinantes/actions/admin-perfil.test.ts` —
  já mockam `geocodificarEnderecoComMotivo`, `createClient`/`createServiceClient` e as
  queries de loja. Os testes novos entram nesses arquivos, sem novo harness.

**O que precisa ser criado (e por quê não dá para reusar):**

- `deveRegeocodificar(...)` em `patches-loja.ts` — não existe nenhuma comparação
  endereço-antigo × endereço-novo no codebase (`grep` em `lib/utils/`, `lib/validacoes/`,
  `lib/supabase/queries/`, `lib/actions/`: nada). Nasce **no mesmo arquivo** de
  `montarConsultaGeocoding` justamente para não abrir uma segunda lista de campos.
- `AvisoGeocodingDialog.tsx` colocado ao lado de `PerfilClient.tsx` — o texto e a semântica
  são específicos do perfil; ainda é 1 lugar só, então não sobe para `components/painel/`
  (`design-system.md` §"Regra de origem do componente": só compõe componente de domínio
  quando o padrão aparece em 2+ lugares).

#### D-180A-1 — a comparação é feita sobre a CONSULTA, não sobre os campos

A comparação é `montarConsultaGeocoding(dados) === montarConsultaGeocoding(loja)`, com os
dois lados produzidos pela MESMA função. Isso atende o gate de reuso e é estritamente melhor
que comparar campo a campo:

1. **Uma lista só, por construção.** Campo de endereço novo entra em
   `montarConsultaGeocoding` e a comparação passa a considerá-lo no mesmo commit. Não existe
   segunda lista para divergir.
2. **Normalização de graça.** A função já faz `trim()` em todos os campos. `"  Campinas "`
   → `"Campinas"` não dispara regeocodificação inútil (e nem o risco de apagar a coord por
   falha transitória num save que não mudou nada de fato).
3. **Compara o que importa: o INPUT do geocoder.** O CEP é deliberadamente excluído da
   consulta (issue 186 — token envenenador). Logo mudar só o CEP **não** regeocodifica, o
   que é correto: a chamada devolveria exatamente o mesmo ponto, e regeocodificar exporia a
   coord válida a uma falha transitória sem nenhum ganho. Comparar campo a campo faria o
   oposto — regeocodificaria por um campo que comprovadamente não influencia o resultado.
4. **Trata o endereço incompleto no mesmo eixo.** `consulta === null` (sem cidade+estado) é
   um valor comparável como qualquer outro.

Ressalva coberta pelo gate de segurança: `null === null` sozinho não pode preservar
coordenada órfã. Ver a regra completa abaixo.

### Contrato do helper novo

Em `src/lib/actions/patches-loja.ts` (mesmo módulo neutro, puro e síncrono):

```ts
export function deveRegeocodificar(
  novo: Parameters<typeof montarConsultaGeocoding>[0],
  atual: Parameters<typeof montarConsultaGeocoding>[0] & {
    latitude?: number | null;
    longitude?: number | null;
  },
): boolean
```

Regra (nesta ordem):

1. `consultaNova = montarConsultaGeocoding(novo)`, `consultaAtual = montarConsultaGeocoding(atual)`.
2. `consultaNova !== consultaAtual` → **true** (endereço mudou de fato; segue o caminho
   atual, inclusive gravando o par NULL se o geocoding falhar — escopo item 2 da issue).
3. Consultas iguais **e** `consultaNova === null` **e** a loja tem `latitude`/`longitude`
   não-nulas → **true**. É o caso "coordenada órfã de endereço incompleto": D3 continua
   valendo, o par é limpo. (Acontece com linha semeada ou herdada de antes do gate de
   completude.)
4. Caso contrário → **false**: pula o 2º UPDATE inteiro.

Tipagem via `Parameters<typeof montarConsultaGeocoding>[0]` para que o helper **nunca** tenha
uma lista própria de campos nem no tipo.

### Cenários

**Caminho feliz (painel):**
1. Lojista muda só o nome da loja e salva.
2. `salvarPerfil` valida com `schemaPerfil`, resolve a loja com `buscarLojaDoDono`.
3. 1º UPDATE grava o patch da allowlist (`montarPatchPerfil`) — inalterado.
4. `deveRegeocodificar(dados, loja)` → `false`.
5. **Nenhuma chamada ao Google Geocoding, nenhum 2º UPDATE.** `latitude`/`longitude`
   intactas.
6. Retorno: `{ ok: true, geocodificado: loja.latitude !== null && loja.longitude !== null }`,
   sem `motivo` → nenhum modal.

**Caminho feliz (endereço realmente alterado):**
1. Lojista troca rua/número/bairro/cidade/estado.
2. `deveRegeocodificar` → `true`. Fluxo atual preservado na íntegra: consulta →
   `geocodificarEnderecoComMotivo` → retry único no `transitorio` → 2º UPDATE com o par
   (coords ou NULL).
3. Falhou → `{ ok: true, geocodificado: false, motivo }` → **modal** no cliente.

**Casos de borda:**
- *Endereço igual + geocoding fora do ar* → não chama o geocoder, coords preservadas. **É o
  bug da issue.** Coberto por teste.
- *Endereço igual, loja sem coords (endereço incompleto)* → pula, continua sem coords;
  retorna `geocodificado: false` **sem `motivo`** → cai no texto `nao_encontrado` do cliente
  (branch de compat que já existe). Comportamento aceito: a loja de fato não tem localização.
- *Só o CEP mudou* → não regeocodifica (ver D-180A-1 item 3). O CEP é gravado normalmente
  pelo 1º UPDATE.
- *Só espaço em branco mudou* → `trim()` da consulta absorve, não regeocodifica.
- *Endereço completo → incompleto* (lojista apaga a cidade) → consultas diferentes → `true`
  → o par vira NULL. Correto: sem âncora, coord antiga é coord errada.
- *Loja com coords e endereço incompleto (órfã)* → regra 3 → limpa. Mantém D3.
- *Slug mudou junto* → ortogonal; a checagem de unicidade e o `revalidarVitrine` dos dois
  slugs não mudam.
- *Falha do 1º UPDATE* → `throw` → catch → erro genérico. Inalterado.
- *Falha de rede no geocoder com endereço alterado* → retry único, depois par NULL + modal.
  Inalterado (é o comportamento desejado nesse caso).

**Tratamento de erros:** inalterado e conforme `seguranca.md` §14 — `console.error` no
servidor, `ERRO_GENERICO` para o cliente. O helper novo é puro e não lança: entrada
inesperada vira `false`/`true` determinístico, nunca exceção. **Nenhuma mensagem de erro
nova é introduzida.**

### Schema de Banco

**Nenhuma migration. Nenhuma mudança de RLS.** A issue não cria nem altera tabela, coluna,
índice ou política. O que muda é *quando* o 2º UPDATE acontece — as políticas
`lojas_update_proprio` (painel, `auth.uid() = dono_id`) e o escopo manual por `eq("id")` no
service_role (admin) continuam exatamente como estão. Confirmado: `grep` por `latitude` em
`supabase/migrations/` não é tocado por esta issue.

### Validação (zod)

**Nenhum schema novo.** `schemaPerfil` (`src/lib/validacoes/loja.ts`) continua sendo o schema
único usado no form (`PerfilClient.salvar`) e nas duas Server Actions. A mudança é de fluxo,
não de contrato de entrada.

### Regra cliente ↔ servidor (mapa de enforcement)

| Invariante | Onde é garantida |
|---|---|
| Coordenada é dado derivado, nunca vem do cliente | `montarPatchPerfil` (allowlist RN-7) — `latitude`/`longitude` fora da allowlist. **Inalterado.** |
| "Endereço mudou?" é decidido a partir do BANCO | Server Action: `buscarLojaDoDono` / `buscarLojaAdminPorId`. O payload do cliente é só um dos lados da comparação; o outro lado vem sempre do banco. Cliente não envia flag de "mudou" — **se enviasse, seria ignorada** (`schemaPerfil` é `.strict()`). |
| Escrita do perfil escopada ao dono | RLS `lojas_update_proprio` (painel) / `eq("id", lojaId)` + `verificarAdminSaaS` fail-closed (admin). **Inalterado.** |
| Leitura da loja para comparar | RLS `lojas_leitura_propria` (painel) / service_role escopado por id (admin). **Inalterado.** |
| Modal de aviso | **Puramente UX.** Não protege invariante nenhuma: o `motivo` é produzido no servidor e o cliente só o exibe. Nenhuma decisão de valor ou permissão depende do modal. |

Não há valor monetário nesta issue. A coord influencia frete por raio, mas o cálculo de frete
lê `lojas.latitude/longitude` no servidor (`buscarCoordsLoja`) em outro caminho — não tocado.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/AvisoGeocodingDialog.tsx`
  — `'use client'`. Props: `{ motivo: MotivoGeocoding | undefined; aberto: boolean;
  onFechar: () => void }`. Renderiza `Dialog` com `disablePointerDismissal` (prop real do
  Base UI Root, verificada em `node_modules/@base-ui/react/dialog/root/DialogRoot.d.ts:48`):
  clique fora **não** fecha. `DialogContent showCloseButton={false}`, um único botão
  "Entendi" (`DialogClose`) no `DialogFooter`. ESC continua fechando — é focus-trap
  acessível, não sequestro do usuário (`design-system.md` §"Modal acessível"), e a exigência
  da issue ("exige ação para fechar") é atendida por não sumir sozinho e não ter
  auto-dismiss. Exporta `TEXTO_AVISO_GEOCODING: Record<MotivoGeocoding, string>` com os
  **dois textos atuais copiados literalmente** de `PerfilClient.tsx:220-233` — a 180-B, se
  precisar, importa daqui em vez de reescrever.

**Modificar:**
- `src/lib/actions/patches-loja.ts` — adicionar `deveRegeocodificar` (função pura,
  documentada, ao lado de `montarConsultaGeocoding`, reusando-a).
- `src/lib/actions/loja.ts` (`salvarPerfil`, `:106-137`) — envolver o bloco de geocoding +
  2º UPDATE em `if (deveRegeocodificar(dados, loja)) { ... }`. Atualizar o comentário "D3"
  em `:106-112` para registrar a separação "endereço igual × endereço alterado" (a decisão
  D3 continua válida, só passa a ser condicional). No ramo pulado, retornar
  `{ ok: true, geocodificado: loja.latitude !== null && loja.longitude !== null }`.
- `src/app/admin/assinantes/actions/admin-perfil.ts` (`:104`) — importar
  `buscarLojaAdminPorId` de `@/lib/supabase/queries/lojas` e lê-la com `svc` **antes** do 1º
  UPDATE (precisa do endereço *anterior*; depois do UPDATE ele já foi sobrescrito — esta
  ordem é obrigatória). Loja inexistente → `{ ok: false, erro: "Loja não encontrada." }`,
  mesmo texto já usado ali. Mesmo gate `deveRegeocodificar`.
- `src/app/(painel)/painel/(bloqueavel)/configuracoes/perfil/PerfilClient.tsx:220-233` —
  trocar os dois `toast.warning` por `setAvisoGeocoding(resultado.motivo ?? "nao_encontrado")`
  e renderizar `<AvisoGeocodingDialog />`. `toast.success("Perfil salvo!")` permanece.
  `router.refresh()` continua sendo chamado (o save deu certo; o modal é sobre a coord).
- `src/lib/actions/patches-loja.test.ts`, `src/lib/actions/loja.test.ts`,
  `src/app/admin/assinantes/actions/admin-perfil.test.ts` — testes novos (abaixo).

**NÃO tocar:**
- `src/components/ui/dialog.tsx` — gerado pelo shadcn CLI. Já tem tudo. Nenhum
  `npx shadcn add` nesta issue.
- `src/lib/utils/geocodificarEndereco.ts` — o classificador de motivo está correto; a 180-B
  é que mexe nele, se mexer.
- `src/lib/validacoes/loja.ts`, `montarPatchPerfil`, `montarConsultaGeocoding` (corpo) —
  a consulta NÃO muda; o CEP continua fora dela (issue 186).
- `supabase/migrations/`, políticas RLS — fora do escopo.
- `montarPayloadPerfil.ts` — o payload do form não muda.

### Dependências Externas

**Nenhuma nova.** Dialog (`@base-ui/react`) e `lucide-react` já estão no `package.json` e já
são usados no painel. Não há pacote a instalar, nem API nova a chamar.

**Efeito na quota existente (positivo, `architecture.md` §9 nº1):** a mudança **reduz**
chamadas ao Google Geocoding — hoje todo save de perfil gasta 1 chamada (2 com retry) mesmo
sem alterar endereço; passa a gastar 0 nesse caso. Isso alivia tanto o custo por chamada do
Google quanto o teto diário e a trava de burst no Upstash
(`geocodificarEndereco.ts`, fail-closed). Nenhum comportamento ao estourar quota muda.

### Recálculo no Servidor

Não se aplica: **nenhum valor monetário** é lido, escrito ou derivado nesta issue. O dado
derivado em jogo é a coordenada, que já é calculada exclusivamente no servidor e continua
assim — o cliente não envia, não influencia e não pode gravar `latitude`/`longitude`
(bloqueado pela allowlist de `montarPatchPerfil`).

### Cobertura: teste automatizado × verificação manual

Ambiente é Vitest `environment: node`, **sem jsdom, sem Playwright, sem MCP de browser**.
Logo o recorte é explícito:

**Automatizado (Server Action + função pura) — obrigatório:**
1. `patches-loja.test.ts` — `deveRegeocodificar`:
   - endereço idêntico → `false`;
   - idêntico a menos de espaços (`" São Paulo "`) → `false`;
   - só o CEP mudou → `false` (documenta D-180A-1 item 3);
   - rua/número/bairro/cidade/estado alterados → `true` (um caso por campo, tabelado);
   - consulta nova `null` + loja **com** coords → `true` (regra 3, D3 preservada);
   - consulta nova `null` + loja **sem** coords → `false`.
2. `loja.test.ts` — `salvarPerfil` com o mock de geocoding configurado como
   `{ coords: null, motivo: "transitorio" }`:
   - **endereço IGUAL ao da loja** → `geocodificarEnderecoComMotivo` **não é chamado**
     (`expect(...).not.toHaveBeenCalled()`), **só 1 UPDATE** é capturado, e o patch
     capturado **não contém** `latitude`/`longitude`. É o critério de aceite nº 1.
   - **endereço ALTERADO** → geocoder chamado, 2º UPDATE com `{ latitude: null,
     longitude: null }`, retorno com `motivo: "transitorio"`. É o critério nº 3 (lado
     servidor).
   - endereço igual + loja já com coords → retorno `geocodificado: true`, sem `motivo`.
3. `admin-perfil.test.ts` — os mesmos dois casos em `salvarPerfilAdmin`, com
   `buscarLojaAdminPorId` mockado devolvendo a loja-alvo; prova que a leitura acontece
   **antes** do 1º UPDATE (ordem em `ordemChamadas`, harness já existente no arquivo).
   É o critério de aceite nº 2.

**Verificação manual (não automatizável aqui) — checklist para o `verificar`:**
- No painel, com o geocoder indisponível e endereço alterado: o modal abre, mostra o texto
  `transitorio`, **não fecha ao clicar fora**, fecha no botão "Entendi".
- Mesmo fluxo com endereço inexistente → texto `nao_encontrado`.
- Salvar só o nome com o geocoder fora → sem modal, e o pino/zonas por raio seguem ativos
  (checar `latitude`/`longitude` no Supabase cloud antes e depois).
- Modal legível em 360px de largura e com foco preso (Tab circula dentro).

### Ordem de Implementação

Issue **não crítica** (`crítica: NÃO` — sem valor monetário, sem RLS, sem migration, sem
auth): **não passa pelo agente `tdd`**. Ainda assim, os dois testes de Server Action são
escritos antes do ajuste do respectivo caller — é barato e é onde o bug vive.

1. `deveRegeocodificar` em `patches-loja.ts` + testes em `patches-loja.test.ts`. Função pura,
   fecha o contrato antes de qualquer caller depender dele.
2. Teste em `loja.test.ts` para os dois casos → **ver falhar** → aplicar o gate em
   `salvarPerfil`. (Bloqueado pelo passo 1: precisa do helper.)
3. Teste em `admin-perfil.test.ts` → **ver falhar** → aplicar o gate + `buscarLojaAdminPorId`
   em `salvarPerfilAdmin`. (Mesma dependência; separado do passo 2 para o diff de cada
   caller ficar isolado.)
4. `AvisoGeocodingDialog.tsx` + troca dos `toast.warning` em `PerfilClient.tsx`. Último
   porque é a única camada sem cobertura automatizada — entra depois que o servidor já está
   provado, para a verificação manual testar só o veículo do aviso.
5. Gate local completo: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.

### Riscos

- **Ordem no admin:** ler a loja DEPOIS do 1º UPDATE compararia o endereço novo com ele
  mesmo e desligaria a regeocodificação para sempre (falha silenciosa, coord congelada).
  Mitigado pelo teste de ordem no passo 3.
- **Loja órfã (coord sem endereço válido):** endereçado pela regra 3 e por teste dedicado.
- **Modal sem cobertura automatizada:** aceito e explicitado; vai para verificação manual.
