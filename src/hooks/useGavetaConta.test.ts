import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abrirGavetaConta,
  fecharGavetaConta,
  getServerSnapshot,
  getSnapshot,
  subscribe,
  zerarGavetaConta,
} from "./useGavetaConta";

describe("store da gaveta da conta", () => {
  beforeEach(() => {
    zerarGavetaConta();
  });

  it("nasce fechada, inclusive no SSR", () => {
    expect(getSnapshot()).toEqual({ aberta: false, origem: "menu" });
    expect(getServerSnapshot()).toEqual({ aberta: false, origem: "menu" });
  });

  it("abrir pelo Finalizar pedido guarda a origem", () => {
    abrirGavetaConta("finalizar");
    expect(getSnapshot()).toEqual({ aberta: true, origem: "finalizar" });
  });

  it("fechar mantém a origem (animação de saída não troca o conteúdo)", () => {
    abrirGavetaConta("finalizar");
    fecharGavetaConta();
    expect(getSnapshot()).toEqual({ aberta: false, origem: "finalizar" });
  });

  it("abrir pelo menu substitui a origem anterior", () => {
    abrirGavetaConta("finalizar");
    fecharGavetaConta();
    abrirGavetaConta("menu");
    expect(getSnapshot()).toEqual({ aberta: true, origem: "menu" });
  });

  it("avisa os ouvintes e para de avisar depois do unsubscribe", () => {
    const ouvinte = vi.fn();
    const sair = subscribe(ouvinte);
    abrirGavetaConta("menu");
    expect(ouvinte).toHaveBeenCalledTimes(1);
    sair();
    fecharGavetaConta();
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it("fechar já fechada e zerar já zerada não emitem", () => {
    const ouvinte = vi.fn();
    const sair = subscribe(ouvinte);
    fecharGavetaConta();
    zerarGavetaConta();
    expect(ouvinte).not.toHaveBeenCalled();
    sair();
  });
});
