# [147] Corrigir comentário `faixa_cep` + registrar risco residual de CEP declarado em §10-A

**crítica:** NÃO (documentação — sem runtime, sem teste; delegável ao `escriba`)
**Mundo:** servidor — `criarPedido` (comentário) + `references/seguranca.md` (doc)
**Origem:** pentest 2026-07-09, achado BAIXA/informacional. Spec: `specs/hardening-cardinalidade-itens-pedido.md`

## Contexto
Um comentário em `criarPedido` (`src/lib/actions/pedido.ts:~220-221`) afirma que zonas
de frete `tipo='faixa_cep'` são "já reconciliadas por natureza — faixa numérica, sem
string livre forjável". É **impreciso**: o CEP É controlado pelo cliente (regex de 8
dígitos livres). A reconciliação §10-A fecha o vetor só para `tipo='bairro'` (força o
bairro canônico do CEP); para `tipo='faixa_cep'` a seleção da zona depende do CEP
**declarado**, que não tem fonte mais canônica para reconciliar server-side. Se a loja
tem uma zona `faixa_cep` mais barata e entrega pelo logradouro, o cliente pode declarar
um CEP da faixa barata. É risco **residual inerente** (não defeito de código — não se
prova server-side qual é "o CEP real do cliente"), mas o comentário passa falsa
sensação de imunidade.

## Escopo
- [ ] Ajustar o comentário em `src/lib/actions/pedido.ts:~220-221`: parar de alegar
  imunidade; deixar explícito que `faixa_cep` depende do CEP declarado e carrega risco
  residual mitigável só operacionalmente.
- [ ] Registrar o residual em `references/seguranca.md` §10-A (linha ~746): frete por
  `faixa_cep` carrega risco de CEP declarado; sem defesa server-side possível; mitigação
  operacional (lojista modela zonas com cautela). Bump de versão do doc conforme padrão.

## Critério de aceite
- [ ] Comentário não alega mais imunidade de `faixa_cep`.
- [ ] §10-A documenta o residual e distingue de `tipo='bairro'` (reconciliado).
- [ ] Sem mudança de runtime, sem teste novo.

## Fora do escopo
- Fechar o residual tecnicamente — não há defesa server-side (não se prova o CEP real).
- Qualquer mitigação operacional (guia ao lojista) é produto, não código.
