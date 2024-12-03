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
                const ws = new WebSocket('ws://localhost:8080');
                ws.addEventListener("message", (message)=>{

                });
            </script>
        </body>
    </html>
    `);
  res.end();
});

server.listen(4200);

const webSockets = new Set();
const wss = new WebSocketServer({
  port: 8080,
});

wss.on("connection", function (ws) {
  webSockets.add(ws);
  wss.on("error", console.error);

  ws.on("close", () => {
    webSockets.delete(ws);
  });
});

fs.watchFile(
  path.join(fileURLToPath(import.meta.url), "../app.svelte"),
  {
    interval: 0,
  },
  () => {
    webSockets.forEach((ws) => {
      ws.send("");
    });
  }
);
