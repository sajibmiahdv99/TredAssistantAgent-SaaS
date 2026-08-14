// Minimal Node HTTP server that hosts the TanStack Start fetch handler.
// The Vite 8 build emits dist/server/server.js as a fetch-handler export
// (Workers-style); Node needs a small adapter to listen on a port.
//
// Usage: node serve.mjs   (PORT/HOST env supported, defaults 3000/0.0.0.0)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

// Load the built server handler
const { default: serverHandler } = await import(
  join(__dirname, "dist/server/server.js")
);

async function toNodeRequest(req) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  let body;
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    body = req; // pass the node stream through as the Request body
  }
  return new Request(url, { method, headers, body, duplex: "half" });
}

const server = createServer(async (req, res) => {
  try {
    const request = await toNodeRequest(req);
    const response = await serverHandler.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    console.error("[serve] request failed:", err);
    if (!res.headersSent) res.writeHead(500);
    res.end("Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] listening on http://${HOST}:${PORT}`);
});

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[serve] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
