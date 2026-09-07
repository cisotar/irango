# [163] zod inteiro no bundle público do checkout (42% do JS da rota)

**crítica:** NÃO (é performance — mas mexe em validação, exige cuidado)
**Mundo:** vitrine pública
**Depende de:** —
**Origem:** finding CUSTO da auditoria de performance da issue 126.
Registro: `performance/2026-09-06-checkout-abertura-whatsapp.md`
**Pré-existente** — NÃO é regressão da 126.

## Problema

Primeira medição real do bundle da rota do checkout público:
**63,8 KB gzip de 151 KB (42% do JS) é o zod**, importado pelo cliente via
`src/lib/validacoes/pedido.ts:10`.

O veredito dessa validação no cliente é apenas **preview de UX** — `criarPedido`
revalida tudo no servidor de qualquer forma (é o princípio de não confiar no
cliente). O painel do lojista paga esse custo atrás de login, onde conversão não
está em jogo; aqui quem paga é o comprador no celular, no caminho da compra.

## Diagnóstico detalhado

O chunk sozinho tem 283.469 B raw / 63.797 B gzip e é praticamente zod 4.4.3
puro. O build clássico do zod v4 NÃO é tree-shakable: o minificado carrega
`cidr` x119, `nanoid`/`cuid2`/`base64url` x108, `emoji` x90 e `toJSONSchema` —
nada disso é usado aqui.

`useEnviarPedido.ts` e o UNICO importador client de zod na vitrine. Todos os
outros importadores sao painel/auth, atras de login.

## Escopo (em ordem de preferencia)

- [ ] **Opcao A (menor risco):** migrar `validacoes/pedido.ts` para `zod/mini` —
      mesmo pacote ja instalado, API funcional e tree-shakable.
- [ ] **Opcao B:** carregar o schema por `import()` dinamico dentro do `enviar()`,
      tirando-o do bundle inicial.
- [ ] **Opcao C (mais radical):** eliminar o gate no cliente e deixar o veredito
      so com o servidor, mantendo a validacao de campo que o wizard ja faz.
- [ ] O schema permanece INTACTO como fronteira de seguranca no servidor.
- [ ] Build A/B de confirmacao (o registro em `performance/` tem o metodo, reuse)
      e teste de paridade das mensagens de erro.

## 🛑 Cuidado

Isto mexe na validação do caminho de pedido. A regra é: o cliente pode perder o
preview, o servidor NÃO pode perder nenhuma barreira. Qualquer mudança tem que
manter verdes os testes de adulteração de payload de `criarPedido`.

## Critério de aceite

- [ ] Redução medida do JS da rota `/loja/[slug]/pedido`.
- [ ] Nenhuma validação do servidor removida ou enfraquecida.
- [ ] UX de erro de formulário preservada (o cliente ainda vê o que corrigir).
