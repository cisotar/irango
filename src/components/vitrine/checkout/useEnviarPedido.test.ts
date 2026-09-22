/**
 * Testes de `useEnviarPedido`.
 *
 * [287] A RN-A5 é APOSENTADA. O checkout deixa de pré-abrir a aba de fundo do
 * WhatsApp: o aviso passa a viver na página de confirmação, onde a navegação é
 * top-level (`window.location.href`) e não exige user activation — logo, toda
 * a mecânica anti-popup do checkout some daqui.
 *
 * Por isso o antigo teste de ORDEM (que exigia a pré-abertura antes de
 * `criarPedido:inicio`) foi SUBSTITUÍDO — não apagado em silêncio: a
 * invariante que ele protegia deixou de existir, e no lugar dela entra a
 * invariante nova, mais forte: **nenhuma janela é aberta nem navegada pelo
 * checkout**, em nenhum caminho.
 *
 * Ambiente: `environment: "node"` (sem jsdom). O hook não usa JSX nem DOM,
 * então mockamos os 3 hooks/side-effects que ele importa (`useTransition`,
 * `useRouter`, `toast`) e o chamamos como função comum. `window` NÃO existe
 * neste ambiente — cada teste instala uma janela falsa DEPOIS do import do
 * módulo (instalá-la antes dispararia a pré-carga do schema em idle, que é
 * exatamente o que `useEnviarPedido.semSchema.test.ts` precisa não acontecer).
 * Essa janela falsa é o detector: se alguém reintroduzir a pré-abertura, o
 * `open`/`location.href` dela registra.
 *
 * `useTransition` roda o callback SINCRONAMENTE só para o teste poder aguardar
 * o resultado sem depender do scheduler — o que importa é a ORDEM relativa
 * entre `criarPedido` e `router.push`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ESTADO_INICIAL, type EstadoWizard } from "./estado";

const routerPush = vi.fn();
const toastError = vi.fn();
const criarPedidoMock = vi.fn();

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    // Roda o callback imediatamente — o teste só observa ORDEM de chamadas,
    // não precisa da semântica real de concorrência do useTransition.
    useTransition: () => [false, (fn: () => void) => fn()],
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("sonner", () => ({
  toast: { error: toastError },
}));

vi.mock("@/lib/actions/pedido", () => ({
  criarPedido: (...args: unknown[]) => criarPedidoMock(...args),
}));

// Import DEPOIS dos vi.mock (hoisted) — precisa vir após as declarações acima.
const { useEnviarPedido, precarregarSchemaPedido } = await import("./useEnviarPedido");

const LOJA_ID = "0d1e2f30-0000-4000-8000-000000000001";
const PRODUTO_ID = "0d1e2f30-0000-4000-8000-000000000002";

/** Destino fictício (sem PII, sem número real) só para o mock da action. */
const HREF_DO_SERVIDOR = "https://wa.me/5500000000000?text=Novo%20pedido";

// ---------------------------------------------------------------------------
// Janela falsa — detector de pré-abertura/navegação feita pelo checkout.
// ---------------------------------------------------------------------------

function instalarJanelaFalsa() {
  const aba = {
    location: { href: "" },
    close: vi.fn(),
    opener: {} as unknown,
  };
  const open = vi.fn(() => aba);
  const g = globalThis as unknown as { window?: unknown };
  g.window = { open };
  return { aba, open };
}

function removerJanelaFalsa(): void {
  const g = globalThis as unknown as { window?: unknown };
  delete g.window;
}

function estadoValido(): EstadoWizard {
  return {
    ...ESTADO_INICIAL,
    tipoEntrega: "retirada",
    formaPagamento: "dinheiro",
    nome: "Cliente Teste",
  };
}

/**
 * Monta o hook. [287] A prop legada da pré-abertura já saiu do tipo (fase
 * GREEN): quem prova a invariante agora é o detector de janela falsa — se
 * alguém reintroduzir `open`/`location.href` no checkout, ele acusa.
 */
function useMontarHook(estado: EstadoWizard = estadoValido()) {
  const args = {
    lojaId: LOJA_ID,
    lojaSlug: "loja-teste",
    itens: [{ produtoId: PRODUTO_ID, quantidade: 1 }],
    estado,
    onEstadoChange: vi.fn(),
  };
  return useEnviarPedido(args);
}

describe("[287] useEnviarPedido — envio sem nenhuma pré-abertura de aba", () => {
  const ordem: string[] = [];
  let janela: ReturnType<typeof instalarJanelaFalsa>;

  // [163] O schema do preview chega por import() em idle, e a pré-carga
  // automática é guardada por `typeof window` — que não existe em
  // `environment: node`. Estes casos descrevem o comportamento COM o preview
  // ativo, então carregamos o schema explicitamente. O comportamento sem ele
  // é coberto em useEnviarPedido.semSchema.test.ts.
  beforeAll(async () => {
    await precarregarSchemaPedido();
  });

  beforeEach(() => {
    ordem.length = 0;
    routerPush.mockReset();
    routerPush.mockImplementation(() => void ordem.push("router.push"));
    toastError.mockClear();
    criarPedidoMock.mockReset();
    janela = instalarJanelaFalsa();
  });

  afterEach(() => {
    removerJanelaFalsa();
  });

  it("ordem do envio: criarPedido:inicio → criarPedido:fim → router.push, e NENHUMA janela aberta no gesto", async () => {
    criarPedidoMock.mockImplementation(async () => {
      ordem.push("criarPedido:inicio");
      await Promise.resolve();
      ordem.push("criarPedido:fim");
      return {
        pedidoId: "p1",
        token_acesso: "t1",
        whatsappHref: HREF_DO_SERVIDOR,
      };
    });

    const { enviar } = useMontarHook();
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(ordem).toEqual(["criarPedido:inicio", "criarPedido:fim", "router.push"]);
    // A invariante NOVA: nada é aberto antes, durante ou depois do await.
    expect(janela.open).not.toHaveBeenCalled();
  });

  it("o checkout não navega para o WhatsApp: o `whatsappHref` do servidor não vira location de aba nenhuma", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: HREF_DO_SERVIDOR,
    });

    const { enviar } = useMontarHook();
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(janela.open).not.toHaveBeenCalled();
    expect(janela.aba.location.href).toBe("");
    expect(janela.aba.close).not.toHaveBeenCalled();
    // O envio termina onde sempre terminou: na confirmação.
    expect(routerPush).toHaveBeenCalledWith(
      expect.stringContaining("/loja/loja-teste/confirmacao?pedido=p1&token=t1"),
    );
  });

  it("REGRESSÃO: payload inválido (schema falha) não chama criarPedido nem abre janela", () => {
    const { enviar } = useMontarHook({ ...estadoValido(), nome: "" });

    enviar();

    expect(criarPedidoMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
    expect(janela.open).not.toHaveBeenCalled();
  });

  it("erro do servidor: router.push NÃO roda, o cliente é avisado e nenhuma janela é tocada", async () => {
    criarPedidoMock.mockResolvedValue({ erro: "Loja fechada no momento." });

    const { enviar } = useMontarHook();
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(routerPush).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Loja fechada no momento.");
    expect(janela.open).not.toHaveBeenCalled();
    expect(janela.aba.close).not.toHaveBeenCalled();
  });

  it("[162] Server Action REJEITA (não retorna erro): avisa o cliente, sem push e sem janela órfã", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    criarPedidoMock.mockRejectedValue(new Error("fetch failed"));

    const { enviar } = useMontarHook();
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(routerPush).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Não foi possível enviar seu pedido. Tente novamente.",
    );
    expect(janela.open).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("sucesso com `whatsappHref: null` (loja sem WhatsApp): push normal, nenhuma janela", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: null,
    });

    const { enviar } = useMontarHook();
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(janela.open).not.toHaveBeenCalled();
  });
});
