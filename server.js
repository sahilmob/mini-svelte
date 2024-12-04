import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";

import appComponent from "./ssr.js";
import { buildClient } from "./index.js";

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/app.js") {
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
                let app = App();
                const container = document.getElementById("app");
                app.create(container);
                const ws = new WebSocket('ws://localhost:8080');
                ws.addEventListener("message", (message)=>{
                    import("./app.js?t=" + Date.now()).then(_ =>{
                      const App = _.default;
                      app.destroy(container);
                      app = App();
                      app.create(container, false);  
                    })
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
      buildClient();
      ws.send("new build");
    });
  }
);
