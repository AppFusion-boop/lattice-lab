import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { compileExpression, expressionVariables } from "./expression.ts";

interface Case {
  expr: string;
  variables?: string[];
  vars?: Record<string, number>;
  expect: {
    value?: number;
    error?:
      | "parse"
      | "unknown_variable"
      | "unknown_function"
      | "arity"
      | "non_finite"
      | "missing_variable"
      | "too_deep"
      | "too_long";
  };
}

const fixturePath = path.resolve(process.cwd(), "shared/expression-conformance.json");
const cases: Case[] = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));

function classifyError(msg: string, expr: string): string {
  if (/non-finite/i.test(msg)) return "non_finite";
  if (/expects.*argument/i.test(msg)) return "arity";
  if (/unknown function/i.test(msg)) return "unknown_function";
  if (/unknown variable/i.test(msg)) return "unknown_variable";
  if (/missing variable/i.test(msg)) return "missing_variable";
  if (/too deeply nested/i.test(msg)) return "too_deep";
  if (expr.length > 500) return "too_long";
  return "parse";
}

test("expression conformance fixture (shared)", () => {
  assert.ok(cases.length >= 40, "Fixture must contain at least 40 cases");

  for (const c of cases) {
    const opts = c.variables ? { variables: c.variables } : undefined;
    if (c.expect.value !== undefined) {
      const fn = compileExpression(c.expr, opts);
      const val = fn(c.vars ?? {});
      assert.ok(
        Math.abs(val - c.expect.value) < 1e-10,
        `Expression ${c.expr} evaluated to ${val}, expected ${c.expect.value}`,
      );
    } else if (c.expect.error) {
      let threw = false;
      let actualKind = "";
      try {
        const fn = compileExpression(c.expr, opts);
        fn(c.vars ?? {});
      } catch (err: unknown) {
        threw = true;
        const msg = err instanceof Error ? err.message : String(err);
        actualKind = classifyError(msg, c.expr);
      }
      assert.ok(threw, `Expression "${c.expr}" should throw error`);
      assert.equal(
        actualKind,
        c.expect.error,
        `Expression "${c.expr}" error was "${actualKind}", expected "${c.expect.error}"`,
      );
    }
  }
});

test("named variables, collision checks, and expressionVariables helper", () => {
  // expressionVariables helper
  const vars = expressionVariables("flow * nozzles + sqrt(radius) <= 600 * sin(pi / 2)");
  assert.deepEqual(vars, ["flow", "nozzles", "radius"]);

  // Variable collision with function
  assert.throws(
    () => compileExpression("sin * 2", { variables: ["sin"] }),
    /Variable name collides with function: sin/,
  );

  // Missing variable in strict mode
  const fn = compileExpression("x + y", { variables: ["x", "y"] });
  assert.throws(() => fn({ x: 5 }), /Missing variable: y/);

  // Existing default behavior without options (missing variables default to 0)
  const defaultFn = compileExpression("a + b");
  assert.equal(defaultFn({ a: 10 }), 10);
});
