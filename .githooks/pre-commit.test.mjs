// Regressão do pre-commit: monta um repositório temporário, põe arquivos no stage
// (com `git add -f` quando preciso) e confere se o hook barra ou deixa passar.
// Rodar: node .githooks/pre-commit.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const hook = join(aqui, "pre-commit");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "pipe" });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "irango-precommit-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  mkdirSync(join(dir, ".githooks"));
  copyFileSync(hook, join(dir, ".githooks", "pre-commit"));
  chmodSync(join(dir, ".githooks", "pre-commit"), 0o755);
  git(dir, "config", "core.hooksPath", ".githooks");
  return dir;
}
const escrever = (dir, caminho, texto = "x\n") => {
  mkdirSync(join(dir, caminho, ".."), { recursive: true });
  writeFileSync(join(dir, caminho), texto);
};
const rodarHook = (dir) => spawnSync("bash", [".githooks/pre-commit"], { cwd: dir }).status;

const casos = [
  // [rótulo, arquivos {caminho: texto}, esperado: "barra" | "passa"]
  ["arquivo normal", { "src/a.ts": "x\n" }, "passa"],
  [".env.example", { ".env.example": "CHAVE=\n" }, "passa"],
  [".env", { ".env": "X=1\n" }, "barra"],
  [".env.local", { ".env.local": "X=1\n" }, "barra"],
  [".env em subpasta", { "apps/.env.production": "X=1\n" }, "barra"],
  [".ENV maiúsculo", { ".ENV": "X=1\n" }, "barra"],
  ["relatório de pentest", { "plan/seguranca-auditoria-2026-09-22.md": "# r\n" }, "barra"],
  ["relatório em outra pasta", { "docs/seguranca-auditoria-x.md": "# r\n" }, "barra"],
  ["relatório copiado com outro nome (marcador na 1ª linha)", { "docs/notas.md": "<!-- IRANGO-NAO-COMMITAR -->\n# r\n" }, "barra"],
  ["doc que só CITA o marcador no corpo", { "docs/regra.md": "# Regra\nrelatórios levam IRANGO-NAO-COMMITAR na 1ª linha\n" }, "passa"],
  ["nome com espaço", { "docs/a b.md": "x\n" }, "passa"],
];

let falhas = 0;
for (const [rotulo, arquivos, esperado] of casos) {
  const dir = repo();
  try {
    for (const [caminho, texto] of Object.entries(arquivos)) escrever(dir, caminho, texto);
    git(dir, "add", "-f", "--", ...Object.keys(arquivos));
    const status = rodarHook(dir);
    const obtido = status === 0 ? "passa" : "barra";
    if (obtido !== esperado) {
      falhas++;
      console.log(`FALHOU  esperado=${esperado} obtido=${obtido}  ${rotulo}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Integração: `git commit` de verdade tem de falhar, e passar sem o arquivo proibido.
{
  const dir = repo();
  try {
    escrever(dir, ".env", "X=1\n");
    escrever(dir, "src/ok.ts");
    git(dir, "add", "-f", ".env", "src/ok.ts");
    const c1 = spawnSync("git", ["commit", "-q", "-m", "x"], { cwd: dir });
    if (c1.status === 0) { falhas++; console.log("FALHOU  git commit com .env no stage deveria falhar"); }
    git(dir, "rm", "--cached", "-q", ".env");
    const c2 = spawnSync("git", ["commit", "-q", "-m", "x"], { cwd: dir });
    if (c2.status !== 0) { falhas++; console.log("FALHOU  git commit sem o .env deveria passar:", c2.stderr.toString()); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const total = casos.length + 1;
console.log(`${total - falhas}/${total} casos ok`);
process.exit(falhas ? 1 : 0);
