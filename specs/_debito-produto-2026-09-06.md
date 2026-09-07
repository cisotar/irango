# Débito de produto — aberto em 2026-09-06

Itens de produto conscientemente adiados. Não são bugs nem riscos de segurança:
são escopo que o dono do produto **decidiu não fazer agora**, com o motivo
registrado, para que a decisão não precise ser redescoberta depois.

## 1. Complemento / ponto de referência no endereço da loja

**Aberto em:** 2026-09-06, durante a especificação de
`specs/retirada-endereco-da-loja.md` (endereço da loja na retirada).

**O que falta.** A tabela `lojas` guarda rua, número, bairro, cidade, estado e
CEP — mas **não tem um campo de complemento** ("loja 2", "sobreloja", "ao lado da
padaria"). Um cliente que vai retirar o pedido em um endereço com mais de uma
porta pode chegar ao lugar certo e ainda assim não achar a loja.

**Decisão (dono do produto, 2026-09-06):** **não implementar agora.** O custo não
está na coluna em si, e sim na cauda dela: `ALTER TABLE` + **drop/create da view
`vitrine_lojas`** (o padrão obrigatório do repo — `create or replace view` não
muda lista de colunas) + regeneração de tipos + `schemaPerfil` + `montarPatchPerfil`
+ campo no formulário do lojista **e** no espelho do admin. É uma issue de schema
inteira, com risco de produção na recriação da view, para um ganho marginal frente
ao endereço já existente.

**Quando vale reabrir.** Quando um lojista reclamar que cliente de retirada não
acha a porta — aí o problema é real e observado, não hipotético.

**Cuidado ao implementar.** A lista de colunas do `create view` tem de ser gerada
a partir do schema vigente na hora, nunca copiada de um documento: recriar
`vitrine_lojas` a partir de uma lista desatualizada derruba colunas em produção.
Delegar ao agente `migrar`.

---

## 2. Duplicação de `formatarEndereco` (endereço do cliente)

**Aberto em:** 2026-09-06, achado durante a mesma especificação.

**O que é.** A função que formata o `endereco_entrega` (JSONB do **cliente**, não
da loja) está duplicada literalmente em dois arquivos:
`src/lib/utils/whatsappPedido.ts` e
`src/app/(publica)/loja/[slug]/confirmacao/page.tsx`.

**Decisão:** débito **pré-existente** — não foi criado pela feature de endereço na
retirada, e consolidá-lo junto dela aumentaria o diff sem servir ao objetivo. Vale
uma issue própria, de baixa prioridade.

**Cuidado.** Não confundir com `formatarEnderecoLoja` (`src/lib/utils/enderecoLoja.ts`),
criada pela feature de retirada: essa formata as **colunas da loja**, shape
diferente. As duas não se fundem.
