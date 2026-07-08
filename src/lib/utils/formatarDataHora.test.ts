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
});
