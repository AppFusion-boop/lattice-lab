import ts from "typescript";
import fs from "node:fs";
import { ka } from "../src/core/ka.ts";
for (const name of [
  "Workspace",
  "NodeCard",
  "Plots",
  "SceneEditor",
  "SceneEventTools",
]) {
  const file = "src/" + name + ".tsx",
    src = fs.readFileSync(file, "utf8"),
    ast = ts.createSourceFile(
      file,
      src,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
    edits = [];
  function walk(n) {
    if (ts.isJsxText(n)) {
      const raw = n.getText(ast),
        key = raw.trim().replace(/\s+/g, " ");
      if (ka[key]) {
        edits.push([n.getStart(ast), n.end, raw.replace(raw.trim(), ka[key])]);
      }
    } else if (ts.isStringLiteral(n) && ka[n.text]) {
      const parent = n.parent;
      let skip = false;
      if (
        ts.isImportDeclaration(parent) ||
        ts.isImportClause(parent) ||
        ts.isBinaryExpression(parent) ||
        ts.isLiteralTypeNode(parent) ||
        ts.isUnionTypeNode(parent)
      )
        skip = true;
      if (
        ts.isJsxAttribute(parent) &&
        !["aria-label", "title", "placeholder", "alt"].includes(
          parent.name.getText(ast),
        )
      )
        skip = true;
      if (
        ts.isPropertyAssignment(parent) &&
        ["id", "kind", "icon", "category", "value", "default"].includes(
          parent.name.getText(ast),
        )
      )
        skip = true;
      if (
        n.text === "All" ||
        n.text === "Off" ||
        n.text === "On" ||
        n.text === "Box" ||
        n.text === "Sensors" ||
        n.text === "Scenes" ||
        n.text === "Outputs" ||
        n.text === "Scene events" ||
        /^[a-z]/.test(n.text)
      )
        skip = true;
      if (!skip)
        edits.push([n.getStart(ast), n.end, JSON.stringify(ka[n.text])]);
    }
    ts.forEachChild(n, walk);
  }
  walk(ast);
  let out = src;
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0]))
    out = out.slice(0, start) + value + out.slice(end);
  fs.writeFileSync(file, out);
  console.log(name, edits.length);
}
