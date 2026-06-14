import { describe, it, expect } from "vitest";
// RED: este módulo ainda NÃO existe na sua forma final — a fase GREEN (executar)
// implementa src/lib/validacoes/cupom.ts com o `cupomSchema` zod completo.
// Existe apenas um STUB TDD (z.never()) para o type-check compilar e a falha
// acontecer por ASSERÇÃO, não por símbolo ausente.
//
// RESPONSABILIDADE DO SCHEMA (form FormCupom + Server Action de criar/editar):
// validar a FORMA do cupom no momento de cadastro/edição.
//   - codigo: obrigatório, trim + uppercase, alfanumérico, tamanho limitado
//   - tipo: enum 'percentual' | 'fixo'
//   - valor: > 0, no máx 2 casas; se percentual, 1..100 (defesa em profundidade
//     contra desconto absurdo — relacionado ao clamp de calcularDesconto / 020)
//   - pedido_minimo: >= 0
//   - usos_maximos: int positivo ou null (NULL = ilimitado)
//   - expira_em: data futura ou null (NULL = sem expiração)
//   - ativo: boolean
//
// FORA DA RESPONSABILIDADE (Server Action validarCupom / 013, banco / 032):
//   validade no momento do USO (ativo/expirado/usos/mínimo atendido), unicidade
//   de (loja_id, codigo). Aqui validamos só a forma do dado a persistir.
import { cupomSchema } from "./cupom";

// ---------------------------------------------------------------------------
// Builder mínimo de cupom válido (caminho feliz) — cada teste sobrescreve o
// campo que está exercitando. `expira_em` no futuro relativo a "agora".
// ---------------------------------------------------------------------------
function umAnoNoFuturo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString();
}
function umAnoNoPassado(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

function cupomValido(over: Record<string, unknown> = {}) {
  return {
    codigo: "BEMVINDO10",
    tipo: "percentual",
    valor: 10,
    pedido_minimo: 0,
    usos_maximos: null,
    expira_em: null,
    ativo: true,
    ...over,
  };
}

describe("cupomSchema — caminho feliz", () => {
  it("aceita um cupom percentual válido completo", () => {
    const r = cupomSchema.safeParse(cupomValido());
    expect(r.success).toBe(true);
  });

  it("aceita um cupom fixo válido", () => {
    const r = cupomSchema.safeParse(
      cupomValido({ tipo: "fixo", valor: 15 }),
    );
    expect(r.success).toBe(true);
  });

  it("aceita usos_maximos null (ilimitado) e expira_em null (sem expiração)", () => {
    const r = cupomSchema.safeParse(
      cupomValido({ usos_maximos: null, expira_em: null }),
    );
    expect(r.success).toBe(true);
  });

  it("aceita expira_em data futura", () => {
    const r = cupomSchema.safeParse(
      cupomValido({ expira_em: umAnoNoFuturo() }),
    );
    expect(r.success).toBe(true);
  });
});

describe("cupomSchema — codigo", () => {
  it("rejeita codigo vazio", () => {
    const r = cupomSchema.safeParse(cupomValido({ codigo: "" }));
    expect(r.success).toBe(false);
  });

  it("normaliza codigo: trim + uppercase ('  bem10  ' → 'BEM10')", () => {
    const r = cupomSchema.safeParse(cupomValido({ codigo: "  bem10  " }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.codigo).toBe("BEM10");
  });

  it("rejeita codigo com caracteres não-alfanuméricos (espaço interno / símbolo)", () => {
    const r = cupomSchema.safeParse(cupomValido({ codigo: "BEM 10!" }));
    expect(r.success).toBe(false);
  });
});

describe("cupomSchema — tipo (enum)", () => {
  it("rejeita tipo fora do enum ('brinde')", () => {
    const r = cupomSchema.safeParse(cupomValido({ tipo: "brinde" }));
    expect(r.success).toBe(false);
  });
});

describe("cupomSchema — valor (dinheiro)", () => {
  it("rejeita valor 0", () => {
    const r = cupomSchema.safeParse(cupomValido({ valor: 0 }));
    expect(r.success).toBe(false);
  });

  it("rejeita valor negativo", () => {
    const r = cupomSchema.safeParse(cupomValido({ valor: -5 }));
    expect(r.success).toBe(false);
  });

  it("rejeita valor com mais de 2 casas decimais (10.999)", () => {
    const r = cupomSchema.safeParse(
      cupomValido({ tipo: "fixo", valor: 10.999 }),
    );
    expect(r.success).toBe(false);
  });

  // CRÍTICO (critério de aceite): percentual fora de 1..100 abriria desconto
  // absurdo. Defesa em profundidade na borda — antes mesmo do clamp de 020.
  it("rejeita percentual 150 (acima de 100%)", () => {
    const r = cupomSchema.safeParse(
      cupomValido({ tipo: "percentual", valor: 150 }),
    );
    expect(r.success).toBe(false);
  });

  it("rejeita percentual abaixo de 1 (0.5%)", () => {
    const r = cupomSchema.safeParse(
      cupomValido({ tipo: "percentual", valor: 0.5 }),
    );
    expect(r.success).toBe(false);
  });

  it("aceita percentual exatamente 100", () => {
    const r = cupomSchema.safeParse(
      cupomValido({ tipo: "percentual", valor: 100 }),
    );
    expect(r.success).toBe(true);
  });

  it("aceita fixo de valor alto (R$ 250) — limite de 100 só vale p/ percentual", () => {
    const r = cupomSchema.safeParse(
      cupomValido({ tipo: "fixo", valor: 250 }),
    );
    expect(r.success).toBe(true);
  });
});

describe("cupomSchema — pedido_minimo", () => {
  it("rejeita pedido_minimo negativo", () => {
    const r = cupomSchema.safeParse(cupomValido({ pedido_minimo: -1 }));
    expect(r.success).toBe(false);
  });

  it("aceita pedido_minimo 0", () => {
    const r = cupomSchema.safeParse(cupomValido({ pedido_minimo: 0 }));
    expect(r.success).toBe(true);
  });
});

describe("cupomSchema — usos_maximos", () => {
  it("rejeita usos_maximos 0 (positivo ou null)", () => {
    const r = cupomSchema.safeParse(cupomValido({ usos_maximos: 0 }));
    expect(r.success).toBe(false);
  });

  it("rejeita usos_maximos não-inteiro (2.5)", () => {
    const r = cupomSchema.safeParse(cupomValido({ usos_maximos: 2.5 }));
    expect(r.success).toBe(false);
  });

  it("aceita usos_maximos inteiro positivo", () => {
    const r = cupomSchema.safeParse(cupomValido({ usos_maximos: 100 }));
    expect(r.success).toBe(true);
  });
});

describe("cupomSchema — expira_em", () => {
  // CRÍTICO (critério de aceite): expira_em no passado rejeitado no cadastro.
  it("rejeita expira_em no passado", () => {
    const r = cupomSchema.safeParse(
      cupomValido({ expira_em: umAnoNoPassado() }),
    );
    expect(r.success).toBe(false);
  });
});
