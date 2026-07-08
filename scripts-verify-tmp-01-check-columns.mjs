// Verifica: colunas modulo_impressao_* existem em `lojas` (prova de deploy no cloud).
// Usa service_role só para leitura de schema/estado — nunca imprime valores de env.
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Faltam envs (nomes apenas, sem valores): NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

const { data, error } = await supabase
  .from("lojas")
  .select("id, slug, nome, modulo_impressao_a4, modulo_impressao_termica, whatsapp_envio_automatico")
  .limit(10);

if (error) {
  console.error("ERRO ao consultar lojas:", error);
  process.exit(1);
}

console.log(`Colunas modulo_impressao_* existem — OK. ${data.length} lojas lidas.`);
console.table(
  data.map((l) => ({
    id: l.id.slice(0, 8),
    slug: l.slug,
    nome: l.nome,
    a4: l.modulo_impressao_a4,
    termica: l.modulo_impressao_termica,
    whatsapp_auto: l.whatsapp_envio_automatico,
  })),
);
