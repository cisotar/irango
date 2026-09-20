import { z } from "zod";
import { schemaStorageUrl } from "./storage";
import { formatarMoeda } from "@/lib/utils/formatarMoeda";

// Validação isomórfica (form + Server Action). Espelha as constraints do banco
// (references/schema.md). Contrato documentado em produto.test.ts.
//
// RN-11 / seguranca.md §6: `preco` é tratado como NÚMERO. A coerção string->number
// é responsabilidade da borda (form), não do schema autoritativo do servidor.
// numeric(10,2): negativo, NaN, Infinity e >2 casas decimais são rejeitados.

const preco = z
  .number()
  .finite()
  .min(0)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
    message: "Preço deve ter no máximo 2 casas decimais",
  });

// Hora local do lojista: "YYYY-MM-DDTHH:MM", o value nativo do datetime-local.
// Sem segundos e sem offset — um ISO absoluto ("...T23:59:00.000Z") é recusado.
const prazoLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data e hora inválidas")
  .nullable()
  .optional();

// Campos do produto. O `superRefine` de desconto vive logo abaixo, separado,
// para que este objeto continue legível (e o diff das colunas novas, mínimo).
const camposProduto = z.object({
  nome: z.string().trim().min(1).max(200),
  descricao: z.string().optional(),
  preco,
  // z.guid(): qualquer UUID com formato válido (sem exigir versão/variante RFC),
  // espelhando o tipo `uuid` do Postgres, que não impõe versão.
  categoria_id: z.guid().nullable().optional(),
  disponivel: z.boolean(),
  // Visibilidade na vitrine (issue 085 / migration 083). Obrigatório e boolean,
  // espelhando `disponivel`: o form sempre envia o valor explícito; o DEFAULT
  // false vive no banco (RN-7). Separado de `disponivel` (RN-6-b).
  oculto: z.boolean(),
  ordem: z.number().int().min(0),
  // foto_url (issue 072): camada autoritativa anti-injeção de URL — renderizada
  // como <Image src> na vitrine pública. `preprocess` normaliza "" (form sem
  // foto) → null ANTES do parse (`.url()` rejeitaria ""); `.nullish()` aceita
  // ausência/null. URL externa, `javascript:` e bucket alheio são barrados pelo
  // refine de schemaStorageUrl. Tipo: `foto_url?: string | null | undefined`.
  foto_url: z.preprocess(
    (v) => (v === "" ? null : v),
    schemaStorageUrl.nullish(),
  ),
  // ── Desconto por produto (issue 230; CHECKs da 219 são o backstop) ────────
  // Os cinco campos são OPCIONAIS na FORMA (payload legado sem bloco de
  // promoção continua válido) mas nunca parcialmente: enviar qualquer um deles
  // sem `desconto_ativo` é recusado no superRefine — não existe default
  // silencioso. Nenhum é estripado: a action faz `insert({ ...parsed.data })`,
  // e estripar aqui apagaria a promoção do lojista ao desligar (RN-07).
  desconto_ativo: z.boolean().optional(),
  desconto_tipo: z.enum(["percentual", "fixo"]).nullable().optional(),
  desconto_valor: z.number().finite().nullable().optional(),
  // HORA LOCAL do lojista, no formato nativo do <input type="datetime-local">.
  // NÃO é instante: o schema roda ANTES de qualquer I/O e não conhece
  // `lojas.timezone`; quem converte para instante absoluto é a Server Action,
  // por `instanteNoFuso` (RN-03). Aceitar um ISO com offset aqui faria o campo
  // significar duas coisas conforme quem o preencheu.
  desconto_inicio: prazoLocal,
  desconto_fim: prazoLocal,
});

export const schemaProduto = camposProduto.superRefine((v, ctx) => {
  const enviouBloco =
    v.desconto_ativo !== undefined ||
    v.desconto_tipo !== undefined ||
    v.desconto_valor !== undefined ||
    v.desconto_inicio !== undefined ||
    v.desconto_fim !== undefined;
  if (!enviouBloco) return;

  if (typeof v.desconto_ativo !== "boolean") {
    ctx.addIssue({
      code: "custom",
      path: ["desconto_ativo"],
      message: "Informe se a promoção está ligada ou desligada",
    });
  }

  // Coerência do ligado (RN-07): promoção ligada exige tipo E valor.
  if (v.desconto_ativo === true) {
    if (v.desconto_tipo == null) {
      ctx.addIssue({
        code: "custom",
        path: ["desconto_tipo"],
        message: "Escolha o tipo do desconto",
      });
    }
    if (v.desconto_valor == null) {
      ctx.addIssue({
        code: "custom",
        path: ["desconto_valor"],
        message: "Informe o valor do desconto",
      });
    }
  }

  // Faixa por tipo — INDEPENDENTE de `desconto_ativo`, exatamente como os
  // CHECKs da 219: quem desligou a promoção e baixou o preço precisa da
  // mensagem legível de D10, não de um 23514 cru (RN-06).
  if (v.desconto_tipo === "percentual" && v.desconto_valor != null) {
    if (!(v.desconto_valor > 0 && v.desconto_valor <= 100)) {
      ctx.addIssue({
        code: "custom",
        path: ["desconto_valor"],
        message: "Percentual deve estar entre 1 e 100",
      });
    }
  }

  if (v.desconto_tipo === "fixo" && v.desconto_valor != null) {
    if (!(v.desconto_valor > 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["desconto_valor"],
        message: "Valor do desconto deve ser maior que zero",
      });
    } else if (v.desconto_valor > v.preco) {
      ctx.addIssue({
        code: "custom",
        path: ["desconto_valor"],
        message: mensagemDescontoMaiorQuePreco(v.preco, v.desconto_valor),
      });
    }
  }

  // Janela: comparação lexicográfica basta no formato YYYY-MM-DDTHH:MM (e os
  // dois lados são hora local da MESMA loja, então o fuso não entra).
  if (
    v.desconto_inicio != null &&
    v.desconto_fim != null &&
    v.desconto_fim <= v.desconto_inicio
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["desconto_fim"],
      message: "O fim da promoção deve ser depois do início",
    });
  }
});

export const schemaCategoria = z.object({
  nome: z.string().trim().min(1),
  ordem: z.number().int().min(0),
});

/**
 * Reordenação de categorias (issue 175). O cliente manda APENAS a sequência de
 * ids — nunca valores de `ordem`, que são derivados do índice no servidor, e
 * nunca `nome`/`loja_id`. Por isso NÃO reusa `schemaCategoria`, que exige
 * justamente `nome` e `ordem`.
 *
 * `.min(2)`: lista de 1 não tem ordem (o botão nem renderiza).
 * `.max(200)`: teto de cardinalidade (CWE-770, mesmo motivo do `.max()` de
 * `pedido.ts`) — sem ele um array de 100k ids vira amplificação de payload.
 * O refine de unicidade é defesa em profundidade: a RPC também rejeita
 * duplicata pelo `row_count`, mas duplicata nem deve chegar ao banco.
 */
export const schemaReordenacaoCategorias = z
  .array(z.guid())
  .min(2)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Ids repetidos na reordenação",
  });

/**
 * Mensagem literal de D10 (M7 do design §8.2): nomeia os DOIS números e as
 * DUAS saídas. Função PURA, definida UMA vez e consumida pelo `superRefine` do
 * `schemaProduto`, para que form, Server Action do lojista e Server Action do
 * admin recebam exatamente o mesmo texto.
 *
 * É mensagem de VALIDAÇÃO (o lojista precisa lê-la), não erro interno — nada a
 * ver com o `23514` do Postgres, que vira mensagem genérica + log.
 */
export function mensagemDescontoMaiorQuePreco(
  preco: number,
  desconto: number,
): string {
  return (
    `Não dá para salvar: o preço novo (${formatarMoeda(preco)}) é menor que ` +
    `o desconto configurado (${formatarMoeda(desconto)}). Reduza o desconto ` +
    `para no máximo ${formatarMoeda(preco)} ou desligue a promoção deste produto.`
  );
}

// Prefixo estável da frase acima. A Server Action promove ao lojista APENAS
// esta mensagem de validação (todo o resto do parse falho segue genérico), e
// precisa reconhecê-la sem reconstruí-la a partir de um payload não validado.
const PREFIXO_D10 = "Não dá para salvar: o preço novo (";

/** Verdadeiro quando a mensagem é a de D10 (a única promovida à UI). */
export function ehMensagemDescontoMaiorQuePreco(mensagem: string): boolean {
  return mensagem.startsWith(PREFIXO_D10);
}
