# [067] Preview de frete deve reconciliar CEP igual ao autoritativo (paridade 064)

**crítica:** NÃO (UX — preview não-vinculante)
**Mundo:** checkout
**Origem:** finding MÉDIA da auditoria 064

## Contexto
`calcularFreteAction` (preview, `src/lib/actions/frete.ts`) aceita só `{ loja_id, bairro }` — schema `.strict()` nem aceita `cep` — e NUNCA chama `reconciliarBairroCep`. Após o fix fail-closed da 064, o caminho autoritativo (`criarPedido`) descarta o bairro declarado quando o ViaCEP não reconcilia; o preview continua mostrando a taxa da zona do bairro declarado (barato). Divergência preview↔cobrança.

## Escopo
- [ ] `calcularFreteAction` aceitar `cep` no schema e reconciliar via `reconciliarBairroCep` igual ao autoritativo
- [ ] `EtapaEntrega.tsx` passar o `cep` ao preview
- [ ] Garantir mesma política fail-closed no preview

## Segurança
Apenas UX/consistência — o caminho que cobra já está correto (064). Não é vetor de dinheiro.

## Critério de aceite
- [ ] Preview e cobrança mostram o MESMO frete para o mesmo (cep, bairro)
