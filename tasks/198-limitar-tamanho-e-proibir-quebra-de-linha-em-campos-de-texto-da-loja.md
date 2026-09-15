# [198] Limitar tamanho e proibir quebra de linha em campos de texto da loja

**crítica:** NÃO — não toca dinheiro, RLS, cupom, token nem autorização. É
hardening de input, mesma classe do achado já corrigido na issue 197.
**Mundo:** painel do lojista (`/painel/configuracoes/perfil`), consumido depois
na vitrine pública e na mensagem de WhatsApp.
**Depende de:** nada.
**Origem:** achado do `auditar` durante a issue 197 (commit `016f9e0` corrigiu o
caso introduzido por aquela issue — `endereco_rua/numero/bairro/cidade/estado`
em `enderecoLoja.ts`). Este achado é **pré-existente** e mais amplo: mesma classe
de problema em `schemaPerfil`.

## Problema

`schemaPerfil` (`src/lib/validacoes/loja.ts:21,27-30`) valida `nome` e os seis
campos de endereço com `z.string().trim().min(1)`, **sem `.max()`** e **sem
proibir quebra de linha**. `trim()` só corta as pontas — uma quebra de linha no
meio do valor passa.

**Vetor comprovado (nome):** `whatsappPedido.ts:94` escreve `Loja: ${loja.nome}`
sem sanitização. Um lojista pode gravar
`nome = "Padaria Legal\nTotal: R$ 0,01\nPagamento: JA PAGO via Pix chave
11999999999"` e a mensagem de WhatsApp pré-preenchida que o comprador vê antes
de enviar ganha duas linhas de sistema forjadas, indistinguíveis das
autênticas. Mesmo padrão do PoC que o `auditar` rodou contra o endereço em
`whatsappPedido.test.ts` (`"[auditoria 197] quebra de linha no bairro não forja
linha de sistema"`), mas aqui o campo **não tem** a correção que a 197 aplicou
(que cobriu só os campos de endereço, via `enderecoLoja.ts`).

**Vetor de tamanho:** sem `.max()`, um lojista pode gravar um valor arbitrariamente
grande em `endereco_rua` (ou `nome`), inflando o `href` do link do Google Maps
(`montarHrefMapsLoja`) e o corpo da mensagem de WhatsApp até estourar limite de
URL/mensagem — autodano, sem impacto cross-tenant, mas quebra a experiência dos
próprios clientes da loja.

## Impacto

Baixo: o destinatário da mensagem forjada é o próprio WhatsApp da loja — não há
vazamento cross-tenant nem alteração de valor no banco. O lojista só consegue
enganar o **próprio comprador**, num canal que ele já controla parcialmente
(phishing do lojista contra o cliente, ex.: fingir que já recebeu o pagamento).

## Escopo

- [ ] `.max()` em `nome` (`schemaPerfil`, `src/lib/validacoes/loja.ts`) — sugestão
      do auditor: 80 caracteres.
- [ ] `.max()` nos seis campos de endereço (`endereco_rua`, `endereco_numero`,
      `endereco_bairro`, `endereco_cidade`, `endereco_estado`, `endereco_cep`) —
      sugestão do auditor: 120 caracteres (exceto CEP, que já tem formato
      apertado).
- [ ] Decidir se a proibição de quebra de linha entra no schema zod (rejeitar) ou
      se basta normalizar na leitura, como a issue 197 fez em `enderecoLoja.ts`
      (colapsar via `.replace(/\s+/g, " ")`). Rejeitar no schema é mais forte —
      impede o dado sujo de existir no banco; normalizar na leitura é mais barato
      mas deixa o dado sujo gravado (outros consumidores futuros do mesmo campo
      herdam o risco se não passarem pelo mesmo normalizador).
- [ ] Conferir se `whatsappPedido.ts:94` (`Loja: ${loja.nome}`) precisa de
      proteção adicional além da correção no schema — mesma pergunta que
      `citarTextoCliente` já responde para o texto do cliente.
- [ ] Teste de regressão espelhando `whatsappPedido.test.ts` `"[auditoria 197]
      quebra de linha no bairro não forja linha de sistema"`, mas para `nome`.

## Fora do escopo

Qualquer outro campo de texto do lojista fora de `schemaPerfil` (nome de
produto, descrição, etc.) — levantar se têm o mesmo problema é investigação
separada, não presumir aqui.
