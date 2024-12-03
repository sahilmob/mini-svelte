import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";

import appComponent from "./ssr.js";

const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    const app = fs.readFileSync(
      path.join(fileURLToPath(import.meta.url), "../app.js"),
      "utf-8"
    );
    res.setHeader("Content-Type", "text/javascript");
    res.write(app);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "text/html");
  res.write(`
    <html>
        <body>
            <div id="app">${appComponent()}</div>
            <script type="module">
                import App from "./app.js";
                App().create(document.getElementById("app"));
            </script>
        </body>
    </html>
    `);
  res.end();
});

server.listen(4200);

const wss = new WebSocketServer({
  port: 8080,
});

wss.on("connection", function (ws) {
  wss.on("error", console.error);

  ws.on("close", function () {});

  let i = 0;

  setInterval(() => {
    ws.send(i++);
  }, 1000);
});
