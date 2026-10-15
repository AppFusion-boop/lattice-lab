#!/usr/bin/env node
import * as readline from "node:readline";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBindings } from "../src/core/study/bindings.ts";
import { evaluateRows } from "../src/core/study/batch.ts";
import type { BatchHeader, BatchRowInput } from "../src/core/study/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

function getEngineVersion(): string {
  let pkgVersion = "2.2.0";
  try {
    const pkgPath = path.join(REPO_ROOT, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.version) pkgVersion = pkg.version;
    }
  } catch {
    // fallback
  }

  let gitRev = "unknown";
  try {
    gitRev = execSync("git rev-parse --short HEAD", {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim();
  } catch {
    // fallback
  }

  return `${pkgVersion}-${gitRev}`;
}

async function main() {
  const engineVersion = getEngineVersion();
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  let header: BatchHeader | null = null;
  let count = 0;

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    // Line 1: Header
    if (!header) {
      try {
        header = JSON.parse(line) as BatchHeader;
      } catch (err: unknown) {
        console.error("Invalid JSON header:", err);
        process.exit(2);
      }

      try {
        validateBindings(header);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Header validation failed:", msg);
        process.exit(2);
      }
      continue;
    }

    // Lines 2..N: Rows
    try {
      const row = JSON.parse(line) as BatchRowInput;
      const [res] = evaluateRows(header, [row]);
      process.stdout.write(JSON.stringify(res) + "\n");
      count++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        JSON.stringify({
          id: "unknown",
          status: "error",
          outcomes: {},
          message: `Malformed row JSON: ${msg}`,
        }) + "\n",
      );
      count++;
    }
  }

  if (!header) {
    console.error("No header received on stdin");
    process.exit(2);
  }

  // Final completion summary line
  process.stdout.write(
    JSON.stringify({
      done: true,
      count,
      engineVersion,
    }) + "\n",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal engine error:", err);
  process.exit(1);
});

