type Tree = { op: string; value?: string; args: Tree[] };
const fns: Record<string, { arity: number; fn: (...v: number[]) => number }> = {
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  abs: { arity: 1, fn: Math.abs },
  sqrt: { arity: 1, fn: Math.sqrt },
  exp: { arity: 1, fn: Math.exp },
  log: { arity: 1, fn: Math.log },
  log10: { arity: 1, fn: Math.log10 },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  round: { arity: 1, fn: Math.round },
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
  pow: { arity: 2, fn: Math.pow },
  clamp: { arity: 3, fn: (x, a, b) => Math.max(a, Math.min(b, x)) },
  if: { arity: 3, fn: (c, a, b) => (c ? a : b) },
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
      } else if (tok !== "pi" && tok !== "e") {
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
    ? new Set([...options!.variables!, "pi", "e"])
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
          if (!["a", "b", "t", "pi", "e"].includes(tok))
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
