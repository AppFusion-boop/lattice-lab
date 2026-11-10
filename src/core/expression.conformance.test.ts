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

test("advanced mathematical functions: integral, sum, det2, det3, norm", () => {
  // Definite integral: ∫_0^3 t^2 dt = 9
  const intFn1 = compileExpression("integral(0, 3, t^2)");
  assert.ok(Math.abs(intFn1({}) - 9) < 1e-6);

  // Definite integral with parameters: ∫_0^mist_lead (amplitude * t) dt = 0.5 * amplitude * mist_lead^2
  const intFn2 = compileExpression("integral(0, mist_lead, amplitude * t)", {
    variables: ["mist_lead", "amplitude"],
  });
  const res2 = intFn2({ mist_lead: 2, amplitude: 5 });
  assert.ok(Math.abs(res2 - 10) < 1e-6);

  // Matrix determinants
  const det2Fn = compileExpression("det2(4, 2, 1, 3)");
  assert.equal(det2Fn({}), 10);

  const det3Fn = compileExpression("det3(1, 0, 0, 0, 1, 0, 0, 0, 1)");
  assert.equal(det3Fn({}), 1);

  // Vector norms
  const normFn = compileExpression("norm2(3, 4)");
  assert.equal(normFn({}), 5);

  const norm3Fn = compileExpression("norm3(2, 3, 6)");
  assert.equal(norm3Fn({}), 7);

  // Discrete summation: sum_{k=1}^4 k = 10
  const sumFn = compileExpression("sum(1, 4, k)");
  assert.equal(sumFn({}), 10);

  // Variables extraction ignores dummy integration variables (t, k)
  const vars = expressionVariables("integral(0, mist_lead, amplitude * t) + sum(1, n, k * factor)");
  assert.deepEqual(vars, ["amplitude", "factor", "mist_lead", "n"]);
});

test("Symbolab extended functions: prod, deriv, deriv2, root, logb, ln, fact, binom, erf, matrices, vectors", async () => {
  // Product Π_{k=1}^4 k = 24
  assert.equal(compileExpression("prod(1, 4, k)")({}), 24);

  // 1st derivative: d/dt (t^3) at t = 2 -> 3 * 4 = 12
  assert.ok(Math.abs(compileExpression("deriv(2, t^3)")({}) - 12) < 1e-4);

  // 2nd derivative: d^2/dt^2 (t^3) at t = 2 -> 6 * 2 = 12
  assert.ok(Math.abs(compileExpression("deriv2(2, t^3)")({}) - 12) < 1e-3);

  // nth root and arbitrary base logarithm
  assert.ok(Math.abs(compileExpression("root(3, 27)")({}) - 3) < 1e-9);
  assert.ok(Math.abs(compileExpression("logb(2, 8)")({}) - 3) < 1e-9);
  assert.ok(Math.abs(compileExpression("ln(e^2)")({}) - 2) < 1e-9);

  // Combinatorics & special functions
  assert.ok(Math.abs(compileExpression("fact(5)")({}) - 120) < 1e-9);
  assert.ok(Math.abs(compileExpression("binom(6, 2)")({}) - 15) < 1e-9);
  assert.ok(Math.abs(compileExpression("erf(0)")({})) < 1e-7);

  // Matrices & vectors: trace, Frobenius norm, dot product
  assert.equal(compileExpression("mat2trace(5, 1, 2, 7)")({}), 12);
  assert.equal(compileExpression("mat3trace(1, 0, 0, 0, 4, 0, 0, 0, 9)")({}), 14);
  assert.equal(compileExpression("fnorm2(1, 2, 2, 4)")({}), 5);
  assert.equal(compileExpression("dot2(2, 3, 4, 5)")({}), 23);
  assert.equal(compileExpression("dot3(1, 2, 3, 4, 5, 6)")({}), 32);

  // Hyperbolic & inverse trig
  assert.ok(Math.abs(compileExpression("sinh(0) + cosh(0)")({}) - 1) < 1e-9);
  assert.ok(Math.abs(compileExpression("asin(0.5) * 6 / pi")({}) - 1) < 1e-9);

  // 2D MathBuilder AST round-trip and cursor navigation
  const {
    parseExpressionToMathRow,
    serializeMathRowToExpression,
    countEmptySlots,
    moveCursorRight,
    moveCursorLeft,
    moveCursorTab,
    insertFractionAtCursor,
    insertPowerAtCursor,
    insertNodesAtCursor,
    createVarNode,
    createNumberNodes,
  } = await import("../study/components/mathBuilderModel.ts");

  const complexExpr =
    "(flow * sqrt(droplet)) / nozzles + integral(0, mist_lead, amplitude * exp(-0.15 * t)) + det2(flow, 1, 1, nozzles)";
  const allowedVars = ["flow", "droplet", "nozzles", "mist_lead", "amplitude"];
  const row = parseExpressionToMathRow(complexExpr);
  const serialized = serializeMathRowToExpression(row);
  const fnOrig = compileExpression(complexExpr, { variables: allowedVars });
  const fnRound = compileExpression(serialized, { variables: allowedVars });
  const sampleEnv = { flow: 50, droplet: 16, nozzles: 4, mist_lead: 5, amplitude: 12 };
  assert.ok(Math.abs(fnOrig(sampleEnv) - fnRound(sampleEnv)) < 1e-6);

  // Cursor wrapping: typing variable then `/` wraps variable into numerator and places cursor in denominator
  let editRoot = parseExpressionToMathRow("");
  let cur = { rowId: editRoot.id, offset: 0 };
  const ins1 = insertNodesAtCursor(editRoot, cur, [createVarNode("flow")]);
  editRoot = ins1.root;
  cur = ins1.cursor;
  const fracStep = insertFractionAtCursor(editRoot, cur);
  editRoot = fracStep.root;
  cur = fracStep.cursor;
  const ins2 = insertNodesAtCursor(editRoot, cur, createNumberNodes("60"));
  editRoot = ins2.root;
  assert.equal(serializeMathRowToExpression(editRoot), "(flow / 60)");

  // Power wrapping & empty slot detection
  const powStep = insertPowerAtCursor(editRoot, ins2.cursor);
  assert.equal(countEmptySlots(powStep.root).count, 1);
  assert.equal(countEmptySlots(powStep.root).firstEmptyRowId, powStep.cursor.rowId);

  // Integral node cursor navigation visits lower -> upper -> integrand
  const intRoot = parseExpressionToMathRow("integral(0, mist_lead, amplitude * t)");
  const intNode = intRoot.items[0];
  assert.equal(intNode.kind, "integral");
  const c0 = { rowId: intNode.lower.id, offset: intNode.lower.items.length };
  const cRight = moveCursorRight(intRoot, c0);
  assert.equal(cRight.rowId, intNode.upper.id);
  const cBack = moveCursorLeft(intRoot, cRight);
  assert.equal(cBack.rowId, intNode.lower.id);
  const cTab = moveCursorTab(intRoot, c0, false);
  assert.ok(cTab.rowId);
});
