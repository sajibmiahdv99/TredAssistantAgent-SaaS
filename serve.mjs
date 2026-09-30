// Minimal Node HTTP server that hosts the TanStack Start fetch handler.
// The Vite 8 build emits dist/server/server.js as a fetch-handler export
// (Workers-style); Node needs a small adapter to listen on a port AND serve
// the client build (dist/client) for /assets/*, favicon, manifest, etc.
//
// Usage: node serve.mjs   (PORT/HOST env supported, defaults 3000/0.0.0.0)

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const CLIENT_DIR = join(__dirname, "dist/client");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".map": "application/json",
};

// Load the built server handler
const { default: serverHandler } = await import(join(__dirname, "dist/server/server.js"));

/** Serve a static file from dist/client, with path traversal protection. */
async function serveStatic(urlPath, res) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  // Reject traversal / absolute paths
  if (pathname.includes("..") || pathname.startsWith("/\\")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  let filePath = join(CLIENT_DIR, normalize(pathname).replace(/^([/\\])+/, ""));
  // Directory request -> index.html (SPA fallback happens in server handler,
  // but assets dir listing shouldn't leak)
  if (existsSync(filePath) && (await statIsDir(filePath))) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

async function statIsDir(p) {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

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
  const pathname = (req.url ?? "/").split("?")[0];
  try {
    // Static assets from the client build (fingerprinted, immutable)
    if (pathname.startsWith("/assets/")) {
      await serveStatic(pathname, res);
      return;
    }
    // Well-known / PWA files
    if (
      pathname === "/manifest.webmanifest" ||
      pathname === "/favicon.ico" ||
      pathname === "/favicon.svg" ||
      pathname === "/apple-touch-icon.png" ||
      pathname === "/robots.txt" ||
      pathname === "/sw.js" ||
      pathname.startsWith("/icons/")
    ) {
      await serveStatic(pathname, res);
      return;
    }
    // Everything else -> SSR fetch handler
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
