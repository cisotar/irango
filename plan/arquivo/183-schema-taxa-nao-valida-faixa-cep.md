## Plano Técnico

Issue `crítica: SIM` — a correção toca a camada que decide se um endereço paga frete. Mandato 3:
**a fase RED do agente `tdd` vem antes de qualquer linha de produção**, com output `FAIL` capturado.

### Análise do Codebase

#### O que já existe e será REUSADO (não criar nada equivalente)

- `supabase/migrations/20260615011000_taxas_faixa_cep.sql` — colunas `cep_inicio`/`cep_fim`
  (`integer`) + CONSTRAINT `taxas_faixa_cep_coerente` (par tudo-ou-nada, ambos em `[0, 99999999]`,
  `cep_inicio <= cep_fim`). **Já aplicada no cloud (local = remote).** O banco já é a última linha de
  defesa. **NÃO haverá migration nova nesta issue** — se a implementação concluir que precisa de uma,
  é sinal de plano errado: parar e reportar.
- `tests/migrations/taxas_faixa_cep.test.ts` — já verde, prova o contrato de schema (coluna + CHECK)
  em pglite. Não tocar.
- `src/lib/utils/calcularFrete.ts:85-95` (`zonaAtende`, case `faixa_cep`) — a lógica de match já
  existe, é pura e está testada. Normaliza o CEP do cliente com `cep.replace(/\D/g,"")` e
  `Number(digitos)`, comparando contra `[cep_inicio, cep_fim]` inclusivo. **Não alterar.**
- `src/lib/utils/calcularFrete.test.ts:283-355` e `src/lib/actions/frete.test.ts:315-316` — cobertura
  do match por faixa já existe. Não duplicar.
- `src/lib/supabase/queries/entregaPagamento.ts:46` (`listarZonasComTaxas`) — o SELECT **já traz**
  `cep_inicio, cep_fim`, e `ZonaVitrine` os carrega. Nenhuma mudança de query é necessária.
- `src/lib/utils/buscarCep.ts:32` — `limparCep(cep)` (só dígitos). Reusar na conversão
  máscara → inteiro. É client-safe (sem `server-only`).
- `react-imask` (`^7.6.1`, já em `package.json`) + o padrão de `src/components/vitrine/FormEndereco.tsx:145-152`
  (`<IMaskInput mask="00000-000" inputMode="numeric">`). Reusar esse padrão nos dois campos de CEP do
  `FormZona` — **não escrever máscara artesanal**.
- `src/lib/validacoes/entrega.ts` — `schemaTaxa`/`schemaZonaCompleta` já são o schema zod ÚNICO
  usado pelo form (`FormZona.tsx:118`, gate de UX), pela Server Action do lojista
  (`src/lib/actions/entrega.ts:57,119`) e pelas Server Actions admin
  (`src/app/admin/assinantes/actions/admin-entrega.ts:47,103`). Corrigir o schema conserta os três
  caminhos de uma vez — **não é um segundo bug no admin, e não se cria schema admin separado**.
- RLS já existente (`zonas_escrita_propria`, `taxas_escrita_propria`) e o wrapper `EscopoLoja`
  (`seguranca.md` §7) no caminho admin. Nenhuma política nova.

#### O que será CRIADO, e por que não dá pra reusar

- `src/components/painel/payloadZona.ts` — módulo **puro, sem React**, com `paraNumero` (movido do
  `FormZona.tsx:45-50`), `cepParaInteiro`, `cepInteiroParaMascara` e `montarPayloadZona`.
  Justificativa: `FormZona.tsx` é `'use client'` e a suíte roda `environment: node`, sem jsdom — a
  regra de montagem do payload (que é onde o bug vive) só é testável se sair do componente. Nenhum
  util existente converte CEP mascarado ↔ inteiro de 8 dígitos: `limparCep` só remove não-dígitos e
  é reusado dentro de `cepParaInteiro`.

#### Causa raiz (confirmada contra o código atual)

1. `src/lib/validacoes/entrega.ts:17-25` — `schemaTaxa` é `z.object` (strip por padrão) e não declara
   `cep_inicio`/`cep_fim`: qualquer faixa enviada é **descartada em silêncio** pelo parse, antes do
   insert.
2. `src/components/painel/FormZona.tsx:103-115` — `montarPayload()` nem coleta os campos; não há UI
   para `tipo === "faixa_cep"` (o `<option value="faixa_cep">` da linha 170 existe e não abre campo
   nenhum).
3. `src/app/(painel)/.../entregas/EntregasClient.tsx:199-213` — o `inicial` da edição não repassa a
   faixa; mesmo com (1) e (2) corrigidos, reabrir uma zona e salvar zeraria a faixa.
4. Consequência: colunas gravam `NULL` → `calcularFrete.ts:88` (`if (cep_inicio == null || cep_fim == null) return false`)
   → **toda** zona `faixa_cep` nunca atende ninguém.

#### Decisão de design: onde mora cada refinamento

`schemaTaxa` isolado **não conhece `tipo`** (que vive em `schemaZona`). Logo, a validação se divide:

| Invariante | Onde | Por quê |
|---|---|---|
| `cep_inicio`/`cep_fim` inteiros em `[0, 99999999]` | `schemaTaxa` (campo) | intra-objeto; espelha o CHECK |
| par tudo-ou-nada e `cep_inicio <= cep_fim` | `.refine`/`.superRefine` em `schemaTaxa` | intra-objeto; espelha `taxas_faixa_cep_coerente` |
| `tipo === "faixa_cep"` ⇒ par **obrigatório** | `.superRefine` em `schemaZonaCompleta` | só esse nível vê `tipo` |
| `tipo !== "faixa_cep"` ⇒ par **null** | `.superRefine` em `schemaZonaCompleta` | evita faixa órfã em zona de bairro/raio |

Compatibilidade: os campos entram como `.nullable().default(null)` — payloads legados que não mandam
as chaves (testes existentes de `schemaTaxa`, `admin-entrega.test.ts`) continuam válidos, e a
obrigatoriedade real para `faixa_cep` vem do `superRefine` do nível composto. O `.superRefine` deve
ser aplicado **por último** em `schemaZonaCompleta` (depois do `.extend`), já que a instância
refinada não é mais extensível.

Detalhe numérico que a implementação **não pode errar**: `Number("01000000") === 1000000` (7
dígitos). `calcularFrete` já normaliza o CEP do cliente da mesma forma, então a comparação é
consistente nos dois lados. Mas a volta para a UI precisa de `String(n).padStart(8, "0")`, senão
a máscara reexibe `0100-000` ao editar.

### Cenários

**Caminho Feliz**
1. Lojista abre `/painel/configuracoes/entregas` → "Nova zona".
2. Escolhe tipo "Por faixa de CEP" → dois campos mascarados (`00000-000`) aparecem: CEP inicial e
   CEP final.
3. Preenche `01000-000` / `01099-999`, taxa `R$ 8,00`, salva.
4. `montarPayloadZona` converte para `cep_inicio: 1000000`, `cep_fim: 1099999`; `schemaZonaCompleta`
   aprova no client (UX).
5. `criarZona` (ou `criarZonaAdmin`) **revalida o mesmo schema** no servidor, deriva `loja_id` do
   dono (nunca do payload) e insere em `taxas_entrega` com a faixa; o CHECK do banco confirma.
6. Cliente da vitrine com CEP `01050-000` → `listarZonasComTaxas` traz a faixa → `calcularFrete`
   retorna `atendido: true, taxa: 8`.
7. Lojista reabre a zona: os campos vêm preenchidos com a máscara correta (`01000-000`), salvar de
   novo preserva a faixa.

**Casos de Borda**
- Campo de CEP vazio com `tipo === "faixa_cep"` → schema reprova, toast genérico, **nada é enviado**.
- CEP incompleto (`0100`) → `cepParaInteiro` retorna `null` (exige 8 dígitos) → cai no caso acima.
- Faixa invertida (`02000-000` a `01000-000`) → reprovada no schema (client e servidor) e, se
  escapasse, pelo CHECK `taxas_faixa_cep_coerente`.
- Troca de tipo na edição (`faixa_cep` → `bairro`) → `montarPayloadZona` zera a faixa por tipo (mesma
  disciplina já aplicada a `raio_max_km` e `bairros`); sem isso o `superRefine` reprovaria.
- Zona legada `faixa_cep` com faixa `NULL` no banco → ao editar, o lojista é **obrigado** a preencher
  antes de salvar. Nota: `alternarZonaAtiva` não passa por schema, então ativar uma zona legada
  continua possível — ela apenas segue não atendendo ninguém (comportamento atual, sem regressão).
- Bordas da faixa (`cep_inicio` e `cep_fim` exatos) → inclusivas; já coberto em
  `calcularFrete.test.ts:329`.
- CEP com zero à esquerda (`01000-000` → `1000000`) → round-trip com `padStart(8,"0")`.
- Falha de rede ao salvar → `try/catch` já existente nas Server Actions devolve erro genérico.
- Loja inativa / zona de outra loja → já barrado por RLS (lojista) e pelo `EscopoLoja` +
  `buscarPorId` (admin). Sem mudança.

**Tratamento de Erros**
Mantém o padrão atual: toast com a mensagem do primeiro issue zod no client (UX), e nas Server
Actions mensagem genérica (`"Zona inválida."` / `"Dados inválidos."`) com o detalhe apenas em
`console.error` no servidor (`seguranca.md` §14). **Não vazar `error.message` do Postgres** (ex.:
violação do CHECK) para a UI.

### Schema de Banco

**Nenhuma migration nova.** `taxas_entrega.cep_inicio` / `cep_fim` (`integer`, nullable) e a
CONSTRAINT `taxas_faixa_cep_coerente` já existem e estão aplicadas no cloud. RLS de
`taxas_entrega`/`zonas_entrega` inalterada — a issue é 100% camada de aplicação.

### Validação (zod)

Schema único em `src/lib/validacoes/entrega.ts`, reusado no form (`FormZona`, gate de UX) e nas três
Server Actions (autoridade):

- `schemaTaxa` ganha `cep_inicio` e `cep_fim`: `z.number().int().min(0).max(99999999).nullable().default(null)`.
- `schemaTaxa` ganha refinamento: `(cep_inicio == null) === (cep_fim == null)` **e**
  `cep_inicio <= cep_fim` quando ambos presentes — espelho exato do CHECK do banco.
- `schemaZonaCompleta` ganha `.superRefine` condicional a `tipo` (tabela da seção de design acima),
  aplicado depois do `.extend`.
- Atualizar o comentário-cabeçalho do módulo (linha 4) que hoje lista só `taxa, pedido_minimo_gratis, raio_max_km`.

### Recálculo no Servidor

Esta issue não move dinheiro do comprador: nenhum valor sai do cliente comprador. A faixa é
**configuração do lojista**, revalidada pelo mesmo schema na Server Action e ancorada em
`loja_id`/`zona_id` derivados no servidor. O frete cobrado continua recalculado do banco por
`calcularFrete` na Server Action de pedido (`seguranca.md` §10) — sem mudança nesse caminho. Efeito
prático da correção: o servidor passa a **ter** o dado de faixa para recalcular, em vez de sempre
ler `NULL`.

Camadas que garantem cada invariante:

| Invariante | Camada |
|---|---|
| Faixa bem-formada (par, ordem, range) | zod na Server Action + CHECK `taxas_faixa_cep_coerente` |
| Zona/taxa pertence à loja do lojista | RLS `zonas_escrita_propria`/`taxas_escrita_propria` |
| Zona/taxa pertence à loja-alvo (admin) | `EscopoLoja` + `escopo.buscarPorId` antes de escrever filhas |
| Frete cobrado no pedido | recálculo em `calcularFrete` a partir do banco |

### Arquivos a Criar / Modificar / NÃO tocar

**Criar**
- `src/components/painel/payloadZona.ts` — `paraNumero` (movido), `cepParaInteiro`,
  `cepInteiroParaMascara`, `montarPayloadZona`. Puro, testável em `environment: node`.
- `src/components/painel/payloadZona.test.ts` — parte do RED.

**Modificar**
- `src/lib/validacoes/entrega.ts` — campos + refinamentos descritos acima. **Coração do fix.**
- `src/lib/validacoes/entrega.test.ts` — novos casos (RED).
- `src/components/painel/FormZona.tsx` — estado `cepInicio`/`cepFim`, bloco `tipo === "faixa_cep"`
  com dois `IMaskInput`, `montarPayload` delegando ao módulo puro, `ZonaInicial` ganhando
  `cep_inicio`/`cep_fim` e hidratação via `cepInteiroParaMascara`.
- `src/app/(painel)/painel/(bloqueavel)/configuracoes/entregas/EntregasClient.tsx:199-213` —
  repassar `cep_inicio`/`cep_fim` no `inicial` (já disponíveis em `ZonaVitrine`). Sem isso, editar
  zera a faixa.

**NÃO tocar**
- `supabase/migrations/**` — nenhuma migration nova (colunas e CHECK já existem e estão no cloud).
- `src/lib/utils/calcularFrete.ts` — lógica de match já correta e testada.
- `src/lib/supabase/queries/entregaPagamento.ts` — SELECT já traz a faixa.
- `src/lib/actions/entrega.ts` e `src/app/admin/assinantes/actions/admin-entrega.ts` — usam
  `{...parsed.data.taxa}` no insert/upsert; assim que o schema parar de fazer strip, a faixa passa
  a fluir **sem nenhuma alteração** nesses arquivos. Só tocar se um teste provar o contrário.
- `tests/migrations/taxas_faixa_cep.test.ts`, `src/lib/utils/calcularFrete.test.ts`,
  `src/lib/actions/frete.test.ts` — já verdes.
- `src/components/ui/**` — gerado pelo shadcn CLI.

### Dependências Externas

**Nenhuma nova.** `react-imask@^7.6.1` já está em `package.json` e já é usado em três telas. Zero
custo, zero quota, zero chamada de rede: a máscara é local. Este fluxo **não** chama ViaCEP (o
lojista digita uma faixa, não consulta um CEP), então nada do orçamento do ViaCEP/Nominatim
(`architecture.md` §9) é consumido.

### Ordem de Implementação

1. **RED — agente `tdd`** (antes de qualquer produção; capturar output `FAIL`):
   - `src/lib/validacoes/entrega.test.ts`:
     - **o teste que prova o bug**: `schemaZonaCompleta.safeParse` de zona `faixa_cep` com
       `taxa.cep_inicio: 1000000, cep_fim: 1099999` → sucesso **e**
       `parsed.data.taxa.cep_inicio === 1000000` (hoje a chave some por strip);
     - `schemaTaxa` rejeita meio-par (`cep_inicio` sem `cep_fim`), faixa invertida, valor negativo,
       acima de `99999999` e não-inteiro;
     - `schemaTaxa` aceita payload legado sem as chaves (compat) com par resolvendo em `null`;
     - `schemaZonaCompleta` rejeita `faixa_cep` sem faixa e rejeita `bairro`/`raio_km` **com** faixa.
   - `src/components/painel/payloadZona.test.ts`:
     - `tipo: "faixa_cep"` com `"01000-000"`/`"01099-999"` → `cep_inicio: 1000000, cep_fim: 1099999`;
     - `tipo: "bairro"` e `"raio_km"` → par `null` mesmo com os campos preenchidos (troca de tipo);
     - CEP vazio ou incompleto → `null`;
     - round-trip `cepInteiroParaMascara(1000000) === "01000-000"`.
2. **GREEN 1 — schema** (`src/lib/validacoes/entrega.ts`). Fecha o teste que prova o bug e destrava
   lojista **e** admin de uma vez. Primeiro porque tudo depende dele.
3. **GREEN 2 — módulo puro** (`src/components/painel/payloadZona.ts`), movendo `paraNumero`.
4. **GREEN 3 — UI** (`FormZona.tsx`): campos mascarados, `ZonaInicial` estendido, hidratação na
   edição. Depende de 2 e 3 estarem consistentes com o schema de 1.
5. **GREEN 4 — round-trip de edição** (`EntregasClient.tsx`): repassar a faixa no `inicial`. Último
   porque só faz sentido com o form já lendo os campos.
6. **Gates**: `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`.
7. **`verificar`** no app real: criar zona `faixa_cep` na loja de teste autorizada ("Lanches base"),
   conferir no cloud que `taxas_entrega.cep_inicio/cep_fim` **não** são `NULL`, e simular um CEP
   dentro da faixa na vitrine.

### Riscos

- **Regressão em payload legado**: se os campos entrarem como obrigatórios em vez de
  `.nullable().default(null)`, `admin-entrega.test.ts` e os casos existentes de `schemaTaxa` quebram.
  Mitigado pelo teste de compat no passo 1.
- **`.superRefine` antes do `.extend`**: aplicar o refinamento e depois tentar estender quebra o
  build. Ordem fixada no plano.
- **Zero à esquerda**: esquecer o `padStart(8,"0")` na volta para a máscara produz faixa errada em
  uma segunda edição — coberto pelo teste de round-trip.
