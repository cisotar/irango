# [064] Reconciliar bairro declarado com CEP no cálculo de frete

**crítica:** SIM
**Mundo:** checkout
**Depende de:** 008, 014
**Origem:** finding BAIXA da auditoria da issue 014

## Objetivo
Impedir subpagamento de frete: hoje o frete por `tipo='bairro'` casa o `endereco.bairro` (string livre digitada pelo cliente) contra `bairros_zona`. Cliente pode declarar um bairro de zona barata enquanto o endereço real é de zona cara / fora de área.

## Contexto
`calcularFrete` confia no bairro declarado. O `cep` é validado por formato mas NÃO é usado para reconciliar com o bairro nem com `faixa_cep` (que está desabilitado, retorna não-atendido). Ganho do atacante limitado ao delta de frete (não o pedido inteiro) → BAIXA, mas é vetor de pagar-menos.

## Escopo
- [ ] Reconciliar CEP ↔ bairro (via ViaCEP no servidor, ou tabela de CEP→bairro) antes de aceitar a zona declarada
- [ ] Implementar `faixa_cep` de fato (schema precisa de colunas de faixa — avaliar migration)
- [ ] Se bairro declarado diverge do CEP → recalcular pela zona do CEP ou recusar

## Segurança
- Recálculo de frete é server-side (§10); a reconciliação fecha o vetor de bairro declarado falso.

## Critério de aceite
- [ ] Endereço com bairro de zona barata + CEP de zona cara → frete da zona do CEP (não da declarada)
