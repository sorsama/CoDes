import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const isDev = args[0] === "dev";

if (isDev && process.platform === "win32") {
  const debugExecutables = [
    path.join(root, "src-tauri", "target", "debug", "codes.exe"),
    path.join(root, ".codex-target", "debug", "codes.exe"),
    path.join(root, "src-tauri", ".dev-target", "debug", "codes.exe"),
  ];
  const quotedPaths = debugExecutables
    .map((value) => `'${value.replaceAll("'", "''")}'`)
    .join(",");
  const cleanup = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$paths = @(${quotedPaths}); $all = Get-CimInstance Win32_Process; $stopped = @(); $all | Where-Object { $_.Name -eq 'codes.exe' -and $paths -contains $_.ExecutablePath } | ForEach-Object { $app = $_; $stopped += $app.ProcessId; Stop-Process -Id $app.ProcessId -Force; $parent = $all | Where-Object { $_.ProcessId -eq $app.ParentProcessId -and $_.Name -eq 'cargo.exe' }; if ($parent) { Stop-Process -Id $parent.ProcessId -Force } }; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(1420, 8787) } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { if ($_ -and $_ -ne $PID) { $stopped += $_; Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }; $stopped | Select-Object -Unique | Write-Output`,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (cleanup.status !== 0) {
    console.error(cleanup.stderr.trim() || "Could not inspect stale CoDes development processes.");
    process.exit(cleanup.status ?? 1);
  }
  const stopped = cleanup.stdout.trim().split(/\s+/).filter(Boolean);
  if (stopped.length) {
    console.log(`Stopped stale CoDes development process${stopped.length === 1 ? "" : "es"}: ${stopped.join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

const cli = path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const child = spawn(process.execPath, [cli, ...args], {
  cwd: root,
  stdio: "inherit",
  env: isDev
    ? { ...process.env, CARGO_TARGET_DIR: path.join(root, "src-tauri", ".dev-target") }
    : process.env,
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
