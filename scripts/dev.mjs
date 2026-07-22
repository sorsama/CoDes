import { spawn, spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error("npm_execpath is unavailable. Start development with `npm run dev`.");
}

const runNpm = (args) => spawn(process.execPath, [npmCli, ...args], { stdio: "inherit" });
const children = [
  runNpm(["run", "relay:dev"]),
  runNpm(["run", "dev:web"]),
];

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.killed || !child.pid) continue;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
    }
  }
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      if (code && code !== 0) {
        const displayCode =
          process.platform === "win32" && code === 4294967295
            ? "terminated by Windows"
            : `code ${code}`;
        console.error(`Development service exited (${displayCode}).`);
      }
      if (signal) console.error(`Development service exited from signal ${signal}.`);
      stop(code ?? (signal ? 1 : 0));
    }
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
process.on("SIGHUP", () => stop());
