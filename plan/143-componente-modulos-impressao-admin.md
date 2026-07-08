## Plano Técnico

### Análise do Codebase

**O que já existe e será reusado (nada de novo aqui):**

- `src/app/admin/assinantes/actions/admin-modulos-impressao.ts` — Server Action
  `alternarModuloImpressao(lojaId, modulo, ativo): Promise<{ok:true}|{ok:false;erro:string}>`
  (issue 142, **já em produção**). É a ÚNICA autoridade: valida `lojaId` (z.guid),
  valida `modulo` contra union fixo `"a4"|"termica"`, prova admin (`verificarAdminSaaS`
  via `prepararContextoAdmin`), escreve por mapa server-side de coluna, revalida. O
  componente só a consome. **Não** tocar.
- `src/app/admin/assinantes/AcoesAssinante.tsx` — **fonte do esqueleto**: helper
  `executar` + `useTransition` + `toast.success/error` + `Switch checked=… disabled={pendente}
  onCheckedChange={…}` + `<Label htmlFor>`. Copiar o padrão, **adaptando** para a
  assinatura de 3 args da action e para estado otimista local (ver "Desvio" abaixo).
- `src/components/ui/switch.tsx` — primitivo base-ui (`SwitchPrimitive.Root.Props`).
  API confirmada em uso (AcoesAssinante): **controlado** via `checked: boolean` +
  `onCheckedChange: (ativo: boolean) => void`, mais `disabled` e `id`. **Não** rodar
  `npx shadcn add` (puxa Radix — memória do projeto `ui-primitivos-base-ui-nao-radix`).
- `src/components/ui/label.tsx` — `<Label htmlFor={id}>` (reuso).
- `src/components/ui/card.tsx`, `badge.tsx`, `separator.tsx` — disponíveis; uso conforme
  o layout do componente (ver seam com 144 em "Arquivos / Riscos").
- `sonner` (`toast`) — já dependência; import `import { toast } from "sonner"`.
- `useTransition` (React) — um único hook para o `pendente` que desabilita **os dois**
  switches.

**Referência visual (para 144, não para 143):** `src/app/admin/assinantes/[lojaId]/layout.tsx`
usa a paleta âmbar/admin (`bg-amber-50 dark:bg-amber-950/40`, `text-amber-900/950`,
`border-b`, `Badge`). O tratamento âmbar do card é escopo da **144**, não desta issue.

**Contrato de props — decisão firme:** usar `{ lojaId: string; modulos: { a4: boolean;
termica: boolean } }` (forma da issue e do consumidor 144, que passa
`modulos={{ a4: loja.modulo_impressao_a4, termica: loja.modulo_impressao_termica }}`).
A forma achatada `moduloA4/moduloTermica` sugerida no pedido do orquestrador **não** é
adotada — quebraria o contrato com a page da 144. Coerção fail-closed `=== true` no
componente (RN-3), independente do tipo declarado ser `boolean`.

### Desvio deliberado do esqueleto de `AcoesAssinante` (justificar)

`AcoesAssinante` **não tem estado local**: o `Switch` de cortesia é `checked={ehCortesia}`,
derivado de uma **prop** (`status`) que a revalidação do servidor re-renderiza. Aqui a
issue/spec RN-4 exige **preview otimista + rollback** — o switch antecipa o novo estado
antes da resposta e **volta** ao anterior em falha. Como não há prop de status re-derivada
no mesmo render, é necessário **`useState` local por módulo**, semeado das props:

```
const [pendente, iniciar] = useTransition();
const [a4, setA4] = useState(modulos.a4 === true);          // RN-3 fail-closed
const [termica, setTermica] = useState(modulos.termica === true);

function alternar(modulo, novo, setEstado, anterior) {
  setEstado(novo);                                          // otimista (RN-4)
  iniciar(async () => {
    try {
      const r = await alternarModuloImpressao(lojaId, modulo, novo);
      if (r.ok) toast.success(`Módulo ${rotulo} ${novo ? "ativado" : "desativado"}.`);
      else { setEstado(anterior); toast.error(r.erro); }    // rollback (RN-4)
    } catch { setEstado(anterior); toast.error("Não foi possível alterar o módulo."); }
  });
}
// Switch: checked={a4} disabled={pendente} onCheckedChange={(v)=>alternar("a4", v, setA4, a4)}
```

`useState` semeado das props é aceitável: após sucesso o estado otimista já bate com o
servidor (a action chama `revalidarLojaAdmin`); em navegação/refresh o componente
remonta com props frescas. **Não** usar `useEffect` de sincronização (desnecessário e
propenso a piscar).

### Cenários

**Caminho Feliz:**
1. Admin abre `/admin/assinantes/[lojaId]/configuracoes`; a page (144) passa `modulos`
   lido do servidor. Os dois switches renderizam refletindo `a4`/`termica`.
2. Admin liga "Impressão A4/PDF" → `setA4(true)` (otimista), ambos switches ficam
   `disabled` (`pendente`), `alternarModuloImpressao(lojaId, "a4", true)` roda.
3. `{ ok:true }` → `toast.success`; switch permanece ligado; `revalidarLojaAdmin`
   propaga a verdade do servidor às rotas consumidoras (spec 4).
4. Idem para "Impressão Térmica" com `"termica"` — módulos independentes (RN-6).

**Casos de Borda:**
- **`{ ok:false }` (loja não encontrada / módulo inválido / erro de banco):** rollback ao
  estado anterior + `toast.error(r.erro)` (mensagem já neutra vinda da action 142).
- **Exceção (falha de rede, `verificarAdminSaaS` propaga fora do try da action — D-4):**
  o `await` rejeita → `catch` → rollback + `toast.error` genérico.
- **Estado inicial ambíguo** (`undefined`/qualquer não-`true`): coerção `=== true`
  renderiza **desligado** (RN-3, coerente com `variantesHabilitadas`).
- **Duplo-clique / corrida no gesto:** ambos switches `disabled` enquanto `pendente`
  (defesa de UX; a defesa real é o `UPDATE` idempotente por `id` no banco, RN-5).
- **Sem permissão / não-admin:** impossível chegar aqui (rota `/admin/*` barrada por
  `verificarAdminSaaS()` no `layout.tsx`); e mesmo forjando request, a action 142
  reprova antes de qualquer efeito. O componente **não** decide permissão.

**Tratamento de Erros:** o componente exibe só `toast.error` (mensagem neutra da action
ou genérica na exceção). Nenhum detalhe de servidor é montado no cliente — o log fica na
action (`console.error` em 142, `seguranca.md` §14). Nada de `error.message` cru na UI.

### Schema de Banco

**Nenhuma mudança.** Zero coluna/tabela/RLS nova (spec 6 §Modelos de Dados). As flags
`lojas.modulo_impressao_a4` / `lojas.modulo_impressao_termica`, o trigger
`lojas_protege_billing()` v3 e a RLS de `lojas` já existem (spec 4). Esta issue é
100% cliente.

### Validação (zod)

**Nenhuma no cliente.** A validação de entrada (`z.guid` no `lojaId`, `z.enum(["a4",
"termica"])` no módulo, `z.boolean()` no ativo) já está na Server Action 142 e é a
autoridade. Recriar um schema aqui seria duplicação inútil — o cliente só envia
`(lojaId, "a4"|"termica", boolean)` fixados no código, não campos livres de formulário.

### Recálculo no Servidor

**Não há valor monetário.** `ativo` é booleano server-set: o servidor grava tal-e-qual
**após** provar admin (RN-2, `seguranca.md` §10 aplicado a *permissão*, não a dinheiro).
O análogo do "recálculo" aqui é a **decisão de entitlement ser server-autoritativa** —
garantida integralmente na action 142.

### Mapa cliente ↔ servidor (invariantes)

| Invariante | Camada que garante |
|---|---|
| Só admin altera as flags (entitlement) | **Server Action 142** (`verificarAdminSaaS` + `service_role`), + guard `verificarAdminSaaS()` no `layout.tsx`. RLS **não** é a defesa (service_role bypassa). |
| `modulo` nunca vira nome de coluna arbitrário | **Server Action 142** (union fixo + mapa server-side). Cliente só manda `"a4"`/`"termica"` hardcoded. |
| Escrita escopada à loja-alvo | **Server Action 142** (`.eq("id", lojaId)`) + trigger `lojas_protege_billing()` v3 (backstop). |
| Estado inicial = verdade do banco | **Server (loader `carregarLojaAdmin`, service_role escopado)** — 144 passa as flags. |
| Preview otimista / rollback / disabled | **Cliente (UX)** — não-autoritativo; a verdade é o `{ ok }` da action + próximo load. |

Nenhuma regra de valor/permissão é decidida no cliente — o `'use client'` aqui é
puramente gesto + feedback. Enforcement server-side: **completo na 142**.

### Arquivos a Criar / Modificar / NÃO tocar

**Criar:**
- `src/app/admin/assinantes/[lojaId]/configuracoes/ModulosImpressaoAdmin.tsx` —
  `'use client'`. Dois `Switch` + `Label` + descrição curta por módulo, `useTransition`,
  estado otimista local, `toast`, chamando `alternarModuloImpressao`. Rótulos PT:
  "Impressão A4/PDF" e "Impressão Térmica". Container **neutro/mínimo** (ver seam).
- `src/app/admin/assinantes/[lojaId]/configuracoes/ModulosImpressaoAdmin.test.tsx` —
  teste leve (ver "Como Testar").

**NÃO tocar:**
- `admin-modulos-impressao.ts` (142 — pronta).
- `configuracoes/page.tsx` e o card âmbar (144 — insere `<ModulosImpressaoAdmin/>` e
  aplica o chrome âmbar/admin).
- `ConfiguracaoAdminClient.tsx` — **proibido** inserir o controle ali (spec 6: aquele
  espelha só o que o lojista edita).
- `src/components/ui/*` (shadcn/base-ui) — não editar à mão.

**Seam 143 ↔ 144 (risco principal de coordenação):** a issue 143 lista `Card`/`Badge` no
reuso, mas seu "Fora de escopo" atribui o **tratamento âmbar/admin à 144**, e a 144 é
quem define o card "Módulos pagos (controle do SaaS)". **Decisão recomendada:** 143 entrega
o **conteúdo funcional** (título curto opcional + as duas linhas rótulo/descrição/switch)
com tokens neutros; 144 envolve com o **card âmbar** e o cabeçalho "Módulos pagos (controle
do SaaS)" + posicionamento acima de `ConfiguracaoAdminClient`. Assim a 144 não reabre a 143
e não há chrome duplicado. Confirmar essa fronteira antes de implementar a 144.

### Dependências Externas

Nenhuma nova. `sonner` (`^2.0.7`), `@base-ui/react` (`^1.5.0`), `react` — já no
`package.json`.

### Como Testar (padrão do projeto — sem jsdom)

Confirmado: o projeto **não** usa jsdom/@testing-library (as ocorrências de "jsdom" são
comentários "sem jsdom"). Testes de client component usam `renderToStaticMarkup`
(`react-dom/server`) + captura/invocação de props via stub, como
`ConfiguracaoAdminClient.test.tsx` e `AcoesStatus.test.tsx`.

Estratégia para `ModulosImpressaoAdmin.test.tsx` (`environment=node`):
1. **Mockar** `@/components/ui/switch` com um stub que captura `checked`/`disabled`/
   `onCheckedChange` de cada switch; **mockar** `@/app/admin/assinantes/actions/admin-modulos-impressao`
   (`alternarModuloImpressao: vi.fn()`); **mockar** `sonner` (`toast:{success,error}`).
2. **Render estático** → assert: dois switches; `checked` reflete `modulos.a4`/`.termica`;
   **coerção fail-closed** (passar `a4` truthy-mas-não-`true`, ex. via cast, renderiza
   desligado — RN-3); ambos com `htmlFor`/`id` casados.
3. **Wiring do toggle** (padrão ConfiguracaoAdminClient): invocar o `onCheckedChange`
   capturado do switch A4 com `true` → assert `alternarModuloImpressao(lojaId, "a4", true)`;
   com `false` no de Térmica → `(lojaId, "termica", false)`.
4. **Ramo de toast**: action mockada `{ok:true}` → `toast.success` chamado; `{ok:false,
   erro}` → `toast.error(erro)`; action que rejeita → `toast.error` genérico.

**Limitação honesta (documentar no topo do teste, como `AcoesStatus.test.tsx`):** o
**rollback visual** (switch voltando de posição) é `setState` e **não** é re-observável em
`renderToStaticMarkup` (render único, sem re-render). O teste prova o **efeito observável**
do rollback (`toast.error` no ramo de falha) e o disparo correto da action; a reversão
visual ponta-a-ponta fica coberta pelo `verificar`/critério da 144 ("após recarregar
persiste"). Não introduzir jsdom só por isto.

### Ordem de Implementação

Issue **não-crítica** → TDD red-first **não** é obrigatório (é UX de cliente, sem
dinheiro/RLS/token/authz — a autoridade toda está na 142, que é a crítica). Ordem:
1. `ModulosImpressaoAdmin.tsx` (componente + estado otimista + wiring da action 142).
2. `ModulosImpressaoAdmin.test.tsx` (render + coerção + wiring + ramos de toast).
3. `npx next build` (garante que o `'use client'` e a importação da action passam no
   build — memória `use-server-export-constraint`).
