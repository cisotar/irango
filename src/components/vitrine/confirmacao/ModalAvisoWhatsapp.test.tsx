/**
 * [287] Testes de `ModalAvisoWhatsapp.tsx`.
 *
 * `environment: node`, sem jsdom: sem hidratação não há como disparar o
 * `useEffect` nem clique de botão de verdade, então este arquivo segue o
 * MESMO padrão de `ModalPromocoes.test.tsx`:
 *
 *  1. `renderToStaticMarkup` prova que o SSR é VAZIO — `aberto` começa
 *     `false`, então nenhum `href` (PII do comprador na query string) escapa
 *     para o HTML do servidor, mesmo com `avisoHabilitado=true`.
 *  2. Tudo que só existe depois da montagem (a contagem, o cleanup, a ordem
 *     "marca antes de abrir") é travado sobre o TEXTO-FONTE do arquivo, sem
 *     comentários — é o mesmo grep do gate mecânico do plano (§4), travado na
 *     suíte em vez de na disciplina de quem revisa.
 *
 * [aviso-wpp-nova-aba] O describe §6 do [287] (gesto com `window.open(...,
 * "noopener")` + fallback `location.href`) foi SUBSTITUÍDO pelas travas F2
 * (contagem abre com `window.open` sem feature + `opener = null`), F3 (botões
 * de envio como `<a target="_blank" rel="noopener noreferrer">`) e F4 (passo 1
 * em qualquer dispositivo). Spec: `specs/aviso-whatsapp-contagem-nova-aba.md`.
 *
 * A regra de negócio em si (quando exibir, o gate uma-vez-por-pedido, a
 * contagem, o guard §15) já está travada em `avisoWhatsapp.test.ts`, no
 * módulo puro — este arquivo só prova que o COMPONENTE está ligado nela
 * corretamente, não reimplementa nada.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";

import {
  ModalAvisoWhatsapp,
  COPY_ACELERE_PEDIDO,
  COPY_POPUP_BLOQUEADO_TITULO,
  COPY_POPUP_BLOQUEADO_DESC,
} from "./ModalAvisoWhatsapp";

const FONTE = readFileSync(
  new URL("./ModalAvisoWhatsapp.tsx", import.meta.url),
  "utf8",
);

/** Mesmo arquivo sem comentário — as travas são sobre o que o código FAZ. */
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

const PEDIDO_ID = "11111111-1111-1111-1111-111111111111";
const HREF_COM_PII =
  "https://wa.me/5500000000000?text=Jo%C3%A3o%20da%20Silva%2C%20Rua%20X%2C%20999";

// ---------------------------------------------------------------------------
// 1. Critério 7 do gate — a copy do passo 2 bate LITERALMENTE com o plano
// ---------------------------------------------------------------------------

describe("[287] COPY_ACELERE_PEDIDO — copy literal do passo 2 (gate §4 crit. 7)", () => {
  it("é exatamente a string decidida pelo usuário — nem parcial, nem reescrita", () => {
    expect(COPY_ACELERE_PEDIDO).toBe(
      "Envie a mensagem no WhatsApp e acelere seu pedido.",
    );
  });

  it("o componente usa a CONSTANTE no título do passo 2, não um literal solto", () => {
    // Garante que ninguém troque `{COPY_ACELERE_PEDIDO}` por uma string nova
    // "melhorando" a copy sem passar pela constante exportada — se isso
    // acontecer, a asserção acima deixa de proteger o texto exibido.
    expect(CODIGO).toMatch(/<DialogTitle>\{COPY_ACELERE_PEDIDO\}<\/DialogTitle>/);
    // E só existe UMA ocorrência de uso (fora da declaração/export) — não há
    // um segundo lugar divergente que também tente exibir a copy do passo 2.
    const usos = CODIGO.match(/\{COPY_ACELERE_PEDIDO\}/g) ?? [];
    expect(usos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 1-B. Copy do passo 2 QUANDO o popup foi bloqueado (decisão de produto nova)
// ---------------------------------------------------------------------------

describe("[aviso-wpp-nova-aba] copy do passo 2 no bloqueio de popup — literal e condicionada a `bloqueado`", () => {
  it("os literais são exatamente os decididos pelo usuário", () => {
    expect(COPY_POPUP_BLOQUEADO_TITULO).toBe(
      "Clique em “Enviar mensagem” para abrir o WhatsApp",
    );
    expect(COPY_POPUP_BLOQUEADO_DESC).toBe(
      "Seu navegador bloqueou a abertura automática. O pedido já está registrado — clique para avisar a loja, ou libere os pop-ups deste site.",
    );
  });

  it("a copy de bloqueio não sugere que o pedido não foi feito (RN-W4)", () => {
    const texto = `${COPY_POPUP_BLOQUEADO_TITULO} ${COPY_POPUP_BLOQUEADO_DESC}`;
    // Reafirma que o pedido existe e nunca fala em desfazer/cancelar/refazer.
    expect(COPY_POPUP_BLOQUEADO_DESC).toContain("O pedido já está registrado");
    expect(texto).not.toMatch(/cancel|desfaz|desist|refaz|refaça|não foi feito/i);
  });

  it("o passo 2 escolhe a copy por `bloqueado`: constantes de bloqueio usadas 1× cada, na ramificação verdadeira", () => {
    // As duas variantes coexistem no passo 2, separadas por `bloqueado ? … : …`.
    expect(CODIGO).toMatch(/\{bloqueado \? \(/);
    expect(
      CODIGO.match(/<DialogTitle>\{COPY_POPUP_BLOQUEADO_TITULO\}<\/DialogTitle>/g),
    ).toHaveLength(1);
    expect(CODIGO.match(/\{COPY_POPUP_BLOQUEADO_DESC\}/g)).toHaveLength(1);
    // A copy de incentivo continua existindo para os outros caminhos do passo 2.
    expect(CODIGO).toMatch(/<DialogTitle>\{COPY_ACELERE_PEDIDO\}<\/DialogTitle>/);
  });

  it("`bloqueado` começa `false` e só vira `true` no desfecho \"bloqueada-sem-navegar\"", () => {
    expect(CODIGO).toMatch(/const \[bloqueado, setBloqueado\] = useState\(false\)/);
    // setBloqueado(true) mora exatamente uma vez, dentro do handler aoEsgotar.
    expect(CODIGO.match(/setBloqueado\(true\)/g)).toHaveLength(1);
    const corpo = propriedadeDeps("aoEsgotar");
    expect(corpo).not.toBeNull();
    expect(corpo).toMatch(
      /if \(desfecho === "bloqueada-sem-navegar"\) \{\s*setBloqueado\(true\);\s*setPasso\(2\);/,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. SSR vazio — nenhum PII do `href` escapa para o HTML do servidor
// ---------------------------------------------------------------------------

describe("[287] ModalAvisoWhatsapp — SSR vazio, mesmo com aviso habilitado e href com PII", () => {
  it("avisoHabilitado=true + href com PII ⇒ HTML do servidor é vazio", () => {
    const html = renderToStaticMarkup(
      <ModalAvisoWhatsapp
        pedidoId={PEDIDO_ID}
        avisoHabilitado={true}
        href={HREF_COM_PII}
      />,
    );
    expect(html).toBe("");
    // Sanidade do fixture: se isto falhasse por não conter PII, o teste acima
    // não provaria nada.
    expect(HREF_COM_PII).toContain("Silva");
  });

  it("avisoHabilitado=false também é vazio", () => {
    expect(
      renderToStaticMarkup(
        <ModalAvisoWhatsapp
          pedidoId={PEDIDO_ID}
          avisoHabilitado={false}
          href={HREF_COM_PII}
        />,
      ),
    ).toBe("");
  });

  it("href nulo também é vazio", () => {
    expect(
      renderToStaticMarkup(
        <ModalAvisoWhatsapp
          pedidoId={PEDIDO_ID}
          avisoHabilitado={true}
          href={null}
        />,
      ),
    ).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 3. Desmontagem com timer pendente — o cleanup chama `parar()`
// ---------------------------------------------------------------------------

describe("[287] efeito de montagem — estrutura do cleanup (bordas §5 do plano)", () => {
  it("existe UM único useEffect de deps `[]`, e é ele que decide o aviso", () => {
    const efeito = /useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(CODIGO);
    expect(efeito).not.toBeNull();
    expect(CODIGO.match(/useEffect\(/g)).toHaveLength(1);
    expect(efeito?.[1]).toContain("decidirEMarcarAvisoUmaVez(");
  });

  it("REGRESSÃO: a decisão vem do helper memoizado por instância, nunca solta no efeito", () => {
    // O Strict Mode (e o Fast Refresh) roda o efeito duas vezes na MESMA
    // instância. Decidir e marcar soltos aqui faziam a segunda passada ler a
    // marca gravada pela primeira, concluir "já exibi" e sair sem armar a
    // contagem — modal aberto, spinner eterno, nenhuma navegação.
    expect(CODIGO).toMatch(
      /const \{ exibir, persistiu \} = decidirEMarcarAvisoUmaVez\(decisaoRef, \{/,
    );
    expect(CODIGO).toMatch(/const decisaoRef = useRef</);
    // As primitivas cruas não podem voltar a ser chamadas pelo componente.
    expect(CODIGO).not.toMatch(/decidirAvisoWhatsapp\(/);
    expect(CODIGO).not.toMatch(/marcarAvisoWhatsappExibido\(/);
    expect(CODIGO).not.toMatch(/jaExibiuAvisoWhatsapp\(/);
  });

  it("a desmontagem (cleanup do useEffect) CHAMA contagem.parar() e limpa a ref", () => {
    const efeito = /useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(CODIGO);
    expect(efeito).not.toBeNull();
    const corpo = efeito![1];

    const cleanup = /return \(\) => \{([\s\S]*?)\};/.exec(corpo);
    expect(cleanup).not.toBeNull();
    expect(cleanup![1]).toContain("contagem.parar()");
    expect(cleanup![1]).toContain("contagemRef.current = null");
  });

  it("decide e marca ANTES de abrir (revisita não pode reabrir o aviso)", () => {
    // A marcação em si mora dentro de `decidirEMarcarAvisoUmaVez` (travada em
    // `avisoWhatsapp.test.ts`); aqui trava-se a ORDEM: nada é aberto antes de
    // a marca ter sido tentada.
    const efeito = /useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(CODIGO);
    const corpo = efeito![1];
    expect(corpo.indexOf("decidirEMarcarAvisoUmaVez(")).toBeGreaterThan(-1);
    expect(corpo.indexOf("decidirEMarcarAvisoUmaVez(")).toBeLessThan(
      corpo.indexOf("setAberto(true)"),
    );
  });

  it("iniciar() só roda DEPOIS de setAberto(true) — nenhum tick antes da montagem visível", () => {
    const efeito = /useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(CODIGO);
    const corpo = efeito![1];
    expect(corpo.indexOf("setAberto(true)")).toBeLessThan(
      corpo.indexOf("contagem.iniciar()"),
    );
  });

  it("aoAdiar() e aoFechar() também param a contagem pela MESMA ref (não duplicam a lógica)", () => {
    expect(CODIGO).toMatch(/function aoAdiar\(\): void \{[\s\S]*?contagemRef\.current\?\.parar\(\);/);
    expect(CODIGO).toMatch(/function aoFechar\(\): void \{[\s\S]*?contagemRef\.current\?\.parar\(\);/);
    // `parar()` só é chamado a partir da ref nestes dois lugares + no cleanup
    // do efeito (já travado no teste acima) — não há um quarto caminho. Os
    // links de envio reusam `aoFechar` (S2 do plano), então a contagem fica 2.
    expect(CODIGO.match(/contagemRef\.current\?\.parar\(\)/g)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Storage indisponível (aba privativa) — o componente nunca toca
//    `window.sessionStorage` fora do wrapper que engole exceção
// ---------------------------------------------------------------------------

describe("[287] borda — storage indisponível não pode quebrar o componente", () => {
  it("REGRESSÃO: gate que não persistiu ⇒ a contagem NÃO é armada (sem laço de redirecionamento)", () => {
    // Com storage bloqueado a marca some, então o aviso reabriria a cada
    // revisita da confirmação. Se ele também contasse e navegasse sozinho,
    // isso viraria laço. A única navegação automática do componente é
    // `contagem.iniciar()` — e ela fica atrás do retorno da marcação.
    expect(CODIGO).toMatch(
      /const \{ exibir, persistiu \} = decidirEMarcarAvisoUmaVez\(/,
    );
    expect(CODIGO.match(/contagem\.iniciar\(\)/g)).toHaveLength(1);
    expect(CODIGO).toMatch(
      // `persistiu` é SEMPRE a primeira condição; a forma exata (sem heurística
      // de dispositivo) é travada em F4.
      /if \(persistiu(?: && !ehComputadorComMouse\(\))?\) \{\s*contagem\.iniciar\(\);\s*\} else \{\s*setPasso\(2\);\s*\}/,
    );
  });

  it("REESCRITO (D1/D2.1): `ehComputadorComMouse()` só escolhe o fallback do bloqueio — alimenta `podeNavegarTopLevel`, avaliado UMA vez", () => {
    // A versão [287] usava a heurística para NÃO armar a contagem no PC.
    // Agora ela só decide se o bloqueio de popup pode virar navegação
    // top-level (toque) ou passo 2 (computador).
    expect(CODIGO).toMatch(/function ehComputadorComMouse\(\): boolean \{/);
    expect(CODIGO).toMatch(
      /window\.matchMedia\("\(hover: hover\) and \(pointer: fine\)"\)\.matches/,
    );
    const chamadas =
      CODIGO.match(/(?<!function )\behComputadorComMouse\(\)/g) ?? [];
    expect(chamadas).toHaveLength(1);
    expect(CODIGO).toMatch(
      /podeNavegarTopLevel(?::| =) !ehComputadorComMouse\(\)/,
    );
  });

  it("REESCRITO: gate não confiável ⇒ passo 2; `setPasso(2)` em 3 lugares (aoAdiar + gate + desfecho \"bloqueada-sem-navegar\")", () => {
    // `navegarTopLevel` só é alcançável a partir de um tick da contagem, que
    // não foi armada; restam os botões do passo 2, ambos por gesto.
    expect(CODIGO).toMatch(/navegarTopLevel: \(destino\) => \{/);
    expect(CODIGO.match(/setPasso\(2\)/g)).toHaveLength(3);
    // "Enviar agora", "Enviar mensagem" (links, S2 do plano) e "Sair mesmo
    // assim" fecham pelo MESMO handler.
    expect(CODIGO.match(/onClick=\{aoFechar\}/g)).toHaveLength(3);
    expect(CODIGO).toMatch(/onClick=\{aoAdiar\}/);
  });

  it("todo acesso a sessionStorage passa por lerSessionStorage() (try/catch)", () => {
    // Fora da própria função `lerSessionStorage`, o arquivo não toca
    // `sessionStorage` diretamente — se alguém acessar `window.sessionStorage`
    // num outro ponto, a leitura deixaria de ser fail-safe e este teste pega.
    const usosDiretos = CODIGO.match(/window\.sessionStorage/g) ?? [];
    expect(usosDiretos).toHaveLength(1); // só dentro de lerSessionStorage()
    expect(CODIGO).toMatch(
      /function lerSessionStorage\(\)[\s\S]*?window\.sessionStorage[\s\S]*?catch/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Guard §15 — o componente não reimplementa nem contorna
// ---------------------------------------------------------------------------

describe("[287] guard §15 — o componente não reimplementa nem loga o destino", () => {
  it("não importa nem reimplementa urlHttpsSegura — só passa o href cru para avisoWhatsapp", () => {
    expect(CODIGO).not.toMatch(/urlHttpsSegura/);
  });

  it("nunca loga href/destino (precedente [161])", () => {
    expect(CODIGO).not.toMatch(/console\.(log|error|warn|info)/);
  });
});

// ---------------------------------------------------------------------------
// Helpers de fatiamento do texto-fonte (F2/F3)
// ---------------------------------------------------------------------------

/**
 * Corpo de uma propriedade do objeto de deps passado a `criarContagemAviso`,
 * do `nome:` até a próxima propriedade (6 espaços de indentação) ou o fim do
 * objeto. Tolerante a forma (bloco, ternário, uma linha).
 */
function propriedadeDeps(nome: string): string | null {
  const ini = CODIGO.indexOf(`${nome}:`);
  if (ini < 0) return null;
  const resto = CODIGO.slice(ini + nome.length + 1);
  const fim = resto.search(/\n {6}[A-Za-z]\w*[:,]|\n {4}\}\);/);
  return fim < 0 ? resto : resto.slice(0, fim);
}

/** Trecho JSX do `<Button>` cujo rótulo é `rotulo`. */
function botaoComRotulo(rotulo: string): string {
  // ÚLTIMA ocorrência: a copy de bloqueio (COPY_POPUP_BLOQUEADO_TITULO) cita
  // "Enviar mensagem" no topo do arquivo; o rótulo do botão é sempre o último.
  const idx = CODIGO.lastIndexOf(rotulo);
  expect(idx, `rótulo "${rotulo}" não encontrado`).toBeGreaterThan(-1);
  const ini = CODIGO.lastIndexOf("<Button", idx);
  const candidatos = [
    CODIGO.indexOf("</Button>", idx),
    CODIGO.indexOf("<Button", idx),
  ].filter((i) => i > -1);
  const fim = candidatos.length ? Math.min(...candidatos) : CODIGO.length;
  return CODIGO.slice(ini, fim);
}

// ---------------------------------------------------------------------------
// 6. F4 — o passo 1 volta em QUALQUER dispositivo (D1)
// ---------------------------------------------------------------------------

describe("[aviso-wpp-nova-aba] F4 — contagem armada só por `persistiu`, em qualquer dispositivo", () => {
  it("`if (persistiu) { contagem.iniciar() } else { setPasso(2) }` — sem condição de dispositivo", () => {
    expect(CODIGO).toMatch(
      /if \(persistiu\) \{\s*contagem\.iniciar\(\);\s*\} else \{\s*setPasso\(2\);\s*\}/,
    );
    expect(CODIGO).not.toMatch(/persistiu && !ehComputadorComMouse\(\)/);
    // Nenhum `if` decide armar a contagem pela heurística de dispositivo.
    expect(CODIGO).not.toMatch(/if \([^)]*ehComputadorComMouse/);
  });
});

// ---------------------------------------------------------------------------
// 7. F2 — abertura por CONTAGEM: `window.open` sem feature + `opener = null`
// ---------------------------------------------------------------------------

/**
 * SUBSTITUI o describe [287] "gesto com popup bloqueado — fallback para
 * navegação top-level". Aquele travava `window.open(destino, "_blank",
 * "noopener")` + `if (aba == null) window.location.href = destino` — que com
 * `noopener` devolve `null` SEMPRE e trocava a aba da confirmação em todo
 * clique (bug latente, spec § Visão Geral). `window.open` agora só existe na
 * contagem esgotada, e precisa do handle para detectar o bloqueio (D2).
 */
describe("[aviso-wpp-nova-aba] F2 — tentarAbrirNovaAba: handle para detectar bloqueio, opener zerado na mesma tarefa (§15-A)", () => {
  it("`window.open(` aparece exatamente 1 vez, dentro de `tentarAbrirNovaAba`", () => {
    expect(CODIGO.match(/window\.open\(/g)).toHaveLength(1);
    const corpo = propriedadeDeps("tentarAbrirNovaAba");
    expect(corpo).not.toBeNull();
    expect(corpo).toMatch(/window\.open\(/);
  });

  it('`window.open(destino, "_blank")` SEM 3º argumento, seguido de `aba.opener = null` antes do `return "aberta"`', () => {
    expect(CODIGO).toMatch(
      /const aba = window\.open\(destino, "_blank"\);\s*if \(aba == null\) \{?\s*return "bloqueada";\s*\}?\s*aba\.opener = null;\s*return "aberta";/,
    );
  });

  it('nenhuma string `"noopener"` passada como feature de `window.open`', () => {
    expect(CODIGO).not.toMatch(/window\.open\([^)]*noopener/);
    expect(CODIGO).not.toMatch(/"noopener"/);
    // Nenhuma chamada com 3 argumentos.
    expect(CODIGO).not.toMatch(/window\.open\([^,)]*,[^,)]*,/);
  });

  it("usa o `destino` aprovado pelo guard, nunca o `href` cru da prop", () => {
    const corpo = propriedadeDeps("tentarAbrirNovaAba");
    expect(corpo, "deps sem `tentarAbrirNovaAba`").not.toBeNull();
    expect(corpo).toMatch(/^\s*\(destino\) =>/);
    // `location.href`/`.href` é propriedade; só o identificador solto `href`
    // contornaria o guard §15.
    expect(corpo).not.toMatch(/(?<!\.)\bhref\b/);
  });

  it("o contrato antigo do gesto saiu do componente: sem `abrirNovaAba`, `enviarAgora` nem `aoEnviar`", () => {
    expect(CODIGO).not.toMatch(/\babrirNovaAba\b/);
    expect(CODIGO).not.toMatch(/\benviarAgora\b/);
    expect(CODIGO).not.toMatch(/\baoEnviar\b/);
  });

  it('aoEsgotar: "bloqueada-sem-navegar" ⇒ setPasso(2); "aberta"/"navegou-top-level" ⇒ setAberto(false) (D4)', () => {
    const corpo = propriedadeDeps("aoEsgotar");
    expect(corpo).not.toBeNull();
    expect(corpo).toMatch(/"bloqueada-sem-navegar"/);
    expect(corpo).toMatch(/setPasso\(2\)/);
    expect(corpo).toMatch(/setAberto\(false\)/);
    // O desfecho só mexe na UI: quem navega é o módulo, via navegarTopLevel.
    expect(corpo).not.toMatch(/window\./);
  });
});

// ---------------------------------------------------------------------------
// 8. F3 — botões de envio viram LINK DECLARATIVO (D3)
// ---------------------------------------------------------------------------

describe("[aviso-wpp-nova-aba] F3 — \"Enviar agora\"/\"Enviar mensagem\" são <a target=\"_blank\" rel=\"noopener noreferrer\"> (Base UI, sem asChild)", () => {
  for (const rotulo of ["Enviar agora", "Enviar mensagem"]) {
    it(`"${rotulo}": Button nativeButton={false} + render={<a …/>}, onClick={aoFechar}, sem type="button" nem preventDefault`, () => {
      const botao = botaoComRotulo(rotulo);
      expect(botao).toMatch(/nativeButton=\{false\}/);
      expect(botao).toMatch(/render=\{\s*<a\b/);
      expect(botao).toMatch(/target="_blank"/);
      expect(botao).toMatch(/rel="noopener noreferrer"/);
      expect(botao).toMatch(/onClick=\{aoFechar\}/);
      expect(botao).not.toMatch(/type="button"/);
      expect(botao).not.toMatch(/preventDefault/);
      // Alvo de toque ≥44px e variante default preservados.
      expect(botao).toMatch(/className="min-h-11 w-full"/);
      expect(botao).not.toMatch(/variant=/);
    });
  }

  it('`nativeButton={false}`, `target="_blank"` e `rel="noopener noreferrer"` literais: exatamente 2 de cada', () => {
    expect(CODIGO.match(/nativeButton=\{false\}/g) ?? []).toHaveLength(2);
    expect(CODIGO.match(/target="_blank"/g) ?? []).toHaveLength(2);
    expect(CODIGO.match(/rel="noopener noreferrer"/g) ?? []).toHaveLength(2);
    expect(CODIGO.match(/render=\{\s*<a\b/g) ?? []).toHaveLength(2);
  });

  it("o `href` de cada <a> vem do `destino` da contagem (guard §15), nunca da prop `href` crua", () => {
    const tags = CODIGO.match(/<a\b[^>]*>/g) ?? [];
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      const valor = /\bhref=\{([^}]*)\}/.exec(tag);
      expect(valor, `<a> sem href={…}: ${tag}`).not.toBeNull();
      expect(valor![1]).toMatch(/destino/);
      expect(valor![1]).not.toMatch(/(?<![.\w])href\b/);
    }
    // A fonte do valor é o `destino` exposto pela contagem (aprovado).
    expect(CODIGO).toMatch(/contagem\.destino/);
  });

  it("nenhum `window.location.href` fora de `navegarTopLevel` (o gesto nunca navega top-level)", () => {
    expect(CODIGO.match(/window\.location\.href/g)).toHaveLength(1);
    const corpo = propriedadeDeps("navegarTopLevel");
    expect(corpo).toMatch(/window\.location\.href = destino;/);
  });

  it("nenhum `preventDefault` no arquivo — o clique do link segue o navegador", () => {
    expect(CODIGO).not.toMatch(/preventDefault/);
  });

  it('"Agora não" e "Sair mesmo assim" continuam botões nativos de saída (outline, type="button")', () => {
    const adiar = botaoComRotulo("Agora não");
    expect(adiar).toMatch(/type="button"/);
    expect(adiar).toMatch(/variant="outline"/);
    expect(adiar).toMatch(/onClick=\{aoAdiar\}/);
    expect(adiar).not.toMatch(/nativeButton/);

    const sair = botaoComRotulo("Sair mesmo assim");
    expect(sair).toMatch(/type="button"/);
    expect(sair).toMatch(/variant="outline"/);
    expect(sair).toMatch(/onClick=\{aoFechar\}/);
    expect(sair).not.toMatch(/nativeButton/);
  });

  it("comentário de `aoFechar` (S2): fecha o aviso; quem navega, se for o caso, é o próprio link", () => {
    expect(FONTE).toMatch(
      /fecha o aviso; quem navega, se for o caso, é o próprio link[\s\S]{0,40}?\*\/\s*function aoFechar\(\): void \{/i,
    );
  });
});
