import fs from "node:fs";
import { tunnelProject } from "../src/core/tunnel-demo.ts";
fs.mkdirSync("public/demos", { recursive: true });
fs.writeFileSync(
  "public/demos/tunnel-methane-water.json",
  JSON.stringify(tunnelProject(), null, 2),
);
console.log("Generic tunnel workflow exported");
