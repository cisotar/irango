// Route handler que compila e serve o Service Worker (issue 006).
// @serwist/turbopack é Turbopack-nativo: bundla `src/app/sw.ts` via esbuild e
// serve o resultado same-origin em /serwist/sw.js (sem tocar em webpack, sem
// gerar artefato em public/). O `<RegistrarSW>` no client registra essa URL.
//
// Desligado em desenvolvimento para não conflitar com o hot reload do Turbopack.
import { createSerwistRoute } from "@serwist/turbopack";

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
  });
