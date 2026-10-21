import { resolverTema } from "@/lib/utils/temaVitrine";

/**
 * Injeta o tema da loja em `:root` durante o SSR. Toda página pública da loja
 * (vitrine, checkout, confirmação) precisa dele: sem, cai nos defaults de
 * `globals.css`. `--cor-destaque` é legado, sem consumidor na vitrine
 * (specs/vitrine-cor-unica-primaria.md RN-8).
 */
export function TemaLojaStyle({ tema }: { tema: unknown }) {
  const { primaria, fundo, destaque } = resolverTema(tema);
  return (
    <style>{`:root{--cor-primaria:${primaria};--cor-fundo:${fundo};--cor-destaque:${destaque};}`}</style>
  );
}
