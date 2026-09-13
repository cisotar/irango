/**
 * Testes de `useEnviarPedido` (issue 163) — estado DEGRADADO: o schema de
 * preview (`schemaPayloadPedido`) ainda NÃO chegou pelo import() dinâmico.
 *
 * Arquivo SEPARADO de `useEnviarPedido.test.ts` de propósito: `schemaPedido`
 * é uma variável de escopo de MÓDULO em `useEnviarPedido.ts`, compartilhada
 * por todas as chamadas de `useEnviarPedido(...)` dentro do MESMO módulo
 * carregado. `useEnviarPedido.test.ts` chama `precarregarSchemaPedido()` no
 * `beforeAll` e, uma vez preenchida, `schemaPedido` não pode ser "esvaziada"
 * de volta para `null` (não há função de reset — de propósito, é
 * `precarga ??=`, idempotente). O vitest isola módulos por arquivo de teste,
 * então este arquivo nunca importa `precarregarSchemaPedido` e nunca a chama:
 * aqui `schemaPedido` fica `null` do jeito que está logo após o import,
 * reproduzindo o clique que acontece ANTES do idle callback rodar.
 *
 * O que este arquivo prova:
 *  1. Com o schema ausente, `enviar()` NÃO barra localmente — nem payload que
 *     o schema rejeitaria. O payload CRU vai para `criarPedido` (o servidor é
 *     quem valida, `actions/pedido.ts` antes de qualquer I/O — nada é
 *     enfraquecido; a prova de paridade está no describe "paridade (163)"
 *     mais abaixo, neste mesmo arquivo).
 *  2. `prepararAbaWhatsapp` RODA mesmo com payload que o schema rejeitaria —
 *     é o delta de comportamento aceito e registrado no plano da issue 163
 *     §2: "flash de aba, não aba órfã" — se o servidor rejeitar, o próprio
 *     `catch`/`if ("erro" in resultado)` fecha a aba via `aba.concluir(null)`.
 *  3. Payload válido continua funcionando normalmente sem o schema (o gate é
 *     só `schemaPedido?.safeParse` — `undefined?.` nunca lança).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ESTADO_INICIAL, montarPayloadPedido, type EstadoWizard } from "./estado";
import { schemaPayloadPedido } from "@/lib/validacoes/pedido";

const routerPush = vi.fn();
const toastError = vi.fn();
const criarPedidoMock = vi.fn();
const prepararAbaWhatsappMock = vi.fn();

vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
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

// Import DEPOIS dos vi.mock (hoisted). CRÍTICO: NÃO chamar
// `precarregarSchemaPedido` neste arquivo — é o próprio ponto do teste.
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

describe("useEnviarPedido — schema de preview AINDA NÃO carregado (163)", () => {
  const abaConcluir = vi.fn();

  beforeEach(() => {
    routerPush.mockClear();
    toastError.mockClear();
    abaConcluir.mockClear();
    criarPedidoMock.mockReset();
    prepararAbaWhatsappMock.mockReset();
    prepararAbaWhatsappMock.mockImplementation(() => ({ concluir: abaConcluir }));
  });

  it("payload que o schema REJEITARIA (nome vazio): criarPedido recebe o payload CRU, sem gate local", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: null,
    });

    const { enviar } = useMontarHook(true, { ...estadoValido(), nome: "" });
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(criarPedidoMock).toHaveBeenCalledTimes(1);
    const payloadEnviado = criarPedidoMock.mock.calls[0][0] as { nome_cliente: string };
    // Nenhum gate local rodou: o campo inválido (nome_cliente vazio) segue
    // intacto até a Server Action — é ELA quem tem que barrar.
    expect(payloadEnviado.nome_cliente).toBe("");
    // Sem gate local, nenhum toast de "confira os dados" é disparado no cliente.
    expect(toastError).not.toHaveBeenCalledWith(
      "Confira os dados do pedido (nome, endereço e itens).",
    );
  });

  it("payload que o schema REJEITARIA: prepararAbaWhatsapp RODA (flash de aba, não aba órfã)", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: null,
    });

    const { enviar } = useMontarHook(true, { ...estadoValido(), nome: "" });
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(prepararAbaWhatsappMock).toHaveBeenCalledTimes(1);
  });

  it("servidor rejeita o payload cru (nome_cliente vazio): aba pré-aberta é FECHADA por aba.concluir(null) — não fica órfã", async () => {
    // actions/pedido.ts faz o safeParse e devolve { erro } antes de qualquer I/O
    // — reproduzido aqui pelo mock, já que a Server Action real não roda no
    // teste unitário do hook.
    criarPedidoMock.mockResolvedValue({ erro: "Dados do pedido inválidos." });

    const { enviar } = useMontarHook(true, { ...estadoValido(), nome: "" });
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(prepararAbaWhatsappMock).toHaveBeenCalledTimes(1);
    expect(abaConcluir).toHaveBeenCalledWith(null);
    expect(routerPush).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Dados do pedido inválidos.");
  });

  it("payload VÁLIDO: envio funciona normalmente mesmo sem o schema carregado", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: "https://api.whatsapp.com/send?phone=5511999999999",
    });

    const { enviar } = useMontarHook(true);
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(criarPedidoMock).toHaveBeenCalledTimes(1);
    const payloadEnviado = criarPedidoMock.mock.calls[0][0] as { nome_cliente: string };
    expect(payloadEnviado.nome_cliente).toBe("Cliente Teste");
    expect(abaConcluir).toHaveBeenCalledWith(
      "https://api.whatsapp.com/send?phone=5511999999999",
    );
    expect(routerPush).toHaveBeenCalledWith(
      expect.stringContaining("/loja/loja-teste/confirmacao?pedido=p1&token=t1"),
    );
  });
});

/**
 * PARIDADE (163) — o payload cru que segue para o servidor quando o schema de
 * preview ainda não chegou precisa ser barrado/aceito por `schemaPayloadPedido`
 * EXATAMENTE como o payload que o cliente já mandava antes desta issue (schema
 * síncrono no bundle). O ponto: a issue 163 mudou QUANDO o schema chega no
 * cliente, nunca o CONTRATO da fronteira do servidor — nenhuma barreira foi
 * enfraquecida. Usa a mesma função `montarPayloadPedido` de
 * `estado.test.ts` (nenhum payload paralelo inventado aqui).
 */
describe("paridade (163): payload cru sem preview local vs. schema do servidor", () => {
  const LOJA_ID_PARIDADE = "33333333-3333-4333-8333-333333333333";
  const PRODUTO_ID_PARIDADE = "11111111-1111-4111-8111-111111111111";
  const IDEMPOTENCY = "44444444-4444-4444-8444-444444444444";

  it("payload de estado VÁLIDO: aceito pelo schema — igual antes e depois da 163 (nada mudou no contrato)", () => {
    const payload = montarPayloadPedido({
      lojaId: LOJA_ID_PARIDADE,
      itens: [{ produtoId: PRODUTO_ID_PARIDADE, quantidade: 2 }],
      estado: {
        ...ESTADO_INICIAL,
        nome: "Maria",
        tipoEntrega: "retirada",
        formaPagamento: "pix",
      },
      idempotencyKey: IDEMPOTENCY,
    });

    expect(schemaPayloadPedido.safeParse(payload).success).toBe(true);
  });

  it("payload de estado com nome vazio: REJEITADO pelo schema — o cliente sem preview local não teria barrado, mas o servidor barra do mesmo jeito de sempre", () => {
    const payload = montarPayloadPedido({
      lojaId: LOJA_ID_PARIDADE,
      itens: [{ produtoId: PRODUTO_ID_PARIDADE, quantidade: 2 }],
      estado: {
        ...ESTADO_INICIAL,
        nome: "", // o preview local rejeitaria isso; sem ele, chega cru aqui
        tipoEntrega: "retirada",
        formaPagamento: "pix",
      },
      idempotencyKey: IDEMPOTENCY,
    });

    const parsed = schemaPayloadPedido.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("payload de estado sem forma de pagamento (undefined): REJEITADO pelo schema — mesma barreira de antes", () => {
    const payload = montarPayloadPedido({
      lojaId: LOJA_ID_PARIDADE,
      itens: [{ produtoId: PRODUTO_ID_PARIDADE, quantidade: 1 }],
      estado: {
        ...ESTADO_INICIAL,
        nome: "Maria",
        tipoEntrega: "retirada",
        formaPagamento: null,
      },
      idempotencyKey: IDEMPOTENCY,
    });

    const parsed = schemaPayloadPedido.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("payload de estado 'entrega' sem endereço: REJEITADO pelo schema (refine condicional) — mesma barreira de antes", () => {
    const payload = montarPayloadPedido({
      lojaId: LOJA_ID_PARIDADE,
      itens: [{ produtoId: PRODUTO_ID_PARIDADE, quantidade: 1 }],
      estado: {
        ...ESTADO_INICIAL,
        nome: "Maria",
        tipoEntrega: "entrega",
        endereco: null,
        formaPagamento: "dinheiro",
      },
      idempotencyKey: IDEMPOTENCY,
    });

    const parsed = schemaPayloadPedido.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});
