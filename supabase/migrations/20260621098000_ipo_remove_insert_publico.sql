-- Issue 110 — remove a superfície de escrita anon órfã em itens_pedido_opcionais.
-- A policy `ipo_insert_publico` permitia INSERT por anon/authenticated, mas a
-- produção só insere via RPC `criar_pedido` sob service_role (BYPASSRLS) — a policy
-- nunca participava de caminho legítimo. Pós-drop o INSERT vira deny-all para
-- anon/authenticated.
-- O helper `item_pedido_aceita_opcionais` PERMANECE (não dropar) e a policy de
-- leitura `ipo_leitura_lojista` (SELECT do dono) fica intacta.
drop policy if exists "ipo_insert_publico" on public.itens_pedido_opcionais;
