import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  runInNewContext(source, {
    URL,
    location: { origin: "https://siasajcorp.com" },
    self: { addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; } },
    caches: { match: () => Promise.resolve(new Response("static asset")) },
  });
  return handlers;
}

describe("service worker privacy", () => {
  it.each(["/app", "/app/sources", "/auth", "/api/public/health", "/_serverFn/example?payload=account"])("does not cache private or dynamic response %s", (path) => {
    const respondWith = vi.fn();
    worker().fetch({ request: { method: "GET", url: `https://siasajcorp.com${path}`, mode: "navigate" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it("can serve fingerprinted build assets from cache", async () => {
    const respondWith = vi.fn();
    worker().fetch({ request: { method: "GET", url: "https://siasajcorp.com/assets/app-abc123.js" }, respondWith });
    expect(respondWith).toHaveBeenCalledOnce();
    expect(await (await respondWith.mock.calls[0][0]).text()).toBe("static asset");
  });
});
