/**
 * Arrasto por toque das categorias em /painel/produtos (issue 175, coberta pela 176).
 *
 * O que este teste PROVA (toque emitido pelo CDP em Chromium com hasTouch):
 *  - a alça "Reordenar <nome>" tem alvo de toque de pelo menos 44px;
 *  - arrastar pela alça troca a ordem das linhas;
 *  - o arrasto NÃO leva a rolagem vertical da página junto — razão de existir
 *    da alça dedicada com `touch-action: none`.
 *
 * O que NÃO prova (por isso o checklist em aparelho real continua valendo para
 * mudança de interação por toque; ninguém escreve "validado em mobile" só com
 * base neste teste):
 *  - quirks do Safari iOS (rolagem elástica, long-press, teclado virtual);
 *  - latência e inércia de um dedo de verdade, ou toque com dois dedos;
 *  - Chrome Android real com barra de endereço retrátil e overscroll nativo;
 *  - qualquer navegador que não seja Chromium.
 *
 * Escreve na loja de teste do cloud (reordena e desfaz no fim). Pulado sem
 * `E2E_EMAIL` / `E2E_SENHA`.
 */
import { expect, test } from "@playwright/test";
import { arrastarComToque, entrarNoPainel, temCredenciais } from "./helpers";

test.skip(!temCredenciais, "defina E2E_EMAIL e E2E_SENHA (loja de teste)");

test("arrastar pela alça reordena sem rolar a página", async ({ page, context }) => {
  await entrarNoPainel(page);
  await page.goto("/painel/produtos");
  await page.getByRole("button", { name: "Reordenar categorias" }).click();

  const alcas = page.getByRole("button", { name: /^Reordenar (?!categorias)/ });
  await expect(alcas.nth(1)).toBeVisible();

  const nomes = async () =>
    (await alcas.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))));
  const antes = await nomes();
  expect(antes.length).toBeGreaterThanOrEqual(2);

  const primeira = alcas.first();
  await primeira.scrollIntoViewIfNeeded();
  const caixa = (await primeira.boundingBox())!;
  expect(caixa.width).toBeGreaterThanOrEqual(44);
  expect(caixa.height).toBeGreaterThanOrEqual(44);

  const segunda = (await alcas.nth(1).boundingBox())!;
  const deslocamento = segunda.y - caixa.y + segunda.height / 2;
  const scrollAntes = await page.evaluate(() => window.scrollY);

  const cdp = await context.newCDPSession(page);
  const centro = { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 };
  await arrastarComToque(cdp, centro, deslocamento);

  await expect.poll(nomes).not.toEqual(antes);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollAntes);

  // Desfaz: o último movimento volta a ordem original na loja de teste.
  const depois = await nomes();
  const nova = (await alcas.nth(1).boundingBox())!;
  await arrastarComToque(
    cdp,
    { x: nova.x + nova.width / 2, y: nova.y + nova.height / 2 },
    -deslocamento,
  );
  await expect.poll(nomes).toEqual(antes);
  expect(depois).not.toEqual(antes);
});
