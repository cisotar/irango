/**
 * Testes do `ModulosImpressaoAdmin` (issue 143 — NÃO crítica; a autoridade toda
 * está na Server Action 142, coberta lá). Componente é SÓ UX: gesto + feedback
 * otimista. Aqui provamos:
 *   (a) render dos dois módulos (rótulos, descrições, estado inicial refletido);
 *   (b) coerção fail-closed `=== true` (RN-3): valor truthy-mas-não-`true` = OFF;
 *   (c) wiring do toggle → `alternarModuloImpressao(lojaId, "a4"|"termica", novo)`;
 *   (d) ramos de toast: `{ok:true}` → success; `{ok:false,erro}` → error(erro);
 *       exceção → error genérico.
 *
 * Ambiente: vitest environment=node — SEM jsdom/@testing-library (padrão do
 * projeto: ConfiguracaoAdminClient.test.tsx, AcoesStatus.test.tsx). Não há clique
 * DOM real; a prova de wiring é feita CAPTURANDO as props que cada `Switch`
 * recebe (via stub mockado, indexado por `id`) e INVOCANDO o `onCheckedChange`.
 *
 * Infra de render: `renderToStaticMarkup` (react-dom/server) troca o
 * `startTransition` do `useTransition` por um stub que LANÇA fora do render. Como
 * este componente dispara a action DENTRO de `iniciar(...)`, mockamos
 * `useTransition` por `[false, (cb) => cb()]` (executa o callback sync, sem
 * transição real) — análogo ao mock de `useRouter` em AcoesStatus.test.tsx. É só
 * infra: não altera a lógica sob teste (wiring da action + ramos de toast).
 *
 * Limitação honesta: o rollback VISUAL (o switch voltando de posição) é `setState`
 * e NÃO é re-observável em `renderToStaticMarkup` (render único, sem re-render).
 * O teste prova o efeito observável do rollback — `toast.error` no ramo de falha —
 * e o disparo correto da action. A reversão visual ponta-a-ponta fica coberta
 * pelo `verificar`/critério da 144. Não introduzimos jsdom só por isto.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const LOJA_ALVO = "11111111-1111-4111-8111-111111111111";

// Captura das props de cada Switch, indexada por `id`. `vi.hoisted` roda antes
// dos factories de `vi.mock`, então a referência existe quando o mock executa.
const switches = vi.hoisted(
  () =>
    new Map<
      string,
      {
        checked: boolean;
        disabled: boolean;
        onCheckedChange: (novo: boolean) => void;
      }
    >(),
);

// Stub do primitivo base-ui: registra props e renderiza um marcador estável para
// asserção de presença/estado inicial sem depender do markup real do base-ui.
vi.mock("@/components/ui/switch", () => ({
  Switch: (props: {
    id: string;
    checked: boolean;
    disabled: boolean;
    onCheckedChange: (novo: boolean) => void;
  }) => {
    switches.set(props.id, {
      checked: props.checked,
      disabled: props.disabled,
      onCheckedChange: props.onCheckedChange,
    });
    return (
      <button
        data-testid={`switch-${props.id}`}
        data-checked={props.checked ? "true" : "false"}
        data-disabled={props.disabled ? "true" : "false"}
      />
    );
  },
}));

// `useTransition` sob render estático: startTransition lança. Substituímos por
// um executor síncrono do callback (o `pendente` fica sempre `false` — o disabled
// durante a ação não é observável em render único, ver "Limitação honesta").
vi.mock("react", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("react")>();
  return {
    ...real,
    useTransition: () => [false, (cb: () => void) => cb()] as const,
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../../actions/admin-modulos-impressao", () => ({
  alternarModuloImpressao: vi.fn(async () => ({ ok: true }) as const),
}));

import { ModulosImpressaoAdmin } from "./ModulosImpressaoAdmin";
import { alternarModuloImpressao } from "../../actions/admin-modulos-impressao";
import { toast } from "sonner";

const ID_A4 = "modulo-impressao-a4";
const ID_TERMICA = "modulo-impressao-termica";

function renderizar(modulos: { a4: boolean; termica: boolean }): string {
  return renderToStaticMarkup(
    <ModulosImpressaoAdmin lojaId={LOJA_ALVO} modulos={modulos} />,
  );
}

// Drena todos os microtasks pendentes (a action resolvida + o toast rodam em
// microtask após o `onCheckedChange`). Um macrotask garante a ordem, sem flake.
const flush = (): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, 0));

beforeEach(() => {
  vi.clearAllMocks();
  switches.clear();
  // default do mock consumido nos ramos: sucesso (sobrescrito por teste).
  vi.mocked(alternarModuloImpressao).mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// (a) render: rótulos, descrições e estado inicial
// ---------------------------------------------------------------------------

describe("render dos dois módulos", () => {
  it("exibe rótulos e descrições dos dois módulos + cabeçalho admin", () => {
    const html = renderizar({ a4: false, termica: false });

    expect(html).toContain("Módulos pagos");
    expect(html).toContain("Controle do SaaS · não visível ao lojista");
    expect(html).toContain("Impressão A4/PDF");
    expect(html).toContain(
      "Libera a variante Comum (A4) no seletor de impressão de pedidos.",
    );
    expect(html).toContain("Impressão Térmica");
    expect(html).toContain(
      "Libera as variantes Via cozinha e Recibo (bobina 80mm) no seletor de impressão.",
    );
  });

  it("renderiza os dois switches com id casado ao htmlFor do Label", () => {
    const html = renderizar({ a4: false, termica: false });
    expect(switches.has(ID_A4)).toBe(true);
    expect(switches.has(ID_TERMICA)).toBe(true);
    // Label associa por htmlFor (alvo ampliado, RN de acessibilidade).
    expect(html).toContain(`for="${ID_A4}"`);
    expect(html).toContain(`for="${ID_TERMICA}"`);
  });

  it("reflete o estado inicial das flags (A4 e Térmica independentes)", () => {
    renderizar({ a4: true, termica: false });
    expect(switches.get(ID_A4)?.checked).toBe(true);
    expect(switches.get(ID_TERMICA)?.checked).toBe(false);
  });

  it("estado textual Ativo/Inativo acompanha cada flag", () => {
    const html = renderizar({ a4: true, termica: false });
    expect(html).toContain("Ativo");
    expect(html).toContain("Inativo");
  });
});

// ---------------------------------------------------------------------------
// (b) coerção fail-closed (RN-3)
// ---------------------------------------------------------------------------

describe("coerção fail-closed do estado inicial (RN-3)", () => {
  it("valor não-`true` (undefined/truthy) renderiza DESLIGADO", () => {
    // Cliente/servidor pode entregar um valor ambíguo; só `=== true` liga.
    const modulos = { a4: undefined, termica: 1 } as unknown as {
      a4: boolean;
      termica: boolean;
    };
    renderizar(modulos);
    expect(switches.get(ID_A4)?.checked).toBe(false);
    expect(switches.get(ID_TERMICA)?.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) wiring do toggle → assinatura de 3 args da action 142
// ---------------------------------------------------------------------------

describe("wiring do toggle para alternarModuloImpressao", () => {
  it("ligar A4 chama (lojaId, \"a4\", true)", async () => {
    renderizar({ a4: false, termica: false });
    switches.get(ID_A4)!.onCheckedChange(true);
    await flush();
    expect(alternarModuloImpressao).toHaveBeenCalledWith(LOJA_ALVO, "a4", true);
  });

  it("desligar Térmica chama (lojaId, \"termica\", false)", async () => {
    renderizar({ a4: false, termica: true });
    switches.get(ID_TERMICA)!.onCheckedChange(false);
    await flush();
    expect(alternarModuloImpressao).toHaveBeenCalledWith(
      LOJA_ALVO,
      "termica",
      false,
    );
  });

  it("módulos independentes: mexer em A4 não chama a Térmica", async () => {
    renderizar({ a4: false, termica: false });
    switches.get(ID_A4)!.onCheckedChange(true);
    await flush();
    expect(alternarModuloImpressao).toHaveBeenCalledTimes(1);
    expect(alternarModuloImpressao).toHaveBeenCalledWith(LOJA_ALVO, "a4", true);
  });

  it("dois toggles em sequência no MESMO switch: duas chamadas independentes, sem dedup/cross-talk", async () => {
    // Duplo clique/duplo submit: nada no componente impede um segundo toggle
    // antes do primeiro resolver (o `disabled` de UX não é observável aqui —
    // ver "Limitação honesta"). Prova que a SEGUNDA chamada não é engolida e
    // que cada resultado dispara o toast certo, sem misturar com o outro.
    vi.mocked(alternarModuloImpressao)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, erro: "Loja não encontrada." });
    renderizar({ a4: false, termica: false });

    switches.get(ID_A4)!.onCheckedChange(true);
    switches.get(ID_A4)!.onCheckedChange(false);
    await flush();

    expect(alternarModuloImpressao).toHaveBeenCalledTimes(2);
    expect(alternarModuloImpressao).toHaveBeenNthCalledWith(
      1,
      LOJA_ALVO,
      "a4",
      true,
    );
    expect(alternarModuloImpressao).toHaveBeenNthCalledWith(
      2,
      LOJA_ALVO,
      "a4",
      false,
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Impressão A4/PDF ativada.");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Loja não encontrada.");
  });
});

// ---------------------------------------------------------------------------
// (d) ramos de toast (efeito observável do sucesso / rollback)
// ---------------------------------------------------------------------------

describe("feedback via toast", () => {
  it("{ok:true} ao ligar → toast.success com o rótulo do módulo", async () => {
    vi.mocked(alternarModuloImpressao).mockResolvedValueOnce({ ok: true });
    renderizar({ a4: false, termica: false });
    switches.get(ID_A4)!.onCheckedChange(true);
    await flush();
    expect(toast.success).toHaveBeenCalledWith("Impressão A4/PDF ativada.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("{ok:true} ao desligar Térmica → toast.success \"...desativada.\"", async () => {
    vi.mocked(alternarModuloImpressao).mockResolvedValueOnce({ ok: true });
    renderizar({ a4: false, termica: true });
    switches.get(ID_TERMICA)!.onCheckedChange(false);
    await flush();
    expect(toast.success).toHaveBeenCalledWith("Impressão Térmica desativada.");
  });

  // Mutação verificada manualmente: remover o `setEstado(anterior)` do ramo
  // `{ok:false}` em ModulosImpressaoAdmin.tsx NÃO quebra nenhum teste deste
  // arquivo (16/16 seguem verdes) — os dois testes abaixo só provam o `toast`,
  // não a reversão de `checked`. Sob `renderToStaticMarkup` (render único, sem
  // reconciler) o setter de `useState` invocado fora do render é inerte: não
  // há como reobservar o switch revertido sem jsdom + @testing-library/react
  // (ausentes no projeto — nenhum arquivo do repo usa jsdom hoje). A reversão
  // real do `checked` fica sem prova automatizada; cobertura ponta-a-ponta
  // depende do `verificar` da issue 144, como já assumido no cabeçalho deste
  // arquivo ("Limitação honesta").
  it("{ok:false,erro} → toast.error(erro) (rollback observável)", async () => {
    vi.mocked(alternarModuloImpressao).mockResolvedValueOnce({
      ok: false,
      erro: "Loja não encontrada.",
    });
    renderizar({ a4: false, termica: false });
    switches.get(ID_A4)!.onCheckedChange(true);
    await flush();
    expect(toast.error).toHaveBeenCalledWith("Loja não encontrada.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("exceção da action → toast.error genérico (rollback observável)", async () => {
    vi.mocked(alternarModuloImpressao).mockRejectedValueOnce(
      new Error("falha de admin propagada (D-4)"),
    );
    renderizar({ a4: false, termica: false });
    switches.get(ID_A4)!.onCheckedChange(true);
    await flush();
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível alterar o módulo.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
