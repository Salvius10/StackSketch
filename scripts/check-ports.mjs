// Runs before `npm run dev`. If an earlier StackSketch server (or another program)
// still holds one of the dev ports, say which process it is and stop, instead of
// letting the three servers crash with EADDRINUSE.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

// The sync server's port may be set in .env; the shell's value still wins.
if (existsSync(".env")) process.loadEnvFile(".env");

const PORTS = [
  { port: 8000, name: "API" },
  { port: Number(process.env.PORT) || 1234, name: "sync server" },
  { port: 3000, name: "web app" },
];

const answers = (port, host) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
  } catch {
    return "";
  }
};

/** PIDs and process names listening on a port; empty when the OS tools aren't available. */
function owners(port) {
  if (process.platform === "win32") {
    const pids = new Set();
    for (const line of run("netstat", ["-ano"]).split(/\r?\n/)) {
      const [proto, local, remote, ...rest] = line.trim().split(/\s+/);
      // Listening sockets have no remote end; this avoids depending on the localized state column.
      if (proto === "TCP" && local?.endsWith(`:${port}`) && /^(0\.0\.0\.0|\[::\]):0$/.test(remote ?? "")) pids.add(rest.at(-1));
    }
    return [...pids].map((pid) => {
      const csv = run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
      return { pid, name: csv.startsWith('"') ? csv.slice(1, csv.indexOf('"', 1)) : "unknown" };
    });
  }
  return run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
    .split("\n")
    .filter(Boolean)
    .map((pid) => ({ pid, name: run("ps", ["-o", "comm=", "-p", pid]).trim() || "unknown" }));
}

const busy = [];
for (const p of PORTS) {
  if ((await answers(p.port, "127.0.0.1")) || (await answers(p.port, "::1"))) busy.push({ ...p, owners: owners(p.port) });
}

if (busy.length > 0) {
  const lines = ["", "StackSketch can't start: these ports are already in use.", ""];
  for (const b of busy) {
    const who = b.owners.length ? b.owners.map((o) => `${o.name} (PID ${o.pid})`).join(", ") : "unknown process";
    lines.push(`  ${String(b.port).padEnd(6)}${b.name.padEnd(13)}${who}`);
  }
  lines.push("", "If StackSketch is already running in another terminal, use it (http://localhost:3000) or press Ctrl+C there.");
  const pids = [...new Set(busy.flatMap((b) => b.owners.map((o) => o.pid)))];
  if (pids.length > 0) {
    const kill = process.platform === "win32" ? `taskkill /F /T ${pids.map((p) => `/PID ${p}`).join(" ")}` : `kill ${pids.join(" ")}`;
    lines.push("Otherwise end the processes above and run `npm run dev` again:", "", `  ${kill}`);
  }
  console.error(lines.join("\n") + "\n");
  process.exit(1);
}
