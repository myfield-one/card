import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { versions } = JSON.parse(readFileSync(path.join(root, "releases.json"), "utf8"));
const entries = Object.entries(versions);
for (const [version, commit] of entries) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error(`Invalid release entry: ${version}`);
  }
}

const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
const git = (args) => execFileSync("git", args, { cwd: root, env: gitEnv });
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });
const vite = (directory) => path.join(directory, "node_modules/vite/bin/vite.js");

run(process.execPath, [vite(root), "build"], root);
if (entries.length > 0) {
  const temporary = mkdtempSync(path.join(tmpdir(), "card-versions-"));
  try {
    for (const [version, commit] of entries) {
      const tag = `refs/tags/v${version}`;
      try {
        git(["rev-parse", "--verify", "--quiet", `${tag}^{commit}`]);
      } catch {
        git(["fetch", "--no-tags", "origin", `${tag}:${tag}`]);
      }
      if (git(["rev-parse", `${tag}^{commit}`]).toString().trim() !== commit) {
        throw new Error(`Tag v${version} does not match releases.json`);
      }

      const source = path.join(temporary, version);
      mkdirSync(source);
      const archive = path.join(temporary, `${version}.tar`);
      git(["archive", `--output=${archive}`, commit]);
      run("tar", ["-xf", archive, "-C", source], root);
      const pkg = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
      if (pkg.version !== version) throw new Error(`Package version does not match v${version}`);
      run("npm", ["ci", "--no-audit", "--no-fund"], source);
      const base = `/v${version}/`;
      run(process.execPath, [vite(source), "build", "--base", base], source);
      cpSync(path.join(source, "dist"), path.join(root, "dist", `v${version}`), { recursive: true });
      appendFileSync(path.join(root, "dist", "_headers"), `\n${base}\n  Cache-Control: no-cache\n\n${base}index.html\n  Cache-Control: no-cache\n\n${base}assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
