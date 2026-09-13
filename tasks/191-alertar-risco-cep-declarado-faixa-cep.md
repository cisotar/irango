# 191 — Alertar lojista sobre risco de CEP declarado em zona `faixa_cep`

crítica: NÃO (risco residual documentado, mitigação é de copy/orientação, não de código)

## Origem

Achado `auditar` durante a revisão da issue #183 (commit `4db2c36`, branch `fix/sanear-debitos-frete-cep`), 2026-09-13.

## Problema

O comprador declara o próprio CEP no checkout; a reconciliação ViaCEP força só o **bairro** ao canônico
(`src/lib/actions/pedido.ts` ~258-262) — o CEP é a própria âncora e não tem fonte mais canônica que a
declarada. Um comprador pode declarar um CEP dentro da faixa mais barata da loja mesmo entregando em
outro endereço, pagando o frete da zona errada.

Isso já era um vetor residual documentado (`references/seguranca.md` §10-A, pentest 2026-07-09), mas
até o commit `4db2c36` era **código morto** — `faixa_cep` sempre gravava `NULL` e nunca atendia
ninguém (issue #183). A partir de agora o vetor é alcançável na prática assim que uma loja configurar
uma zona `faixa_cep`.

## Por que não é crítica

Limitado à diferença de preço entre zonas da MESMA loja — não há vazamento de dado nem valor negativo.
Não há defesa técnica real (o CEP é o próprio critério de match); a mitigação é operacional: orientar o
lojista a não configurar faixas de preço muito distintas cobrindo a mesma região real.

## O que fazer

Adicionar uma linha de aviso no `FormZona.tsx`, junto ao texto existente "A faixa é inclusiva…", quando
`tipo === "faixa_cep"` — algo como "O CEP é informado pelo cliente; evite faixas de preço muito
diferentes cobrindo a mesma região." Mudança de copy — escopo de `/polir`, não `/fix`.

## Arquivos prováveis

- `src/components/painel/FormZona.tsx` (texto de ajuda perto do campo de faixa de CEP)
