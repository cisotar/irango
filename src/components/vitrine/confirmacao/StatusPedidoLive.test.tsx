/**
 * Testes do StatusPedidoLive (issue 131).
 *
 * Ambiente: vitest environment=node — sem jsdom. Por isso a MECÂNICA de polling
 * (8s, backoff 8→16→30, timeout 5s via Promise.race, pausa por visibilidade,
 * parada terminal, cleanup) é exercitada no controlador `criarControladorPolling`
 * — framework-agnóstico e testável com `vi.useFakeTimers()` sem montar React. O
 * SHELL visual (Card + região viva sr-only + região da trilha + ausência do
 * aviso de erro no mount) é conferido via `renderToStaticMarkup`, padrão dos
 * demais testes de componente do projeto (HeaderLoja/FormEndereco).
 *
 * A Server Action é mockada — o contrato de segurança dela (posse do token,
 * anti-enumeração) tem cobertura própria na issue 128; aqui só provamos como o
 * cliente REAGE ao resultado autoritativo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  StatusPedidoLive,
  criarControladorPolling,
  comTimeout,
  limparCarrinhoSessionStorage,
  type DepsPolling,
} from "@/components/vitrine/confirmacao/StatusPedidoLive";
import type { ResultadoStatusPedido } from "@/lib/actions/consultarStatusPedido";

// A action real importa módulos server-only (service client, next/headers). O
// componente só precisa dela como referência importável no render estático.
vi.mock("@/lib/actions/consultarStatusPedido", () => ({
  consultarStatusPedido: vi.fn(),
}));

const PEDIDO_ID = "11111111-1111-1111-1111-111111111111";
const TOKEN = "22222222-2222-2222-2222-222222222222";

function encontrado(status: string): ResultadoStatusPedido {
  return { encontrado: true, status: status as never, tipo_entrega: "entrega" };
}

/** Fábrica de deps com espiões e visibilidade controlável. */
function criarDeps(
  consultar: DepsPolling["consultar"],
  visivelInicial = true,
) {
  const estado = { visivel: visivelInicial };
  const aoAtualizar = vi.fn();
  const aoErro = vi.fn();
  const deps: DepsPolling = {
    consultar,
    aoAtualizar,
    aoErro,
    estaVisivel: () => estado.visivel,
  };
  return { deps, aoAtualizar, aoErro, estado };
}

// ---------------------------------------------------------------------------
// limparCarrinhoSessionStorage
// ---------------------------------------------------------------------------

describe("limparCarrinhoSessionStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remove as duas chaves do sessionStorage", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("window", { sessionStorage: { removeItem } });

    limparCarrinhoSessionStorage();

    expect(removeItem).toHaveBeenCalledWith("irango:carrinho");
    expect(removeItem).toHaveBeenCalledWith("irango:checkout");
  });

  it("engole erro de sessionStorage indisponível (modo restrito)", () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        removeItem: () => {
          throw new Error("bloqueado");
        },
      },
    });
    expect(() => limparCarrinhoSessionStorage()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// comTimeout (Promise.race)
// ---------------------------------------------------------------------------

describe("comTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolve com o valor se a promessa vence o timer", async () => {
    const p = comTimeout(Promise.resolve("ok"), 5000);
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toBe("ok");
  });

  it("rejeita se o timer vence a promessa (timeout)", async () => {
    const nunca = new Promise<string>(() => {});
    const p = comTimeout(nunca, 5000);
    const assercao = expect(p).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(5000);
    await assercao;
  });
});

// ---------------------------------------------------------------------------
// criarControladorPolling — mecânica
// ---------------------------------------------------------------------------

describe("criarControladorPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("statusInicial terminal → zero requisições", async () => {
    const consultar = vi.fn();
    const { deps } = criarDeps(consultar as never);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("entregue");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(consultar).not.toHaveBeenCalled();
    c.parar();
  });

  it("não-terminal → chama a action após 8s e repassa (pedidoId, token)", async () => {
    const consultar = vi.fn().mockResolvedValue(encontrado("confirmado"));
    const { deps, aoAtualizar } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente");
    expect(consultar).not.toHaveBeenCalled(); // sem chamada imediata no mount

    await vi.advanceTimersByTimeAsync(8_000);

    expect(consultar).toHaveBeenCalledExactlyOnceWith(PEDIDO_ID, TOKEN);
    expect(aoAtualizar).toHaveBeenCalledWith("confirmado", "entrega");
    c.parar();
  });

  it("sucesso não-terminal reagenda em 8s (novo poll no próximo ciclo)", async () => {
    const consultar = vi.fn().mockResolvedValue(encontrado("confirmado"));
    const { deps } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(consultar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(consultar).toHaveBeenCalledTimes(2);
    c.parar();
  });

  it("ao receber status terminal → nenhum poll adicional", async () => {
    const consultar = vi.fn().mockResolvedValue(encontrado("entregue"));
    const { deps, aoAtualizar } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("saiu_entrega");
    await vi.advanceTimersByTimeAsync(8_000);
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(aoAtualizar).toHaveBeenCalledWith("entregue", "entrega");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(consultar).toHaveBeenCalledTimes(1); // parada dura
    c.parar();
  });

  it("{ encontrado: false } → erro de UX, mantém ciclo com backoff 8→16→30", async () => {
    const consultar = vi.fn().mockResolvedValue({ encontrado: false });
    const { deps, aoErro, aoAtualizar } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente");

    await vi.advanceTimersByTimeAsync(8_000); // 1º poll → erro
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(aoErro).toHaveBeenLastCalledWith(true);
    expect(aoAtualizar).not.toHaveBeenCalled(); // NÃO adianta/limpa status

    await vi.advanceTimersByTimeAsync(15_999);
    expect(consultar).toHaveBeenCalledTimes(1); // ainda dentro dos 16s
    await vi.advanceTimersByTimeAsync(1);
    expect(consultar).toHaveBeenCalledTimes(2); // backoff = 16s

    await vi.advanceTimersByTimeAsync(29_999);
    expect(consultar).toHaveBeenCalledTimes(2); // ainda dentro dos 30s
    await vi.advanceTimersByTimeAsync(1);
    expect(consultar).toHaveBeenCalledTimes(3); // backoff = 30s (teto)

    await vi.advanceTimersByTimeAsync(30_000);
    expect(consultar).toHaveBeenCalledTimes(4); // teto mantido
    c.parar();
  });

  it("sucesso após erro reseta o backoff para 8s", async () => {
    const consultar = vi
      .fn()
      .mockResolvedValueOnce({ encontrado: false })
      .mockResolvedValue(encontrado("confirmado"));
    const { deps, aoErro } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente");
    await vi.advanceTimersByTimeAsync(8_000); // erro → backoff 16s
    await vi.advanceTimersByTimeAsync(16_000); // sucesso → reseta p/ 8s
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(aoErro).toHaveBeenLastCalledWith(false);

    await vi.advanceTimersByTimeAsync(8_000); // já voltou a 8s
    expect(consultar).toHaveBeenCalledTimes(3);
    c.parar();
  });

  it("timeout de 5s (Promise.race) conta como erro → backoff", async () => {
    const consultar = vi.fn().mockReturnValue(new Promise<never>(() => {}));
    const { deps, aoErro } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente");
    await vi.advanceTimersByTimeAsync(8_000); // dispara poll (nunca resolve)
    expect(aoErro).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000); // timeout → erro
    expect(aoErro).toHaveBeenLastCalledWith(true);
    c.parar();
  });

  it("aba oculta não agenda poll; ficar visível dispara poll imediato", async () => {
    const consultar = vi.fn().mockResolvedValue(encontrado("confirmado"));
    const { deps, estado } = criarDeps(consultar, /* visivelInicial */ false);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(consultar).not.toHaveBeenCalled(); // oculta → sem poll

    estado.visivel = true;
    c.aoFicarVisivel();
    await vi.advanceTimersByTimeAsync(0); // poll imediato, sem esperar 8s
    expect(consultar).toHaveBeenCalledTimes(1);
    c.parar();
  });

  it("ficar oculto pausa o agendamento pendente", async () => {
    const consultar = vi.fn().mockResolvedValue(encontrado("confirmado"));
    const { deps, estado } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente"); // agendado p/ 8s
    estado.visivel = false;
    c.aoFicarOculto(); // cancela o timer pendente
    await vi.advanceTimersByTimeAsync(60_000);
    expect(consultar).not.toHaveBeenCalled();
    c.parar();
  });

  it("parar() impede novos ticks e não chama callbacks após unmount", async () => {
    let resolver!: (v: ResultadoStatusPedido) => void;
    const consultar = vi.fn().mockReturnValue(
      new Promise<ResultadoStatusPedido>((res) => {
        resolver = res;
      }),
    );
    const { deps, aoAtualizar } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente");
    await vi.advanceTimersByTimeAsync(8_000); // poll em voo
    c.parar(); // unmount enquanto a request está solta
    resolver(encontrado("confirmado")); // resolve após parar
    await vi.advanceTimersByTimeAsync(0);

    expect(aoAtualizar).not.toHaveBeenCalled(); // sem setState pós-unmount
    await vi.advanceTimersByTimeAsync(60_000);
    expect(consultar).toHaveBeenCalledTimes(1); // nenhum novo agendamento
  });

  it("erro seguido de sucesso terminal → limpa o aviso de erro e para o polling (sem reagendar)", async () => {
    const consultar = vi
      .fn()
      .mockResolvedValueOnce({ encontrado: false }) // 1º poll: erro
      .mockResolvedValue(encontrado("entregue")); // 2º poll: sucesso terminal
    const { deps, aoErro, aoAtualizar } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("saiu_entrega");
    await vi.advanceTimersByTimeAsync(8_000); // erro → backoff 16s
    expect(aoErro).toHaveBeenLastCalledWith(true);

    await vi.advanceTimersByTimeAsync(16_000); // sucesso terminal
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(aoErro).toHaveBeenLastCalledWith(false); // aviso de erro limpo
    expect(aoAtualizar).toHaveBeenCalledWith("entregue", "entrega");

    await vi.advanceTimersByTimeAsync(60_000); // parada dura — sem 3º poll
    expect(consultar).toHaveBeenCalledTimes(2);
    c.parar();
  });

  it("aba oculta durante request em voo → resolve mas não reagenda; volta a agendar só ao ficar visível", async () => {
    let resolver!: (v: ResultadoStatusPedido) => void;
    const consultar = vi.fn().mockReturnValue(
      new Promise<ResultadoStatusPedido>((res) => {
        resolver = res;
      }),
    );
    const { deps, estado, aoAtualizar } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente");
    await vi.advanceTimersByTimeAsync(8_000); // dispara o poll — request em voo
    expect(consultar).toHaveBeenCalledTimes(1);

    // Aba fica oculta ENQUANTO a resposta ainda não chegou.
    estado.visivel = false;
    c.aoFicarOculto();

    // Resposta chega com sucesso não-terminal, mas a aba segue oculta.
    resolver(encontrado("confirmado"));
    await vi.advanceTimersByTimeAsync(0);
    expect(aoAtualizar).toHaveBeenCalledWith("confirmado", "entrega"); // estado atualiza normalmente

    await vi.advanceTimersByTimeAsync(60_000);
    expect(consultar).toHaveBeenCalledTimes(1); // NÃO reagenda — aba oculta

    // Volta a ficar visível → retoma com poll imediato.
    estado.visivel = true;
    c.aoFicarVisivel();
    await vi.advanceTimersByTimeAsync(0);
    expect(consultar).toHaveBeenCalledTimes(2);
    c.parar();
  });

  it("parar() chamado duas vezes é idempotente — não lança e não reagenda", async () => {
    const consultar = vi.fn().mockResolvedValue(encontrado("confirmado"));
    const { deps, estado } = criarDeps(consultar);
    const c = criarControladorPolling(PEDIDO_ID, TOKEN, deps);

    c.iniciar("pendente");
    c.parar();

    expect(() => c.parar()).not.toThrow();

    // Chamadas de ciclo de vida após parar() não devem reviver o polling.
    estado.visivel = true;
    expect(() => c.aoFicarVisivel()).not.toThrow();
    expect(() => c.aoFicarOculto()).not.toThrow();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(consultar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// StatusPedidoLive — shell estático (render server, sem efeitos)
// ---------------------------------------------------------------------------

describe("StatusPedidoLive (shell)", () => {
  it("renderiza o Card com título de seção e a região da trilha", () => {
    const html = renderToStaticMarkup(
      <StatusPedidoLive
        pedidoId={PEDIDO_ID}
        token={TOKEN}
        statusInicial="em_preparo"
        tipoEntrega="entrega"
      />,
    );

    expect(html).toContain("Acompanhe seu pedido");
    expect(html).toContain('aria-label="Acompanhamento do pedido"');
    // Anunciador conciso sr-only com o título do status (não a trilha inteira).
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Em preparo");
  });

  it("no mount não mostra o aviso de erro de rede", () => {
    const html = renderToStaticMarkup(
      <StatusPedidoLive
        pedidoId={PEDIDO_ID}
        token={TOKEN}
        statusInicial="pendente"
        tipoEntrega={null}
      />,
    );
    expect(html).not.toContain("tentando de novo");
  });
});
