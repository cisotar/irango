import { describe, it, expect } from "vitest";
// RED: este módulo ainda NÃO existe — a fase GREEN (executar) cria
// src/lib/utils/validarImagem.ts com as funções puras + estes tipos.
// Stub mínimo (lançando "TODO: GREEN") existe só para compilar e falhar
// na ASSERÇÃO, não no type-check.
import {
  validarImagem,
  validarMagicBytes,
  TIPOS_IMAGEM_PERMITIDOS,
  TAMANHO_MAXIMO_BYTES,
  type MetaImagem,
  type ResultadoValidacao,
} from "./validarImagem";

// ---------------------------------------------------------------------------
// LIMITES PROPOSTOS (issue 010 + seguranca.md §13):
//   - Whitelist MIME: image/jpeg, image/png, image/webp
//   - Tamanho máximo: 2 MB = 2 * 1024 * 1024 = 2_097_152 bytes (binário)
//   - validarImagem({ tipo, tamanho }) valida o METADADO DECLARADO (client/UX).
//   - validarMagicBytes(buffer) é a 2ª linha (Server Action 016): inspeciona
//     o conteúdo real do arquivo; NÃO confia no Content-Type declarado.
// Política de NOME: a issue gera o nome via uuid na Server Action e NUNCA usa
// o nome original do client (§13). Portanto validarImagem NÃO valida extensão
// nem nome — a defesa contra "foto.php.jpg" é não usar o nome, não filtrá-lo.
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

function meta(over: Partial<MetaImagem> = {}): MetaImagem {
  return { tipo: "image/jpeg", tamanho: 1 * MB, ...over };
}

// Helper: monta um Uint8Array começando pelos magic bytes dados.
function comMagic(bytes: number[], tamanho = 64): Uint8Array {
  const buf = new Uint8Array(tamanho);
  buf.set(bytes, 0);
  return buf;
}

describe("validarImagem (metadados declarados — client/UX)", () => {
  // 1. Caminho feliz: tipo aceito + tamanho ok
  it("aceita jpeg de 1 MB", () => {
    const r: ResultadoValidacao = validarImagem(meta());
    expect(r.valido).toBe(true);
    expect(r.erro).toBeUndefined();
  });

  it("aceita png e webp dentro do limite", () => {
    expect(validarImagem(meta({ tipo: "image/png" })).valido).toBe(true);
    expect(validarImagem(meta({ tipo: "image/webp" })).valido).toBe(true);
  });

  // 2. Tipo não-imagem rejeitado (anti-upload malicioso)
  it("rejeita application/pdf", () => {
    const r = validarImagem(meta({ tipo: "application/pdf" }));
    expect(r.valido).toBe(false);
    expect(r.erro).toBeTruthy();
  });

  it("rejeita text/html (anti-XSS/script)", () => {
    expect(validarImagem(meta({ tipo: "text/html" })).valido).toBe(false);
  });

  it("rejeita image/gif (fora da whitelist, mesmo sendo imagem)", () => {
    const r = validarImagem(meta({ tipo: "image/gif" }));
    expect(r.valido).toBe(false);
    expect(r.erro).toBeTruthy();
  });

  it("rejeita image/svg+xml (SVG carrega script — fora da whitelist)", () => {
    expect(validarImagem(meta({ tipo: "image/svg+xml" })).valido).toBe(false);
  });

  // 3. Tamanho acima do máximo
  it("rejeita arquivo de 3 MB (acima do limite de 2 MB)", () => {
    const r = validarImagem(meta({ tamanho: 3 * MB }));
    expect(r.valido).toBe(false);
    expect(r.erro).toBeTruthy();
  });

  // 3b. Bordas exatas do limite de tamanho
  it("aceita arquivo exatamente no limite (2 MB)", () => {
    expect(validarImagem(meta({ tamanho: TAMANHO_MAXIMO_BYTES })).valido).toBe(true);
  });

  it("rejeita arquivo 1 byte acima do limite", () => {
    const r = validarImagem(meta({ tamanho: TAMANHO_MAXIMO_BYTES + 1 }));
    expect(r.valido).toBe(false);
  });

  // 4. Tamanho 0 / negativo
  it("rejeita tamanho 0 (arquivo vazio)", () => {
    const r = validarImagem(meta({ tamanho: 0 }));
    expect(r.valido).toBe(false);
    expect(r.erro).toBeTruthy();
  });

  it("rejeita tamanho negativo (input corrompido/adulterado)", () => {
    expect(validarImagem(meta({ tamanho: -1 })).valido).toBe(false);
  });

  // 5. Tipo ausente / vazio (client não envia Content-Type)
  it("rejeita tipo vazio", () => {
    expect(validarImagem(meta({ tipo: "" })).valido).toBe(false);
  });

  // 6. Constantes expostas para reuso client+servidor (anti-drift)
  it("expõe a whitelist com exatamente jpeg, png e webp", () => {
    expect([...TIPOS_IMAGEM_PERMITIDOS].sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it("expõe o limite de 2 MB em bytes (2 * 1024 * 1024)", () => {
    expect(TAMANHO_MAXIMO_BYTES).toBe(2 * 1024 * 1024);
  });

  // PARIDADE client ↔ servidor: a MESMA chamada com o MESMO input deve dar o
  // MESMO resultado. Pega drift entre a validação de UX e a da Server Action.
  it("é determinística — mesmo input produz o mesmo resultado (client ≡ servidor)", () => {
    const entrada = meta({ tipo: "image/png", tamanho: 1234 });
    expect(validarImagem(entrada)).toEqual(validarImagem(entrada));
  });
});

describe("validarMagicBytes (conteúdo real — Server Action 016)", () => {
  // Magic bytes de referência:
  //   JPEG: FF D8 FF
  //   PNG : 89 50 4E 47 0D 0A 1A 0A
  //   WEBP: "RIFF" .... "WEBP"  → 52 49 46 46 .. 57 45 42 50
  //   ELF (executável Linux): 7F 45 4C 46

  it("aceita buffer com magic bytes JPEG", () => {
    const r = validarMagicBytes(comMagic([0xff, 0xd8, 0xff]));
    expect(r.valido).toBe(true);
  });

  it("aceita buffer com magic bytes PNG", () => {
    const png = comMagic([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validarMagicBytes(png).valido).toBe(true);
  });

  // CRÍTICA (critério de aceite): executável disfarçado deve cair mesmo que o
  // client tenha declarado image/png. A defesa real é o conteúdo, não o header.
  it("rejeita buffer com magic bytes de executável ELF mesmo com Content-Type image/png", () => {
    const elf = comMagic([0x7f, 0x45, 0x4c, 0x46]);
    const r = validarMagicBytes(elf, "image/png");
    expect(r.valido).toBe(false);
    expect(r.erro).toBeTruthy();
  });

  it("rejeita buffer cujo conteúdo não bate com nenhum tipo da whitelist", () => {
    const lixo = comMagic([0x00, 0x01, 0x02, 0x03]);
    expect(validarMagicBytes(lixo).valido).toBe(false);
  });

  it("rejeita buffer menor que a maior assinatura (truncado)", () => {
    const truncado = comMagic([0x89, 0x50], 2);
    expect(validarMagicBytes(truncado).valido).toBe(false);
  });

  // FIX auditoria: WEBP é container RIFF — exige "RIFF" no offset 0 E "WEBP"
  // no offset 8 (bytes 4-7 = tamanho, variáveis).
  it("aceita buffer WEBP (RIFF no offset 0 + WEBP no offset 8)", () => {
    const webp = comMagic(
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
    );
    expect(validarMagicBytes(webp).valido).toBe(true);
  });

  it("rejeita RIFF sem WEBP no offset 8 (ex.: .wav/.avi não passam como webp)", () => {
    // RIFF presente, mas offset 8 não é "WEBP" → não é webp válido.
    const riffNaoWebp = comMagic([0x52, 0x49, 0x46, 0x46]);
    expect(validarMagicBytes(riffNaoWebp).valido).toBe(false);
  });

  it("rejeita ELF declarado como image/webp (conteúdo manda, não o header)", () => {
    const elf = comMagic([0x7f, 0x45, 0x4c, 0x46]);
    const r = validarMagicBytes(elf, "image/webp");
    expect(r.valido).toBe(false);
    expect(r.erro).toBeTruthy();
  });
});
