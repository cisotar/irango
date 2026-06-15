import { describe, it, expect } from "vitest";
// RED (issue 019): os schemas REAIS ainda NÃO existem. loja.ts contém apenas
// STUBS TDD (z.never / throw) para o import compilar e a falha cair nas
// asserções abaixo, não num erro de resolução de módulo. A fase GREEN
// (executar) substitui os stubs pela implementação real.
import {
  schemaPerfil,
  schemaHorarios,
  schemaTema,
  sanitizarSlug,
} from "./loja";

// ---------------------------------------------------------------------------
// CONTRATO (issue 019, RN-07 / seguranca.md §6) — validação ISOMÓRFICA:
// o MESMO schema roda no form (client, UX) e na Server Action (servidor,
// segurança). O servidor NÃO confia no client — revalida tudo por regex.
//
//   schemaPerfil = z.object({
//     nome:     string trim, 1..N
//     slug:     /^[a-z0-9-]{3,60}$/
//     telefone: string opcional (dígitos)
//     whatsapp: string opcional, /^55\d{10,11}$/
//   })
//
//   schemaTema = z.object({
//     primaria: /^#[0-9a-fA-F]{6}$/
//     fundo:    /^#[0-9a-fA-F]{6}$/
//     destaque: /^#[0-9a-fA-F]{6}$/
//   })
//
//   schemaHorarios — chaves seg,ter,qua,qui,sex,sab,dom; cada dia:
//     { abre: 'HH:MM', fecha: 'HH:MM', ativo: boolean }
//     se ativo === true ENTÃO abre < fecha
//
//   sanitizarSlug(nome): sugestão UX de slug a partir do nome.
//
// Helpers: usamos schema.safeParse(x).success como booleano de "passou".
// ---------------------------------------------------------------------------

const temaValido = {
  primaria: "#e63946",
  fundo: "#ffffff",
  destaque: "#f1a208",
};

const diaPadrao = { abre: "08:00", fecha: "22:00", ativo: true };
const horariosValidos = {
  seg: diaPadrao,
  ter: diaPadrao,
  qua: diaPadrao,
  qui: diaPadrao,
  sex: diaPadrao,
  sab: { abre: "09:00", fecha: "20:00", ativo: true },
  dom: { abre: "00:00", fecha: "00:00", ativo: false },
};

describe("schemaPerfil — slug (seguranca.md §6, defesa server-side)", () => {
  it("aceita slug minúsculo com hífen e dígitos", () => {
    const r = schemaPerfil.safeParse({ nome: "Burger do Zé", slug: "burger-do-ze" });
    expect(r.success).toBe(true);
  });

  it("rejeita slug com espaço e maiúsculas ('Burger Do Zé')", () => {
    const r = schemaPerfil.safeParse({ nome: "Burger", slug: "Burger Do Zé" });
    expect(r.success).toBe(false);
  });

  it("rejeita slug com maiúscula ('Loja')", () => {
    expect(schemaPerfil.safeParse({ nome: "x", slug: "Loja" }).success).toBe(false);
  });

  it("rejeita slug com espaço ('a b')", () => {
    expect(schemaPerfil.safeParse({ nome: "x", slug: "a b" }).success).toBe(false);
  });

  it("rejeita path traversal ('loja/../admin')", () => {
    expect(schemaPerfil.safeParse({ nome: "x", slug: "loja/../admin" }).success).toBe(false);
  });

  it("rejeita caractere especial ('loja_zé!')", () => {
    expect(schemaPerfil.safeParse({ nome: "x", slug: "loja_zé!" }).success).toBe(false);
  });

  it("rejeita slug curto demais (< 3)", () => {
    expect(schemaPerfil.safeParse({ nome: "x", slug: "ab" }).success).toBe(false);
  });

  it("rejeita slug longo demais (> 60)", () => {
    expect(schemaPerfil.safeParse({ nome: "x", slug: "a".repeat(61) }).success).toBe(false);
  });
});

describe("schemaPerfil — nome", () => {
  it("rejeita nome vazio", () => {
    expect(schemaPerfil.safeParse({ nome: "", slug: "loja-ok" }).success).toBe(false);
  });

  it("rejeita nome só de espaços (trim)", () => {
    expect(schemaPerfil.safeParse({ nome: "   ", slug: "loja-ok" }).success).toBe(false);
  });
});

describe("schemaPerfil — whatsapp (formato BR 55 + DDD + número)", () => {
  it("aceita whatsapp ausente (opcional)", () => {
    expect(schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok" }).success).toBe(true);
  });

  it("aceita whatsapp BR válido (5511999998888)", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", whatsapp: "5511999998888" });
    expect(r.success).toBe(true);
  });

  it("rejeita whatsapp com máscara/caracteres ('(11) 99999-8888')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", whatsapp: "(11) 99999-8888" });
    expect(r.success).toBe(false);
  });

  it("rejeita whatsapp sem prefixo 55 ('11999998888')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", whatsapp: "11999998888" });
    expect(r.success).toBe(false);
  });
});

describe("schemaTema — cores hex (anti-injeção CSS, seguranca.md)", () => {
  it("aceita três cores hex #RRGGBB válidas", () => {
    expect(schemaTema.safeParse(temaValido).success).toBe(true);
  });

  it("rejeita nome de cor CSS ('red')", () => {
    expect(schemaTema.safeParse({ ...temaValido, primaria: "red" }).success).toBe(false);
  });

  it("rejeita payload de injeção CSS no lugar da cor", () => {
    const r = schemaTema.safeParse({ ...temaValido, fundo: "#fff;}body{display:none" });
    expect(r.success).toBe(false);
  });

  it("rejeita hex de 3 dígitos (#fff) — exige #RRGGBB", () => {
    expect(schemaTema.safeParse({ ...temaValido, destaque: "#fff" }).success).toBe(false);
  });

  it("rejeita hex sem '#'", () => {
    expect(schemaTema.safeParse({ ...temaValido, primaria: "e63946" }).success).toBe(false);
  });
});

describe("schemaHorarios — estrutura por dia + HH:MM + abre<fecha quando ativo", () => {
  it("aceita horários válidos completos", () => {
    expect(schemaHorarios.safeParse(horariosValidos).success).toBe(true);
  });

  it("rejeita HH:MM inválido ('25:00')", () => {
    const r = schemaHorarios.safeParse({
      ...horariosValidos,
      seg: { abre: "25:00", fecha: "22:00", ativo: true },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita abre >= fecha quando o dia está ativo", () => {
    const r = schemaHorarios.safeParse({
      ...horariosValidos,
      seg: { abre: "22:00", fecha: "08:00", ativo: true },
    });
    expect(r.success).toBe(false);
  });

  it("rejeita abre == fecha quando ativo", () => {
    const r = schemaHorarios.safeParse({
      ...horariosValidos,
      seg: { abre: "10:00", fecha: "10:00", ativo: true },
    });
    expect(r.success).toBe(false);
  });

  it("permite abre>=fecha quando o dia está INATIVO (não há expediente)", () => {
    const r = schemaHorarios.safeParse({
      ...horariosValidos,
      dom: { abre: "00:00", fecha: "00:00", ativo: false },
    });
    expect(r.success).toBe(true);
  });
});

describe("sanitizarSlug — sugestão UX a partir do nome", () => {
  it("converte nome com maiúsculas/espaços em slug válido", () => {
    expect(sanitizarSlug("Burger do Zé")).toBe("burger-do-ze");
  });

  it("a saída SEMPRE passa pelo schema de slug (paridade UX↔validação)", () => {
    const slug = sanitizarSlug("Lanchonete da Esquina!!!");
    expect(schemaPerfil.safeParse({ nome: "Lanchonete", slug }).success).toBe(true);
  });

  // issue 071: slug descongelado — bordas que podem aparecer com nomes reais
  it("nome com acentos variados → slug ASCII válido", () => {
    expect(sanitizarSlug("Çafé & Ñoño")).toBe("cafe-nono");
  });

  it("nome com múltiplos separadores consecutivos → hífens colapsados", () => {
    expect(sanitizarSlug("Loja   ---  Top")).toBe("loja-top");
  });

  it("nome que começa e termina com caracteres especiais → sem hífen nas bordas", () => {
    const resultado = sanitizarSlug("!!! Minha Loja !!!");
    expect(resultado.startsWith("-")).toBe(false);
    expect(resultado.endsWith("-")).toBe(false);
  });

  it("nome só de especiais '!!!' → slug vazio (UI deve bloquear submit — schema rejeita)", () => {
    const slug = sanitizarSlug("!!!");
    // A saída é string vazia — schema rejeita (< 3 chars). O campo fica inválido,
    // botão Salvar fica desabilitado. Esse é o comportamento correto.
    expect(slug).toBe("");
    expect(schemaPerfil.safeParse({ nome: "x", slug }).success).toBe(false);
  });

  it("nome vazio '' → slug vazio (campo inválido, submit bloqueado)", () => {
    const slug = sanitizarSlug("");
    expect(slug).toBe("");
    expect(schemaPerfil.safeParse({ nome: "x", slug }).success).toBe(false);
  });

  it("nome muito curto que gera < 3 chars → schema rejeita (submit bloqueado)", () => {
    // Ex.: nome "AB" → slug "ab" (2 chars) — abaixo do mínimo de 3
    const slug = sanitizarSlug("AB");
    expect(slug).toBe("ab");
    expect(schemaPerfil.safeParse({ nome: "AB", slug }).success).toBe(false);
  });

  it("nome com dígitos → dígitos preservados no slug", () => {
    expect(sanitizarSlug("Loja 123 Top")).toBe("loja-123-top");
  });
});
