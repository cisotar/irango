import { describe, expect, it } from "vitest";
import { formatarDataHora } from "./formatarDataHora";

describe("formatarDataHora", () => {
  it("formata o exemplo da issue (07/07/2026 14:32) convertendo UTC → America/Sao_Paulo", () => {
    // 17:32Z é 14:32 em São Paulo (UTC-3, sem horário de verão desde 2019).
    expect(formatarDataHora("2026-07-07T17:32:00Z")).toBe("07/07/2026 14:32");
  });

  it("usa espaço (não vírgula) entre data e hora", () => {
    expect(formatarDataHora("2026-07-07T17:32:00Z")).not.toContain(",");
  });

  it("converte para o fuso do Brasil quando o ISO vem com offset explícito", () => {
    // 14:32-03:00 já é horário local de São Paulo → sem deslocamento.
    expect(formatarDataHora("2026-07-07T14:32:00-03:00")).toBe("07/07/2026 14:32");
  });

  it("recua o dia quando a conversão de fuso cruza a meia-noite", () => {
    // 02:00Z de 08/07 é 23:00 de 07/07 em São Paulo (UTC-3).
    expect(formatarDataHora("2026-07-08T02:00:00Z")).toBe("07/07/2026 23:00");
  });

  it("preenche com zero à esquerda dia/mês/hora/minuto de um dígito", () => {
    // 12:05Z é 09:05 em São Paulo.
    expect(formatarDataHora("2026-01-05T12:05:00Z")).toBe("05/01/2026 09:05");
  });

  it("usa o fuso da loja quando informado (issue 351)", () => {
    // 17:32Z é 13:32 em Manaus (UTC-4) e 14:32 em São Paulo (UTC-3).
    expect(formatarDataHora("2026-07-07T17:32:00Z", "America/Manaus")).toBe("07/07/2026 13:32");
    expect(formatarDataHora("2026-07-07T17:32:00Z", "America/Sao_Paulo")).toBe("07/07/2026 14:32");
  });

  it("cruza a meia-noite no fuso da loja, não no de São Paulo", () => {
    // 03:30Z de 08/07 é 23:30 de 07/07 em Manaus, mas já 00:30 de 08/07 em São Paulo.
    expect(formatarDataHora("2026-07-08T03:30:00Z", "America/Manaus")).toBe("07/07/2026 23:30");
    expect(formatarDataHora("2026-07-08T03:30:00Z")).toBe("08/07/2026 00:30");
  });
});
