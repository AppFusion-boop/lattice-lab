import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { tunnelProject } from "../tunnel-demo.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts/eval-batch.ts");

test("scripts/eval-batch.ts CLI processes rows over stdin/stdout and outputs done summary", async () => {
  const project = tunnelProject();
  const header = {
    project,
    parameterBindings: [
      { parameterKey: "reduction", nodeId: "water", paramKey: "reduction" },
    ],
    outcomeBindings: [
      {
        outcomeKey: "peak_mist",
        nodeId: "mist",
        port: "sensor:probe",
        reducer: "maxAbs",
      },
    ],
  };

  const rows = [
    { id: "row1", values: { reduction: 10 } },
    { id: "row2", values: { reduction: 50 } },
    { id: "row3", values: { reduction: 90 } },
  ];

  const child = spawn("npx", ["tsx", SCRIPT_PATH], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdoutChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));

  // Write header line + rows
  child.stdin.write(JSON.stringify(header) + "\n");
  for (const r of rows) {
    child.stdin.write(JSON.stringify(r) + "\n");
  }
  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });

  assert.equal(exitCode, 0, "CLI should exit with code 0");

  const lines = Buffer.concat(stdoutChunks)
    .toString("utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);

  assert.equal(lines.length, 4, "Should receive 3 row results + 1 final done summary");

  const parsedRows = lines.slice(0, 3).map((l) => JSON.parse(l));
  assert.equal(parsedRows[0].id, "row1");
  assert.equal(parsedRows[0].status, "ok");
  assert.ok(typeof parsedRows[0].outcomes.peak_mist === "number");

  assert.equal(parsedRows[1].id, "row2");
  assert.equal(parsedRows[1].status, "ok");

  assert.equal(parsedRows[2].id, "row3");
  assert.equal(parsedRows[2].status, "ok");

  // Higher reduction should yield lower or equal peak pressure
  assert.ok(parsedRows[0].outcomes.peak_mist > parsedRows[2].outcomes.peak_mist);

  const doneSummary = JSON.parse(lines[3]);
  assert.equal(doneSummary.done, true);
  assert.equal(doneSummary.count, 3);
  assert.ok(typeof doneSummary.engineVersion === "string");
  assert.ok(doneSummary.engineVersion.startsWith("2.2.0"));
});

test("scripts/eval-batch.ts CLI exits with code 2 on invalid header", async () => {
  const child = spawn("npx", ["tsx", SCRIPT_PATH], {
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Invalid header JSON
  child.stdin.write("{ broken json...\n");
  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });

  assert.equal(exitCode, 2, "CLI should exit with code 2 on invalid header");
});

