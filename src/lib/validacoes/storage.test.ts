import { describe, expect, it, vi } from "vitest";
// STORAGE_URL_PREFIX é derivado de NEXT_PUBLIC_SUPABASE_URL em tempo de
// avaliação do módulo. vi.hoisted garante que a env está definida ANTES do
// import ESM — sem isso o prefixo seria "undefined/..." e os testes de
// startsWith passariam por razão errada (ou falharia em z.url()).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://projeto-teste.supabase.co";
});
import { STORAGE_URL_PREFIX, schemaStorageUrl } from "./storage";

// ---------------------------------------------------------------------------
// schemaStorageUrl — contrato do módulo neutro de Storage (issue 072).
//
// Responsabilidade: z.string().url() + refine(startsWith(STORAGE_URL_PREFIX)).
// Sem .optional() / .nullish() embutido — opcionalidade é composta no ponto
// de uso (produto.ts usa .nullish(), pagamento.ts usa .optional()).
//
// O que NÃO é responsabilidade deste schema (e por isso não há teste forçado):
//   - path traversal ("../") dentro de um path com prefixo correto: o caminho
//     completo ainda começa com STORAGE_URL_PREFIX, então startsWith passa.
//     Mitigação real: RLS do bucket Storage (seguranca.md §18) + signed URLs —
//     não o schema de validação da aplicação.
// ---------------------------------------------------------------------------

const PREFIX = STORAGE_URL_PREFIX; // "https://projeto-teste.supabase.co/storage/v1/object/public/"
const urlValida = `${PREFIX}produtos/loja-abc/foto.png`;

describe("schemaStorageUrl — caminho feliz", () => {
  it("aceita URL do Storage do iRango com path completo", () => {
    const r = schemaStorageUrl.safeParse(urlValida);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe(urlValida);
  });

  it("preserva o valor exato (sem normalização silenciosa)", () => {
    // Garante que o refine não modifica a string — o valor persiste tal qual.
    const r = schemaStorageUrl.safeParse(urlValida);
    if (r.success) expect(r.data).toBe(urlValida);
  });
});

describe("schemaStorageUrl — rejeições de segurança (anti-injeção de URL)", () => {
  it("rejeita URL de OUTRO projeto Supabase (host diferente, mesmo path)", () => {
    // Outro projeto Supabase: mesmo path de storage, host diferente → não
    // começa com STORAGE_URL_PREFIX do iRango → rejeitado.
    const outroProjeto = `https://outro-projeto.supabase.co/storage/v1/object/public/produtos/foto.png`;
    const r = schemaStorageUrl.safeParse(outroProjeto);
    expect(r.success).toBe(false);
  });

  it("rejeita downgrade http:// quando STORAGE_URL_PREFIX é https://", () => {
    // Um atacante que controle um servidor em http:// com o mesmo path não
    // consegue passar: PREFIX é https://, então startsWith falha para http://.
    const httpUrl = urlValida.replace("https://", "http://");
    const r = schemaStorageUrl.safeParse(httpUrl);
    expect(r.success).toBe(false);
  });

  it("rejeita URL externa (https://evil.com)", () => {
    const r = schemaStorageUrl.safeParse("https://evil.com/storage/v1/object/public/produtos/foto.png");
    expect(r.success).toBe(false);
  });

  it("rejeita javascript: (XSS clássico — z.url() já bloqueia, mas o contrato é explícito)", () => {
    const r = schemaStorageUrl.safeParse("javascript:alert(1)");
    expect(r.success).toBe(false);
  });

  it("rejeita string vazia (não é URL válida)", () => {
    const r = schemaStorageUrl.safeParse("");
    expect(r.success).toBe(false);
  });

  it("rejeita undefined (sem .nullish() — responsabilidade do ponto de uso)", () => {
    const r = schemaStorageUrl.safeParse(undefined);
    expect(r.success).toBe(false);
  });

  it("rejeita null (sem .nullish() — responsabilidade do ponto de uso)", () => {
    const r = schemaStorageUrl.safeParse(null);
    expect(r.success).toBe(false);
  });
});

describe("schemaStorageUrl — borda: prefixo nu sem path de arquivo", () => {
  // O prefixo sozinho (terminando em "/") é uma URL válida pelo spec e passa
  // no startsWith trivialmente. O schema ACEITA — isso é documentado como
  // limitação conhecida: a garantia de path não-vazio é do componente de
  // upload (issue 073), não do schema de validação.
  // Este teste serve como documentação executável: se alguém endurecer o
  // schema para rejeitar path vazio, o teste ficará vermelho e a mudança
  // terá que ser intencional.
  it("aceita prefixo nu sem path (limitação conhecida — upload nunca produz essa URL)", () => {
    const r = schemaStorageUrl.safeParse(PREFIX);
    // Documenta comportamento real: o schema não valida comprimento do path.
    // A garantia é upstream (upload.ts sempre produz path com bucket/loja/arquivo).
    expect(r.success).toBe(true);
  });
});
