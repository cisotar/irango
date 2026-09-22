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
 *  2. [287] NENHUMA aba é pré-aberta — nem no estado degradado. A mecânica
 *     anti-popup (RN-A5) foi aposentada: o aviso vive na confirmação e navega
 *     em top-level. O que antes era "flash de aba, não aba órfã" vira agora
 *     "nenhuma aba, em caminho nenhum".
 *  3. Payload válido continua funcionando normalmente sem o schema (o gate é
 *     só `schemaPedido?.safeParse` — `undefined?.` nunca lança).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ESTADO_INICIAL, montarPayloadPedido, type EstadoWizard } from "./estado";
import { schemaPayloadPedido } from "@/lib/validacoes/pedido";

const routerPush = vi.fn();
const toastError = vi.fn();
const criarPedidoMock = vi.fn();

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

// Import DEPOIS dos vi.mock (hoisted). CRÍTICO: NÃO chamar
// `precarregarSchemaPedido` neste arquivo — é o próprio ponto do teste.
// CRÍTICO 2 [287]: a janela falsa é instalada só DEPOIS deste import. Instalada
// antes, o bloco `typeof window !== "undefined"` do módulo agendaria a pré-carga
// do schema — justamente o estado que este arquivo precisa NÃO ter.
const { useEnviarPedido } = await import("./useEnviarPedido");

const LOJA_ID = "0d1e2f30-0000-4000-8000-000000000001";
const PRODUTO_ID = "0d1e2f30-0000-4000-8000-000000000002";

/** Destino fictício (sem PII, sem número real) só para o mock da action. */
const HREF_DO_SERVIDOR = "https://wa.me/5500000000000?text=Novo%20pedido";

/** Detector de pré-abertura: qualquer `window.open` do checkout registra aqui. */
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
 * [287] A prop legada da pré-abertura já saiu do tipo do hook (fase GREEN):
 * quem prova que o checkout não abre nem navega janela é o detector de janela
 * falsa instalado em cada caso.
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

describe("useEnviarPedido — schema de preview AINDA NÃO carregado (163)", () => {
  let janela: ReturnType<typeof instalarJanelaFalsa>;

  beforeEach(() => {
    routerPush.mockClear();
    toastError.mockClear();
    criarPedidoMock.mockReset();
    janela = instalarJanelaFalsa();
  });

  afterEach(() => {
    removerJanelaFalsa();
  });

  it("payload que o schema REJEITARIA (nome vazio): criarPedido recebe o payload CRU, sem gate local", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: null,
    });

    const { enviar } = useMontarHook({ ...estadoValido(), nome: "" });
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

  it("[287] payload que o schema REJEITARIA: NENHUMA aba é pré-aberta (a mecânica saiu do checkout)", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: null,
    });

    const { enviar } = useMontarHook({ ...estadoValido(), nome: "" });
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(janela.open).not.toHaveBeenCalled();
  });

  it("[287] servidor rejeita o payload cru: sem push, com aviso ao cliente e sem nenhuma aba para fechar", async () => {
    // actions/pedido.ts faz o safeParse e devolve { erro } antes de qualquer I/O
    // — reproduzido aqui pelo mock, já que a Server Action real não roda no
    // teste unitário do hook.
    criarPedidoMock.mockResolvedValue({ erro: "Dados do pedido inválidos." });

    const { enviar } = useMontarHook({ ...estadoValido(), nome: "" });
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(janela.open).not.toHaveBeenCalled();
    expect(janela.aba.close).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Dados do pedido inválidos.");
  });

  it("[287] payload VÁLIDO: envio funciona sem o schema E sem abrir/navegar aba nenhuma", async () => {
    criarPedidoMock.mockResolvedValue({
      pedidoId: "p1",
      token_acesso: "t1",
      whatsappHref: HREF_DO_SERVIDOR,
    });

    const { enviar } = useMontarHook();
    enviar();
    await new Promise((r) => setTimeout(r, 0));

    expect(criarPedidoMock).toHaveBeenCalledTimes(1);
    const payloadEnviado = criarPedidoMock.mock.calls[0][0] as { nome_cliente: string };
    expect(payloadEnviado.nome_cliente).toBe("Cliente Teste");
    expect(janela.open).not.toHaveBeenCalled();
    expect(janela.aba.location.href).toBe("");
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
