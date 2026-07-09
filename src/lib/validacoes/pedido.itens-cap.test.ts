import { describe, it, expect } from "vitest";
import { schemaPayloadPedido } from "./pedido";

// ===========================================================================
// PENTEST 2026-07-09 — DoS / amplificação de recursos por array `itens` SEM TETO
//
// Classe: OWASP A05 (Security Misconfiguration) / CWE-770 (Allocation of
// Resources Without Limits or Throttling). Achado do pentester (não coberto
// pela suíte 022/069/083, que testa min(1) e o teto de QUANTIDADE, nunca o teto
// de CARDINALIDADE do array).
//
// Contexto: `schemaItemPedido.opcionais` já tem `.max(50)` (anti payload gigante
// — achado auditoria 085). O array RAIZ `itens` só tem `.min(1)`, SEM `.max()`.
// Um cliente pode enviar dezenas de milhares de itens num único payload:
//   - buscarProdutosPorIds faz `.in("id", ids)` com N ids (ids NEM é
//     deduplicado, ao contrário de opcionalIds) → URL/query PostgREST gigante;
//   - o loop de recálculo e a RPC `criar_pedido` (FOR ... jsonb_array_elements
//     + 1 INSERT por item) executam N iterações numa única transação;
//   - com bodySizeLimit=2mb no next.config, cabem ~33 mil itens por requisição.
// Impacto: DoS (CPU/memória/tempo de transação) e amplificação de storage
// (um pedido gera dezenas de milhares de linhas em itens_pedido +
// itens_pedido_opcionais). NÃO é subpagamento — o núcleo do recálculo (§10)
// resiste; é exaustão de recursos.
//
// TDD RED: hoje o schema ACEITA 50k itens → o `expect(...).toBe(false)` FALHA.
// O GREEN adiciona `.max(N)` ao array `itens` (espelhando o `.max(50)` dos
// opcionais). N sugerido: 100 (um carrinho real nunca tem 100 linhas distintas).
// ===========================================================================

const UUID = "11111111-1111-4111-8111-111111111111";
const PROD = "22222222-2222-4222-8222-222222222222";

function item() {
  return { produto_id: PROD, quantidade: 1 };
}

function payload(qtdItens: number): Record<string, unknown> {
  return {
    loja_id: UUID,
    tipo_entrega: "retirada",
    forma_pagamento: "pix",
    nome_cliente: "Cliente",
    itens: Array.from({ length: qtdItens }, item),
  };
}

describe("schemaPayloadPedido — teto de cardinalidade do array itens (CWE-770)", () => {
  it("ATAQUE DoS: rejeita payload com 50.000 itens (array precisa de .max())", () => {
    // RED: sem `.max()` no array `itens`, o schema aceita → este expect FALHA hoje.
    const r = schemaPayloadPedido.safeParse(payload(50_000));
    expect(r.success).toBe(false);
  });

  it("ATAQUE DoS: rejeita payload com 1.000 itens (bem acima de um carrinho real)", () => {
    const r = schemaPayloadPedido.safeParse(payload(1_000));
    expect(r.success).toBe(false);
  });

  // Guarda de não-regressão: um carrinho realista (30 linhas distintas) segue
  // válido. O teto do GREEN não pode barrar o caminho feliz.
  it("não-regressão: carrinho realista de 30 itens distintos continua aceito", () => {
    const r = schemaPayloadPedido.safeParse(payload(30));
    expect(r.success).toBe(true);
  });

  it("não-regressão: 1 item (mínimo) continua aceito", () => {
    const r = schemaPayloadPedido.safeParse(payload(1));
    expect(r.success).toBe(true);
  });
});
