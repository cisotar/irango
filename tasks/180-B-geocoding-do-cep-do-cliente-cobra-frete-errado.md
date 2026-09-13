# [180-B] Falha de geocoding do CEP do cliente cobra frete errado e mente no checkout

**crítica:** SIM — altera o valor do frete cobrado no caminho autoritativo
(`pedido.ts:288-311`) e exige migration em tabela com dados. Exige TDD red-first (`tdd`,
com output `FAIL` capturado antes de qualquer código de produção) e passagem pelo `auditar`.
**Mundo:** vitrine / checkout público
**Depende de:** `180-A` (reusa a classificação de motivo consolidada lá). Não é bloqueio
duro — é ordem: fazer A primeiro evita resolver o mesmo conflito duas vezes.
**Origem:** achada ao revisar a 180-A — o mesmo modo de falha, no caminho do cliente,
custa dinheiro.

> **Provedor:** Google Geocoding desde a issue 190 (`plan/tecnico-geocoding-google.md`).

## Problema

Quando o geocoding do **CEP do cliente** falha, `distanciaDaLojaAoCep`
(`src/lib/actions/distanciaFrete.ts`) devolve `undefined`. O fail-closed em si está
correto (§12-A) — o problema é o que vem depois:

1. **Cobra a taxa errada.** `distanciaKm` indefinido faz toda zona `raio_km` não casar
   (`calcularFrete.ts:83`). Se a loja tem `taxa_entrega_fora_zona`, o cliente paga o
   fallback — normalmente **mais caro** — mesmo morando dentro do raio. E não é só
   preview: o caminho autoritativo `criarPedido` (`src/lib/actions/pedido.ts:288-311`)
   usa exatamente a mesma sequência, então o pedido **fecha com o valor errado**.
2. **Mente para o cliente.** Sem `taxa_entrega_fora_zona`, o resultado é `FORA_DE_AREA` →
   *"Entrega não disponível para o seu bairro"* / *"tente outro endereço"*. Quando a causa
   é o serviço fora do ar, trocar de endereço **não resolve nada** — o cliente abandona a
   compra achando que a loja não atende ele.
3. **Não existe veredito para essa causa.** `freteDegradado.ts` já distingue UMA
   misconfiguração (`VEREDITO_LOJA_SEM_COORDS` = loja sem coords), mas não há veredito
   para "o geocoding do CEP do cliente falhou", nem a separação `transitorio` ×
   `nao_encontrado` que o painel já faz.

## Escopo

1. **Subdividir o motivo `transitorio`** em *retriável* (rede, timeout, burst de 1s,
   `OVER_QUERY_LIMIT` momentâneo) e *esgotado* (teto diário global ou por IP batido —
   `geocodificarEndereco.ts:108-152`). Retry só faz sentido no retriável: o teto diário
   só reseta no dia seguinte, e cada tentativa ainda debita do teto por IP. Motivo
   esgotado **pula direto** para o passo 3, sem spinner inútil.
2. **Modal de recálculo no checkout** quando o motivo é retriável. **Decisão do usuário:**
   a chamada que falhou e abriu o modal **conta como tentativa 1** — o modal faz mais
   **2** tentativas, em `t=10s` e `t=20s`. Total de 3 chamadas ao geocoder, ~20s de espera
   máxima. Sucesso em qualquer tentativa fecha o modal e segue o fluxo normal com o frete
   correto.
3. **Esgotadas as tentativas (ou motivo esgotado), o modal orienta o pedido por
   WhatsApp**, de forma explícita, deixando claro que **o cliente deve informar o endereço
   diretamente para a loja** — o frete será combinado no chat.
4. **O pedido É gravado, com frete a combinar.** **Decisão do usuário:** migration tornando
   `pedidos.taxa_entrega` **nullable** + coluna booleana **`frete_a_combinar`**. NULL
   sozinho seria ambíguo (não distingue "a combinar" de dado legado/faltante); o booleano
   declara a intenção e faz o consumidor que esquecer de tratar quebrar no type-check em
   vez de exibir R$ 0,00 silencioso. Consumidores a revisar (7 arquivos):
   `lib/actions/pedido.ts`, `lib/utils/whatsappPedido.ts`, `lib/validacoes/pedido.ts`,
   `app/(publica)/loja/[slug]/confirmacao/page.tsx`, `components/painel/DetalhePedido.tsx`,
   `components/painel/ReciboCliente.tsx`, `components/vitrine/checkout/estado.ts`.
5. **Loja publicada sem WhatsApp** (caso raro — publicar exige nome + WhatsApp em
   `loja.ts:178`, mas o gate é best-effort, débito 140): **o modal oferece retirada no
   balcão**, não o caminho do WhatsApp. Sem canal de contato, um pedido "a combinar"
   nasceria órfão. Retirada é sempre possível — não existe flag `aceitaRetirada`, e loja
   sem zona de entrega já é forçada para retirada (`CheckoutWizard.tsx:96`): **reusar esse
   caminho**, não criar outro.
6. **Receita do painel:** pedido a combinar **entra na soma com frete 0**, com etiqueta
   visível "a combinar". A soma usa `COALESCE(taxa_entrega, 0)`; a etiqueta vem de
   `frete_a_combinar`, nunca de `taxa_entrega == 0` (que é frete grátis legítimo).

## Restrições técnicas

- **O WhatsApp do passo 3 tem que ser um link que o cliente clica dentro do modal, nunca
  auto-abertura.** `prepararAbaWhatsapp`
  (`src/components/vitrine/checkout/aberturaWhatsapp.ts:86`) exige chamada **síncrona
  dentro do gesto do clique**; depois de até 20s de spinner a user activation já morreu e
  o `window.open` cai no bloqueador de pop-up. O guard `urlHttpsSegura` (§15) continua
  valendo para o href.
- **`taxa_entrega` nullable não pode virar `0` implícito** em nenhum consumidor: `0` é
  frete grátis legítimo e "a combinar" não é grátis. Recibo, confirmação e detalhe do
  pedido precisam exibir estados distintos.
- **`distanciaKm` continua jamais vindo do cliente** (mandato 1). O retry é do servidor;
  o modal só dispara a Server Action de novo.
- **O teto diário por IP é do CLIENTE FINAL**, não do servidor Next: `extrairIp` lê
  `x-real-ip`, que a Vercel sobrescreve com o IP de conexão real
  (`src/lib/utils/rateLimit.ts:52-64`). Estourar 50/dia em uso normal é implausível; o
  caso real é **IP compartilhado** (NAT corporativo, CGNAT de operadora móvel). O texto
  do modal **não pode culpar o cliente** por isso.
- **Migration em tabela com dados** → sequência expand → backfill → contract pelo agente
  `migrar`. Expand entra no PR; **contract fica para depois do código em produção**.
  `npx supabase db push` só com autorização explícita do usuário.

## Critério de aceite

- [ ] Motivo retriável × esgotado são distinguidos, com teste por causa (rede, burst,
      teto global, teto por IP).
- [ ] Motivo esgotado NÃO consome tentativa de retry nem exibe spinner.
- [ ] Falha retriável abre o modal e faz mais 2 tentativas (t=10s, t=20s); sucesso na 2ª
      ou 3ª chamada fecha o modal e aplica o frete correto (teste com o geocoding falhando
      N vezes e então respondendo).
- [ ] **Teste vermelho capturado (mandato 3):** com o geocoding falhando e a loja tendo
      `taxa_entrega_fora_zona`, o pedido NÃO é criado cobrando o fallback silenciosamente.
- [ ] Esgotadas as tentativas, o modal mostra o caminho do WhatsApp com instrução
      explícita de informar o endereço para a loja, como link clicável.
- [ ] Loja sem WhatsApp cai em retirada no balcão, reusando o caminho de
      `CheckoutWizard.tsx:96`.
- [ ] Pedido gravado com frete a combinar aparece no painel e é distinguível de frete
      grátis (`taxa_entrega = 0`) em recibo, confirmação e detalhe.
- [ ] Receita do painel soma o pedido a combinar com frete 0 e exibe a etiqueta.
- [ ] A mensagem "Entrega não disponível para o seu bairro" só aparece quando o endereço
      está genuinamente fora de área — nunca por falha do serviço.

## Verificação manual

Sem browser automatizável (sem Playwright, sem MCP de browser). Risco residual
concentrado: **o link de WhatsApp depois de ~20s de spinner, em iOS Safari e Android
Chrome** — `aberturaWhatsapp.ts:86` exige gesto síncrono e a user activation já morreu.
Também à mão: os 2 retries visíveis a cada 10s, e o pedido "a combinar" distinguível de
frete grátis no painel, recibo e confirmação.
