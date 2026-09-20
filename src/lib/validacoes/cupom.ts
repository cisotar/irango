// Schema de validação da FORMA do cupom no cadastro/edição (FormCupom +
// Server Action de criar/editar). Valida o dado a persistir — NÃO a validade
// no momento do uso (isso é de `validarUsoCupom`, chamada por
// `revisarCarrinhoAction` e por `criarPedido`).
//
// Defesa em profundidade: a regra percentual 1..100 aqui é a 1ª barreira
// (impede persistir 150%); o clamp em calcularDesconto (020) é a 2ª.
import { z } from "zod";

// Valor monetário/percentual: > 0, no máximo 2 casas decimais.
const valorComDuasCasas = z
  .number()
  .positive()
  .refine((v) => Number.isInteger(Math.round(v * 100)) && v * 100 === Math.round(v * 100), {
    message: "Valor deve ter no máximo 2 casas decimais",
  });

/**
 * Código de cupom — FONTE ÚNICA da forma do código, nos TRÊS caminhos:
 * cadastro (`cupomSchema`), preview (`schemaRevisarCarrinho`) e autoritativo
 * (`schemaPayloadPedido`).
 *
 * Antes da correção da auditoria 228/229 havia DUAS réguas: o cadastro e o
 * preview aceitavam `^[A-Z0-9]+$` sem teto, o pedido exigia `{3,20}`. Um código
 * de 2 caracteres passava no preview e derrubava o pedido inteiro com erro
 * genérico (beco sem saída), e um código de ~1MB chegava ao `.eq("codigo", …)`.
 * O teto `{3,20}` é o do autoritativo — a régua mais apertada vence (§10-A).
 */
export const codigoCupomSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(
    z
      .string()
      .min(1, "Código é obrigatório")
      .regex(
        /^[A-Z0-9]{3,20}$/,
        "Código deve ter de 3 a 20 letras ou números",
      ),
  );

export const cupomSchema = z
  .object({
    codigo: codigoCupomSchema,
    tipo: z.enum(["percentual", "fixo"]),
    valor: valorComDuasCasas,
    pedido_minimo: z.number().min(0, "Pedido mínimo não pode ser negativo"),
    usos_maximos: z.number().int().positive().nullable(),
    expira_em: z
      .string()
      .datetime({ offset: true })
      .refine((s) => new Date(s).getTime() > Date.now(), {
        message: "Data de expiração deve ser no futuro",
      })
      .nullable(),
    ativo: z.boolean(),
  })
  .refine(
    (c) => c.tipo !== "percentual" || (c.valor >= 1 && c.valor <= 100),
    {
      message: "Percentual deve estar entre 1 e 100",
      path: ["valor"],
    },
  );
