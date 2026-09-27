/**
 * [302] O builder do payload do form do modal sazonal.
 *
 * `environment: node`, sem jsdom: função pura, afirmável byte a byte. O ponto
 * mais valioso é o booleano `mostrar_promocoes_junto` SEMPRE presente (nunca
 * spread condicional) e a conversão `datetime-local` → ISO.
 */

import { describe, it, expect } from "vitest";

import { schemaModalSazonal } from "@/lib/validacoes/modalSazonal";
import { montarPayloadModalSazonal } from "./montarPayloadModalSazonal";

const CAT = "11111111-1111-4111-8111-111111111111";

const BASE = {
  titulo: "Inverno",
  exibicaoInicio: "2026-06-01T00:00",
  exibicaoFim: "2026-06-15T00:00",
  categorias: [] as string[],
  cardapios: [] as string[],
  mostrarPromocoesJunto: false,
};

describe("montarPayloadModalSazonal", () => {
  it("faz trim do título e converte as datas para ISO", () => {
    const p = montarPayloadModalSazonal({
      titulo: "  Inverno  ",
      exibicaoInicio: "2026-06-01T00:00",
      exibicaoFim: "2026-06-15T00:00",
      mensagem: null,
      categorias: [CAT],
      cardapios: [],
      mostrarPromocoesJunto: true,
    });
    expect(p.titulo).toBe("Inverno");
    expect(new Date(p.exibicao_inicio).getTime()).not.toBeNaN();
    expect(p.exibicao_fim).toMatch(/Z$/);
  });

  it("mantém `mostrar_promocoes_junto: false` (nunca omite o booleano)", () => {
    const p = montarPayloadModalSazonal({
      titulo: "X",
      exibicaoInicio: "2026-06-01T00:00",
      exibicaoFim: "2026-06-15T00:00",
      mensagem: null,
      categorias: [CAT],
      cardapios: [],
      mostrarPromocoesJunto: false,
    });
    expect(p.mostrar_promocoes_junto).toBe(false);
    expect("mostrar_promocoes_junto" in p).toBe(true);
  });

  it("a saída passa no MESMO schema do servidor", () => {
    const p = montarPayloadModalSazonal({
      titulo: "Inverno",
      exibicaoInicio: "2026-06-01T00:00",
      exibicaoFim: "2026-06-15T00:00",
      mensagem: null,
      categorias: [CAT],
      cardapios: [],
      mostrarPromocoesJunto: true,
    });
    expect(schemaModalSazonal.safeParse(p).success).toBe(true);
  });

  it("data de fim invertida é reprovada pelo schema (gate de UX)", () => {
    const p = montarPayloadModalSazonal({
      titulo: "Inverno",
      exibicaoInicio: "2026-06-15T00:00",
      exibicaoFim: "2026-06-01T00:00",
      mensagem: null,
      categorias: [CAT],
      cardapios: [],
      mostrarPromocoesJunto: false,
    });
    expect(schemaModalSazonal.safeParse(p).success).toBe(false);
  });

  it("seleção vazia é ACEITA pelo schema (RN-M02 remove a RN-06)", () => {
    const p = montarPayloadModalSazonal({
      titulo: "Inverno",
      exibicaoInicio: "2026-06-01T00:00",
      exibicaoFim: "2026-06-15T00:00",
      mensagem: null,
      categorias: [],
      cardapios: [],
      mostrarPromocoesJunto: false,
    });
    expect(schemaModalSazonal.safeParse(p).success).toBe(true);
  });

  it("`mensagem` é SEMPRE presente: `null` fica `null` (apagar a mensagem)", () => {
    const p = montarPayloadModalSazonal({ ...BASE, mensagem: null });
    expect("mensagem" in p).toBe(true);
    expect(p.mensagem).toBeNull();
    // `undefined` (estado não inicializado) também vira `null`, nunca chave ausente.
    const q = montarPayloadModalSazonal({ ...BASE, mensagem: undefined });
    expect("mensagem" in q).toBe(true);
    expect(q.mensagem).toBeNull();
  });

  it("documento do editor sem texto visível sai do schema como `null`", () => {
    const p = montarPayloadModalSazonal({
      ...BASE,
      mensagem: { versao: 1, paragrafos: [{ trechos: [] }, { trechos: [{ texto: "   " }] }] },
    });
    const r = schemaModalSazonal.safeParse(p);
    expect(r.success).toBe(true);
    expect(r.success && r.data.mensagem).toBeNull();
  });

  it("mensagem com texto passa canonizada; sem seleção também vale (RN-M02)", () => {
    const p = montarPayloadModalSazonal({
      ...BASE,
      mensagem: { versao: 1, paragrafos: [{ trechos: [{ texto: "Sopas " }, { texto: "quentes" }] }] },
    });
    const r = schemaModalSazonal.safeParse(p);
    expect(r.success).toBe(true);
    expect(r.success && r.data.mensagem).toEqual({ versao: 1, paragrafos: [{ trechos: [{ texto: "Sopas quentes" }] }] });
  });

  it("mensagem fora do contrato é reprovada pelo schema (gate de UX)", () => {
    const p = montarPayloadModalSazonal({
      ...BASE,
      mensagem: { versao: 1, paragrafos: [{ trechos: [{ texto: "x", style: "color:red" }] }] },
    });
    expect(schemaModalSazonal.safeParse(p).success).toBe(false);
  });
});
