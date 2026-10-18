// Gravação das zonas pelas telas (issues 325/326/328) — módulo puro
// `gravacaoZonas.ts`, ambiente node (sem jsdom).
//
// `enviarZonas` e `criarFilaGravacao` vieram de `TabelaFaixasEntrega.test.ts`
// junto com o código (extração do P4); `criarGravadorComVersao` é novo: a
// versão otimista corrente e o corte de chamadas depois de um conflito. O gesto
// (blur, switch, diálogo, banner) fica no checklist de clique.
import { describe, expect, it, vi } from "vitest";

import {
  criarFilaGravacao,
  criarGravadorComVersao,
  enviarZonas,
  type EstadoGravacao,
} from "./gravacaoZonas";
import {
  MENSAGEM_CONFLITO_ZONAS,
  MENSAGEM_ERRO_ZONAS,
  type DadosFaixasEntrega,
  type DadosZonasEntrega,
  type DadosZonasSemVersao,
  type ResultadoZonas,
} from "@/lib/validacoes/entrega";

const PAYLOAD: DadosFaixasEntrega = {
  incremento: 1,
  faixas: [
    { taxa: 4, pedido_minimo_gratis: null, ativo: true },
    { taxa: 6, pedido_minimo_gratis: 60, ativo: false },
  ],
};

describe("enviarZonas — orquestração da gravação", () => {
  it("chama a action com o payload exato e, no sucesso, não mostra toast", async () => {
    const salvar = vi.fn().mockResolvedValue({ ok: true });
    const toast = { error: vi.fn() };

    const r = await enviarZonas(PAYLOAD, { salvar, toast });

    expect(r).toEqual({ ok: true });
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(salvar).toHaveBeenCalledWith(PAYLOAD);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("erro da action ⇒ toast.error com a mensagem genérica que ela devolve", async () => {
    const salvar = vi.fn().mockResolvedValue({ ok: false, erro: "Não foi possível salvar as faixas de entrega." });
    const toast = { error: vi.fn() };

    const r = await enviarZonas(PAYLOAD, { salvar, toast });

    expect(r).toEqual({ ok: false });
    expect(toast.error).toHaveBeenCalledWith("Não foi possível salvar as faixas de entrega.");
  });

  it("exceção (rede) ⇒ toast.error genérico, sem vazar a mensagem interna", async () => {
    const salvar = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNRESET 10.0.0.1"));
    const toast = { error: vi.fn() };

    const r = await enviarZonas(PAYLOAD, { salvar, toast });

    expect(r).toEqual({ ok: false });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).not.toContain("ECONNRESET");
  });
});

/** Promessa controlável: a gravação só termina quando o teste manda. */
function adiada<T>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}

describe("criarFilaGravacao — salvamento automático serializado (C6)", () => {
  function montar() {
    const chamadas: string[] = [];
    const pendentes: Array<ReturnType<typeof adiada<boolean>>> = [];
    let emVoo = 0;
    let maxEmVoo = 0;
    const estados: EstadoGravacao[] = [];
    const fila = criarFilaGravacao<string>(
      async (payload) => {
        chamadas.push(payload);
        emVoo += 1;
        maxEmVoo = Math.max(maxEmVoo, emVoo);
        const p = adiada<boolean>();
        pendentes.push(p);
        try {
          return await p.promessa;
        } finally {
          emVoo -= 1;
        }
      },
      (e) => estados.push(e),
    );
    return { fila, chamadas, pendentes, estados, maxEmVoo: () => maxEmVoo };
  }

  const tique = () => new Promise((r) => setTimeout(r, 0));

  it("duas gravações seguidas ⇒ uma em andamento; só o estado MAIS RECENTE é gravado depois", async () => {
    const { fila, chamadas, pendentes, estados, maxEmVoo } = montar();

    const fim = fila.gravar("a");
    void fila.gravar("b");
    void fila.gravar("c");
    await tique();

    expect(chamadas).toEqual(["a"]);

    pendentes[0].resolver(true);
    await tique();
    expect(chamadas).toEqual(["a", "c"]); // "b" foi superado por "c"

    pendentes[1].resolver(true);
    await fim;

    expect(chamadas).toEqual(["a", "c"]);
    expect(maxEmVoo()).toBe(1);
    expect(estados).toEqual(["salvando", "salvo"]);
  });

  it("gravação isolada ⇒ salvando → salvo; nova gravação depois começa outro ciclo", async () => {
    const { fila, chamadas, pendentes, estados } = montar();

    const primeira = fila.gravar("a");
    await tique();
    pendentes[0].resolver(true);
    await primeira;

    const segunda = fila.gravar("b");
    await tique();
    pendentes[1].resolver(true);
    await segunda;

    expect(chamadas).toEqual(["a", "b"]);
    expect(estados).toEqual(["salvando", "salvo", "salvando", "salvo"]);
  });

  it("estado final segue a ÚLTIMA gravação: falha depois de sucesso ⇒ erro", async () => {
    const { fila, pendentes, estados } = montar();

    const fim = fila.gravar("a");
    void fila.gravar("b");
    await tique();
    pendentes[0].resolver(true);
    await tique();
    pendentes[1].resolver(false);
    await fim;

    expect(estados).toEqual(["salvando", "erro"]);
  });

  it("exceção numa gravação não trava a fila: a pendente ainda é gravada", async () => {
    const { fila, chamadas, pendentes, estados } = montar();

    const fim = fila.gravar("a");
    void fila.gravar("b");
    await tique();
    pendentes[0].rejeitar(new Error("rede"));
    await tique();
    expect(chamadas).toEqual(["a", "b"]);
    pendentes[1].resolver(true);
    await fim;

    expect(estados).toEqual(["salvando", "salvo"]);
  });
});

describe("enviarZonas — conflito de versão", () => {
  it("conflito ⇒ { ok:false } SEM toast (o aviso de conflito da tela cobre)", async () => {
    const salvar = vi.fn().mockResolvedValue({ ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS });
    const toast = { error: vi.fn() };

    const r = await enviarZonas(PAYLOAD, { salvar, toast });

    expect(r).toEqual({ ok: false });
    expect(toast.error).not.toHaveBeenCalled();
  });
});

const DADOS_KM: DadosZonasSemVersao = { forma: "raio_km", ...PAYLOAD };
const DADOS_CEP: DadosZonasSemVersao = {
  forma: "faixa_cep",
  faixas: [{ cep_inicio: 1000000, cep_fim: 1999999, taxa: 5, pedido_minimo_gratis: null, ativo: true }],
};

describe("criarGravadorComVersao — versão otimista entre gravações (328)", () => {
  function montar(respostas: Array<ResultadoZonas | Error>, versaoInicial = 3) {
    const enviados: DadosZonasEntrega[] = [];
    const aoConflito = vi.fn();
    const acao = vi.fn(async (p: DadosZonasEntrega): Promise<ResultadoZonas> => {
      enviados.push(p);
      const r = respostas.shift();
      if (r === undefined) throw new Error("resposta não programada");
      if (r instanceof Error) throw r;
      return r;
    });
    const gravador = criarGravadorComVersao({ acao, versaoInicial, aoConflito });
    return { gravador, acao, enviados, aoConflito };
  }

  it("manda os dados com a versão inicial e, no ok, a versão vira a devolvida", async () => {
    const { gravador, enviados } = montar([{ ok: true, versao: 4 }]);

    const r = await gravador.salvar(DADOS_KM);

    expect(r).toEqual({ ok: true, versao: 4 });
    expect(enviados).toEqual([{ ...DADOS_KM, versao: 3 }]);
    expect(gravador.versaoAtual()).toBe(4);
  });

  it("a próxima gravação usa a versão nova (inclusive trocando de forma)", async () => {
    const { gravador, enviados } = montar([
      { ok: true, versao: 4 },
      { ok: true, versao: 5 },
    ]);

    await gravador.salvar(DADOS_KM);
    await gravador.salvar(DADOS_CEP);

    expect(enviados.map((e) => e.versao)).toEqual([3, 4]);
    expect(enviados[1]).toEqual({ ...DADOS_CEP, versao: 4 });
    expect(gravador.versaoAtual()).toBe(5);
  });

  it("erro comum (sem conflito) não muda a versão nem chama aoConflito; a seguinte ainda chama a action", async () => {
    const { gravador, acao, enviados, aoConflito } = montar([
      { ok: false, erro: MENSAGEM_ERRO_ZONAS },
      { ok: true, versao: 4 },
    ]);

    await gravador.salvar(DADOS_KM);
    await gravador.salvar(DADOS_KM);

    expect(acao).toHaveBeenCalledTimes(2);
    expect(enviados.map((e) => e.versao)).toEqual([3, 3]);
    expect(aoConflito).not.toHaveBeenCalled();
  });

  it("conflito ⇒ aoConflito UMA vez; as gravações seguintes devolvem conflito SEM chamar a action", async () => {
    const { gravador, acao, aoConflito } = montar([
      { ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS },
    ]);

    const primeira = await gravador.salvar(DADOS_KM);
    const segunda = await gravador.salvar(DADOS_KM);
    const terceira = await gravador.salvar(DADOS_CEP);

    expect(primeira).toEqual({ ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS });
    expect(segunda).toEqual({ ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS });
    expect(terceira).toEqual({ ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS });
    expect(acao).toHaveBeenCalledTimes(1);
    expect(aoConflito).toHaveBeenCalledTimes(1);
    expect(gravador.versaoAtual()).toBe(3);
  });

  it("duas gravações disparadas em sequência sem await usam versões v e v+1, sem conflito", async () => {
    // Os três editores compartilham o gravador e cada um tem a própria fila:
    // um blur no km e outro no CEP podem chegar juntos. Sem fila no gravador,
    // as duas sairiam com a versão 3 e a segunda daria conflito falso.
    const { gravador, enviados, aoConflito } = montar([
      { ok: true, versao: 4 },
      { ok: true, versao: 5 },
    ]);

    const primeira = gravador.salvar(DADOS_KM);
    const segunda = gravador.salvar(DADOS_CEP);
    const resultados = await Promise.all([primeira, segunda]);

    expect(enviados.map((e) => e.versao)).toEqual([3, 4]);
    expect(resultados).toEqual([
      { ok: true, versao: 4 },
      { ok: true, versao: 5 },
    ]);
    expect(aoConflito).not.toHaveBeenCalled();
    expect(gravador.versaoAtual()).toBe(5);
  });

  it("gravação enfileirada atrás de uma exceção sai com a mesma versão (a fila não trava)", async () => {
    const { gravador, enviados } = montar([new Error("fetch failed"), { ok: true, versao: 4 }]);

    const primeira = gravador.salvar(DADOS_KM);
    const segunda = gravador.salvar(DADOS_CEP);

    await expect(primeira).rejects.toThrow("fetch failed");
    await expect(segunda).resolves.toEqual({ ok: true, versao: 4 });
    expect(enviados.map((e) => e.versao)).toEqual([3, 3]);
  });

  it("exceção propaga e não muda a versão; a próxima gravação sai com a mesma versão", async () => {
    const { gravador, enviados } = montar([new Error("fetch failed"), { ok: true, versao: 4 }]);

    await expect(gravador.salvar(DADOS_KM)).rejects.toThrow("fetch failed");
    expect(gravador.versaoAtual()).toBe(3);

    await gravador.salvar(DADOS_KM);
    expect(enviados.map((e) => e.versao)).toEqual([3, 3]);
    expect(gravador.versaoAtual()).toBe(4);
  });
});

// Fluxo da tela: enviarZonas em cima do gravador com versão (como o editor faz).
describe("enviarZonas + criarGravadorComVersao — conflito e erro até o toast", () => {
  function tela(respostas: Array<ResultadoZonas | Error>, versaoInicial = 7) {
    const enviados: DadosZonasEntrega[] = [];
    const aoConflito = vi.fn();
    const toast = { error: vi.fn() };
    const acao = vi.fn(async (p: DadosZonasEntrega): Promise<ResultadoZonas> => {
      enviados.push(p);
      const r = respostas.shift();
      if (r === undefined) throw new Error("resposta não programada");
      if (r instanceof Error) throw r;
      return r;
    });
    const gravador = criarGravadorComVersao({ acao, versaoInicial, aoConflito });
    const gravar = (d: DadosZonasSemVersao) => enviarZonas(d, { salvar: (x) => gravador.salvar(x), toast });
    return { gravar, gravador, acao, enviados, aoConflito, toast };
  }

  it("conflito ⇒ aoConflito 1x, nenhum toast; blurs seguintes não batem na action nem avisam de novo", async () => {
    const t = tela([{ ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS }]);

    expect(await t.gravar(DADOS_KM)).toEqual({ ok: false });
    expect(await t.gravar(DADOS_CEP)).toEqual({ ok: false });
    expect(await t.gravar(DADOS_KM)).toEqual({ ok: false });

    expect(t.aoConflito).toHaveBeenCalledTimes(1);
    expect(t.acao).toHaveBeenCalledTimes(1);
    expect(t.toast.error).not.toHaveBeenCalled();
    expect(t.gravador.versaoAtual()).toBe(7);
  });

  it("erro genérico da action ⇒ toast com MENSAGEM_ERRO_ZONAS, versão intacta, sem aoConflito", async () => {
    const t = tela([{ ok: false, erro: MENSAGEM_ERRO_ZONAS }]);

    expect(await t.gravar(DADOS_KM)).toEqual({ ok: false });

    expect(t.toast.error).toHaveBeenCalledTimes(1);
    expect(t.toast.error).toHaveBeenCalledWith(MENSAGEM_ERRO_ZONAS);
    expect(t.aoConflito).not.toHaveBeenCalled();
    expect(t.gravador.versaoAtual()).toBe(7);
  });

  it("exceção da action ⇒ toast genérico, sem aoConflito, e a gravação seguinte ainda sai com a mesma versão", async () => {
    const t = tela([new Error("ECONNRESET 10.0.0.1"), { ok: true, versao: 8 }]);

    expect(await t.gravar(DADOS_KM)).toEqual({ ok: false });
    expect(t.toast.error).toHaveBeenCalledWith(MENSAGEM_ERRO_ZONAS);
    expect(JSON.stringify(t.toast.error.mock.calls)).not.toContain("ECONNRESET");

    expect(await t.gravar(DADOS_KM)).toEqual({ ok: true });
    expect(t.enviados.map((e) => e.versao)).toEqual([7, 7]);
    expect(t.gravador.versaoAtual()).toBe(8);
  });

  it("sucesso atualiza a versão e é silencioso; erro depois dele usa a versão nova", async () => {
    const t = tela([
      { ok: true, versao: 8 },
      { ok: false, erro: MENSAGEM_ERRO_ZONAS },
    ]);

    await t.gravar(DADOS_KM);
    await t.gravar(DADOS_CEP);

    expect(t.enviados.map((e) => e.versao)).toEqual([7, 8]);
    expect(t.toast.error).toHaveBeenCalledTimes(1);
    expect(t.gravador.versaoAtual()).toBe(8);
  });

  it("duas gravações simultâneas, a 1ª em conflito ⇒ a 2ª NÃO chama a action e aoConflito é 1x", async () => {
    const t = tela([{ ok: false, conflito: true, erro: MENSAGEM_CONFLITO_ZONAS }]);

    const [a, b] = await Promise.all([t.gravar(DADOS_KM), t.gravar(DADOS_CEP)]);

    expect(a).toEqual({ ok: false });
    expect(b).toEqual({ ok: false });
    expect(t.acao).toHaveBeenCalledTimes(1);
    expect(t.aoConflito).toHaveBeenCalledTimes(1);
    expect(t.toast.error).not.toHaveBeenCalled();
  });
});
