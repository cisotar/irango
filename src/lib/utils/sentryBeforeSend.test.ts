import { describe, expect, it, vi } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { sentryBeforeSend } from "./sentryBeforeSend";

// Helper: serializa o evento sanitizado para varrer recursivamente por valores.
function contemValor(obj: unknown, alvo: string): boolean {
  return JSON.stringify(obj).includes(alvo);
}

describe("sentryBeforeSend — scrubber de PII e segredos", () => {
  it("remove PII de comprador (email, telefone, nome, pix) do extra/contexts", () => {
    const event = {
      message: "erro no checkout",
      extra: {
        email: "joao@example.com",
        telefone: "+5511999998888",
        nome_cliente: "João da Silva",
        telefone_cliente: "11988887777",
        chave_pix: "joao@pix.com",
        produto_id: "abc-123", // não-PII deve permanecer
        quantidade: 2,
      },
    } as unknown as ErrorEvent;

    const out = sentryBeforeSend(event);

    expect(out).not.toBeNull();
    expect(contemValor(out, "joao@example.com")).toBe(false);
    expect(contemValor(out, "+5511999998888")).toBe(false);
    expect(contemValor(out, "João da Silva")).toBe(false);
    expect(contemValor(out, "11988887777")).toBe(false);
    expect(contemValor(out, "joao@pix.com")).toBe(false);
    // valores não sensíveis sobrevivem
    expect(out!.extra!.produto_id).toBe("abc-123");
    expect(out!.extra!.quantidade).toBe(2);
  });

  it("remove dados de comprador Hotmart (hotmart_subscriber_code, buyer)", () => {
    const event = {
      contexts: {
        hotmart: {
          hotmart_subscriber_code: "SUBSCRIBE-XYZ",
          buyer: { name: "Maria", email: "maria@x.com" },
          transaction: "HP123", // id de transação não é PII
        },
      },
    } as unknown as ErrorEvent;

    const out = sentryBeforeSend(event);

    expect(contemValor(out, "SUBSCRIBE-XYZ")).toBe(false);
    expect(contemValor(out, "Maria")).toBe(false);
    expect(contemValor(out, "maria@x.com")).toBe(false);
    expect(contemValor(out, "HP123")).toBe(true);
  });

  it("barra credenciais por substring: key, secret, token, password, senha", () => {
    const event = {
      extra: {
        SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.super-secret",
        api_secret: "sk_live_abc",
        access_token: "Bearer xyz",
        user_password: "hunter2",
        minha_senha: "trocar123",
        hottok: "hotmart-token",
      },
    } as unknown as ErrorEvent;

    const out = sentryBeforeSend(event);

    expect(contemValor(out, "eyJhbGciOiJIUzI1NiJ9")).toBe(false);
    expect(contemValor(out, "sk_live_abc")).toBe(false);
    expect(contemValor(out, "Bearer xyz")).toBe(false);
    expect(contemValor(out, "hunter2")).toBe(false);
    expect(contemValor(out, "trocar123")).toBe(false);
    expect(contemValor(out, "hotmart-token")).toBe(false);
  });

  it("sanitiza recursivamente em estruturas aninhadas e arrays", () => {
    const event = {
      extra: {
        pedido: {
          itens: [
            { produto_id: "p1", comprador: { email: "a@b.com" } },
            { produto_id: "p2", chave_pix: "pix-123" },
          ],
        },
      },
    } as unknown as ErrorEvent;

    const out = sentryBeforeSend(event);

    expect(contemValor(out, "a@b.com")).toBe(false);
    expect(contemValor(out, "pix-123")).toBe(false);
    expect(contemValor(out, "p1")).toBe(true);
    expect(contemValor(out, "p2")).toBe(true);
  });

  it("limpa user.ip_address/email e request.cookies/authorization", () => {
    const event = {
      user: { id: "u1", email: "x@y.com", ip_address: "1.2.3.4" },
      request: {
        url: "https://irango.app/checkout",
        cookies: { session: "abc" },
        headers: { cookie: "session=abc", authorization: "Bearer t", "user-agent": "UA" },
      },
    } as unknown as ErrorEvent;

    const out = sentryBeforeSend(event);

    expect(out!.user!.id).toBe("u1");
    expect(out!.user!.email).toBeUndefined();
    expect(out!.user!.ip_address).toBeUndefined();
    expect(out!.request!.cookies).toBeUndefined();
    expect((out!.request!.headers as Record<string, unknown>).cookie).toBeUndefined();
    expect((out!.request!.headers as Record<string, unknown>).authorization).toBeUndefined();
    expect((out!.request!.headers as Record<string, unknown>)["user-agent"]).toBe("UA");
  });

  it("é case-insensitive para nomes de campo", () => {
    const event = {
      extra: { Email: "a@b.com", TELEFONE: "119", Chave_Pix: "pix" },
    } as unknown as ErrorEvent;

    const out = sentryBeforeSend(event);

    expect(contemValor(out, "a@b.com")).toBe(false);
    expect(contemValor(out, "119")).toBe(false);
    expect(contemValor(out, "pix")).toBe(false);
  });

  it("lida com referência circular sem lançar", () => {
    const circular: Record<string, unknown> = { produto_id: "p1" };
    circular.self = circular;
    const event = { extra: { circular } } as unknown as ErrorEvent;

    const out = sentryBeforeSend(event);
    expect(out).not.toBeNull();
  });

  it("retorna null (fail-closed) se a sanitização lançar", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Object.entries lança em Proxy malicioso → cai no catch.
    const armadilha = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("boom");
        },
      },
    );
    const event = { extra: armadilha } as unknown as ErrorEvent;

    const out = sentryBeforeSend(event);
    expect(out).toBeNull();
    spy.mockRestore();
  });
});
