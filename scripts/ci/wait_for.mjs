#!/usr/bin/env node
// node scripts/ci/wait_for.mjs <tcp://host:port | http(s)://url> [timeoutSeconds=90] [--max-status=499]   exit 0 when ready, 1 on timeout (prints the last error)
import net from "node:net";
export async function waitFor(target, timeoutS = 90, maxStatus = 499) {
  const end = Date.now() + timeoutS * 1000; let last = "";
  while (Date.now() < end) {
    try {
      if (target.startsWith("tcp://")) { const u = new URL(target); await new Promise((res, rej) => { const s = net.connect(+u.port, u.hostname, () => { s.end(); res(); }); s.on("error", rej); s.setTimeout(2000, () => { s.destroy(); rej(new Error("timeout")); }); }); return { ok: true }; }
      const r = await fetch(target, { signal: AbortSignal.timeout(3000) }); if (r.status <= maxStatus) return { ok: true, status: r.status }; last = `HTTP ${r.status}`;
    } catch (e) { last = e.cause?.code || e.code || e.message; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ok: false, last };
}
if (process.argv[1]?.endsWith("wait_for.mjs")) {
  const t = process.argv[2], s = +(process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : 90), m = process.argv.find((a) => a.startsWith("--max-status="));
  if (!t) { console.error("usage: wait_for.mjs <target> [seconds]"); process.exit(2); }
  const r = await waitFor(t, s, m ? +m.split("=")[1] : 499); console.log(r.ok ? `ready: ${t}` : `TIMEOUT waiting for ${t} (${r.last})`); process.exit(r.ok ? 0 : 1);
}
