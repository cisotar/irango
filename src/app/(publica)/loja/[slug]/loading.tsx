import { ESCADA_LARGURA_VITRINE, CLASSES_MAIN_VITRINE } from "@/components/vitrine/layoutVitrine";

/**
 * Skeleton da vitrine (achado acelerar 2026-09-16, F2). Sem Suspense boundary
 * o App Router segurava a transição inteira no servidor e a volta de /pedido
 * parecia travada. Dimensões espelham `HeaderLoja` (logo 80px) e o grid de
 * `SecaoCatalogo`/`CardProduto` (aspect 4/3) para CLS zero quando o conteúdo
 * real chega. Cores vêm dos defaults de `globals.css`: o `<style>` do tema da
 * loja é emitido pela page e ainda não existe aqui.
 */
export default function LoadingVitrine() {
  return (
    <div
      className="min-h-screen animate-pulse bg-[var(--cor-fundo)]"
      role="status"
      aria-label="Carregando cardápio"
    >
      <header className="bg-[var(--cor-primaria)] px-4 py-2.5">
        <div className={`${ESCADA_LARGURA_VITRINE} flex items-center justify-center gap-4`}>
          <div className="size-[80px] shrink-0 rounded-full bg-white/20" />
          <div className="flex flex-col gap-2">
            <div className="h-7 w-40 rounded bg-white/25" />
            <div className="h-4 w-28 rounded bg-white/15" />
            <div className="h-4 w-32 rounded bg-white/15" />
          </div>
        </div>
      </header>

      <main className={CLASSES_MAIN_VITRINE}>
        <div className="mb-4 flex items-center gap-3.5">
          <div className="h-0.5 flex-1 bg-black/5" />
          <div className="h-4 w-32 rounded bg-black/10" />
          <div className="h-0.5 flex-1 bg-black/5" />
        </div>
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-xl border border-[#eeeeee] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.1)]"
            >
              <div className="aspect-[4/3] w-full bg-black/5" />
              <div className="flex flex-col gap-2 p-3 lg:gap-1.5 lg:p-2.5">
                <div className="h-4 w-3/4 rounded bg-black/10" />
                <div className="mt-2 flex items-center justify-between">
                  <div className="h-5 w-16 rounded bg-black/10" />
                  <div className="h-8 w-8 rounded-lg bg-black/10 lg:h-7 lg:w-7" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
