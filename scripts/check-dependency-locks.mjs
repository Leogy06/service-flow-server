import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Windows cannot remove a running executable during npm ci's cleanup.
// Use Get-Process rather than CIM/WMI, which can require elevated access.
if (process.platform === "win32") {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "ConvertTo-Json -Compress -InputObject @(Get-Process -Name esbuild -ErrorAction SilentlyContinue | Select-Object Id, Path)",
  ], { encoding: "utf8", windowsHide: true });

  if (result.error || result.status !== 0) {
    console.error("Could not check dependency locks. Ensure PowerShell is available and stop the backend development server before retrying.");
    process.exitCode = 1;
  } else {
    try {
      const dependencies = path.join(fileURLToPath(new URL("..", import.meta.url)), "node_modules") + path.sep;
      const processes = JSON.parse(result.stdout.trim());
      const locked = processes.filter(({ Path: executable }) =>
        typeof executable === "string" && executable.toLowerCase().startsWith(dependencies.toLowerCase()));

      if (locked.length > 0) {
        console.error("Cannot reinstall dependencies: this backend's esbuild.exe is still running.");
        for (const { Id, Path: executable } of locked) {
          console.error(`PID ${Id}: ${executable}`);
        }
        console.error("Stop the backend development server with Ctrl+C in its terminal, then rerun scripts/run.sh prod.");
        process.exitCode = 1;
      }
    } catch {
      console.error("Could not read the dependency lock check. Stop the backend development server and check PowerShell before retrying.");
      process.exitCode = 1;
    }
  }
}
