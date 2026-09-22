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

/**
 * [261] D14 — o domínio de `produtos.visibilidade`, declarado UMA vez. É o
 * mesmo enum consumido pelo `FormProduto` (um produto), pela ação em lote
 * (`schemaVisibilidadeEmLote`, N produtos) e pelas Server Actions dos dois
 * mundos: não existe segunda lista de valores válidos no projeto.
 *
 * `'menu'` × `'cardapio'` são jargão de schema e NÃO aparecem na tela — a copy
 * que o lojista lê é a de `plan/design-promocoes-e-vigencia.md` §13.5.
 */
export const visibilidadeProduto = z.enum(["menu", "cardapio"]);

/**
 * Teto de cardinalidade de QUALQUER lista de ids que o cliente manda (CWE-770,
 * o mesmo motivo do `.max()` de `pedido.ts`). Declarado UMA vez porque a UI
 * precisa do MESMO número para explicar a recusa antes de disparar a prévia —
 * um teto que só existe no zod vira "não foi possível" sem saída.
 */
export const TETO_LOTE = 200;

/** O tipo estreito de D14, para quem consome sem passar pelo parse. */
export type Visibilidade = z.infer<typeof visibilidadeProduto>;

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
  // [261] D14 — ONDE o produto aparece. `.default("menu")` é o MESMO default
  // da coluna (migration 20260920130000) e vale SÓ NO INSERT: produto novo sem
  // o campo nasce no menu, como a coluna faria sozinha.
  //
  // 🔴 No UPDATE este default seria o sistema mudando `visibilidade` por conta
  // própria — o invariante que a 255 declara impossível e que `removerCardapio`
  // defende RECUSANDO em vez de converter. Por isso o UPDATE usa
  // `schemaProdutoUpdate` (abaixo), onde o campo é OBRIGATÓRIO.
  // Eixo INDEPENDENTE de `oculto` e de `disponivel` — ver RN-05/D14.
  visibilidade: visibilidadeProduto.default("menu"),
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

/**
 * As regras de desconto, extraídas para que `schemaProduto` (INSERT) e
 * `schemaProdutoUpdate` (UPDATE) compartilhem UMA cópia. Os dois diferem
 * apenas na obrigatoriedade de `visibilidade` — nada mais pode divergir.
 */
function refinarDesconto(
  v: z.infer<typeof camposProduto>,
  ctx: z.RefinementCtx,
): void {
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
    } else {
      // [290] D10 tem UMA fonte: a função pura abaixo, também consumida pelas
      // Server Actions de patch estreito (nome+preço), que não passam por este
      // schema. Duplicar a comparação aqui seria a segunda fonte de verdade.
      const recusa = validarPrecoContraDesconto(
        v.preco,
        v.desconto_tipo,
        v.desconto_valor,
      );
      if (recusa != null) {
        ctx.addIssue({
          code: "custom",
          path: ["desconto_valor"],
          message: recusa,
        });
      }
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
}

/** A linha INTEIRA do produto, para o INSERT (`visibilidade` tem default). */
export const schemaProduto = camposProduto.superRefine(refinarDesconto);

/**
 * [Auditoria 260/261] A linha inteira do produto para o **UPDATE**.
 *
 * Idêntica ao `schemaProduto` em tudo, menos em `visibilidade`: aqui o campo é
 * OBRIGATÓRIO, espelhando `schemaVisibilidadeEmLote`. O UPDATE das actions
 * grava a linha inteira (`update({ ...parsed.data })`), então um default aqui
 * faria um payload sem o campo REESCREVER `'menu'` por cima de um produto que
 * era `'cardapio'` — um prato de temporada voltaria a vender o ano inteiro, em
 * silêncio, inclusive pelo caminho admin sob `service_role` (BYPASSRLS).
 *
 * Fail-closed: payload sem `visibilidade` é RECUSADO no parse, ANTES de
 * qualquer I/O — nenhum UPDATE sai, e a coluna não é tocada. O sistema nunca
 * muda `visibilidade` por conta própria; quem declara é sempre o lojista.
 */
export const schemaProdutoUpdate = camposProduto
  .extend({ visibilidade: visibilidadeProduto })
  .superRefine(refinarDesconto);

/**
 * O `id` do PRODUTO quando ele chega sozinho, fora do payload (`atualizarProduto`,
 * `removerProduto`, `alternarDisponibilidade`, `alternarOculto`). Mesmo contrato
 * de `schemaIdCardapio`: lixo não vira ida ao banco.
 */
export const schemaIdProduto = z.guid();

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
  .max(TETO_LOTE)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Ids repetidos na reordenação",
  });

/**
 * [261] D14 em LOTE — a forma do payload da barra de ação de `/painel/produtos`.
 *
 * Herda o contrato de `schemaLoteDeProdutos` (`lib/validacoes/cardapio.ts`),
 * que é o mesmo de `schemaReordenacaoCategorias`: `.strict()` (um `loja_id`
 * pendurado no payload não sobrevive ao parse — a loja é SEMPRE derivada de
 * `auth.uid()`), `z.guid()` em todo id, `.max(200)` de cardinalidade
 * (CWE-770), `.min(1)` porque escrever em zero produto é chamada sem efeito, e
 * sem duplicata (a seleção é um CONJUNTO).
 *
 * `visibilidade` reusa `visibilidadeProduto`: o lote não tem uma segunda
 * definição do domínio de D14.
 */
export const schemaVisibilidadeEmLote = z
  .object({
    produto_ids: z
      .array(z.guid())
      .min(1)
      .max(TETO_LOTE)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Ids repetidos na seleção",
      }),
    visibilidade: visibilidadeProduto,
  })
  .strict();

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

/**
 * [290] D10 como regra PURA e reusável, fora do schema da linha inteira.
 *
 * A edição inline de nome+preço não passa por `schemaProdutoUpdate` (que exige
 * a linha toda), mas D10 continua valendo: baixar o preço abaixo de um
 * `desconto_valor` FIXO já gravado é recusa, e a recusa precisa da frase
 * legível — não do `23514` cru do CHECK da 20260920120000, que protege o DADO
 * e não a MENSAGEM.
 *
 * `tipo`/`valor` são sempre os LIDOS DO BANCO; nenhum caller pode passar o que
 * o cliente mandou. Só `fixo` cruza com o preço — `percentual` não tem regra
 * cruzada.
 *
 * 🔴 A aridade é 3 de propósito. A faixa por tipo é INDEPENDENTE de
 * `desconto_ativo` (comentário de `refinarDesconto` acima), então um quarto
 * parâmetro `ativo` seria a porta por onde quem desligou a promoção e baixou o
 * preço escaparia para o 23514 genérico.
 */
export function validarPrecoContraDesconto(
  preco: number,
  tipo: string | null,
  valor: number | null,
): string | null {
  // `>` e não `>=`: preço IGUAL ao desconto fixo é aceito, exatamente como o
  // CHECK do banco (`desconto_valor <= preco`).
  if (tipo === "fixo" && valor != null && valor > preco) {
    return mensagemDescontoMaiorQuePreco(preco, valor);
  }
  return null;
}

/**
 * [290] O PATCH ESTREITO da edição inline: só `nome` e `preco`.
 *
 * Não reusa `camposProduto` (nem um `.pick()` dele) por opção de segurança
 * legível: este objeto é a allowlist do que a linha inline pode gravar, e o
 * contrato de `preco` é o MESMO `preco` declarado no topo deste módulo — uma
 * fonte só para numeric(10,2).
 *
 * Chave desconhecida é ESTRIPADA (comportamento padrão do `z.object`), não
 * recusada: `loja_id`, `visibilidade`, `foto_url` e companhia vindos do
 * cliente simplesmente não sobrevivem ao parse e não chegam ao patch. É o que
 * as Server Actions gravam — nunca `{ ...payload }`.
 */
export const schemaNomeEPreco = z.object({
  nome: z.string().trim().min(1).max(200),
  preco,
});

// Prefixo estável da frase acima. A Server Action promove ao lojista APENAS
// esta mensagem de validação (todo o resto do parse falho segue genérico), e
// precisa reconhecê-la sem reconstruí-la a partir de um payload não validado.
const PREFIXO_D10 = "Não dá para salvar: o preço novo (";

/** Verdadeiro quando a mensagem é a de D10 (a única promovida à UI). */
export function ehMensagemDescontoMaiorQuePreco(mensagem: string): boolean {
  return mensagem.startsWith(PREFIXO_D10);
}
