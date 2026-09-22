import http from "node:http";
import { page, appJs } from "./page.js";
import {
  HttpError,
  listNegatives,
  listPlates,
  coatingQueue,
  plateHistory,
  createNegative,
  patchNegative,
  addNegativeLog,
  rollbackNegative,
  intakePlate,
  rewritePlate,
  cleanConfirm,
  coatPlate,
  correctPlate,
  stats,
} from "./records.js";

const port = Number(process.env.PORT || 3040);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
async function handle(res, fn) {
  try {
    const result = await fn();
    send(res, result.status, result.data);
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status || 400, { error: error.message });
    send(res, 500, { error: error.message });
  }
}
const ok = (data) => ({ status: 200, data });
const created = (data) => ({ status: 201, data });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === "GET" && p === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(page());
  }
  if (req.method === "GET" && p === "/app.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    return res.end(appJs());
  }

  // ---- 旧底片 ----
  if (req.method === "GET" && p === "/api/negatives")
    return handle(res, async () => ok(await listNegatives()));
  if (req.method === "POST" && p === "/api/negatives")
    return handle(res, async () => created((await createNegative(await readBody(req))).data));

  let m = p.match(/^\/api\/negatives\/([^/]+)$/);
  if (m && req.method === "GET")
    return handle(res, async () => {
      const item = (await listNegatives()).find((n) => n.code === decodeURIComponent(m[1]));
      if (!item) throw new HttpError(404, "item_not_found");
      return ok(item);
    });
  if (m && req.method === "PATCH")
    return handle(res, async () => (await patchNegative(decodeURIComponent(m[1]), await readBody(req))));

  m = p.match(/^\/api\/negatives\/([^/]+)\/logs$/);
  if (m && req.method === "POST")
    return handle(res, async () =>
      created((await addNegativeLog(decodeURIComponent(m[1]), await readBody(req))).data));

  m = p.match(/^\/api\/negatives\/([^/]+)\/rollback$/);
  if (m && req.method === "POST")
    return handle(res, async () =>
      ok((await rollbackNegative(decodeURIComponent(m[1]), await readBody(req))).data));

  // ---- 玻璃板回收与二次涂布准入 ----
  if (req.method === "GET" && p === "/api/plates")
    return handle(res, async () => ok(await listPlates()));
  if (req.method === "GET" && p === "/api/plates/queue")
    return handle(res, async () => ok(await coatingQueue()));
  if (req.method === "POST" && p === "/api/plates/intake")
    return handle(res, async () => (await intakePlate(await readBody(req))));

  m = p.match(/^\/api\/plates\/([^/]+)\/rewash$/);
  if (m && req.method === "POST")
    return handle(res, async () => (await rewritePlate(decodeURIComponent(m[1]), await readBody(req))));
  m = p.match(/^\/api\/plates\/([^/]+)\/clean$/);
  if (m && req.method === "POST")
    return handle(res, async () => (await cleanConfirm(decodeURIComponent(m[1]), await readBody(req))));
  m = p.match(/^\/api\/plates\/([^/]+)\/coat$/);
  if (m && req.method === "POST")
    return handle(res, async () => (await coatPlate(decodeURIComponent(m[1]), await readBody(req))));
  m = p.match(/^\/api\/plates\/([^/]+)\/correct$/);
  if (m && req.method === "POST")
    return handle(res, async () => (await correctPlate(decodeURIComponent(m[1]), await readBody(req))));
  m = p.match(/^\/api\/plates\/([^/]+)$/);
  if (m && req.method === "GET")
    return handle(res, async () => {
      const data = await plateHistory(decodeURIComponent(m[1]));
      if (!data) throw new HttpError(404, "plate_not_found");
      return ok(data);
    });

  // ---- 兼容旧接口 ----
  if (req.method === "GET" && p === "/api/items")
    return handle(res, async () => ok(await listNegatives()));
  m = p.match(/^\/api\/items\/([^/]+)\/logs$/);
  if (m && req.method === "POST")
    return handle(res, async () =>
      created((await addNegativeLog(decodeURIComponent(m[1]), await readBody(req))).data));
  m = p.match(/^\/api\/items\/([^/]+)$/);
  if (m && req.method === "PATCH")
    return handle(res, async () => (await patchNegative(decodeURIComponent(m[1]), await readBody(req))));

  if (req.method === "GET" && p === "/api/stats")
    return handle(res, async () => ok(await stats()));

  send(res, 404, { error: "not_found" });
});

server.listen(port, () => console.log("玻璃板回收与二次涂布准入台 listening on http://localhost:" + port));
