import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: pedidos, error } = await supabase
  .from("pedidos")
  .select("id, loja_id, cliente_nome, status, total, token_acesso")
  .order("criado_em", { ascending: false })
  .limit(5);

if (error) { console.error(error); process.exit(1); }

for (const p of pedidos) {
  const { data: loja } = await supabase.from("lojas").select("id, slug, dono_id, modulo_impressao_a4, modulo_impressao_termica").eq("id", p.loja_id).single();
  console.log({ pedido_id: p.id, cliente: p.cliente_nome, status: p.status, total: p.total, loja_slug: loja?.slug, loja_id: p.loja_id, dono_id: loja?.dono_id });
}
