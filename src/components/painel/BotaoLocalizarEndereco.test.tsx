import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Issue 368 (P8) — estados do botão D14. Sem jsdom: `useTransition`/`useState`
 * são controlados para (a) renderizar os estados pendente/erro como markup e
 * (b) invocar o `onClick` real e observar o efeito (toast, refresh, erro
 * visível). A Server Action é a única dependência simulada.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const estado = vi.hoisted(() => ({
  pendente: false,
  erro: null as string | null,
  setErro: undefined as unknown as ReturnType<typeof vi.fn>,
  ultima: undefined as Promise<void> | undefined,
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => [
      estado.pendente,
      (cb: () => Promise<void>) => {
        estado.ultima = cb();
      },
    ],
    useState: () => [estado.erro, estado.setErro],
  };
});

import { BotaoLocalizarEndereco } from "./BotaoLocalizarEndereco";
import { ROTULO_LOCALIZAR_DE_NOVO } from "@/lib/utils/publicacao";

type Res = { ok: true } | { ok: false; erro: string };

function montar(onLocalizar: () => Promise<Res>) {
  const el = BotaoLocalizarEndereco({ onLocalizar }) as ReactElement<{
    children: ReactElement<{ onClick: () => void; disabled: boolean }>[];
  }>;
  return el.props.children[0].props.onClick;
}

beforeEach(() => {
  vi.clearAllMocks();
  estado.pendente = false;
  estado.erro = null;
  estado.setErro = vi.fn();
  estado.ultima = undefined;
});

describe("BotaoLocalizarEndereco", () => {
  it("sucesso: toast de sucesso + router.refresh, sem erro visível", async () => {
    const onLocalizar = vi.fn(async (): Promise<Res> => ({ ok: true }));
    montar(onLocalizar)();
    await estado.ultima;
    expect(onLocalizar).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Endereço localizado no mapa.");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(estado.setErro).toHaveBeenCalledTimes(1);
    expect(estado.setErro).toHaveBeenCalledWith(null);
  });

  it("falha: toast + erro persistente na tela, sem refresh", async () => {
    const msg = "Não foi possível localizar. Confira o endereço e tente de novo.";
    montar(async () => ({ ok: false, erro: msg }))();
    await estado.ultima;
    expect(toast.error).toHaveBeenCalledWith(msg);
    expect(estado.setErro).toHaveBeenLastCalledWith(msg);
    expect(refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("novo clique limpa o erro anterior antes de chamar a action", async () => {
    const ordem: string[] = [];
    estado.setErro = vi.fn(() => ordem.push("setErro"));
    montar(async () => {
      ordem.push("action");
      return { ok: true };
    })();
    await estado.ultima;
    expect(ordem.slice(0, 2)).toEqual(["setErro", "action"]);
  });

  it("markup repouso: botão habilitado com o rótulo D14, região aria-live vazia", () => {
    const m = renderToStaticMarkup(<BotaoLocalizarEndereco onLocalizar={vi.fn()} />);
    expect(m).toContain(ROTULO_LOCALIZAR_DE_NOVO);
    expect(m).not.toContain(' disabled=""');
    expect(m).toContain('aria-busy="false"');
    expect(m).toMatch(/<p aria-live="polite"[^>]*><\/p>/);
  });

  it("markup pendente: desabilitado, aria-busy e rótulo 'Localizando…'", () => {
    estado.pendente = true;
    const m = renderToStaticMarkup(<BotaoLocalizarEndereco onLocalizar={vi.fn()} />);
    expect(m).toContain(' disabled=""');
    expect(m).toContain('aria-busy="true"');
    expect(m).toContain("Localizando…");
    expect(m).not.toContain(ROTULO_LOCALIZAR_DE_NOVO);
  });

  it("markup com erro: a instrução de falha fica visível abaixo do botão", () => {
    estado.erro = "Tente de novo em instantes.";
    const m = renderToStaticMarkup(<BotaoLocalizarEndereco onLocalizar={vi.fn()} />);
    expect(m).toMatch(/<p aria-live="polite"[^>]*>Tente de novo em instantes\.<\/p>/);
  });
});
