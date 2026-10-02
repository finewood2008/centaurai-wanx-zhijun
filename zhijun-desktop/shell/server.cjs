const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");

function localService(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("知君当前只连接本机 WANX HTTP 服务");
  }
  return url;
}

async function startServer({
  root,
  upstream = "http://127.0.0.1:8088",
  port = 28631,
}) {
  const target = localService(upstream);
  const sockets = new Set();
  let origin;
  const server = http.createServer(async (req, res) => {
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      res.writeHead(403).end();
      return;
    }
    if (req.url.startsWith("/api/")) {
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers.origin !== origin
      ) {
        res.writeHead(403).end();
        return;
      }
      const proxy = http.request(
        target,
        {
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: target.host },
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      proxy.on("error", () => {
        if (!res.headersSent)
          res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "本机 WANX 未连接，请先启动万象。" },
          }),
        );
      });
      req.on("aborted", () => proxy.destroy());
      req.pipe(proxy);
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    let file;
    try {
      const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
      file = path.resolve(
        root,
        "." +
          (pathname === "/" || pathname === "/login"
            ? "/index.html"
            : pathname),
      );
      if (!file.startsWith(path.resolve(root) + path.sep))
        throw new Error("path");
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) throw new Error("file");
    } catch {
      res.writeHead(404).end();
      return;
    }
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
    };
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:*; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    const stream = fs.createReadStream(file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, socket, head) => {
    if (
      req.headers.host !== new URL(origin).host ||
      req.headers.origin !== origin ||
      !/^\/api\/agents\/[\w-]+\/chat\/ws(?:\?.*)?$/.test(req.url)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const remote = net.connect(
      Number(target.port || 80),
      target.hostname,
      () => {
        const headers = Object.entries({ ...req.headers, host: target.host })
          .map(([key, value]) => `${key}: ${value}`)
          .join("\r\n");
        remote.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
        if (head.length) remote.write(head);
        socket.pipe(remote);
        remote.pipe(socket);
      },
    );
    remote.on("error", () => socket.destroy());
    socket.on("error", () => remote.destroy());
    socket.on("close", () => remote.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}
module.exports = { startServer, localService };
