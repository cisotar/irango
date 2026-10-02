# 350 — Rate limit no "Carregar mais" do painel de clientes

**Origem:** auditoria da issue 347 (BAIXA).
**Crítica:** NÃO
**Mundo:** painel

## Problema
`carregarMaisClientes` e `carregarMaisPedidosDoCliente` (`src/lib/actions/clientesDaLoja.ts`) podem ser chamadas em loop por um lojista autenticado. Só gera carga no banco; o escopo continua na própria loja (sem vazamento).

## Escopo
- Limitar por `auth.uid()` reusando `src/lib/utils/rateLimit.ts` (`verificarRateLimit`), com chave nova.
- Ao estourar: mensagem genérica, sem detalhe interno.
- Teste unitário do limite.
