// Ativa .githooks como core.hooksPath deste clone. Roda no script `prepare`
// (npm install / npm ci). Em ambiente sem git (build em container, tarball) não
// há hook a instalar e o install não pode falhar por causa disso.
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
  // sem git ou fora de um repositório: segue sem hook
}
