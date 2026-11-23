#!/usr/bin/env node
// Regressão da guarda guard-bash.mjs. Passa cada comando como payload do hook
// (stdin) e compara a decisão. Nada é executado além da própria guarda.
// Rodar: node .claude/scripts/guard-bash.test.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const guarda = fileURLToPath(new URL("./guard-bash.mjs", import.meta.url));

const casos = {
  deny: [
    // staging em massa
    "git add -A", "git add --all", "git add .", "git add ./", "git add -Av",
    "git add --a", "git add --al", "git add --no-ignore-removal", "git add --pathspec-from-file=lista.txt",
    "git add :/", "git add *", "git add '*'", "git add ':!src'", "git add ':(glob)plan/*'",
    "cd x && git add -A && git commit -m x", "git -C /tmp/r add .",
    // -f contorna o .gitignore
    "git add -f plan/*.md", "git add -f plan", "git add -f plan/", "git add -f .env", "git add --force x",
    "git add --forc x", "git add -vf x", "git add -f :/", "git add -f -- *", "git add -f .e*", "git add -f .??*",
    "git ls-files -o | xargs git add -f",
    // .env* e relatório de pentest
    "git add .env", "git add .env.local", "git add apps/.env.production", "git add ./.env", "git add .ENV",
    "git add .env.example.bak", "git add .e\\nv", "git add .e*", "git add -- .env",
    "git add plan/seguranca-auditoria-2026-09-22.md", "git add specs/a.md plan/seguranca-auditoria-x.md",
    "git add plan/seguranca\\-auditoria-x.md", "git add plan/seg*", "git -C plan add seguranca-auditoria-x.md",
    "git update-index --add plan/x.md",
    // desligar o pre-commit
    "git commit --no-verify -m x", "git commit -n -m x", "git commit -nm x", "git commit -anm x",
    "git -c core.hooksPath=/dev/null commit -m x", "git -c core.hookspath=x commit -m x",
    "git config core.hooksPath /dev/null", "git config --local core.hooksPath x", "git config --unset core.hooksPath",
    "git config core.hooksPath .githooks-falso", "git config core.hooksPath .githooks extra", "git config --unset-all core.hooksPath",
    // prefixos, agrupamentos e subshells
    "for f in .env; do git add -f $f; done", "if true; then git add -f .env; fi",
    "GIT_TRACE=1 git add -A", "env X=1 git add -A", "command git add -A", "sudo git add -A",
    "/usr/bin/git add -A", "\\git add -A", "time git add -A", "timeout 30 git add -A", "! git add -A",
    "( git add -A )", "{ git add -A; }", "echo $(git add -A)", "echo `git add -A`", "echo \"$(git add -A)\"",
    "git add \\\n  -A", "git -c core.x=y add -A", "git --git-dir=.git add -A", "git --no-pager add -A",
    "git\tadd -A", "bash -c 'git add -A'", "sh -c \"git add .\"", "bash -lc 'git add -f .env'", "eval git add -A",
    // deny vence ask no mesmo comando
    "npx supabase db push; git add -f .env",
    "npx supabase db push && git add -f plan/seguranca-auditoria-2026-09-22.md",
  ],
  ask: [
    "npx supabase db push", "supabase db push --include-all", "echo ok && npx supabase db push",
    "npx --yes supabase db push", "npx -y supabase db push", "npx supabase@latest db push",
    "npx supabase@2.40.0 db push", "./node_modules/.bin/supabase db push", "npm exec supabase -- db push",
    "pnpm dlx supabase db push", "yarn dlx supabase db push", "bunx supabase db push",
    "SUPABASE_ACCESS_TOKEN=x npx supabase db push", "env X=1 npx supabase db push",
    "npx supabase --debug db push", "npx supabase --workdir . db push", "bash -c 'npx supabase db push'",
    "npx supabase db \\\n push", "npx supabase db reset --linked", "npx supabase migration up --linked",
    "npx supabase migration repair --status applied 20260923060457",
    "npx supabase db push --dry-run=false", "npx supabase db push # nao e --dry-run",
    "npx supabase db push > saida--dry-run.log", "npx supabase db push --dry-run && npx supabase db push",
    "git add -u", "git add --update", "git commit -a -m x", "git commit -am x", "git commit --all -m x",
  ],
  allow: [
    "git add specs/vitrine.md", "git add .claude/scripts/guard-bash.mjs", "git add .env.example",
    "git add plan/handoff-2026-11-23-revisao-agentes.md", "git add \"a b.ts\"", "git add src/app/page.tsx 2>/dev/null",
    "git commit -m \"docs: nunca usar git add -A\"", "git commit -m \"fix; git add -A\"",
    "git commit -m \"a && git add -f .env\"", "git commit -m \"-a teste\"", "git commit --amend -m x",
    "git commit -F - <<'EOF'\nlinha\ngit add -A nunca\nnpx supabase db push foi feito\nEOF",
    "git commit -m \"$(cat <<'EOF'\ndocs(294): git add -A proibido; ver fluxo (passo 8)\n\nCo-Authored-By: x\nEOF\n)\"",
    "cat > /tmp/x <<'EOF'\ngit add .\nplan/seguranca-auditoria-x.md\nEOF",
    "npx supabase db push --dry-run", "npx supabase migration list", "npx supabase migration new x",
    "npx supabase gen types typescript", "ls -la", "git status", "git log --all", "git diff 2>&1 | head",
    // depois de "--" o git trata -A como nome de arquivo, não como opção
    "git add -- -A",
    // -n em outro subcomando e dentro de mensagem não é --no-verify
    "git add -n src/a.ts", "git commit -m \"usar -n e --no-verify é proibido\"", "git commit -m x -- src/a.ts",
    "git config user.name x", "git config --get core.hooksPath", "git -c user.name=x commit -m x",
    // ativar o hook do próprio repo é o que o `prepare` faz
    "git config core.hooksPath .githooks", "git config --local core.hooksPath .githooks",
    "echo 'git add -A'", "grep -n \"db push\" .claude/commands/fluxo.md", "git stash list",
  ],
};

const decidir = (comando) => {
  const r = spawnSync(process.execPath, [guarda], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: comando } }),
  });
  if (r.status !== 0) return `exit ${r.status}: ${r.stderr}`;
  const saida = r.stdout.toString().trim();
  return saida ? JSON.parse(saida).hookSpecificOutput.permissionDecision : "allow";
};

let falhas = 0;
let total = 0;
for (const [esperado, comandos] of Object.entries(casos)) {
  for (const comando of comandos) {
    total++;
    const obtido = decidir(comando);
    if (obtido !== esperado) {
      falhas++;
      console.log(`FALHOU  esperado=${esperado} obtido=${obtido}  ${JSON.stringify(comando)}`);
    }
  }
}
for (const [rotulo, payload] of [["payload vazio", "{}"], ["payload inválido", "lixo"]]) {
  total++;
  const r = spawnSync(process.execPath, [guarda], { input: payload });
  if (r.status !== 0 || r.stdout.toString().trim()) {
    falhas++;
    console.log(`FALHOU  ${rotulo}: exit=${r.status} saída=${r.stdout}`);
  }
}
console.log(`${total - falhas}/${total} casos ok`);
process.exit(falhas ? 1 : 0);
