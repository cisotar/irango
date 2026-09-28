// Issue 326, iteração 2 — funções PURAS da tela de faixas de entrega.
//
// Ambiente node (sem jsdom): nada é renderizado. Cobre o que a tela usa para
// montar o payload (`montarPayload`), para chamar a action (`enviarFaixas`) e
// para serializar o salvamento automático (`criarFilaGravacao`, C6). O gesto
// (blur, switch, diálogo) fica no checklist do usuário.
import { describe, expect, it, vi } from "vitest";

import {
  criarFilaGravacao,
  enviarFaixas,
  montarPayload,
  type EstadoGravacao,
  type FaixaEditavel,
} from "./TabelaFaixasEntrega";
import { MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA, type DadosFaixasEntrega } from "@/lib/validacoes/entrega";

const linha = (taxa: string, gratis: string | null = null, ativo = true): FaixaEditavel => ({
  taxa,
  gratis,
  ativo,
});

describe("montarPayload — estado da tela → payload da action", () => {
  it("faixas válidas ⇒ payload com taxa, grátis e ativo de cada faixa (valor sem máscara e com vírgula)", () => {
    const r = montarPayload(2, [linha("4"), linha("6.5", "80.00"), linha("7,25", null, false)]);

    expect(r).toEqual({
      ok: true,
      payload: {
        incremento: 2,
        faixas: [
          { taxa: 4, pedido_minimo_gratis: null, ativo: true },
          { taxa: 6.5, pedido_minimo_gratis: 80, ativo: true },
          { taxa: 7.25, pedido_minimo_gratis: null, ativo: false },
        ],
      },
    });
  });

  it("sem faixas ⇒ payload vazio válido (remover tudo grava lista vazia)", () => {
    expect(montarPayload(1, [])).toEqual({ ok: true, payload: { incremento: 1, faixas: [] } });
  });

  it("preço vazio ⇒ erro citando a faixa e o índice da linha (nada pela metade)", () => {
    const r = montarPayload(1, [linha("4"), linha("")]);

    expect(r).toEqual({ ok: false, erro: "Informe o preço da faixa de 1–2 km.", indice: 1 });
  });

  it("preço vazio numa faixa DESLIGADA também bloqueia (ela é gravada)", () => {
    const r = montarPayload(1, [linha("4"), linha("", null, false)]);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.indice).toBe(1);
  });

  it("preço inválido ⇒ erro na linha", () => {
    const r = montarPayload(2, [linha("abc")]);

    expect(r).toEqual({ ok: false, erro: "Informe o preço da faixa de 0–2 km.", indice: 0 });
  });

  it("frete grátis ligado e vazio ⇒ erro citando a faixa", () => {
    const r = montarPayload(1, [linha("4"), linha("5"), linha("6", "")]);

    expect(r).toEqual({
      ok: false,
      erro: "Informe o valor do frete grátis da faixa de 2–3 km ou desligue a opção.",
      indice: 2,
    });
  });

  it("preço com mais de 2 casas ⇒ erro do schema apontando o preço da faixa", () => {
    const r = montarPayload(1, [linha("4.555")]);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.indice).toBe(0);
      expect(r.erro).toContain("o preço da faixa de 0–1 km");
    }
  });

  it("ativa depois de desligada ⇒ mensagem do contrato na PRIMEIRA ativa depois do buraco", () => {
    const r = montarPayload(1, [linha("4"), linha("5", null, false), linha("6"), linha("7")]);

    expect(r).toEqual({ ok: false, erro: MENSAGEM_FAIXA_ATIVA_DEPOIS_DE_DESLIGADA, indice: 2 });
  });
});

const PAYLOAD: DadosFaixasEntrega = {
  incremento: 1,
  faixas: [
    { taxa: 4, pedido_minimo_gratis: null, ativo: true },
    { taxa: 6, pedido_minimo_gratis: 60, ativo: false },
  ],
};

describe("enviarFaixas — orquestração da gravação", () => {
  it("chama a action com o payload exato e, no sucesso, não mostra toast", async () => {
    const salvar = vi.fn().mockResolvedValue({ ok: true });
    const toast = { error: vi.fn() };

    const r = await enviarFaixas(PAYLOAD, { salvar, toast });

    expect(r).toEqual({ ok: true });
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(salvar).toHaveBeenCalledWith(PAYLOAD);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("erro da action ⇒ toast.error com a mensagem genérica que ela devolve", async () => {
    const salvar = vi.fn().mockResolvedValue({ ok: false, erro: "Não foi possível salvar as faixas de entrega." });
    const toast = { error: vi.fn() };

    const r = await enviarFaixas(PAYLOAD, { salvar, toast });

    expect(r).toEqual({ ok: false });
    expect(toast.error).toHaveBeenCalledWith("Não foi possível salvar as faixas de entrega.");
  });

  it("exceção (rede) ⇒ toast.error genérico, sem vazar a mensagem interna", async () => {
    const salvar = vi.fn().mockRejectedValue(new Error("fetch failed: ECONNRESET 10.0.0.1"));
    const toast = { error: vi.fn() };

    const r = await enviarFaixas(PAYLOAD, { salvar, toast });

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
