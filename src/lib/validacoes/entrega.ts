// Schemas de ENTREGA — validam a FORMA da config de entrega do lojista no
// cadastro (lojista é cliente não-confiável tanto quanto o comprador):
//   - schemaZona   → zonas_entrega (nome, tipo enum, ativo)
//   - schemaTaxa   → taxas_entrega (taxa, pedido_minimo_gratis, raio_max_km)
//   - schemaBairro → bairros_zona (nome)
// FORA daqui: cálculo de frete, match de zona por endereço, RLS/unicidade.
import { z } from "zod";

const nomeObrigatorio = z.string().trim().min(1);

export const schemaZona = z.object({
  nome: nomeObrigatorio,
  tipo: z.enum(["bairro", "raio_km", "faixa_cep"]),
  ativo: z.boolean(),
});

export const schemaTaxa = z.object({
  // CRÍTICO: taxa negativa abriria valor de entrega que reduz o total.
  taxa: z
    .number()
    .min(0)
    .multipleOf(0.01),
  pedido_minimo_gratis: z.number().min(0).nullable(),
  raio_max_km: z.number().positive().nullable(),
});

export const schemaBairro = z.object({
  nome: nomeObrigatorio,
});
