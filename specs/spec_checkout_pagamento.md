# Spec: Checkout e Pagamento — Wizard Multi-Etapa

**Versão:** 0.1.0 | **Atualizado:** 2026-06-14

> **Emenda ao `specs/spec_irango_mvp.md`.** Este spec substitui e detalha apenas a seção "Checkout — `/loja/[slug]/pedido`" e as mudanças de dados associadas. Todas as outras seções do MVP permanecem válidas. O fluxo de confirmação (`/loja/[slug]/confirmacao`) é mantido como está — não alterar o visual de `design-claude/vitrine/confirmacao.html`.

---

## Visão Geral

Refinamento do fluxo de checkout da vitrine pública. Em vez de uma tela única, o cliente percorre um **wizard de 3 etapas** na rota `/loja/[slug]/pedido`:

1. **Itens + Cupom** — revisão do carrinho e aplicação de cupom
2. **Entrega** — escolha entre retirada ou entrega com cálculo de frete por bairro/fallback
3. **Pagamento** — seleção da forma de pagamento com instrução específica (QR Pix, link WhatsApp, troco)

O cliente nunca envia valores monetários. O servidor recalcula tudo de forma autoritativa.

**Mundo:** vitrine pública (sem login). A rota `/loja/[slug]/pedido` é pública — cliente não precisa de conta.

---

## Atores Envolvidos

| Ator | Papel nesta feature |
|------|---------------------|
| **Cliente** | Navega as etapas, informa dados (itens, endereço, forma de pagamento), nunca envia valores monetários |
| **iRango (servidor)** | Recalcula subtotal, desconto, frete e total; valida cupom, loja aberta, assinatura, disponibilidade de produto; persiste o pedido |
| **Lojista** | Configurou previamente zonas de entrega, formas de pagamento, cupons e (para Pix) QR Code estático — não participa ativamente do checkout |

---

## Páginas e Rotas

### Checkout Wizard — `/loja/[slug]/pedido`

**Mundo:** vitrine pública (sem auth)
**Descrição:** Wizard client-side de 3 etapas. O estado do wizard vive em `sessionStorage` (mesmo padrão do carrinho existente, via `useCarrinho`). A navegação entre etapas é client-side; o único request ao servidor é a submissão final na Etapa 3.

**Componentes:**

- `CheckoutWizard` (`components/vitrine/checkout/CheckoutWizard.tsx`) — container com indicador de progresso (shadcn/ui `Progress` ou stepper simples), renderiza a etapa ativa
- `IndicadorEtapas` — row com 3 passos: "Carrinho", "Entrega", "Pagamento"; etapa atual destacada
- `EtapaItens` (`components/vitrine/checkout/EtapaItens.tsx`) — etapa 1
- `EtapaEntrega` (`components/vitrine/checkout/EtapaEntrega.tsx`) — etapa 2
- `EtapaPagamento` (`components/vitrine/checkout/EtapaPagamento.tsx`) — etapa 3
- `ResumoValores` — exibição de subtotal, desconto, frete, total. **PREVIEW de UX** — recalculado no servidor no envio
- Reusa: shadcn/ui `Card`, `Button`, `Input`, `RadioGroup`, `Separator`, sonner `toast`

---

#### Etapa 1 — Itens + Cupom

**Behaviors:**

- [ ] Exibir itens do carrinho — lê `sessionStorage` via `useCarrinho`. Se carrinho vazio, redireciona para `/loja/[slug]`. Garantido em: cliente (UX).
- [ ] Alterar quantidade de item — incrementar/decrementar via `useCarrinho`. Remove item ao zerar. Garantido em: cliente (UX).
- [ ] Remover item — atualiza `sessionStorage` via `useCarrinho`. Garantido em: cliente (UX).
- [ ] Exibir subtotal preview — `calcularSubtotal()` (reutiliza `lib/utils/calcularTotal.ts` já existente). **PREVIEW — não autoritativo.** Garantido em: cliente (UX).
- [ ] Aplicar cupom — ao digitar código e clicar "Aplicar", chama Server Action `validarCupomAction(loja_id, codigo, subtotal_preview)`. Servidor retorna `{ valido, desconto_preview, mensagem }`. Desconto exibido é **PREVIEW**. O cupom só é revalidado de forma autoritativa no envio final. Garantido em: Server Action (validação semântica para UX) + recálculo autoritativo no envio (Server Action `criarPedido`).
- [ ] Remover cupom — limpa campo e desconto preview. Garantido em: cliente (UX).
- [ ] Exibir total preview (sem frete) — `subtotal - desconto_preview`. **PREVIEW.** Garantido em: cliente (UX).
- [ ] Avançar para Etapa 2 — botão "Continuar" habilitado apenas se carrinho não está vazio. Garantido em: cliente (UX).

**Regra crítica de desconto (RN-C1):** desconto incide **apenas no subtotal dos produtos**. Nunca sobre frete. Garantido em: Server Action `criarPedido` (recálculo autoritativo). Preview no cliente segue a mesma regra via `calcularDesconto` (lib existente).

---

#### Etapa 2 — Entrega

**Behaviors:**

- [ ] Exibir opções de tipo de entrega — RadioGroup com "Retirada" e "Entrega". Exibe apenas se a loja tiver ambas configuradas; se a loja não aceitar entrega (sem zonas e sem `taxa_entrega_fora_zona`), só exibe "Retirada" e avisa "Somente retirada disponível". Garantido em: cliente (UX) com dados carregados via Server Component no load da página.
- [ ] Selecionar Retirada — oculta campos de CEP/endereço. Frete preview = R$ 0,00. Avançar direto para Etapa 3. Garantido em: cliente (UX). Frete = 0 SEMPRE no servidor se `tipo_entrega = 'retirada'` — servidor ignora qualquer endereço enviado (RN-C2). Garantido em: Server Action `criarPedido`.
- [ ] Selecionar Entrega — exibe formulário de endereço. Garantido em: cliente (UX).
- [ ] Preencher CEP — campo com máscara react-imask. Ao atingir 8 dígitos, chama ViaCEP (`https://viacep.com.br/ws/{cep}/json/`) diretamente do cliente (API pública sem key — `seguranca.md` §9). Garante apenas UX; a autoridade do frete é o servidor. Garantido em: cliente (UX).
- [ ] Autopreenchimento de endereço via ViaCEP — preenche automaticamente rua (`logradouro`), bairro, cidade (`localidade`) e UF. Bairro retornado pelo ViaCEP é o campo que o servidor usará para calcular frete. Garantido em: cliente (UX).
- [ ] Exibir CEP inválido — se ViaCEP retornar `{ "erro": true }` ou falhar, exibir erro inline "CEP não encontrado". Garantido em: cliente (UX).
- [ ] Calcular frete preview — ao campo `bairro` ser preenchido (manualmente ou via ViaCEP), chama Server Action `calcularFreteAction(loja_id, bairro)` para estimar o frete. Retorna `{ taxa_preview, zona_nome | 'fora_zona' | 'indisponivel' }`. **PREVIEW — valor exibido pode diferir do autoritativo se bairro mudar entre etapas.** Garantido em: Server Action (estimativa para UX) + recálculo autoritativo no envio.
- [ ] Exibir frete preview — exibe taxa calculada ou "Entrega indisponível para este bairro" se loja sem zonas e sem `taxa_entrega_fora_zona`. Garantido em: cliente (UX).
- [ ] Exibir total preview com frete — `(subtotal - desconto) + frete_preview`. **PREVIEW.** Garantido em: cliente (UX), reusa `calcularTotal` (lib existente).
- [ ] Campos obrigatórios de entrega — CEP, rua, número e bairro obrigatórios. Nome e telefone do cliente coletados nesta etapa (ou na etapa anterior — TBD de UX). Validação via zod no cliente e no servidor. Garantido em: cliente (UX) + Server Action `criarPedido` (autoritativo).
- [ ] Avançar para Etapa 3 — botão "Continuar" habilitado apenas quando tipo de entrega selecionado e, se "Entrega", todos os campos obrigatórios preenchidos. Garantido em: cliente (UX).

---

#### Etapa 3 — Pagamento + Dados do Cliente + Envio

**Behaviors:**

- [ ] Exibir formas de pagamento ativas da loja — busca `formas_pagamento WHERE loja_id = $1` (carregado no load da página via Server Component, reusa `lib/supabase/queries/`). Garantido em: Server Component (leitura) + RLS `pagamentos_leitura_publica`.
- [ ] Selecionar Pix — exibe imagem do QR Code (`pix_qr_url` de `formas_pagamento.config`) + chave Pix (`config.chave`) com botão "Copiar chave". Ao copiar → `toast("Chave copiada")` via sonner. QR Code: `<Image>` Next.js apontando para URL do Storage (bucket público de QR codes — ver Dependências). Garantido em: cliente (UX).
- [ ] Selecionar Cartão de crédito/débito — exibe instrução: "Você receberá um link de pagamento via WhatsApp após a confirmação do pedido." Sem input adicional. Garantido em: cliente (UX).
- [ ] Selecionar Dinheiro — exibe instrução de troco + campo "Troco para R$ ___" (optional, numeric). Campo salvo como `troco_para` no pedido. **`troco_para` é informativo ao lojista — não afeta o total cobrado e não é autoridade financeira (RN-C3).** Garantido em: Server Action (salvo mas ignorado nos cálculos).
- [ ] Preencher dados do cliente — campos nome (obrigatório) e telefone (opcional, máscara react-imask). Observações (optional textarea). Validação via zod + react-hook-form. Garantido em: cliente (UX) + Server Action (autoritativo).
- [ ] Exibir resumo final preview — subtotal, desconto, frete, total com os valores acumulados das etapas anteriores. **PREVIEW — valor definitivo determinado pelo servidor.** Garantido em: cliente (UX).
- [ ] Enviar pedido — botão "Fazer pedido" dispara Server Action `criarPedido`. Payload enviado (sem valores monetários):
  ```ts
  {
    loja_id: string,
    tipo_entrega: 'retirada' | 'entrega',
    endereco_entrega?: { cep, rua, numero, bairro, complemento, cidade, uf },
    codigo_cupom?: string,
    forma_pagamento: string,   // tipo: 'pix'|'dinheiro'|'link'|'cartao'
    troco_para?: number,       // informativo, nullable
    nome_cliente: string,
    telefone_cliente?: string,
    observacoes?: string,
    itens: Array<{ produto_id: string, quantidade: number }>
    // SEM preco, subtotal, desconto, taxa_entrega, total
  }
  ```
  Schema zod com `.strict()` — campos monetários não declarados são rejeitados mesmo que enviados. Garantido em: Server Action + zod `.strict()` (`seguranca.md` §10).
- [ ] Botão com estado de loading — desabilitado durante envio, exibe spinner. Garantido em: cliente (UX).
- [ ] Tratar erro de loja fechada — se servidor retornar "Loja fechada", exibir toast de erro. Garantido em: Server Action `criarPedido` (verificação via `lojaAberta` — lib existente).
- [ ] Tratar erro de produto indisponível — exibir toast "Um ou mais itens não estão mais disponíveis". Garantido em: Server Action `criarPedido`.
- [ ] Tratar cupom expirado/esgotado — exibir toast "Cupom inválido ou expirado; pedido criado sem desconto". **Decisão de produto:** cupom esgotado na corrida não bloqueia o pedido (já definido na RPC `criar_pedido` — `seguranca.md` §10). Garantido em: RPC `public.criar_pedido`.
- [ ] Sucesso — redirecionar para `/loja/[slug]/confirmacao?pedido=<id>&token=<token_acesso>`. Garantido em: Server Action `criarPedido` (retorna id + token lido via service_role após INSERT).

---

### Confirmação de Pedido — `/loja/[slug]/confirmacao` (mantida como está)

**Sem mudanças de comportamento.** Visual final conforme `design-claude/vitrine/confirmacao.html`.

**Mudança de dados:** exibir campo `tipo_entrega` (retirada ou entrega) e, se dinheiro, mostrar `troco_para` nas instruções ao lojista. Ambos já estarão no pedido — apenas ajuste de exibição na leitura por token (server-side, service_role).

---

## Modelos de Dados

Todas as tabelas existentes são referenciadas em `references/schema.md`. Este spec adiciona os seguintes deltas de schema — cada item requer migration versionada.

### Delta 1 — `pedidos.tipo_entrega` (nova coluna)

```sql
-- Migration: 20260614XXXXXX_pedidos_tipo_entrega_troco.sql
ALTER TABLE pedidos
  ADD COLUMN tipo_entrega text NOT NULL DEFAULT 'entrega'
    CHECK (tipo_entrega IN ('retirada', 'entrega')),
  ADD COLUMN troco_para numeric(10,2);  -- nullable; só para forma_pagamento = 'dinheiro'
```

**Autoritativo do servidor:** `tipo_entrega` é enviado pelo cliente mas o servidor o usa como instrução operacional (não financeira). Se `tipo_entrega = 'retirada'`, o servidor **força** `taxa_entrega = 0` e ignora qualquer endereço (RN-C2). `troco_para` é apenas informativo — não entra nos cálculos.

**RLS:** coberta pelas policies existentes (`pedidos_insert_publico` e `pedidos_acesso_lojista`). Nenhuma policy nova necessária.

### Delta 2 — `lojas.taxa_entrega_fora_zona` (nova coluna)

```sql
ALTER TABLE lojas
  ADD COLUMN taxa_entrega_fora_zona numeric(10,2);  -- nullable; NULL = entrega fora de zona indisponível
```

**Autoritativo do servidor:** lido pela Server Action `criarPedido` para calcular frete quando o bairro informado não casa com nenhuma `zona_entrega` ativa da loja. Se NULL e sem zona correspondente → entrega recusada com mensagem "Entrega não disponível para seu bairro".

**RLS:** coberta pela policy `lojas_update_proprio` (lojista edita a própria) e pela view `vitrine_lojas`. A coluna **deve** ser adicionada ao SELECT da view `vitrine_lojas` para que a vitrine pública consiga exibir o preview de frete fora-de-zona — requer ajuste da migration da view ou nova migration.

### Delta 3 — `formas_pagamento.config` para Pix (extensão de campo existente)

O campo `config jsonb` já existe em `formas_pagamento`. Para tipo `pix`, o JSONB passa a incluir `pix_qr_url`:

```json
// formas_pagamento.config para tipo='pix' (antes)
{ "chave": "11999999999", "tipo_chave": "telefone" }

// formas_pagamento.config para tipo='pix' (depois — adiciona pix_qr_url)
{
  "chave": "11999999999",
  "tipo_chave": "telefone",
  "pix_qr_url": "https://<supabase-storage>/storage/v1/object/public/pix-qr/<loja_id>/qr.png"
}
```

**Não há migration de schema** para este delta — o campo `config` já é `jsonb`. Requer:
- Novo bucket no Supabase Storage: `pix-qr` (público para leitura) — ver Dependências
- UI no painel (`/painel/configuracoes/pagamentos`) para upload do QR e persistência da URL no `config`
- Validação na Server Action do painel: URL deve ser do Storage do iRango (`https://<supabase-url>/storage/...`) — impede URL externa arbitrária

**Autoritativo do servidor:** a URL é lida do banco pelo Server Component da vitrine — nunca enviada pelo cliente no checkout.

---

## Regras de Negócio

### RN-C1 — Desconto incide apenas no subtotal, nunca no frete

- **Regra:** `desconto = calcularDesconto(cupom, subtotal)`. `total = (subtotal - desconto) + frete`. Frete nunca é reduzido por cupom.
- **Camada client:** preview via `calcularDesconto` (lib existente) — aplica a mesma regra para consistência visual.
- **Camada servidor (autoritativo):** Server Action `criarPedido` recalcula usando a mesma lib. Garantido em: Server Action + RPC `public.criar_pedido`.

### RN-C2 — Retirada implica frete zero; servidor ignora endereço

- **Regra:** `tipo_entrega = 'retirada'` → `taxa_entrega = 0` no servidor, independente de qualquer endereço enviado.
- **Camada servidor (autoritativo):** Server Action `criarPedido` verifica `tipo_entrega` antes de chamar `calcularFrete`. Se `'retirada'`, força `taxa_entrega = 0` e ignora `endereco_entrega`. Garantido em: Server Action.

### RN-C3 — `troco_para` é informativo, não financeiro

- **Regra:** O valor de troco é apenas uma instrução ao lojista ("preciso de troco para R$ X"). Não altera subtotal, desconto, frete nem total. O servidor persiste o valor mas não o usa em nenhum cálculo.
- **Camada servidor:** Server Action recebe `troco_para` (nullable numeric) e o salva diretamente. Schema zod valida que é número positivo se presente. Não entra na fórmula `total`.
- **Camada banco:** `pedidos.troco_para numeric(10,2)` nullable — sem CHECK financeiro.

### RN-C4 — Cálculo de frete: match bairro → zona, com fallback

Sequência executada **exclusivamente no servidor** (Server Action `criarPedido`):

1. Normalizar bairro recebido: `unaccent(lower(trim(bairro)))` — remove acentos, minúsculas, sem espaços laterais. Garantido em: Server Action (função `normalizarBairro` em `lib/utils/calcularFrete.ts` — extensão da lib existente).
2. Buscar zonas ativas da loja (`zonas_entrega WHERE loja_id = $1 AND ativo = true AND tipo = 'bairro'`) com seus `bairros_zona`. Garantido em: Server Action + RLS `zonas_leitura_publica`.
3. Comparar bairro normalizado com cada `bairros_zona.nome` normalizado. Primeira zona que casar → usa `taxas_entrega.taxa` da zona.
4. Se nenhuma zona casar → verificar `lojas.taxa_entrega_fora_zona`:
   - Se não NULL → usa esse valor como taxa fixa.
   - Se NULL → entrega **indisponível** para este bairro. Server Action retorna erro "Entrega não disponível para o seu bairro."
5. Verificar frete grátis: se `taxas_entrega.pedido_minimo_gratis IS NOT NULL` e `subtotal >= pedido_minimo_gratis` → `taxa_entrega = 0`.

**PREVIEW de UX:** Server Action `calcularFreteAction` (separada, chamada na Etapa 2 para estimativa) segue os mesmos passos 1–5. O valor preview pode diferir do autoritativo apenas se o lojista alterar zonas entre a estimativa e o envio — risco aceitável para UX.

**Edge: loja sem zonas e sem `taxa_entrega_fora_zona`** → tipo de entrega "entrega" indisponível. A vitrine exibe apenas "Retirada" como opção. Garantido em: Server Component do load da página (verificação antecipada para UX) + Server Action (recusa autoritativa).

### RN-C5 — Validação de produto no servidor

- **Regra:** cada `produto_id` enviado é verificado no banco — deve existir, `disponivel = true` e pertencer à `loja_id`. Item inválido → pedido recusado integralmente.
- **Camada servidor (autoritativo):** Server Action `criarPedido`. Reusa padrão já definido em `seguranca.md` §10.

### RN-C6 — Gate de loja aberta e assinatura

- **Regra:** `criarPedido` verifica `lojaAberta(loja.horarios, loja.timezone)` e o estado de assinatura (`assinatura_status` + `assinatura_fim_periodo`). Pedido recusado se qualquer gate falhar.
- **Camada servidor (autoritativo):** Server Action `criarPedido`. Reusa `lib/utils/lojaAberta.ts` (já existente) e a lógica de guard de assinatura do adendo MVP. Garantido em: Server Action.

### RN-C7 — QR Code Pix é imagem estática do lojista

- **Regra:** o QR Code exibido é uma imagem pré-enviada pelo lojista (upload via painel). O iRango não gera QR Code dinamicamente nem processa pagamento.
- **Camada:** Storage bucket `pix-qr` (leitura pública), URL salva em `formas_pagamento.config.pix_qr_url`. Vitrine exibe via `<Image>` Next.js. Ver Dependências.

### RN-C8 — Normalização de bairro não é chave de billing

- **Regra:** o casamento bairro→zona pode falhar por typo ou variação de grafia. Isso é um risco de negócio **não** de segurança: na pior hipótese o cliente paga a taxa de fora-de-zona (mais alta). O servidor nunca usa o bairro para reduzir o frete abaixo do configurado.
- **Consequência:** não há vetor de ataque — o cliente não pode forçar zona mais barata; a normalização apenas aumenta a chance de casamento correto.

---

## Segurança (obrigatório)

### Dado sensível que entra/sai

| Campo | Tipo de dado | Tratamento |
|-------|-------------|------------|
| `nome_cliente`, `telefone_cliente`, `endereco_entrega` | PII do cliente (LGPD) | Salvo em `pedidos` (acesso por token + lojista dono). Nunca exposto publicamente. |
| `troco_para` | Informativo financeiro | Nullable, persiste sem entrar em cálculos. Não é PII. |
| `formas_pagamento.config.chave` (chave Pix) | Dado sensível do lojista | Exposto somente via `pagamentos_leitura_publica` (loja ativa). Lida no servidor e renderizada via SSR. |
| `formas_pagamento.config.pix_qr_url` | URL de Storage público | URL do bucket público do Supabase — não é secret, mas deve ser do próprio Storage do iRango (validação na action do painel). |

### Valor monetário → recálculo autoritativo obrigatório

Toda vez que um valor influencia o total do pedido, ele é recalculado no servidor a partir do banco. O cliente **nunca** envia preço, subtotal, desconto, taxa de entrega ou total (`seguranca.md` §10). Resumo do recálculo em `criarPedido`:

```
subtotal    = SUM(produtos[i].preco_banco × itens[i].quantidade)
desconto    = calcularDesconto(cupom_banco, subtotal)   // só se cupom válido
taxa_entrega = tipo_entrega='retirada'? 0 : calcularFrete(zonas_banco, bairro) || taxa_fora_zona_banco
total       = (subtotal - desconto) + taxa_entrega
```

Garantido em: Server Action `criarPedido` + RPC `public.criar_pedido`.

### Tabelas novas / colunas novas — RLS

| Tabela/coluna | RLS necessária |
|--------------|----------------|
| `pedidos.tipo_entrega` | Coberta por policies existentes (`pedidos_insert_publico`, `pedidos_acesso_lojista`) — sem nova policy |
| `pedidos.troco_para` | Idem |
| `lojas.taxa_entrega_fora_zona` | Coberta por `lojas_leitura_propria` (lojista) e view `vitrine_lojas` (anon) — adicionar coluna ao SELECT da view |
| `formas_pagamento.config.pix_qr_url` | Coberta por `pagamentos_leitura_publica` existente |
| Bucket `pix-qr` (Storage) | Nova política de Storage: leitura pública + escrita restrita ao lojista dono |

### Storage — bucket `pix-qr`

```sql
-- Leitura pública (vitrine exibe QR do Pix)
CREATE POLICY "storage_pix_qr_leitura_publica"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'pix-qr');

-- Escrita restrita ao lojista dono: path = '{loja_id}/qr.png'
CREATE POLICY "storage_pix_qr_escrita_propria"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'pix-qr'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM lojas WHERE dono_id = auth.uid()
    )
  );
```

Mesmo padrão do bucket `produtos` (`seguranca.md` §18).

### Schema zod com `.strict()` no payload de checkout

`lib/validacoes/pedido.ts` já usa `.strict()` por decisão de segurança (`seguranca.md` §10). Estender o schema com os novos campos:

```ts
export const schemaCriarPedido = z.object({
  loja_id:           z.string().uuid(),
  tipo_entrega:      z.enum(['retirada', 'entrega']),
  endereco_entrega:  z.object({
    cep:         z.string().length(8),
    rua:         z.string().min(1),
    numero:      z.string().min(1),
    bairro:      z.string().min(1),
    complemento: z.string().optional(),
    cidade:      z.string().min(1),
    uf:          z.string().length(2),
  }).optional(),
  codigo_cupom:      z.string().optional(),
  forma_pagamento:   z.enum(['pix', 'dinheiro', 'link', 'cartao']),
  troco_para:        z.number().positive().optional(),
  nome_cliente:      z.string().min(1).max(200),
  telefone_cliente:  z.string().optional(),
  observacoes:       z.string().max(500).optional(),
  itens: z.array(z.object({
    produto_id: z.string().uuid(),
    quantidade: z.number().int().positive(),
  })).min(1),
  // NÃO declara preco / subtotal / desconto / taxa_entrega / total
  // .strict() rejeita qualquer campo extra
}).strict()
// Refinamento: se tipo_entrega='entrega', endereco_entrega obrigatório
.refine(d => d.tipo_entrega === 'retirada' || !!d.endereco_entrega, {
  message: 'Endereço obrigatório para entrega',
  path: ['endereco_entrega'],
})
```

Garantido em: Server Action (validação autoritativa).

---

## Dependências

| Dependência | Issue(s) | Impacto |
|------------|---------|---------|
| **Bucket `pix-qr` no Storage** | Issues 003/018 (Storage de imagens) | Bloqueia exibição de QR Pix. Sem o bucket, exibir apenas a chave Pix textual (fallback aceitável para MVP). |
| **UI de upload de QR no painel** | Issue nova — `/painel/configuracoes/pagamentos` extende FormPix | Lojista não consegue configurar QR sem esta tela. |
| **Cálculo de frete por bairro no servidor** | Issue 064 (reconciliação CEP↔bairro) | Esta spec define o comportamento esperado. A issue 064 detalha a implementação de `normalizarBairro`. |
| **`taxa_entrega_fora_zona` na view `vitrine_lojas`** | Migration da view `vitrine_lojas` | Sem a coluna na view, o preview client-side de frete fora-de-zona não funciona. |
| **RPC `public.criar_pedido`** | Issue 014 (já existe) | A RPC deve aceitar os novos campos `tipo_entrega` e `troco_para`. Requer ajuste de signature. |

---

## Fora do Escopo (v1)

| Item | Motivo |
|------|--------|
| Pagamento online via gateway | iRango deliberadamente não processa pagamento (`modelo-negocio.md` §3) |
| Geração dinâmica de QR Code Pix | Exige integração com banco/gateway; QR estático é suficiente para MVP |
| Cálculo de frete por raio (km) | `zonas_entrega.tipo = 'raio_km'` existe no schema mas o wizard v1 suporta apenas `bairro` + fallback fixo |
| Cálculo de frete por faixa de CEP | Idem — `tipo = 'faixa_cep'` reservado para fase 2 |
| Agendamento de entrega | Fase 2 |
| Rastreamento de entrega | Fase 2 |
| Idempotência do submit do pedido (duplo clique / reenvio) | Débito técnico já documentado em `architecture.md` issue 063 — não resolvido aqui |
| Troco: validar que `troco_para >= total` | Informativo ao lojista; validação de negócio opcional para fase 2 |
| Link de pagamento gerado pelo servidor | Lojista envia link manualmente via WhatsApp após confirmar pedido |
| Estimativa de tempo de entrega | Fase 2 |
| Multiplas formas de pagamento num mesmo pedido | Pedido aceita exatamente 1 forma de pagamento |
