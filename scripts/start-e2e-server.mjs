import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const distDir = resolve(process.env.NEXT_DIST_DIR ?? ".next-e2e");
const standaloneDir = join(distDir, "standalone");

function findServer(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === "server.js") return path;
    if (entry.isDirectory() && entry.name !== "node_modules") {
      const found = findServer(path);
      if (found) return found;
    }
  }
  return null;
}

const serverPath = findServer(standaloneDir);
if (!serverPath) throw new Error(`Standalone server.js not found under ${standaloneDir}`);

const serverRoot = dirname(serverPath);
const staticSource = join(distDir, "static");
const staticTarget = join(serverRoot, basename(distDir), "static");
if (existsSync(staticSource)) cpSync(staticSource, staticTarget, { recursive: true, force: true });

const publicSource = resolve("public");
const publicTarget = join(serverRoot, "public");
if (existsSync(publicSource) && statSync(publicSource).isDirectory()) cpSync(publicSource, publicTarget, { recursive: true, force: true });

const child = spawn(process.execPath, [serverPath], { env: process.env, stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
