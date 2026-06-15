## Plano Técnico

> **Criticidade:** NÃO crítica (UX, preview não-vinculante). O caminho que cobra (`criarPedido`, issue 064) já está correto e fail-closed. Esta issue alinha o **preview** ao autoritativo para eliminar divergência visual preview↔cobrança. Como toca cálculo de frete, o teste deve **provar paridade** preview↔autoritativo, mas a fase RED não é obrigatória (não é dinheiro vinculante).

### Análise do Codebase

**O que já existe e será reusado (NÃO recriar):**

- `src/lib/utils/reconciliarBairroCep.ts` — `reconciliarBairroCep(cep, bairroDeclarado): Promise<ResultadoReconciliacao>`. I/O isolada, fail-closed total (try/catch engole tudo, timeout 3s via `AbortSignal.timeout`). Já é a fonte usada pelo autoritativo. **Reuso direto, sem mudança.**
- `src/lib/actions/pedido.ts` (linhas 194-217) — bloco de reconciliação autoritativo. É a **referência exata da política** a replicar: `if (endereco.bairro)` → reconcilia se há CEP → `reconciliado && bairroCanonico != null` usa canônico, senão **descarta o bairro declarado** (`bairro: null`). O CEP numérico permanece no endereço para zonas `tipo='faixa_cep'`.
- `src/lib/utils/calcularFrete.ts` — `calcularFrete(zonas, endereco, subtotal, taxaForaZona)`. `EnderecoEntrega` já tem `cep?: string | null` e `bairro?`. Zonas `tipo='faixa_cep'` casam por `endereco.cep` (linhas 85-90). **Pura, sem I/O — não tocar.**
- `src/lib/supabase/queries/entregaPagamento.ts` → `listarZonasComTaxas` e `src/lib/supabase/queries/lojas.ts` → `buscarLojaPublicaPorId`. Já usadas na action. **Reuso.**
- `src/components/vitrine/FormEndereco.tsx` — `EnderecoEntrega` já expõe `cep` e `bairro`; `onEnderecoChange` entrega ambos. O `cep` **já está disponível** em `EtapaEntrega` via `endereco.cep`. **Nenhuma mudança no FormEndereco.**
- `src/lib/actions/frete.test.ts` — suite existente da action (issue 072). Será estendida (mock de `reconciliarBairroCep`, casos de paridade), não recriada.

**O que precisa mudar (mínimo):**
1. Schema e corpo de `calcularFreteAction` em `src/lib/actions/frete.ts` — aceitar `cep` opcional e aplicar a MESMA reconciliação do autoritativo.
2. Chamada em `src/components/vitrine/checkout/EtapaEntrega.tsx` — passar `cep` ao preview e reagir a mudança de CEP além de bairro.
3. `src/lib/actions/frete.test.ts` — testes de paridade.

**Achado adicional (além do enunciado):** o preview hoje passa só `{ bairro }`, sem `cep`, então além de não reconciliar o bairro ele **nunca casa zonas `tipo='faixa_cep'`** — o autoritativo passa `endereco.cep` e casa. Logo, para paridade real, o preview precisa repassar o `cep` numérico ao `calcularFrete` (não só usar o CEP para reconciliar o bairro). Sem isso, lojas que usam zonas por faixa de CEP continuam divergindo.

### Cenários

**Caminho Feliz (paridade):**
1. Cliente preenche CEP no `FormEndereco`; ViaCEP autocompleta o bairro; `onEnderecoChange` propaga `{ cep, bairro, ... }`.
2. `EtapaEntrega` dispara `calcularFreteAction({ loja_id, cep, bairro })` quando `cep` ou `bairro` mudam.
3. Action valida com zod `.strict()` (agora aceita `cep` opcional). Busca `zonas` + `loja`.
4. Action chama `reconciliarBairroCep(cep, bairro)`: reconciliado → usa `bairroCanonico`; falha/sem CEP → descarta bairro (`bairro: null`), igual ao autoritativo.
5. `calcularFrete(zonas, { bairro: <canônico|null>, cep }, 0, taxaForaZona)` — mesmos argumentos lógicos do `criarPedido` (subtotal=0 no preview).
6. Preview exibe taxa idêntica à que `criarPedido` cobrará para o mesmo `(cep, bairro)`.

**Casos de Borda:**
- **Sem CEP (só bairro):** `reconciliarBairroCep` não é chamada (espelha `endereco.cep ? ... : null` do autoritativo) → bairro declarado descartado → cai no fallback fora-de-zona ou indisponível. Preview = autoritativo.
- **ViaCEP fora do ar / timeout 3s:** `reconciliado:false` → bairro descartado (fail-closed). Preview mostra fallback caro / indisponível — coerente com a cobrança.
- **CEP inexistente (`{erro:true}`):** idem fail-closed.
- **Bairro declarado divergente do CEP ("bairro barato"):** preview já usa o canônico do CEP — mostra a taxa real, sem ilusão de barato.
- **Retirada:** preview força 0 sem tocar endereço/action (já é assim em `EtapaEntrega`, sem mudança).
- **Loja sem fallback fora-de-zona:** `taxa_entrega_fora_zona` null → `atendido:false` → `zona_nome:'indisponivel'`, preview bloqueia avanço (já tratado).
- **Zona `tipo='faixa_cep'`:** com o `cep` agora repassado, o preview casa a faixa igual ao autoritativo.
- **Payload com campo extra injetado:** `.strict()` rejeita antes de qualquer I/O (mantido).

**Tratamento de Erros (seguranca.md §14):** reconciliação e queries dentro do `try` existente. Erro interno → `console.error('[calcularFreteAction]', e)` no servidor + retorno genérico `{ ok:false, erro:'Não foi possível calcular o frete.' }`. `reconciliarBairroCep` já é fail-closed e não lança. Nenhum detalhe interno vaza ao cliente.

### Schema de Banco
Nenhuma mudança de schema. Não há tabela nova, nem migration, nem RLS nova. Leitura pública (zonas + `vitrine_lojas`) já coberta por RLS pública existente. **Service role continua proibido nesta action.**

### Validação (zod)
Atualizar `schemaFretePreview` em `src/lib/actions/frete.ts` (schema único da action, reusado no contrato cliente↔servidor):

```ts
const schemaFretePreview = z
  .object({
    loja_id: z.guid(),
    bairro: z.string().trim().min(1),
    cep: z.string().trim().optional(), // novo: opcional p/ reconciliação + faixa_cep
  })
  .strict();
```

`cep` opcional (espelha o autoritativo, onde `endereco.cep` pode faltar). `reconciliarBairroCep` já normaliza dígitos internamente (`replace(/\D/g, '')`), então máscara do CEP é tolerada — sem reimplementar limpeza aqui.

### Recálculo no Servidor (regra cliente↔servidor)

| Invariante | Camada que garante | Observação |
|-----------|--------------------|------------|
| Taxa de frete preview | **Server Action `calcularFreteAction`** recalcula do banco (`calcularFrete` + zonas do banco) | cliente nunca envia taxa; `.strict()` barra `taxa_preview` injetado |
| Reconciliação CEP↔bairro (preview) | **Server Action**, via `reconciliarBairroCep` (ViaCEP server-side) | mesma fail-closed do autoritativo |
| Reconciliação CEP↔bairro (cobrança) | **Server Action `criarPedido`** (já existe, 064) | **fonte de verdade vinculante — inalterada** |

Cliente envia `{ loja_id, cep, bairro }`. Servidor recalcula do zero: reconcilia o bairro contra o CEP e busca taxa nas zonas do banco. O preview **não é vinculante**; `criarPedido` continua sendo a autoridade que cobra (não pular sua revalidação). Esta issue só faz o preview **espelhar** a autoridade, sem tornar o preview confiável.

### Arquivos a Criar / Modificar / NÃO tocar

**Modificar:**
- `src/lib/actions/frete.ts` — (a) schema: `cep` opcional; (b) extrair `cep` do parsed; (c) replicar bloco de reconciliação do `pedido.ts` (linhas 207-217) antes de `calcularFrete`; (d) passar `cep` + bairro reconciliado a `calcularFrete`. Atualizar comentário de cabeçalho citando 064/§10-A e a paridade fail-closed.
- `src/components/vitrine/checkout/EtapaEntrega.tsx` — passar `cep: endereco?.cep` em `calcularFreteAction`; incluir `endereco?.cep` nas deps do `useEffect` e na chave de dedupe (`ultimoBairro` → passar a comparar `cep|bairro`, para recalcular quando só o CEP muda).
- `src/lib/actions/frete.test.ts` — adicionar `vi.mock('@/lib/utils/reconciliarBairroCep')` (mesmo padrão do `pedido.test.ts` linhas 70-72) e casos de paridade.

**NÃO tocar:**
- `src/lib/utils/reconciliarBairroCep.ts` — já pronto e correto.
- `src/lib/utils/calcularFrete.ts` — função pura, contrato suficiente (já aceita `cep`).
- `src/lib/actions/pedido.ts` — autoritativo já correto; é a REFERÊNCIA, não muda.
- `src/components/vitrine/FormEndereco.tsx` — já expõe `cep` e `bairro`.
- `src/components/ui/**` (shadcn) — não editar à mão.
- Queries em `lib/supabase/queries/**` — reuso sem mudança.

### Dependências Externas
- **ViaCEP** (`https://viacep.com.br/ws/{cep}/json/`) — já consumido server-side por `reconciliarBairroCep` (timeout 3s). Sem credencial. Doc: https://viacep.com.br/. Uso server-side de frete é distinto do autocomplete client-side (seguranca.md §10-A nota).
- **zod** (já no `package.json`) — `.optional()` no schema existente.
- Nenhum pacote novo.

### Ordem de Implementação
1. **`src/lib/actions/frete.test.ts`** — escrever os testes de **paridade** primeiro (preview↔autoritativo): mesmo `(cep, bairro)` → mesma taxa; ViaCEP down → fallback (fail-closed); sem CEP → bairro descartado; bairro divergente → canônico vence; zona `faixa_cep` casa com `cep`. Mock de `reconciliarBairroCep` no padrão do `pedido.test.ts`. (Não é RED obrigatório — issue não-crítica —, mas escrever o teste de paridade antes guia a implementação e trava regressão.)
2. **`src/lib/actions/frete.ts`** — schema `cep` opcional + bloco de reconciliação espelhando `pedido.ts` + repasse de `cep` a `calcularFrete`. Rodar suite até verde.
3. **`src/components/vitrine/checkout/EtapaEntrega.tsx`** — passar `cep`, ajustar deps e dedupe do `useEffect`.
4. Verificar paridade ponta a ponta (`/verificar`): preencher CEP cujo bairro do ViaCEP difere do digitável → preview e cobrança batem.

### Riscos
- **Dedupe por bairro mascara mudança de CEP:** `ultimoBairro` atual só observa bairro; se o CEP muda mas o bairro autocompletado é igual, não recalcula. Mitigar usando chave composta `cep|bairro`. Baixa probabilidade, mas é o tipo de bug que reabre divergência.
- **Latência extra no preview:** cada cálculo agora chama ViaCEP (até 3s). Aceitável para preview (já assíncrono, com estado `calculando`); o dedupe evita chamadas repetidas. Não bloqueia o autoritativo.
- **Falsa sensação de autoridade:** reforçar no comentário que o preview continua não-vinculante; `criarPedido` é a única autoridade de cobrança.
