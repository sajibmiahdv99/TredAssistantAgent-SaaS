// One production scheduler uses the app's execution hooks. Do not also run
// execution-worker.ts or another process-orders scheduler against this database.
import { pollSignalChannelsOnce } from "./channelPoller.ts";
import { confirmPendingCryptoPayments } from "../src/lib/crypto-pay.confirm.server.ts";
import { writeFile } from "node:fs/promises";

const base = process.env.APP_INTERNAL_URL ?? "http://app:3000";
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required");
let stopping = false;
const timers: ReturnType<typeof setInterval>[] = [];
const active = new Set<Promise<void>>();

async function hook(name: string): Promise<void> {
  const response = await fetch(`${base}/api/public/hooks/${name}`, {
    method: "POST", headers: { "x-cron-secret": secret! }, signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const result = await response.json() as Record<string, unknown>;
  if (typeof result.errors === "number" && result.errors > 0) throw new Error(`${name}: ${result.errors} operation errors`);
  if (Array.isArray(result.errors) && result.errors.length > 0) throw new Error(`${name}: ${result.errors.length} operation errors`);
}

function schedule(name: string, interval: number, task: () => Promise<unknown>): void {
  let running = false;
  const run = () => {
    if (running || stopping) return;
    running = true;
    const promise = (async () => {
      try { await task(); }
      catch (error) { console.error(`[production-worker:${name}] ${error instanceof Error ? error.message : "job failed"}`); }
      finally { running = false; }
    })();
    active.add(promise);
    void promise.finally(() => active.delete(promise));
  };
  timers.push(setInterval(run, interval));
  run();
}

// A readiness check prevents the initial jobs from racing a container restart.
for (let attempt = 0; ; attempt++) {
  try {
    const health = await fetch(`${base}/api/public/health`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) throw new Error("app unavailable");
    break;
  } catch {
    if (attempt >= 12) throw new Error("Application did not become ready");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

schedule("orders", 10_000, async () => {
  // Apply the risk kill-switch before taking another batch of orders.
  await hook("monitor-anomalies");
  await hook("process-orders");
  await writeFile("/tmp/tred-worker-heartbeat", String(Date.now()));
});
schedule("positions", 15_000, async () => {
  await hook("monitor-positions");
  await hook("sync-positions");
});
schedule("balances", 300_000, () => hook("sync-balances"));
schedule("notifications", 60_000, () => hook("dispatch-notifications"));
schedule("backtests", 300_000, () => hook("run-backtests"));
schedule("channels", 30_000, () => pollSignalChannelsOnce());
schedule("payments", 60_000, () => confirmPendingCryptoPayments());
console.log("[production-worker] ready: orders, positions, balances, notifications, backtests, channels, payments");

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  timers.forEach(clearInterval);
  await Promise.allSettled([...active]);
  process.exit(0);
}
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
