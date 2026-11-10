type Tree = { op: string; value?: string; args: Tree[] };

const GAUSS_NODES = [
  -0.9894009349916499,
  -0.9445750230732326,
  -0.8656312023878318,
  -0.7554044083550030,
  -0.6178762444026438,
  -0.4580167776572274,
  -0.2816035507792589,
  -0.0950125098376374,
  0.0950125098376374,
  0.2816035507792589,
  0.4580167776572274,
  0.6178762444026438,
  0.7554044083550030,
  0.8656312023878318,
  0.9445750230732326,
  0.9894009349916499,
];

const GAUSS_WEIGHTS = [
  0.0271524594117542,
  0.0622535239386475,
  0.0951585116824926,
  0.1246289712555341,
  0.1495959888165767,
  0.1691565193950027,
  0.1826034150449236,
  0.1894506104550686,
  0.1894506104550686,
  0.1826034150449236,
  0.1691565193950027,
  0.1495959888165767,
  0.1246289712555341,
  0.0951585116824926,
  0.0622535239386475,
  0.0271524594117542,
];

const LANCZOS_COEFFS = [
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function gammaFn(z: number): number {
  if (!Number.isFinite(z)) return NaN;
  if (z < 0.5) {
    const s = Math.sin(Math.PI * z);
    if (Math.abs(s) < 1e-15) return NaN;
    return Math.PI / (s * gammaFn(1 - z));
  }
  const zm1 = z - 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < LANCZOS_COEFFS.length; i++) {
    x += LANCZOS_COEFFS[i] / (zm1 + i + 1);
  }
  const t = zm1 + LANCZOS_COEFFS.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, zm1 + 0.5) * Math.exp(-t) * x;
}

function factorialFn(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (x < 0 && Math.abs(x - Math.round(x)) < 1e-12) return NaN;
  if (x >= 0 && x <= 20 && Math.abs(x - Math.round(x)) < 1e-12) {
    let acc = 1;
    const n = Math.round(x);
    for (let i = 2; i <= n; i++) acc *= i;
    return acc;
  }
  return gammaFn(x + 1);
}

function binomFn(n: number, k: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(k)) return NaN;
  if (
    Math.abs(n - Math.round(n)) < 1e-9 &&
    Math.abs(k - Math.round(k)) < 1e-9
  ) {
    const ni = Math.round(n);
    const ki = Math.round(k);
    if (ki < 0 || ki > ni) return 0;
    const m = Math.min(ki, ni - ki);
    let res = 1;
    for (let i = 1; i <= m; i++) {
      res = (res * (ni - m + i)) / i;
    }
    return Math.round(res);
  }
  return factorialFn(n) / (factorialFn(k) * factorialFn(n - k));
}

function erfFn(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function nthRootFn(n: number, x: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(x) || n === 0) return NaN;
  if (x < 0) {
    const nr = Math.round(n);
    if (Math.abs(n - nr) < 1e-9 && Math.abs(nr % 2) === 1) {
      return -Math.pow(-x, 1 / nr);
    }
    return NaN;
  }
  return Math.pow(x, 1 / n);
}

function logBaseFn(base: number, x: number): number {
  if (base <= 0 || base === 1 || x <= 0) return NaN;
  return Math.log(x) / Math.log(base);
}

const fns: Record<string, { arity: number; fn: (...v: number[]) => number }> = {
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  asin: { arity: 1, fn: Math.asin },
  acos: { arity: 1, fn: Math.acos },
  atan: { arity: 1, fn: Math.atan },
  atan2: { arity: 2, fn: Math.atan2 },
  sinh: { arity: 1, fn: Math.sinh },
  cosh: { arity: 1, fn: Math.cosh },
  tanh: { arity: 1, fn: Math.tanh },
  abs: { arity: 1, fn: Math.abs },
  sign: { arity: 1, fn: Math.sign },
  sqrt: { arity: 1, fn: Math.sqrt },
  root: { arity: 2, fn: nthRootFn },
  exp: { arity: 1, fn: Math.exp },
  log: { arity: 1, fn: Math.log },
  ln: { arity: 1, fn: Math.log },
  log10: { arity: 1, fn: Math.log10 },
  logb: { arity: 2, fn: logBaseFn },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  round: { arity: 1, fn: Math.round },
  fact: { arity: 1, fn: factorialFn },
  binom: { arity: 2, fn: binomFn },
  erf: { arity: 1, fn: erfFn },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
  pow: { arity: 2, fn: Math.pow },
  clamp: { arity: 3, fn: (x, a, b) => Math.max(a, Math.min(b, x)) },
  if: { arity: 3, fn: (c, a, b) => (c ? a : b) },
  det2: { arity: 4, fn: (a, b, c, d) => a * d - b * c },
  det3: {
    arity: 9,
    fn: (a1, a2, a3, b1, b2, b3, c1, c2, c3) =>
      a1 * (b2 * c3 - b3 * c2) - a2 * (b1 * c3 - b3 * c1) + a3 * (b1 * c2 - b2 * c1),
  },
  mat2trace: { arity: 4, fn: (a11, _a12, _a21, a22) => a11 + a22 },
  mat3trace: {
    arity: 9,
    fn: (a1, _a2, _a3, _b1, b2, _b3, _c1, _c2, c3) => a1 + b2 + c3,
  },
  fnorm2: { arity: 4, fn: (a, b, c, d) => Math.hypot(a, b, c, d) },
  fnorm3: {
    arity: 9,
    fn: (a1, a2, a3, b1, b2, b3, c1, c2, c3) =>
      Math.hypot(a1, a2, a3, b1, b2, b3, c1, c2, c3),
  },
  norm2: { arity: 2, fn: (x, y) => Math.hypot(x, y) },
  norm3: { arity: 3, fn: (x, y, z) => Math.hypot(x, y, z) },
  dot2: { arity: 4, fn: (x1, y1, x2, y2) => x1 * x2 + y1 * y2 },
  dot3: {
    arity: 6,
    fn: (x1, y1, z1, x2, y2, z2) => x1 * x2 + y1 * y2 + z1 * z2,
  },
  trace2: { arity: 2, fn: (a, d) => a + d },
  trace3: { arity: 3, fn: (a, b, c) => a + b + c },
  integral: { arity: 3, fn: () => 0 }, // Handled in calc AST walker
  sum: { arity: 3, fn: () => 0 }, // Handled in calc AST walker
  prod: { arity: 3, fn: () => 0 }, // Handled in calc AST walker
  deriv: { arity: 2, fn: () => 0 }, // Handled in calc AST walker
  deriv2: { arity: 2, fn: () => 0 }, // Handled in calc AST walker
};
export const formulaFunctions = Object.keys(fns);

export interface CompileOptions {
  variables?: readonly string[];
  strict?: boolean;
}

export function expressionVariables(source: string): string[] {
  if (!source || typeof source !== "string") return [];
  const re =
    /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([a-zA-Z_][\w]*)|(>=|<=|==|!=|&&|\|\||[+*/^(),<>!%-]))/gy;
  let end = 0;
  const tokens: string[] = [];
  while (end < source.length) {
    re.lastIndex = end;
    const m = re.exec(source);
    if (!m) break;
    tokens.push(m[1] || m[2] || m[3]);
    end = re.lastIndex;
  }
  const vars = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^[a-zA-Z_]/.test(tok)) {
      if (tokens[i + 1] === "(") {
        // function call
      } else if (tok !== "pi" && tok !== "e" && tok !== "t" && tok !== "k") {
        vars.add(tok);
      }
    }
  }
  return Array.from(vars).sort();
}

export function compileExpression(
  source: string,
  options?: CompileOptions,
): (vars: Record<string, number>) => number {
  if (!source.trim() || source.length > 500)
    throw Error("Enter an expression (maximum 500 characters).");

  const hasCustomVars = options?.variables !== undefined;
  if (hasCustomVars) {
    for (const v of options!.variables!) {
      if (Object.hasOwn(fns, v)) {
        throw Error("Variable name collides with function: " + v);
      }
    }
  }
  const allowedVars = hasCustomVars
    ? new Set([...options!.variables!, "pi", "e", "t", "k"])
    : null;
  const strict = options?.strict ?? (hasCustomVars ? true : false);

  const tokens: string[] = [];
  const re =
    /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([a-zA-Z_][\w]*)|(>=|<=|==|!=|&&|\|\||[+*/^(),<>!%-]))/gy;
  let end = 0;
  while (end < source.length) {
    re.lastIndex = end;
    const m = re.exec(source);
    if (!m) {
      if (!source.slice(end).trim()) break;
      throw Error("Unexpected character at " + (end + 1));
    }
    tokens.push(m[1] || m[2] || m[3]);
    end = re.lastIndex;
  }
  let at = 0;
  const precedence: Record<string, number> = {
    "||": 1,
    "&&": 2,
    "==": 3,
    "!=": 3,
    ">": 4,
    "<": 4,
    ">=": 4,
    "<=": 4,
    "+": 5,
    "-": 5,
    "*": 6,
    "/": 6,
    "%": 6,
    "^": 8,
  };
  const parse = (min = 0, depth = 0): Tree => {
    if (depth > 35) throw Error("Expression is too deeply nested");
    let tok = tokens[at++],
      tree: Tree;
    if (!tok) throw Error("Incomplete expression");
    if (tok === "-" || tok === "+" || tok === "!")
      tree = { op: "unary" + tok, args: [parse(7, depth + 1)] };
    else if (tok === "(") {
      tree = parse(0, depth + 1);
      if (tokens[at++] !== ")") throw Error("Missing closing parenthesis");
    } else if (/^\d|^\./.test(tok))
      tree = { op: "number", value: tok, args: [] };
    else if (/^[a-zA-Z_]/.test(tok)) {
      if (tokens[at] === "(") {
        if (!Object.hasOwn(fns, tok)) throw Error("Unknown function: " + tok);
        at++;
        const args: Tree[] = [];
        if (tokens[at] !== ")") {
          args.push(parse(0, depth + 1));
          while (tokens[at] === ",") {
            at++;
            args.push(parse(0, depth + 1));
          }
        }
        if (tokens[at++] !== ")") throw Error("Missing closing parenthesis");
        if (args.length !== fns[tok].arity)
          throw Error(tok + " expects " + fns[tok].arity + " arguments");
        tree = { op: "call", value: tok, args };
      } else {
        if (allowedVars) {
          if (!allowedVars.has(tok)) {
            throw Error("Unknown variable: " + tok);
          }
        } else {
          if (!["a", "b", "c", "d", "t", "k", "pi", "e"].includes(tok))
            throw Error("Unknown variable: " + tok + ". Use a, b or t.");
        }
        tree = { op: "variable", value: tok, args: [] };
      }
    } else throw Error("Unexpected token: " + tok);
    while (
      at < tokens.length &&
      (precedence[tokens[at]] || 0) >= min &&
      Object.hasOwn(precedence, tokens[at])
    ) {
      const op = tokens[at++],
        right = parse(precedence[op] + (op === "^" ? 0 : 1), depth + 1);
      tree = { op, args: [tree, right] };
    }
    return tree;
  };
  const root = parse();
  if (at !== tokens.length) throw Error("Unexpected token: " + tokens[at]);
  const calc = (n: Tree, v: Record<string, number>): number => {
    if (n.op === "number") return Number(n.value);
    if (n.op === "variable") {
      if (n.value === "pi") return Math.PI;
      if (n.value === "e") return Math.E;
      if (strict) {
        if (!Object.hasOwn(v, n.value!) || v[n.value!] === undefined || v[n.value!] === null || !Number.isFinite(v[n.value!])) {
          throw Error("Missing variable: " + n.value);
        }
        return v[n.value!];
      }
      return v[n.value!] ?? 0;
    }
    if (n.op === "call") {
      if (n.value === "if")
        return calc(n.args[0], v) ? calc(n.args[1], v) : calc(n.args[2], v);
      if (n.value === "integral") {
        const lower = calc(n.args[0], v);
        const upper = calc(n.args[1], v);
        if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
          throw Error("Integral bounds must be finite numbers");
        }
        let quadSum = 0;
        const halfLen = 0.5 * (upper - lower);
        const mid = 0.5 * (upper + lower);
        for (let i = 0; i < GAUSS_NODES.length; i++) {
          const tVal = halfLen * GAUSS_NODES[i] + mid;
          quadSum += GAUSS_WEIGHTS[i] * calc(n.args[2], { ...v, t: tVal });
        }
        return halfLen * quadSum;
      }
      if (n.value === "sum") {
        const start = Math.floor(calc(n.args[0], v));
        const end = Math.floor(calc(n.args[1], v));
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          throw Error("Summation bounds must be finite integers");
        }
        if (end - start > 10000) {
          throw Error("Summation range too large (max 10,000 steps)");
        }
        let tot = 0;
        for (let k = start; k <= end; k++) {
          tot += calc(n.args[2], { ...v, k, t: k });
        }
        return tot;
      }
      if (n.value === "prod") {
        const start = Math.floor(calc(n.args[0], v));
        const end = Math.floor(calc(n.args[1], v));
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
          throw Error("Product bounds must be finite integers");
        }
        if (end - start > 10000) {
          throw Error("Product range too large (max 10,000 steps)");
        }
        let acc = 1;
        for (let k = start; k <= end; k++) {
          acc *= calc(n.args[2], { ...v, k, t: k });
        }
        return acc;
      }
      if (n.value === "deriv") {
        const t0 = calc(n.args[0], v);
        if (!Number.isFinite(t0)) {
          throw Error("Derivative evaluation point must be finite");
        }
        const h = Math.max(1e-5, Math.abs(t0) * 1e-4);
        const fp2 = calc(n.args[1], { ...v, t: t0 + 2 * h });
        const fp1 = calc(n.args[1], { ...v, t: t0 + h });
        const fm1 = calc(n.args[1], { ...v, t: t0 - h });
        const fm2 = calc(n.args[1], { ...v, t: t0 - 2 * h });
        return (-fp2 + 8 * fp1 - 8 * fm1 + fm2) / (12 * h);
      }
      if (n.value === "deriv2") {
        const t0 = calc(n.args[0], v);
        if (!Number.isFinite(t0)) {
          throw Error("Derivative evaluation point must be finite");
        }
        const h = Math.max(1e-4, Math.abs(t0) * 1e-3);
        const fp1 = calc(n.args[1], { ...v, t: t0 + h });
        const f0 = calc(n.args[1], { ...v, t: t0 });
        const fm1 = calc(n.args[1], { ...v, t: t0 - h });
        return (fp1 - 2 * f0 + fm1) / (h * h);
      }
      return fns[n.value!].fn(...n.args.map((a) => calc(a, v)));
    }
    const a = calc(n.args[0], v);
    if (n.op === "unary-") return -a;
    if (n.op === "unary+") return a;
    if (n.op === "unary!") return +!a;
    if (n.op === "&&") return a ? +!!calc(n.args[1], v) : 0;
    if (n.op === "||") return a ? 1 : +!!calc(n.args[1], v);
    const b = calc(n.args[1], v);
    switch (n.op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return a / b;
      case "%":
        return a % b;
      case "^":
        return a ** b;
      case ">":
        return +(a > b);
      case "<":
        return +(a < b);
      case ">=":
        return +(a >= b);
      case "<=":
        return +(a <= b);
      case "==":
        return +(a === b);
      case "!=":
        return +(a !== b);
      default:
        throw Error("Invalid operator");
    }
  };
  return (vars) => {
    const result = calc(root, vars);
    if (!Number.isFinite(result))
      throw Error(
        "Expression produced a non-finite value. Check division and function domains.",
      );
    return result;
  };
}
