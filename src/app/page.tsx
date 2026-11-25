import Link from "next/link";
import type { CSSProperties } from "react";

import { FooterPublico } from "@/components/FooterPublico";
import { LandingEfeitos } from "@/components/landing/LandingEfeitos";

import "./landing.css";

/**
 * Landing do SaaS. Página estática (SSG) de marca — usa a paleta do iRango, não
 * tema de loja. O redirect de usuário autenticado para `/painel` é feito no
 * middleware (issue 016), não aqui.
 *
 * Visual vem do mockup aprovado `mockups/landing-moderna.html`. CSS escopado em
 * `.lp` (`landing.css`); efeitos de scroll/animação em `LandingEfeitos` (client).
 * As vitrines da galeria e os celulares do hero são EXEMPLOS ilustrativos, não
 * lojas reais — não linkar nem apresentar como clientes.
 */

const atraso = (ms: number): CSSProperties => ({ ["--d" as string]: `${ms}ms` });
const largura = (w: string): CSSProperties => ({ ["--w" as string]: w });

const VITRINES_EXEMPLO = [
  { nome: "Padaria Estrela", cat: "Padaria", emo: "🥐", bg: "linear-gradient(135deg,#f0b46a,#8a5a2b)", logo: "🥖" },
  { nome: "Brasa Burger", cat: "Hamburgueria", emo: "🍔", bg: "linear-gradient(135deg,#e8743b,#6d2a12)", logo: "🔥" },
  { nome: "Doce Vila", cat: "Confeitaria", emo: "🎂", bg: "linear-gradient(135deg,#f08aa8,#7d2f4d)", logo: "🍓" },
  { nome: "Marmita da Vó", cat: "Marmitaria", emo: "🍛", bg: "linear-gradient(135deg,#9bc26a,#3d5a22)", logo: "👵" },
  { nome: "Pizza do Bairro", cat: "Pizzaria", emo: "🍕", bg: "linear-gradient(135deg,#f2c14e,#a1431c)", logo: "🍅" },
  { nome: "Açaí Tropical", cat: "Açaiteria", emo: "🍇", bg: "linear-gradient(135deg,#a56ad8,#3b1d63)", logo: "🌴" },
] as const;

const CONFETES = ["🥐", "🍔", "🍕", "🧁", "🥖", "🍰", "🍇", "🍛"];

export default function Home() {
  return (
    <div className="lp">
      <LandingEfeitos />
      <header id="topo">
        <div className="wrap nav">
          <a className="logo" href="#topo">🥖 iRango</a>
          <nav aria-label="Navegação principal">
            <a className="hide-m" href="#vitrines">Vitrines</a>
            <a className="hide-m" href="#como">Como funciona</a>
            <Link href="/login">Entrar</Link>
            <Link className="pill" href="/cadastro">Criar conta</Link>
          </nav>
        </div>
      </header>

      <main>
        <div className="hero">
          <div className="blob b1" /><div className="blob b2" />
          <div className="wrap hero-grid">
            <div>
              <span className="selo"><i /> SaaS para comércio local</span>
              <h1>Sua loja online<br />pronta <span className="rot" id="rot">em minutos</span></h1>
              <p className="lead">Cardápio digital, pedido direto no WhatsApp, entrega por zona e cupons. Sem comissão por pedido.</p>
              <div className="cta-row">
                <Link className="btn btn-brasa" href="/cadastro">Crie sua loja grátis →</Link>
                <a className="btn btn-ghost" href="#como">Ver como funciona</a>
              </div>
              <p className="micro">Sem cartão de crédito. Cancele quando quiser.</p>
            </div>

            <div className="stage" id="palco" aria-hidden="true">
              <Celular cls="p1" depth={14} cab="🥖 Padaria Estrela" grad="linear-gradient(135deg,#7a4a22,#332616)" abas={["Pães", "Doces", "Bebidas"]}
                itens={[["#fbe3c4", "🥐", "Croissant", "Manteiga francesa", "R$ 8,50"], ["#f3d9b0", "🍞", "Pão de fermentação natural", "Fatiado", "R$ 18,00"], ["#fde8d4", "🥖", "Baguete", "Crocante", "R$ 9,00"]]}
                barra={["Ver carrinho (2)", "R$ 26,50"]} />
              <Celular cls="p2" depth={26} cab="🍔 Brasa Burger" grad="linear-gradient(135deg,#c0451f,#332616)" abas={["Combos", "Burgers", "Porções"]}
                itens={[["#ffd9c2", "🍔", "Duplo Cheddar", "+ batata e refri", "R$ 34,90"], ["#ffe9b8", "🍟", "Batata rústica", "Porção grande", "R$ 19,00"], ["#e3f0d4", "🥤", "Refri 600ml", "Gelado", "R$ 7,00"]]}
                barra={["Finalizar pedido", "R$ 60,90"]} />
              <Celular cls="p3" depth={18} cab="🍰 Doce Vila" grad="linear-gradient(135deg,#d6567a,#332616)" abas={["Bolos", "Tortas", "Kits"]}
                itens={[["#ffd6e2", "🎂", "Bolo no pote", "Ninho com morango", "R$ 12,00"], ["#f6e0c8", "🧁", "Cupcake", "Escolha a cobertura", "R$ 9,50"], ["#e8d9f5", "🍮", "Pudim", "Fatia", "R$ 11,00"]]}
                barra={["Ver carrinho (1)", "R$ 12,00"]} />
              <div className="chip c1">🛒 Novo pedido!</div>
              <div className="chip c2">📲 Chegou no WhatsApp</div>
              <div className="chip c3">🎟️ Cupom aplicado</div>
            </div>
          </div>
        </div>

        <div className="nums">
          <div className="wrap">
            <div><strong>0%</strong><span>de comissão por pedido</span></div>
            <div><strong>0</strong><span>logins ou apps para o cliente pedir</span></div>
            <div><strong data-count="14" data-suf=" dias">14 dias</strong><span>de teste grátis</span></div>
          </div>
        </div>

        <section id="vitrines">
          <div className="wrap gal-head center rv">
            <div className="eyebrow">Vitrines</div>
            <h2 className="sec-t">Cada loja com a sua cara</h2>
            <p className="sec-s">Cada loja ganha seu link e sua vitrine, com as cores e a identidade do negócio. Exemplos ilustrativos.</p>
          </div>
          <div className="marquee rv" style={atraso(150)}>
            <div className="track">
              {[0, 1].map((copia) =>
                VITRINES_EXEMPLO.map((l) => (
                  <div className="loja" key={`${copia}-${l.nome}`} aria-hidden={copia === 1 || undefined}>
                    <div className="capa" style={{ background: l.bg }}>
                      <span className="emo">{l.emo}</span>
                      <div className="mini"><i /><i /><i /><i /></div>
                    </div>
                    <div className="logo-r" style={{ background: "#fff" }}>{l.logo}</div>
                    <div className="info"><h3>{l.nome}</h3><small>{l.cat}</small></div>
                  </div>
                )),
              )}
            </div>
          </div>
        </section>

        <section id="como" style={{ paddingTop: 20 }}>
          <div className="wrap">
            <div className="center rv">
              <div className="eyebrow">Como funciona</div>
              <h2 className="sec-t">Do zero ao primeiro pedido</h2>
              <p className="sec-s">Três passos, sem instalar nada e sem falar com programador.</p>
            </div>
            <div className="passos">
              <div className="passo rv">
                <span className="n">1</span>
                <div className="demo">
                  <div className="chk"><b>✓</b> Pão francês · R$ 1,20</div>
                  <div className="chk"><b>✓</b> Horário: 6h às 19h</div>
                  <div className="chk"><b>✓</b> Entrega: bairro Centro</div>
                </div>
                <h3>Cadastre produtos e horários</h3>
                <p>Foto, preço, opcionais, zonas de entrega e cupons, tudo pelo celular.</p>
              </div>
              <div className="passo rv" style={atraso(120)}>
                <span className="n">2</span>
                <div className="demo">
                  <div className="linkbox">🔗 irango.app/loja/sua-padaria <span className="cp">Copiar</span></div>
                  <small style={{ color: "var(--muted)", textAlign: "center" }}>Cole na bio do Instagram, no status ou no cartão.</small>
                </div>
                <h3>Compartilhe o link</h3>
                <p>O cliente abre, escolhe e pede. Não precisa de login nem de app.</p>
              </div>
              <div className="passo rv" style={atraso(240)}>
                <span className="n">3</span>
                <div className="demo wa">
                  <div className="msg">🛒 <b>Novo pedido #128</b><br />2x Croissant · 1x Baguete<br />📍 Rua das Flores, 45<br />💳 Pix</div>
                  <div className="msg ok">Anotado! Saindo em 20 min 🛵</div>
                  <div className="typing"><i /><i /><i /></div>
                </div>
                <h3>Receba no WhatsApp</h3>
                <p>O pedido chega pronto, com itens, endereço e pagamento. Sem intermediário.</p>
              </div>
            </div>
          </div>
        </section>

        <section style={{ paddingTop: 20 }}>
          <div className="wrap">
            <div className="center rv">
              <div className="eyebrow">Recursos</div>
              <h2 className="sec-t">Tudo para vender online</h2>
            </div>
            <div className="bento">
              <div className="bc dark w2 h2 rv">
                <div className="ic">🏪</div><h3>Vitrine pronta em minutos</h3>
                <p>Cadastre produtos, defina horários e compartilhe. Funciona como app: o cliente instala na tela inicial do celular.</p>
                <div className="hrs" style={{ marginTop: 26 }}><span>☕ Manhã</span><span className="on">🍽️ Almoço</span><span>🌙 Jantar</span></div>
                <p style={{ marginTop: 10, fontSize: ".78rem" }}>Vários cardápios ligam e desligam sozinhos no horário.</p>
              </div>
              <div className="bc rv" style={atraso(80)}><div className="ic">🛵</div><h3>Entrega por zona</h3><p>Frete por bairro ou por raio em km.</p></div>
              <div className="bc warm rv" style={atraso(160)}><div className="ic">🎟️</div><h3>Cupons</h3><p>Percentual ou valor fixo, com validade.</p><span className="cupom">BEMVINDO10</span></div>
              <div className="bc w2 rv" style={atraso(100)}><div className="ic">🧩</div><h3>Opcionais e adicionais</h3><p>Tamanho, borda, acompanhamento. O cliente escolhe e o valor certo é calculado na hora.</p></div>
              <div className="bc w2 rv" style={atraso(180)}><div className="ic">🖨️</div><h3>Comanda e recibo</h3><p>Prontos para imprimir.</p></div>
              <div className="bc w2 rv" style={atraso(260)}><div className="ic">💬</div><h3>WhatsApp direto</h3><p>Sem app extra, sem intermediário.</p></div>
            </div>
          </div>
        </section>

        <section style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div className="vs rv">
              <div className="eyebrow" style={{ color: "var(--ouro)" }}>O diferencial</div>
              <h2 className="sec-t">Venda mais. Pague o mesmo.</h2>
              <p className="sec-s">Mensalidade fixa. O iRango não fica com uma fatia de cada pedido.</p>
              <div className="cmp">
                <div className="col">
                  <h3>Marketplace com comissão</h3>
                  <div className="row">Você vende R$ 10.000<div className="meter"><i style={largura("100%")} /></div></div>
                  <div className="row">Fica com a plataforma (porcentagem)<div className="meter"><i style={largura("70%")} /></div></div>
                  <p style={{ fontSize: ".8rem", opacity: 0.7 }}>Quanto mais vende, mais paga.</p>
                </div>
                <div className="col good">
                  <h3>iRango</h3>
                  <div className="row">Você vende R$ 10.000<div className="meter"><i style={largura("100%")} /></div></div>
                  <div className="row">Fica com a plataforma (comissão)<div className="meter"><i style={largura("0%")} /></div></div>
                  <p style={{ fontSize: ".8rem", color: "var(--muted)" }}>Só a mensalidade fixa, seja qual for o volume.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="cta" id="cta">
          {CONFETES.map((e, i) => (
            <span
              key={e}
              aria-hidden
              className="conf"
              style={{ left: `${6 + i * 12}%`, bottom: 0, animationDuration: `${9 + (i % 4) * 3}s`, animationDelay: `${-i * 2}s`, fontSize: `${1.4 + (i % 3) * 0.5}rem` }}
            >
              {e}
            </span>
          ))}
          <div className="wrap" style={{ position: "relative", zIndex: 2 }}>
            <h2>Pronto para começar?</h2>
            <p>Crie sua conta agora e comece a receber pedidos hoje mesmo.</p>
            <Link className="btn btn-brasa pulse" href="/cadastro">Crie sua loja grátis →</Link>
            <p style={{ fontSize: ".8rem", opacity: 0.55, marginTop: 16 }}>Sem cartão de crédito. Cancele quando quiser.</p>
          </div>
        </div>
      </main>

      <FooterPublico />
    </div>
  );
}

function Celular({ cls, depth, cab, grad, abas, itens, barra }: {
  cls: string;
  depth: number;
  cab: string;
  grad: string;
  abas: string[];
  itens: string[][];
  barra: [string, string];
}) {
  return (
    <div className={`phone ${cls}`} data-depth={depth}>
      <div className="screen">
        <div className="sc-head" style={{ background: grad }}>{cab}</div>
        <div className="sc-tabs">{abas.map((a, i) => <span key={a} className={i === 0 ? "on" : undefined}>{a}</span>)}</div>
        {itens.map(([bg, emo, nome, sub, preco]) => (
          <div className="item" key={nome}>
            <div className="ph" style={{ background: bg }}>{emo}</div>
            <div><b>{nome}</b><small>{sub}</small><em>{preco}</em></div>
            <div className="add">+</div>
          </div>
        ))}
        <div className="bar"><span>{barra[0]}</span><span>{barra[1]}</span></div>
      </div>
    </div>
  );
}
