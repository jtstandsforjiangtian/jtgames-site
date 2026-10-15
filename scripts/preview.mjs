import { cpSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");
cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
mkdirSync(join(standalone, ".next"), { recursive: true });
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });

const child = spawn(process.execPath, [join(standalone, "server.js")], {
  cwd: standalone,
  stdio: "inherit",
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: process.env.PORT || "3000",
    JUKEBOX_DB_PATH: process.env.JUKEBOX_DB_PATH || join(root, "data", "jukebox.sqlite"),
    NODE_OPTIONS: "--disable-warning=ExperimentalWarning",
  },
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
