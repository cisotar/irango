/**
 * [287] Fase RED — decisão e contagem do aviso de envio da mensagem no
 * WhatsApp, na página de confirmação.
 *
 * `environment: node`, sem jsdom: storage e timer entram por PARÂMETRO
 * (padrão de `decisaoModalPromocoes.test.ts` e de `criarControladorPolling`
 * em `StatusPedidoLive.test.tsx`). Nenhum `window` é tocado aqui.
 *
 * Invariantes travadas neste arquivo:
 *  1. QUANDO o aviso aparece — e, principalmente, quando NÃO aparece.
 *  2. Uma vez por pedido: a chave `aviso-wpp:<pedidoId>` no storage injetado.
 *  3. Guard §15 (`seguranca.md`): só `https://` navega. O teste REUSA
 *     `urlHttpsSegura` — o predicado não é reimplementado aqui, senão os dois
 *     lados poderiam divergir sem ninguém perceber.
 *  4. A saída PARA a contagem de verdade: depois dela, nenhum tick posterior
 *     navega. Sem este caso, "saída" vira "adiamento de 5s".
 *  5. [aviso-wpp-nova-aba] Contagem esgotada TENTA ABA NOVA primeiro; o
 *     desfecho segue a tabela F1 (`podeNavegarTopLevel` × resultado). No
 *     computador (`podeNavegarTopLevel=false`) a aba da confirmação nunca
 *     troca sem gesto. O gesto saiu do módulo (é o `<a target="_blank">`).
 *
 * O `destino`/`href` NUNCA é logado (precedente [161]) — nem aqui nem no
 * módulo. E nenhum número real de WhatsApp aparece nos fixtures.
 */
import { describe, it, expect, vi } from "vitest";

import { urlHttpsSegura } from "@/lib/utils/urlHttpsSegura";
import {
  SEGUNDOS_AVISO_WHATSAPP,
  chaveAvisoWhatsapp,
  criarContagemAviso,
  decidirAvisoWhatsapp,
  decidirEMarcarAvisoUmaVez,
  jaExibiuAvisoWhatsapp,
  marcarAvisoWhatsappExibido,
  type DepsContagemAviso,
  type EntradaDecisaoAviso,
  type MemoDecisaoAviso,
  type ResultadoAbertura,
} from "./avisoWhatsapp";

const PEDIDO_ID = "11111111-1111-1111-1111-111111111111";
const OUTRO_PEDIDO_ID = "22222222-2222-2222-2222-222222222222";

/** Destino válido — número fictício, sem PII e sem dado de loja real. */
const HREF_VALIDO = "https://wa.me/5500000000000?text=Novo%20pedido%20iRango";

/**
 * Destinos que o guard §15 reprova. Nenhum deles pode navegar, nunca.
 *
 * A tabela HERDA os casos hostis já cobertos em `aberturaWhatsapp.test.ts`
 * (caixa trocada, espaço/tab/quebra antes do esquema, NUL à frente, esquema
 * malformado): o ponto de aplicação do guard muda de arquivo nesta issue, e a
 * cobertura não pode encolher na mudança.
 */
const HREFS_REPROVADOS: ReadonlyArray<string | null> = [
  null,
  "",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "\tjavascript:alert(1)",
  "\njavascript:alert(1)",
  "vbscript:msgbox(1)",
  "data:text/html,<script>alert(1)</script>",
  "http://wa.me/5500000000000",
  "//wa.me/5500000000000",
  "whatsapp://send?phone=5500000000000",
  "HTTPS://wa.me/5500000000000",
  "https:/wa.me/5500000000000",
  "\u0000https://wa.me/5500000000000",
];

// ---------------------------------------------------------------------------
// Fakes injetáveis
// ---------------------------------------------------------------------------

/** Storage falso mínimo — só o par get/set que o módulo usa. */
function storageFake(inicial: Record<string, string> = {}): Storage {
  const mapa = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
    clear: () => mapa.clear(),
    key: (i: number) => [...mapa.keys()][i] ?? null,
    get length() {
      return mapa.size;
    },
  } as Storage;
}

/** Aba privativa / storage bloqueado por política: o acesso LANÇA. */
function storageQueLanca(): Storage {
  return {
    getItem: () => {
      throw new DOMException("SecurityError");
    },
    setItem: () => {
      throw new DOMException("QuotaExceededError");
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

/**
 * Timer falso controlado pelo teste — nada de `setTimeout` real, nada de
 * `vi.useFakeTimers()`: o módulo recebe `agendar`/`limpar` e o teste decide
 * quando o tempo passa. `agendar` é one-shot; a contagem se reagenda.
 */
function timerFake() {
  const pendentes = new Map<number, () => void>();
  let proximoId = 1;
  const timer = {
    agendar(callback: () => void, _ms: number) {
      const id = proximoId++;
      pendentes.set(id, callback);
      return id;
    },
    limpar(id: number) {
      pendentes.delete(id);
    },
  };
  /** Avança `vezes` ticks: cada tick dispara o que estiver agendado. */
  function tick(vezes = 1): void {
    for (let i = 0; i < vezes; i++) {
      const callbacks = [...pendentes.values()];
      pendentes.clear();
      for (const cb of callbacks) cb();
    }
  }
  return { timer, tick, pendentes };
}

/**
 * Monta a contagem com todos os efeitos como `vi.fn`. Por default o navegador
 * "deixa" a aba nova abrir (`"aberta"`) e o dispositivo é de toque
 * (`podeNavegarTopLevel: true`); cada caso sobrescreve só o que prova.
 */
function montarContagem(
  href: string | null,
  {
    resultado = "aberta",
    ...overrides
  }: Partial<DepsContagemAviso> & { resultado?: ResultadoAbertura } = {},
) {
  const { timer, tick, pendentes } = timerFake();
  const tentarAbrirNovaAba = vi.fn(
    (_destino: string): ResultadoAbertura => resultado,
  );
  const navegarTopLevel = vi.fn();
  const aoEsgotar = vi.fn();
  const aoContar = vi.fn();
  const deps: DepsContagemAviso = {
    href,
    timer,
    tentarAbrirNovaAba,
    navegarTopLevel,
    podeNavegarTopLevel: true,
    aoEsgotar,
    aoContar,
    ...overrides,
  };
  return {
    contagem: criarContagemAviso(deps),
    tick,
    pendentes,
    tentarAbrirNovaAba,
    navegarTopLevel,
    aoEsgotar,
    aoContar,
  };
}


// ---------------------------------------------------------------------------
// 1. Quando o aviso aparece — e quando NÃO aparece
// ---------------------------------------------------------------------------

/** Entrada em que TUDO permite exibir — cada caso estraga um campo só. */
const EXIBE: EntradaDecisaoAviso = {
  avisoHabilitado: true,
  href: HREF_VALIDO,
  jaExibido: false,
};

describe("[287] decidirAvisoWhatsapp — exibição do aviso", () => {
  it("exibe com toggle ligado + href https + ainda não exibido neste pedido", () => {
    expect(decidirAvisoWhatsapp(EXIBE)).toBe(true);
  });

  it("toggle do lojista desligado ⇒ NÃO exibe", () => {
    expect(decidirAvisoWhatsapp({ ...EXIBE, avisoHabilitado: false })).toBe(
      false,
    );
  });

  it("href null (loja sem WhatsApp) ⇒ NÃO exibe", () => {
    expect(decidirAvisoWhatsapp({ ...EXIBE, href: null })).toBe(false);
  });

  it("já exibido para este pedido ⇒ NÃO exibe de novo (uma vez por pedido)", () => {
    expect(decidirAvisoWhatsapp({ ...EXIBE, jaExibido: true })).toBe(false);
  });

  it("href reprovado pelo guard §15 ⇒ NÃO exibe (paridade com urlHttpsSegura, não reimplementação)", () => {
    for (const href of HREFS_REPROVADOS) {
      expect(urlHttpsSegura(href)).toBeNull(); // sanidade do fixture
      expect(decidirAvisoWhatsapp({ ...EXIBE, href })).toBe(false);
    }
  });

  it("a decisão acompanha urlHttpsSegura em toda a tabela de destinos", () => {
    const tabela: ReadonlyArray<string | null> = [
      HREF_VALIDO,
      "https://wa.me/5500000000000",
      ...HREFS_REPROVADOS,
    ];
    for (const href of tabela) {
      expect(decidirAvisoWhatsapp({ ...EXIBE, href })).toBe(
        urlHttpsSegura(href) !== null,
      );
    }
  });

  it("toggle desligado vence todas as outras combinações", () => {
    for (const href of [HREF_VALIDO, null]) {
      for (const jaExibido of [false, true]) {
        expect(
          decidirAvisoWhatsapp({
            ...EXIBE,
            avisoHabilitado: false,
            href,
            jaExibido,
          }),
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Uma vez por pedido — chave `aviso-wpp:<pedidoId>` no storage injetado
// ---------------------------------------------------------------------------

describe("[287] gate 'uma vez por pedido' no storage injetado", () => {
  it("a chave é `aviso-wpp:<pedidoId>` e é POR pedido", () => {
    expect(chaveAvisoWhatsapp(PEDIDO_ID)).toBe(`aviso-wpp:${PEDIDO_ID}`);
    expect(chaveAvisoWhatsapp(PEDIDO_ID)).not.toBe(
      chaveAvisoWhatsapp(OUTRO_PEDIDO_ID),
    );
  });

  it("chave AUSENTE ⇒ ainda não exibiu; depois de marcar ⇒ exibiu", () => {
    const storage = storageFake();
    expect(jaExibiuAvisoWhatsapp(storage, PEDIDO_ID)).toBe(false);
    marcarAvisoWhatsappExibido(storage, PEDIDO_ID);
    expect(jaExibiuAvisoWhatsapp(storage, PEDIDO_ID)).toBe(true);
    // Outro pedido continua sem marca — o gate não vaza entre pedidos.
    expect(jaExibiuAvisoWhatsapp(storage, OUTRO_PEDIDO_ID)).toBe(false);
  });

  it("chave JÁ presente no storage ⇒ a decisão devolve false (revisita da confirmação)", () => {
    const storage = storageFake({ [`aviso-wpp:${PEDIDO_ID}`]: "1" });
    expect(
      decidirAvisoWhatsapp({
        ...EXIBE,
        jaExibido: jaExibiuAvisoWhatsapp(storage, PEDIDO_ID),
      }),
    ).toBe(false);
  });

  it("storage `null` (SSR) ⇒ leitura false e escrita silenciosa que SINALIZA falha", () => {
    expect(jaExibiuAvisoWhatsapp(null, PEDIDO_ID)).toBe(false);
    expect(() => marcarAvisoWhatsappExibido(null, PEDIDO_ID)).not.toThrow();
    expect(marcarAvisoWhatsappExibido(null, PEDIDO_ID)).toBe(false);
  });

  it("storage que LANÇA (aba privativa) ⇒ não propaga exceção", () => {
    const storage = storageQueLanca();
    expect(() => jaExibiuAvisoWhatsapp(storage, PEDIDO_ID)).not.toThrow();
    expect(jaExibiuAvisoWhatsapp(storage, PEDIDO_ID)).toBe(false);
    expect(() => marcarAvisoWhatsappExibido(storage, PEDIDO_ID)).not.toThrow();
  });

  it("marcar devolve `true` quando a marca REALMENTE persistiu", () => {
    const storage = storageFake();
    expect(marcarAvisoWhatsappExibido(storage, PEDIDO_ID)).toBe(true);
    expect(jaExibiuAvisoWhatsapp(storage, PEDIDO_ID)).toBe(true);
  });

  it("REGRESSÃO: storage que LANÇA ⇒ marcar devolve `false` (gate falhou ABERTO)", () => {
    // Sem este sinal o chamador armaria a contagem automática sobre um gate
    // que não persiste: revisitar a confirmação reabriria o aviso e navegaria
    // de novo, em laço de redirecionamento.
    const storage = storageQueLanca();
    expect(marcarAvisoWhatsappExibido(storage, PEDIDO_ID)).toBe(false);
    expect(jaExibiuAvisoWhatsapp(storage, PEDIDO_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Contagem regressiva com timer INJETADO
// ---------------------------------------------------------------------------

/**
 * [aviso-wpp-nova-aba] REESCRITO DE PROPÓSITO. A versão [287] travava
 * "contagem esgotada usa navegação TOP-LEVEL, nunca aba nova". A spec
 * `aviso-whatsapp-contagem-nova-aba.md` (D2) inverte a ordem: a contagem
 * esgotada PRIMEIRO tenta aba nova; top-level só sobra como fallback do
 * bloqueio em tela de toque (D2.1).
 */
describe("[aviso-wpp-nova-aba] contagem regressiva — tenta aba nova ao fim", () => {
  it("conta de N-1 até 0 no `aoContar`, um valor por tick", () => {
    const { contagem, tick, aoContar } = montarContagem(HREF_VALIDO);
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP);
    expect(aoContar.mock.calls.map((c) => c[0])).toEqual([4, 3, 2, 1, 0]);
  });

  it(`só o ${SEGUNDOS_AVISO_WHATSAPP}º tick tenta abrir a aba nova — nenhum antes`, () => {
    const { contagem, tick, tentarAbrirNovaAba, navegarTopLevel, aoEsgotar } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();

    tick(SEGUNDOS_AVISO_WHATSAPP - 1);
    expect(tentarAbrirNovaAba).not.toHaveBeenCalled();
    expect(navegarTopLevel).not.toHaveBeenCalled();
    expect(aoEsgotar).not.toHaveBeenCalled();

    tick(1);
    expect(tentarAbrirNovaAba).toHaveBeenCalledTimes(1);
    expect(tentarAbrirNovaAba).toHaveBeenCalledWith(HREF_VALIDO);
  });

  it("REESCRITO: contagem esgotada tenta ABA NOVA antes de qualquer navegação top-level", () => {
    // Mesmo no toque com popup bloqueado (o único caso que navega top-level),
    // a tentativa de aba nova vem PRIMEIRO.
    const { contagem, tick, tentarAbrirNovaAba, navegarTopLevel } =
      montarContagem(HREF_VALIDO, {
        resultado: "bloqueada",
        podeNavegarTopLevel: true,
      });
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP);
    expect(tentarAbrirNovaAba).toHaveBeenCalledTimes(1);
    expect(navegarTopLevel).toHaveBeenCalledTimes(1);
    expect(tentarAbrirNovaAba.mock.invocationCallOrder[0]).toBeLessThan(
      navegarTopLevel.mock.invocationCallOrder[0],
    );
  });

  it("tenta UMA vez só: ticks depois do fim não repetem tentativa nem desfecho", () => {
    const { contagem, tick, tentarAbrirNovaAba, aoEsgotar } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP + 10);
    expect(tentarAbrirNovaAba).toHaveBeenCalledTimes(1);
    expect(aoEsgotar).toHaveBeenCalledTimes(1);
  });

  it("contagem esgotada não deixa timer pendente (a contagem terminou)", () => {
    const { contagem, tick, pendentes } = montarContagem(HREF_VALIDO);
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP);
    expect(pendentes.size).toBe(0);
  });

  it("`segundos` é parametrizável em um ponto só", () => {
    const { contagem, tick, tentarAbrirNovaAba } = montarContagem(HREF_VALIDO, {
      segundos: 2,
    });
    contagem.iniciar();
    tick(1);
    expect(tentarAbrirNovaAba).not.toHaveBeenCalled();
    tick(1);
    expect(tentarAbrirNovaAba).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3.1 Tabela F1 — podeNavegarTopLevel × resultado da tentativa de aba nova
// ---------------------------------------------------------------------------

/**
 * [aviso-wpp-nova-aba] SUBSTITUI o describe "[287] envio por gesto": o gesto
 * não passa mais pelo módulo (D3 — é o próprio `<a target="_blank">`), então
 * `abrirNovaAba`/`enviarAgora` saem do contrato. O que o módulo decide agora é
 * o DESFECHO da contagem esgotada (RN-AN1, RN-AN2).
 */
type LinhaF1 = {
  podeNavegarTopLevel: boolean;
  resultado: ResultadoAbertura;
  desfecho: "aberta" | "bloqueada-sem-navegar" | "navegou-top-level";
  navegaTopLevel: boolean;
};

const TABELA_F1: ReadonlyArray<LinhaF1> = [
  // toque + aba abriu: modal fecha, nada troca a aba.
  { podeNavegarTopLevel: true, resultado: "aberta", desfecho: "aberta", navegaTopLevel: false },
  // computador + aba abriu (pop-ups liberados): modal fecha.
  { podeNavegarTopLevel: false, resultado: "aberta", desfecho: "aberta", navegaTopLevel: false },
  // toque + bloqueado: fallback de hoje, `location.href` (D2.1).
  { podeNavegarTopLevel: true, resultado: "bloqueada", desfecho: "navegou-top-level", navegaTopLevel: true },
  // computador + bloqueado: passo 2, a aba da confirmação NUNCA troca (RN-AN1).
  { podeNavegarTopLevel: false, resultado: "bloqueada", desfecho: "bloqueada-sem-navegar", navegaTopLevel: false },
];

describe("[aviso-wpp-nova-aba] F1 — desfecho da contagem esgotada (podeNavegarTopLevel × tentarAbrirNovaAba)", () => {
  for (const linha of TABELA_F1) {
    const nome = `podeNavegarTopLevel=${linha.podeNavegarTopLevel} × "${linha.resultado}" ⇒ aoEsgotar("${linha.desfecho}")${linha.navegaTopLevel ? " + navegarTopLevel(destino) 1x" : ", navegarTopLevel NUNCA"}`;
    it(nome, () => {
      const { contagem, tick, tentarAbrirNovaAba, navegarTopLevel, aoEsgotar } =
        montarContagem(HREF_VALIDO, {
          resultado: linha.resultado,
          podeNavegarTopLevel: linha.podeNavegarTopLevel,
        });
      contagem.iniciar();
      tick(SEGUNDOS_AVISO_WHATSAPP + 3);

      expect(tentarAbrirNovaAba).toHaveBeenCalledTimes(1);
      expect(tentarAbrirNovaAba).toHaveBeenCalledWith(HREF_VALIDO);

      expect(aoEsgotar).toHaveBeenCalledTimes(1);
      expect(aoEsgotar).toHaveBeenCalledWith(linha.desfecho);

      if (linha.navegaTopLevel) {
        expect(navegarTopLevel).toHaveBeenCalledTimes(1);
        expect(navegarTopLevel).toHaveBeenCalledWith(HREF_VALIDO);
      } else {
        expect(navegarTopLevel).not.toHaveBeenCalled();
      }
    });
  }

  it("RN-AN1: podeNavegarTopLevel=false ⇒ navegarTopLevel NUNCA é chamado, qualquer que seja o resultado", () => {
    for (const resultado of ["aberta", "bloqueada"] as const) {
      const { contagem, tick, navegarTopLevel, aoEsgotar } = montarContagem(
        HREF_VALIDO,
        { resultado, podeNavegarTopLevel: false },
      );
      contagem.iniciar();
      tick(SEGUNDOS_AVISO_WHATSAPP * 3);
      expect(navegarTopLevel).not.toHaveBeenCalled();
      // E o desfecho foi de fato entregue à UI (não é "não fez nada").
      expect(aoEsgotar).toHaveBeenCalledTimes(1);
    }
  });

  it('D4: no fallback do toque o modal FECHA antes de navegar — aoEsgotar("navegou-top-level") vem antes de navegarTopLevel', () => {
    const { contagem, tick, navegarTopLevel, aoEsgotar } = montarContagem(
      HREF_VALIDO,
      { resultado: "bloqueada", podeNavegarTopLevel: true },
    );
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP);
    expect(aoEsgotar).toHaveBeenCalledWith("navegou-top-level");
    expect(navegarTopLevel).toHaveBeenCalledTimes(1);
    expect(aoEsgotar.mock.invocationCallOrder[0]).toBeLessThan(
      navegarTopLevel.mock.invocationCallOrder[0],
    );
  });

  it("o desfecho só é entregue DEPOIS da tentativa de aba nova (é ela que decide)", () => {
    for (const linha of TABELA_F1) {
      const { contagem, tick, tentarAbrirNovaAba, aoEsgotar } = montarContagem(
        HREF_VALIDO,
        { resultado: linha.resultado, podeNavegarTopLevel: linha.podeNavegarTopLevel },
      );
      contagem.iniciar();
      tick(SEGUNDOS_AVISO_WHATSAPP);
      expect(tentarAbrirNovaAba).toHaveBeenCalledTimes(1);
      expect(aoEsgotar).toHaveBeenCalledTimes(1);
      expect(tentarAbrirNovaAba.mock.invocationCallOrder[0]).toBeLessThan(
        aoEsgotar.mock.invocationCallOrder[0],
      );
    }
  });

  it("contrato: o gesto saiu do módulo — `enviarAgora` não existe mais em ContagemAviso", () => {
    const { contagem } = montarContagem(HREF_VALIDO);
    expect(contagem).not.toHaveProperty("enviarAgora");
  });

  it("`destino` exposto é EXATAMENTE urlHttpsSegura(href) — é o href do <a> dos botões (D3)", () => {
    const { contagem } = montarContagem(HREF_VALIDO);
    expect(contagem.destino).toBe(urlHttpsSegura(HREF_VALIDO));
    expect(contagem.destino).toBe(HREF_VALIDO);
  });
});

describe("[287] saída do aviso — a contagem PARA e não volta a correr", () => {
  it("parar() antes do fim ⇒ nada abre, nada navega, nenhum desfecho", () => {
    const { contagem, tick, tentarAbrirNovaAba, navegarTopLevel, aoEsgotar } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    tick(2);
    contagem.parar();
    tick(SEGUNDOS_AVISO_WHATSAPP);
    expect(tentarAbrirNovaAba).not.toHaveBeenCalled();
    expect(navegarTopLevel).not.toHaveBeenCalled();
    expect(aoEsgotar).not.toHaveBeenCalled();
  });

  it("REGRESSÃO: depois de parar(), NENHUM tick posterior abre aba ou navega — o passo 2 não é adiamento de 5s", () => {
    const { contagem, tick, tentarAbrirNovaAba, navegarTopLevel, aoEsgotar, aoContar } =
      montarContagem(HREF_VALIDO, { resultado: "bloqueada" });
    contagem.iniciar();
    contagem.parar();

    aoContar.mockClear();
    tick(SEGUNDOS_AVISO_WHATSAPP * 10);

    expect(tentarAbrirNovaAba).not.toHaveBeenCalled();
    expect(navegarTopLevel).not.toHaveBeenCalled();
    expect(aoEsgotar).not.toHaveBeenCalled();
    // E o contador também não continua andando por baixo do passo 2.
    expect(aoContar).not.toHaveBeenCalled();
  });

  it("parar() não deixa timer pendente (nada para vazar na desmontagem)", () => {
    const { contagem, pendentes } = montarContagem(HREF_VALIDO);
    contagem.iniciar();
    contagem.parar();
    expect(pendentes.size).toBe(0);
  });

  it("parar() é idempotente — chamar duas vezes não ressuscita a contagem", () => {
    const { contagem, tick, tentarAbrirNovaAba, navegarTopLevel } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    contagem.parar();
    contagem.parar();
    tick(SEGUNDOS_AVISO_WHATSAPP * 2);
    expect(tentarAbrirNovaAba).not.toHaveBeenCalled();
    expect(navegarTopLevel).not.toHaveBeenCalled();
  });

  it("iniciar() depois de parar() NÃO religa a contagem (a saída é definitiva no pedido)", () => {
    const { contagem, tick, tentarAbrirNovaAba, navegarTopLevel } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    contagem.parar();
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP * 2);
    expect(tentarAbrirNovaAba).not.toHaveBeenCalled();
    expect(navegarTopLevel).not.toHaveBeenCalled();
  });

  it("parar() depois da contagem esgotada não repete a tentativa (clique no link após o fim)", () => {
    const { contagem, tick, tentarAbrirNovaAba, aoEsgotar } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP);
    contagem.parar();
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP * 2);
    expect(tentarAbrirNovaAba).toHaveBeenCalledTimes(1);
    expect(aoEsgotar).toHaveBeenCalledTimes(1);
  });
});

describe("[287] guard §15 — destino reprovado NUNCA navega, por nenhum caminho", () => {
  it("REESCRITO: destino reprovado ⇒ nem tentativa de aba nova, nem top-level, nem desfecho; `destino` é null", () => {
    for (const href of HREFS_REPROVADOS) {
      for (const podeNavegarTopLevel of [true, false]) {
        const { contagem, tick, tentarAbrirNovaAba, navegarTopLevel, aoEsgotar } =
          montarContagem(href, { resultado: "bloqueada", podeNavegarTopLevel });

        contagem.iniciar();
        tick(SEGUNDOS_AVISO_WHATSAPP * 3);

        expect(tentarAbrirNovaAba).not.toHaveBeenCalled();
        expect(navegarTopLevel).not.toHaveBeenCalled();
        expect(aoEsgotar).not.toHaveBeenCalled();
        // O `<a>` dos botões lê `destino`: reprovado ⇒ sem href (null).
        expect(contagem.destino).toBeNull();
      }
    }
  });

  it("destino reprovado não agenda nem um tick (nada roda em vão)", () => {
    const { contagem, pendentes } = montarContagem("javascript:alert(1)");
    contagem.iniciar();
    expect(pendentes.size).toBe(0);
  });

  it("REESCRITO: href NULO explicitamente — iniciar() não agenda tick, nada abre e `destino` é null", () => {
    const { contagem, tick, pendentes, tentarAbrirNovaAba, navegarTopLevel } =
      montarContagem(null);
    contagem.iniciar();
    expect(pendentes.size).toBe(0);
    tick(SEGUNDOS_AVISO_WHATSAPP);
    expect(tentarAbrirNovaAba).not.toHaveBeenCalled();
    expect(navegarTopLevel).not.toHaveBeenCalled();
    expect(contagem.destino).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Bordas — storage que lança não pode travar a DECISÃO combinada
// ---------------------------------------------------------------------------

describe("[287] borda — storage indisponível (aba privativa) não trava a decisão combinada", () => {
  it("ler com storage que lança ⇒ decidirAvisoWhatsapp ainda decide exibir (fail-open na leitura)", () => {
    const storage = storageQueLanca();
    // Reproduz o que o componente faz: decide a partir da leitura do storage.
    const jaExibido = jaExibiuAvisoWhatsapp(storage, PEDIDO_ID);
    expect(() =>
      decidirAvisoWhatsapp({ ...EXIBE, jaExibido }),
    ).not.toThrow();
    expect(decidirAvisoWhatsapp({ ...EXIBE, jaExibido })).toBe(true);
  });

  it("gravar com storage que lança, logo após decidir exibir, não propaga exceção (fluxo completo do componente)", () => {
    const storage = storageQueLanca();
    const jaExibido = jaExibiuAvisoWhatsapp(storage, PEDIDO_ID);
    const exibir = decidirAvisoWhatsapp({ ...EXIBE, jaExibido });
    expect(exibir).toBe(true);
    expect(() => marcarAvisoWhatsappExibido(storage, PEDIDO_ID)).not.toThrow();
    // ...mas a gravação REPROVA: o componente não pode auto-navegar aqui.
    expect(marcarAvisoWhatsappExibido(storage, PEDIDO_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Montagem dupla — a decisão vale por INSTÂNCIA, não por execução do efeito
// ---------------------------------------------------------------------------

/**
 * O React Strict Mode (ligado por default no App Router) monta, desmonta e
 * remonta cada componente em dev, e o Fast Refresh faz o mesmo. Decidir e
 * marcar soltos dentro do efeito criavam uma armadilha: a primeira passada
 * gravava a marca, a segunda LIA essa mesma marca, concluía "já exibi" e saía
 * sem armar a contagem — com o modal já aberto pela primeira. O comprador
 * ficava com spinner eterno, contador travado em 5 e nenhuma navegação.
 *
 * A memória por instância (`memo`, vivo num `useRef`) é o que separa "o efeito
 * rodou de novo" de "o comprador voltou à confirmação": a primeira repete a
 * decisão, a segunda merece o gate.
 */
describe("[287] decidirEMarcarAvisoUmaVez — o efeito roda 2x, a decisão vale 1x", () => {
  const ENTRADA = {
    avisoHabilitado: true,
    href: HREF_VALIDO,
    pedidoId: PEDIDO_ID,
  };

  it("REGRESSÃO: a segunda passada repete a decisão da primeira — nunca relê a marca que ela própria gravou", () => {
    const storage = storageFake();
    const memo: MemoDecisaoAviso = { current: null };

    const primeira = decidirEMarcarAvisoUmaVez(memo, { ...ENTRADA, storage });
    const segunda = decidirEMarcarAvisoUmaVez(memo, { ...ENTRADA, storage });

    expect(primeira).toEqual({ exibir: true, persistiu: true });
    expect(segunda).toEqual({ exibir: true, persistiu: true });
  });

  it("a marca é gravada UMA vez, por mais que o efeito rode", () => {
    const storage = storageFake();
    const setItem = vi.spyOn(storage, "setItem");
    const memo: MemoDecisaoAviso = { current: null };

    decidirEMarcarAvisoUmaVez(memo, { ...ENTRADA, storage });
    decidirEMarcarAvisoUmaVez(memo, { ...ENTRADA, storage });
    decidirEMarcarAvisoUmaVez(memo, { ...ENTRADA, storage });

    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("instância NOVA (revisita da confirmação) respeita a marca: não exibe de novo", () => {
    const storage = storageFake();
    decidirEMarcarAvisoUmaVez({ current: null }, { ...ENTRADA, storage });
    // Montagem nova = memo novo, porque o `useRef` morre com a instância.
    expect(
      decidirEMarcarAvisoUmaVez({ current: null }, { ...ENTRADA, storage }),
    ).toEqual({ exibir: false, persistiu: false });
  });

  it("toggle do lojista desligado ⇒ não exibe e NÃO grava marca", () => {
    const storage = storageFake();
    expect(
      decidirEMarcarAvisoUmaVez(
        { current: null },
        { ...ENTRADA, storage, avisoHabilitado: false },
      ),
    ).toEqual({ exibir: false, persistiu: false });
    expect(storage.getItem(chaveAvisoWhatsapp(PEDIDO_ID))).toBeNull();
  });

  it("href reprovado pelo guard §15 ⇒ não exibe e NÃO grava marca", () => {
    for (const href of HREFS_REPROVADOS) {
      const storage = storageFake();
      expect(
        decidirEMarcarAvisoUmaVez(
          { current: null },
          { ...ENTRADA, storage, href },
        ),
      ).toEqual({ exibir: false, persistiu: false });
      expect(storage.getItem(chaveAvisoWhatsapp(PEDIDO_ID))).toBeNull();
    }
  });

  it("storage que lança: exibe com persistiu=false nas DUAS passadas (nenhuma navega sozinha)", () => {
    const storage = storageQueLanca();
    const memo: MemoDecisaoAviso = { current: null };
    const esperado = { exibir: true, persistiu: false };

    expect(decidirEMarcarAvisoUmaVez(memo, { ...ENTRADA, storage })).toEqual(
      esperado,
    );
    expect(decidirEMarcarAvisoUmaVez(memo, { ...ENTRADA, storage })).toEqual(
      esperado,
    );
  });

  it("storage null ⇒ exibe sem persistir: só o gesto navega", () => {
    expect(
      decidirEMarcarAvisoUmaVez(
        { current: null },
        { ...ENTRADA, storage: null },
      ),
    ).toEqual({ exibir: true, persistiu: false });
  });
});
