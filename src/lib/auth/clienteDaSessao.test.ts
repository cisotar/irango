import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import { sessaoClienteConfirmada } from "./clienteDaSessao";

describe("sessaoClienteConfirmada", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("sem usuário → false", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await sessaoClienteConfirmada()).toBe(false);
  });

  it("erro do getUser → false", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: "2026-01-01" } },
      error: { name: "AuthSessionMissingError" },
    });
    expect(await sessaoClienteConfirmada()).toBe(false);
  });

  it("e-mail não confirmado → false", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1", email_confirmed_at: null } }, error: null });
    expect(await sessaoClienteConfirmada()).toBe(false);
  });

  it("getUser lança → false", async () => {
    getUser.mockImplementation(async () => {
      throw new Error("rede");
    });
    expect(await sessaoClienteConfirmada()).toBe(false);
  });

  it("sessão com e-mail confirmado → true", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: "2026-01-01" } },
      error: null,
    });
    expect(await sessaoClienteConfirmada()).toBe(true);
  });
});
