/**
 * Testes de `useEnviarPedido` (issue 126, RN-A5) — fecham a LACUNA documentada
 * em `aberturaWhatsapp.test.ts`: aquele arquivo prova a mecânica da aba isolada,
 * mas não prova que `useEnviarPedido` a invoca na ORDEM certa (ANTES do
 * `await criarPedido`, ainda dentro do gesto de clique). Um bug real seria
 * mover `prepararAbaWhatsapp(...)` para depois do `await` — o popup seria
 * bloqueado em produção, mas nenhum teste existente pega isso.
 *
 * Ambiente: `environment: "node"` (sem jsdom). Não montamos o hook via React —
 * ele não usa JSX nem precisa de DOM, então mockamos os 3 hooks/side-effects
 * que ele importa (`useTransition`, `useRouter`, `toast`) e chamamos
 * `useEnviarPedido(...)` como função comum, fora de um componente. Isso é
 * seguro aqui porque os mocks substituem toda a superfície que dependeria do
 * dispatcher do React — nada do reconciler é exercitado.
 *
 * `useTransition` é mockado para rodar o callback SINCRONAMENTE (sem
 * `startTransition` real) só para podermos `await` o resultado no teste sem
 * depender de timing do scheduler — o que importa aqui é a ORDEM relativa
 * entre `prepararAbaWhatsapp` e `criarPedido`, não a semântica de concorrência
 * do React.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ESTADO_INICIAL, type EstadoWizard } from "./estado";

const routerPush = vi.fn();
const toastError = vi.fn();
const criarPedidoMock = vi.fn();
const prepararAbaWhatsappMock = vi.fn();

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

vi.mock("./aberturaWhatsapp", () => ({
  prepararAbaWhatsapp: (...args: unknown[]) => prepararAbaWhatsappMock(...args),
}));

// Import DEPOIS dos vi.mock (hoisted) — precisa vir após as declarações acima.
const { useEnviarPedido } = await import("./useEnviarPedido");

const LOJA_ID = "0d1e2f30-0000-4000-8000-000000000001";
const PRODUTO_ID = "0d1e2f30-0000-4000-8000-000000000002";

function estadoValido(): EstadoWizard {
  return {
    ...ESTADO_INICIAL,
    tipoEntrega: "retirada",
    formaPagamento: "dinheiro",
    nome: "Cliente Teste",
  };
}

function useMontarHook(preAbrirWhatsapp: boolean, estado: EstadoWizard = estadoValido()) {
  return useEnviarPedido({
    lojaId: LOJA_ID,
    lojaSlug: "loja-teste",
    itens: [{ produtoId: PRODUTO_ID, quantidade: 1 }],
    estado,
    onEstadoChange: vi.fn(),
    preAbrirWhatsapp,
  });
}

describe("useEnviarPedido — ordem e efeitos da mecânica do WhatsApp (126)", () => {
  const ordem: string[] = [];
  const abaConcluir = vi.fn();

  beforeEach(() => {
    ordem.length = 0;
    routerPush.mockClear();
    toastError.mockClear();
    abaConcluir.mockClear();
    criarPedidoMock.mockReset();
    prepararAbaWhatsappMock.mockReset();

    prepararAbaWhatsappMock.mockImplementation(() => {
      ordem.push("prepararAbaWhatsapp");
      return { concluir: abaConcluir };
    });
  });

  it("REGRESSÃO 126: prepararAbaWhatsapp roda ANTES do await criarPedido resolver", async () => {
    criarPedidoMock.mockImplementation(async () => {
      ordem.push("criarPedido:inicio");
      await Promise.resolve();
      ordem.push("criarPedido:fim");
      return { pedidoId: "p1", token_acesso: "t1", whatsappHref: null };
    });

    const { enviar } = useMontarHook(true);
    enviar();
    // Dá tempo pro microtask do criarPedido resolver.
    await new Promise((r) => setTimeout(r, 0));

    expect(ordem).toEqual(["prepararAbaWhatsapp", "criarPedido:inicio", "criarPedido:fim"]);
  });

  it("payload inválido (schema falha): prepararAbaWhatsapp NUNCA é chamado — sem aba órfã", () => {
    const { enviar } = useMontarHook(true, { ...estadoValido(), nome: "" }); // nome vazio falha o schema

    enviar();

    expect(prepararAbaWhatsappMock).not.toHaveBeenCalled();
    expect(criarPedidoMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("erro do servidor: aba.concluir(null) fecha a aba e router.push NÃO roda", async () => {
    criarPedidoMock.mockResolvedValue({ erro: "Loja fechada no momento." });

    const { enviar } = useMontarHook(true);
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(abaConcluir).toHaveBeenCalledWith(null);
    expect(routerPush).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Loja fechada no momento.");
  });

  it("sucesso: aba.concluir(whatsappHref) roda e router.push acontece de qualquer forma (RN-A4)", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: "https://api.whatsapp.com/send?phone=5511999999999",
    });

    const { enviar } = useMontarHook(true);
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(abaConcluir).toHaveBeenCalledWith(
      "https://api.whatsapp.com/send?phone=5511999999999",
    );
    expect(routerPush).toHaveBeenCalledWith(
      expect.stringContaining("/loja/loja-teste/confirmacao?pedido=p1&token=t1"),
    );
  });

  it("preAbrirWhatsapp=false: prepararAbaWhatsapp é chamado com false (nunca abre janela)", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: null,
    });

    const { enviar } = useMontarHook(false);
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(prepararAbaWhatsappMock).toHaveBeenCalledWith(false);
  });
});
