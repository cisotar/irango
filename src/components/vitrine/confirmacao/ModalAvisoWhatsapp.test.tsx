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
    expect(efeito?.[1]).toContain("decidirAvisoWhatsapp(");
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

  it("marca como exibido ANTES de abrir (revisita não pode reabrir o aviso)", () => {
    const efeito = /useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(CODIGO);
    const corpo = efeito![1];
    expect(corpo.indexOf("marcarAvisoWhatsappExibido(")).toBeGreaterThan(-1);
    expect(corpo.indexOf("marcarAvisoWhatsappExibido(")).toBeLessThan(
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
    // do efeito (já travado no teste acima) — não há um quarto caminho.
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
      /const persistiu = marcarAvisoWhatsappExibido\(storage, pedidoId\);/,
    );
    expect(CODIGO.match(/contagem\.iniciar\(\)/g)).toHaveLength(1);
    expect(CODIGO).toMatch(
      /if \(persistiu\) \{\s*contagem\.iniciar\(\);\s*\} else \{\s*setPasso\(2\);\s*\}/,
    );
  });

  it("sem gate confiável o aviso abre direto no passo 2 — só gesto navega, e os dois botões seguem na tela", () => {
    // `navegarTopLevel` só é alcançável a partir de um tick da contagem, que
    // não foi armada; restam os botões do passo 2, ambos por gesto.
    expect(CODIGO).toMatch(/navegarTopLevel: \(destino\) => \{/);
    expect(CODIGO.match(/setPasso\(2\)/g)).toHaveLength(2); // aoAdiar + fallback
    expect(CODIGO).toMatch(/onClick=\{aoEnviar\}/);
    expect(CODIGO).toMatch(/onClick=\{aoFechar\}/);
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
// 6. Popup bloqueado — `window.open` devolve null e o gesto cai para top-level
// ---------------------------------------------------------------------------

describe("[287] gesto com popup bloqueado — fallback para navegação top-level (§2.4 do plano)", () => {
  it("`window.open` é chamado UMA vez e seu retorno é verificado", () => {
    expect(CODIGO.match(/window\.open\(/g)).toHaveLength(1);
    expect(CODIGO).toMatch(
      /const aba = window\.open\(destino, "_blank", "noopener"\);/,
    );
  });

  it("retorno `null` (bloqueador) ⇒ o MESMO destino vai para `window.location.href`", () => {
    // Sem isto o clique no botão de envio não faria nada: nem aba, nem aviso.
    expect(CODIGO).toMatch(
      /const aba = window\.open\(destino, "_blank", "noopener"\);\s*if \(aba == null\) \{\s*window\.location\.href = destino;\s*\}/,
    );
  });

  it("o fallback usa o destino já aprovado pelo guard, nunca o `href` cru da prop", () => {
    // `destino` é o parâmetro que `criarContagemAviso` entrega já passado por
    // `urlHttpsSegura`; usar `href` aqui contornaria o guard §15.
    const abertura = /abrirNovaAba: \(destino\) => \{([\s\S]*?)\n      \},/.exec(
      CODIGO,
    );
    expect(abertura).not.toBeNull();
    // `location.href` é propriedade, não a prop: só o identificador solto
    // `href` (sem `.` antes) contornaria o guard.
    expect(abertura![1]).not.toMatch(/(?<!\.)\bhref\b/);
  });
});
