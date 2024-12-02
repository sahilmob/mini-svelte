import { createServer } from "node:http";
import appComponent from "./ssr.js";

const server = createServer((_req, res) => {
  res.write(appComponent());
  res.end();
});

server.listen(4200);
