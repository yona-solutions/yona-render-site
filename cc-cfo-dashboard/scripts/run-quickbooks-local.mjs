import { spawn } from "node:child_process";
import process from "node:process";

const children = [];

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${name} exited with code ${code}`);
      shutdown(code);
    }
  });

  children.push(child);
  return child;
}

function shutdown(exitCode = 0) {
  children.forEach((child) => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  });
  process.exit(exitCode);
}

start("quickbooks-api", process.execPath, ["scripts/quickbooks-server.mjs"]);
start("vite", "npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4173"]);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}
