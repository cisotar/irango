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
  jaExibiuAvisoWhatsapp,
  marcarAvisoWhatsappExibido,
  type DepsContagemAviso,
  type EntradaDecisaoAviso,
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

function montarContagem(
  href: string | null,
  overrides: Partial<DepsContagemAviso> = {},
) {
  const { timer, tick, pendentes } = timerFake();
  const navegarTopLevel = vi.fn();
  const abrirNovaAba = vi.fn();
  const aoContar = vi.fn();
  const deps: DepsContagemAviso = {
    href,
    timer,
    navegarTopLevel,
    abrirNovaAba,
    aoContar,
    ...overrides,
  };
  return {
    contagem: criarContagemAviso(deps),
    tick,
    pendentes,
    navegarTopLevel,
    abrirNovaAba,
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

describe("[287] contagem regressiva — navegação automática ao fim", () => {
  it("conta de N-1 até 0 no `aoContar`, um valor por tick", () => {
    const { contagem, tick, aoContar } = montarContagem(HREF_VALIDO);
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP);
    expect(aoContar.mock.calls.map((c) => c[0])).toEqual([4, 3, 2, 1, 0]);
  });

  it(`só o ${SEGUNDOS_AVISO_WHATSAPP}º tick navega — nenhum antes`, () => {
    const { contagem, tick, navegarTopLevel } = montarContagem(HREF_VALIDO);
    contagem.iniciar();

    tick(SEGUNDOS_AVISO_WHATSAPP - 1);
    expect(navegarTopLevel).not.toHaveBeenCalled();

    tick(1);
    expect(navegarTopLevel).toHaveBeenCalledTimes(1);
    expect(navegarTopLevel).toHaveBeenCalledWith(HREF_VALIDO);
  });

  it("contagem esgotada usa navegação TOP-LEVEL, nunca aba nova (não há gesto)", () => {
    const { contagem, tick, navegarTopLevel, abrirNovaAba } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP);
    expect(navegarTopLevel).toHaveBeenCalledTimes(1);
    expect(abrirNovaAba).not.toHaveBeenCalled();
  });

  it("navega UMA vez só: ticks depois do fim não repetem a navegação", () => {
    const { contagem, tick, navegarTopLevel } = montarContagem(HREF_VALIDO);
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP + 10);
    expect(navegarTopLevel).toHaveBeenCalledTimes(1);
  });

  it("`segundos` é parametrizável em um ponto só", () => {
    const { contagem, tick, navegarTopLevel } = montarContagem(HREF_VALIDO, {
      segundos: 2,
    });
    contagem.iniciar();
    tick(1);
    expect(navegarTopLevel).not.toHaveBeenCalled();
    tick(1);
    expect(navegarTopLevel).toHaveBeenCalledTimes(1);
  });
});

describe("[287] saída do aviso — a contagem PARA e não volta a correr", () => {
  it("parar() antes do fim ⇒ nada navega", () => {
    const { contagem, tick, navegarTopLevel, abrirNovaAba } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    tick(2);
    contagem.parar();
    tick(SEGUNDOS_AVISO_WHATSAPP);
    expect(navegarTopLevel).not.toHaveBeenCalled();
    expect(abrirNovaAba).not.toHaveBeenCalled();
  });

  it("REGRESSÃO: depois de parar(), NENHUM tick posterior navega — o passo 2 não é adiamento de 5s", () => {
    const { contagem, tick, navegarTopLevel, abrirNovaAba, aoContar } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    contagem.parar();

    aoContar.mockClear();
    tick(SEGUNDOS_AVISO_WHATSAPP * 10);

    expect(navegarTopLevel).not.toHaveBeenCalled();
    expect(abrirNovaAba).not.toHaveBeenCalled();
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
    const { contagem, tick, navegarTopLevel } = montarContagem(HREF_VALIDO);
    contagem.iniciar();
    contagem.parar();
    contagem.parar();
    tick(SEGUNDOS_AVISO_WHATSAPP * 2);
    expect(navegarTopLevel).not.toHaveBeenCalled();
  });

  it("iniciar() depois de parar() NÃO religa a contagem (a saída é definitiva no pedido)", () => {
    const { contagem, tick, navegarTopLevel } = montarContagem(HREF_VALIDO);
    contagem.iniciar();
    contagem.parar();
    contagem.iniciar();
    tick(SEGUNDOS_AVISO_WHATSAPP * 2);
    expect(navegarTopLevel).not.toHaveBeenCalled();
  });
});

describe("[287] envio por gesto — aba nova com o destino do servidor", () => {
  it("enviarAgora() abre a aba nova com o destino e NÃO navega top-level", () => {
    const { contagem, navegarTopLevel, abrirNovaAba } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    contagem.enviarAgora();
    expect(abrirNovaAba).toHaveBeenCalledTimes(1);
    expect(abrirNovaAba).toHaveBeenCalledWith(HREF_VALIDO);
    expect(navegarTopLevel).not.toHaveBeenCalled();
  });

  it("enviarAgora() PARA a contagem: ticks posteriores não navegam de novo", () => {
    const { contagem, tick, navegarTopLevel, abrirNovaAba } =
      montarContagem(HREF_VALIDO);
    contagem.iniciar();
    contagem.enviarAgora();
    tick(SEGUNDOS_AVISO_WHATSAPP * 3);
    expect(abrirNovaAba).toHaveBeenCalledTimes(1);
    expect(navegarTopLevel).not.toHaveBeenCalled();
  });

  it("enviarAgora() depois de parar() ainda funciona (botão do passo 2)", () => {
    const { contagem, abrirNovaAba } = montarContagem(HREF_VALIDO);
    contagem.iniciar();
    contagem.parar();
    contagem.enviarAgora();
    expect(abrirNovaAba).toHaveBeenCalledWith(HREF_VALIDO);
  });
});

describe("[287] guard §15 — destino reprovado NUNCA navega, por nenhum caminho", () => {
  it("nem a contagem esgotada nem o gesto navegam para destino reprovado", () => {
    for (const href of HREFS_REPROVADOS) {
      const { contagem, tick, navegarTopLevel, abrirNovaAba } =
        montarContagem(href);

      contagem.iniciar();
      tick(SEGUNDOS_AVISO_WHATSAPP * 3);
      contagem.enviarAgora();

      expect(navegarTopLevel).not.toHaveBeenCalled();
      expect(abrirNovaAba).not.toHaveBeenCalled();
    }
  });

  it("destino reprovado não agenda nem um tick (nada roda em vão)", () => {
    const { contagem, pendentes } = montarContagem("javascript:alert(1)");
    contagem.iniciar();
    expect(pendentes.size).toBe(0);
  });

  it("href NULO explicitamente: iniciar() não agenda tick, enviarAgora() não abre nada", () => {
    const { contagem, tick, pendentes, navegarTopLevel, abrirNovaAba } =
      montarContagem(null);
    contagem.iniciar();
    expect(pendentes.size).toBe(0);
    tick(SEGUNDOS_AVISO_WHATSAPP);
    contagem.enviarAgora();
    expect(navegarTopLevel).not.toHaveBeenCalled();
    expect(abrirNovaAba).not.toHaveBeenCalled();
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
