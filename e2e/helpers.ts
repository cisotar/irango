import type { CDPSession, Page } from "@playwright/test";

/** Credenciais da loja de teste ("Lanches base"). Nunca em código: só por env. */
export const credenciais = {
  email: process.env.E2E_EMAIL,
  senha: process.env.E2E_SENHA,
};

export const temCredenciais = Boolean(credenciais.email && credenciais.senha);

/** Login por e-mail e senha — o botão do Google é bloqueado em browser automatizado. */
export async function entrarNoPainel(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(credenciais.email!);
  await page.getByLabel("Senha", { exact: true }).fill(credenciais.senha!);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/painel/);
}

/**
 * Arrasto por TOQUE de verdade. `page.touchscreen` só sabe tocar (tap); o
 * gesto de arrastar exige emitir touchStart → touchMove → touchEnd pelo CDP,
 * que é o que o Chromium converte em pointer events (e em scroll, se o
 * elemento não tiver `touch-action: none`).
 */
export async function arrastarComToque(
  cdp: CDPSession,
  de: { x: number; y: number },
  deltaY: number,
  passos = 12,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: de.x, y: de.y }],
  });
  for (let i = 1; i <= passos; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: de.x, y: de.y + (deltaY * i) / passos }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
