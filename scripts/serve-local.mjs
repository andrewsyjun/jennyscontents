import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = numberFromEnv("LOCAL_PORT", 4173, 1024, 65535);
const host = process.env.LOCAL_HOST || "127.0.0.1";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    const filePath = resolveStaticPath(url.pathname);

    if (!filePath) {
      send(response, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }

    const ext = path.extname(filePath);
    send(response, 200, fs.readFileSync(filePath), contentTypes[ext] || "application/octet-stream");
  } catch (error) {
    send(response, 500, `Server error: ${error.message}`, "text/plain; charset=utf-8");
  }
});

server.listen(port, host, () => {
  console.log(`Jenny's Contents local app: http://${host}:${port}/`);
  console.log(`TikTok callback: http://${host}:${port}/auth/tiktok/callback`);
});

function resolveStaticPath(pathname) {
  let cleanPath = decodeURIComponent(pathname).replace(/\\/g, "/");
  if (cleanPath.endsWith("/")) cleanPath += "index.html";
  if (!path.extname(cleanPath)) cleanPath = `${cleanPath}/index.html`;

  const candidate = path.resolve(root, `.${cleanPath}`);
  if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) return "";
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return "";
  return candidate;
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
}

function numberFromEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
