import http from "node:http";
import { snapshot, RuleError } from "./rules.js";
import { store, actions } from "./records.js";
import { renderPage } from "./page.js";

const port = Number(process.env.PORT || 3040);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

// 把业务动作挂到记录层；规则错误转 400，其余 500
function action(handler) {
  return async (req, res) => {
    try {
      const plate = await handler(await body(req));
      send(res, 200, snapshot(await store.read()).plates.find((p) => p.id === plate.id));
    } catch (error) {
      if (error instanceof RuleError) return send(res, 400, { error: error.code, message: error.message });
      throw error;
    }
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = (m) => decodeURIComponent(m[1]);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPage());
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      return send(res, 200, snapshot(await store.read()));
    }
    if (req.method === "POST" && url.pathname === "/api/plates") {
      return action(async (input) => actions.createPlate(input, input.at, input.requestId))(req, res);
    }

    const m = {
      "/delivery$": actions.registerDelivery,
      "/confirm$": actions.confirm,
      "/rollback$": actions.rollback,
      "/correct$": actions.correct,
      "/occupy$": actions.occupy,
      "/complete-coating$": actions.completeCoating,
    };
    for (const [suffix, fn] of Object.entries(m)) {
      const match = url.pathname.match(new RegExp("^/api/plates/([^/]+)" + suffix));
      if (match && req.method === "POST") {
        return action(async (input) => fn(code(match), input, input.at, input.requestId))(req, res);
      }
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

await store.init();
server.listen(port, () => console.log("玻璃板回收与二次涂布准入台 listening on http://localhost:" + port));
