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

// ---------------------------------------------------------------------------
// RED (issue 004): os 6 campos endereco_* ainda NÃO existem em schemaPerfil.
// Por design, latitude/longitude NUNCA entram no schema (derivados no servidor,
// issue 008) — qualquer payload com essas chaves deve reprovar via .strict()
// (RN-1 / seguranca.md §2/§10).
//
// Contrato esperado (fase GREEN adiciona ao z.object antes do .strict()):
//   const reCep = /^\d{5}-?\d{3}$/;   // mesmo de pedido.ts:39
//   const reUf  = /^[A-Za-z]{2}$/;    // 2 letras (UF)
//   endereco_cep:    z.string().trim().regex(reCep).optional(),
//   endereco_rua:    z.string().trim().min(1).optional(),
//   endereco_numero: z.string().trim().min(1).optional(),
//   endereco_bairro: z.string().trim().min(1).optional(),
//   endereco_cidade: z.string().trim().min(1).optional(),
//   endereco_estado: z.string().trim().regex(reUf).optional(),
//
// POR QUE estes casos FALHAM agora:
//  - "válido passa": os campos não existem → com .strict(), payload com chaves
//    desconhecidas (endereco_*) reprova → success = false (esperado true). FAIL.
//  - "malformado reprova" / "coords reprovam": já reprovam hoje, mas por strict
//    (chave desconhecida), não pela regra de CEP/UF. Passam a verde pelo motivo
//    CERTO só após a GREEN. Os casos que PROVAM o RED são os "válido passa".
// ---------------------------------------------------------------------------
const enderecoValido = {
  endereco_cep: "01310-100",
  endereco_rua: "Av Paulista",
  endereco_numero: "1000",
  endereco_bairro: "Bela Vista",
  endereco_cidade: "São Paulo",
  endereco_estado: "SP",
};

describe("schemaPerfil — endereço (6 campos opcionais + strict rejeita coords)", () => {
  // --- Passam (após GREEN) ---
  it("aceita payload base + os 6 campos de endereço válidos", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido });
    expect(r.success).toBe(true);
  });

  it("aceita CEP sem hífen ('01310100')", () => {
    const r = schemaPerfil.safeParse({
      nome: "Loja",
      slug: "loja-ok",
      ...enderecoValido,
      endereco_cep: "01310100",
    });
    expect(r.success).toBe(true);
  });

  it("aceita payload SEM nenhum campo de endereço (todos opcionais)", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok" });
    expect(r.success).toBe(true);
  });

  it("aceita UF minúscula ('sp') — regex [A-Za-z]", () => {
    const r = schemaPerfil.safeParse({
      nome: "Loja",
      slug: "loja-ok",
      ...enderecoValido,
      endereco_estado: "sp",
    });
    expect(r.success).toBe(true);
  });

  it("aceita cada campo de endereço individualmente, demais ausentes", () => {
    expect(schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", endereco_cep: "01310-100" }).success).toBe(true);
    expect(schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", endereco_rua: "Av Paulista" }).success).toBe(true);
    expect(schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", endereco_numero: "1000" }).success).toBe(true);
    expect(schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", endereco_bairro: "Bela Vista" }).success).toBe(true);
    expect(schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", endereco_cidade: "São Paulo" }).success).toBe(true);
    expect(schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", endereco_estado: "SP" }).success).toBe(true);
  });

  // --- Reprovam: coords nunca aceitas do cliente (.strict(), RN-1) ---
  it("rejeita latitude no payload (.strict())", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, latitude: -23.5 });
    expect(r.success).toBe(false);
  });

  it("rejeita longitude no payload (.strict())", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, longitude: -46.6 });
    expect(r.success).toBe(false);
  });

  it("rejeita latitude + longitude juntos (.strict())", () => {
    const r = schemaPerfil.safeParse({
      nome: "Loja",
      slug: "loja-ok",
      ...enderecoValido,
      latitude: -23.5,
      longitude: -46.6,
    });
    expect(r.success).toBe(false);
  });

  // --- Reprovam: CEP malformado ---
  it("rejeita CEP malformado ('123')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_cep: "123" });
    expect(r.success).toBe(false);
  });

  it("rejeita CEP malformado ('0131-100')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_cep: "0131-100" });
    expect(r.success).toBe(false);
  });

  it("rejeita CEP malformado ('01310-10a')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_cep: "01310-10a" });
    expect(r.success).toBe(false);
  });

  // --- Reprovam: UF malformada (não 2 letras) ---
  it("rejeita UF malformada ('S')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_estado: "S" });
    expect(r.success).toBe(false);
  });

  it("rejeita UF malformada ('SPP')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_estado: "SPP" });
    expect(r.success).toBe(false);
  });

  it("rejeita UF malformada ('S1')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_estado: "S1" });
    expect(r.success).toBe(false);
  });

  it("rejeita UF malformada ('12')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_estado: "12" });
    expect(r.success).toBe(false);
  });

  // --- Reprovam: string vazia / só espaços em campo texto livre (min(1) após trim) ---
  it("rejeita endereco_rua vazio ('')", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_rua: "" });
    expect(r.success).toBe(false);
  });

  it("rejeita endereco_cidade só de espaços ('   ' → '' após trim)", () => {
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_cidade: "   " });
    expect(r.success).toBe(false);
  });

  // --- Bordas adicionais: casos que pegam bugs reais ---

  it("aceita endereco_numero '0' (número de porta legítimo, não é string vazia)", () => {
    // min(1) verifica comprimento da string, não valor numérico. '0' tem 1 char → válido.
    // Bug potencial: se implementação usar Number('0') === falsy, rejeitaria erroneamente.
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_numero: "0" });
    expect(r.success).toBe(true);
  });

  it("aceita endereco_numero com letra de complemento ('1000 A')", () => {
    // Número real de endereço comercial com complemento embutido.
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_numero: "1000 A" });
    expect(r.success).toBe(true);
  });

  it("rejeita CEP com 9 dígitos sem hífen ('013101000')", () => {
    // reCep = /^\d{5}-?\d{3}$/ — 9 dígitos corridos não casam com \d{5}...\d{3}.
    // Bug potencial: regex sem âncoras deixaria '013101000' casar em substring.
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", ...enderecoValido, endereco_cep: "013101000" });
    expect(r.success).toBe(false);
  });

  it("rejeita whatsapp com número de 8 dígitos após DDD (curto demais: '551199998888')", () => {
    // reWhatsapp = /^55\d{10,11}$/ — DDD(2)+número(8)=10 dígitos total após 55,
    // mas a regex exige \d{10,11} DEPOIS do 55. '551199998888' tem 12 chars total,
    // 10 após '55' → deveria aceitar. Verificamos o caso 9 chars após DDD+55 (11 total).
    // '5511999988' → só 10 chars total → 8 após 55 → rejeita (\d{10,11} não casa com 8).
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "loja-ok", whatsapp: "5511999988" });
    expect(r.success).toBe(false);
  });

  it("slug só de dígitos ('123') é aceito pelo schema (padrão [a-z0-9-])", () => {
    // reSlug = /^[a-z0-9-]{3,60}$/ — dígitos são permitidos.
    // Documenta a decisão: slug "123" é sintaticamente válido (unicidade garante semântica).
    const r = schemaPerfil.safeParse({ nome: "Loja", slug: "123" });
    expect(r.success).toBe(true);
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
