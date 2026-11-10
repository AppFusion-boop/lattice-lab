/**
 * Recursive 2D Mathematical Document Model, AST Parser/Serializer,
 * and Cursor Navigation Engine for the Symbolab-style Visual Equation Builder.
 */

let _nextNodeId = 1;
export function newMathId(prefix = "m"): string {
  return `${prefix}_${_nextNodeId++}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface MathRow {
  id: string;
  items: MathNode[];
}

export type MathOp =
  | "+"
  | "-"
  | "*"
  | "%"
  | "=="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "&&"
  | "||";

export type MathNode =
  | { id: string; kind: "char"; char: string }
  | { id: string; kind: "var"; name: string }
  | { id: string; kind: "op"; op: MathOp }
  | { id: string; kind: "frac"; num: MathRow; den: MathRow }
  | { id: string; kind: "pow"; base: MathRow; exp: MathRow }
  | { id: string; kind: "sqrt"; radicand: MathRow }
  | { id: string; kind: "nthroot"; degree: MathRow; radicand: MathRow }
  | { id: string; kind: "abs"; inner: MathRow }
  | { id: string; kind: "floor"; inner: MathRow }
  | { id: string; kind: "ceil"; inner: MathRow }
  | { id: string; kind: "paren"; inner: MathRow }
  | {
      id: string;
      kind: "integral";
      lower: MathRow;
      upper: MathRow;
      integrand: MathRow;
      dVar: string;
    }
  | {
      id: string;
      kind: "sum";
      indexVar: string;
      start: MathRow;
      end: MathRow;
      term: MathRow;
    }
  | {
      id: string;
      kind: "prod";
      indexVar: string;
      start: MathRow;
      end: MathRow;
      term: MathRow;
    }
  | {
      id: string;
      kind: "deriv";
      order: 1 | 2;
      atPoint: MathRow;
      body: MathRow;
    }
  | {
      id: string;
      kind: "matrix";
      op: "det" | "trace" | "fnorm";
      size: 2 | 3;
      cells: MathRow[]; // length 4 for 2x2, 9 for 3x3
    }
  | {
      id: string;
      kind: "vecnorm";
      dim: 2 | 3;
      coords: MathRow[]; // length 2 or 3
    }
  | {
      id: string;
      kind: "vecdot";
      dim: 2 | 3;
      left: MathRow[];
      right: MathRow[];
    }
  | {
      id: string;
      kind: "logbase";
      base: MathRow;
      arg: MathRow;
    }
  | {
      id: string;
      kind: "binom";
      n: MathRow;
      k: MathRow;
    }
  | {
      id: string;
      kind: "piecewise";
      cond: MathRow;
      thenRow: MathRow;
      elseRow: MathRow;
    }
  | {
      id: string;
      kind: "fn";
      fn: string;
      args: MathRow[];
    };

export interface MathCursor {
  rowId: string;
  offset: number;
}

export function createEmptyRow(items: MathNode[] = []): MathRow {
  return { id: newMathId("row"), items };
}

export function createNumberNodes(numStr: string): MathNode[] {
  return numStr.split("").map((ch) => ({
    id: newMathId("ch"),
    kind: "char" as const,
    char: ch,
  }));
}

export function createVarNode(name: string): MathNode {
  return { id: newMathId("var"), kind: "var", name };
}

export function createOpNode(op: MathOp): MathNode {
  return { id: newMathId("op"), kind: "op", op };
}

export function cloneMathRow(row: MathRow): MathRow {
  return {
    id: row.id,
    items: row.items.map(cloneMathNode),
  };
}

export function cloneMathNode(node: MathNode): MathNode {
  switch (node.kind) {
    case "char":
    case "var":
    case "op":
      return { ...node };
    case "frac":
      return { ...node, num: cloneMathRow(node.num), den: cloneMathRow(node.den) };
    case "pow":
      return { ...node, base: cloneMathRow(node.base), exp: cloneMathRow(node.exp) };
    case "sqrt":
      return { ...node, radicand: cloneMathRow(node.radicand) };
    case "nthroot":
      return {
        ...node,
        degree: cloneMathRow(node.degree),
        radicand: cloneMathRow(node.radicand),
      };
    case "abs":
    case "floor":
    case "ceil":
    case "paren":
      return { ...node, inner: cloneMathRow(node.inner) };
    case "integral":
      return {
        ...node,
        lower: cloneMathRow(node.lower),
        upper: cloneMathRow(node.upper),
        integrand: cloneMathRow(node.integrand),
      };
    case "sum":
    case "prod":
      return {
        ...node,
        start: cloneMathRow(node.start),
        end: cloneMathRow(node.end),
        term: cloneMathRow(node.term),
      };
    case "deriv":
      return {
        ...node,
        atPoint: cloneMathRow(node.atPoint),
        body: cloneMathRow(node.body),
      };
    case "matrix":
      return { ...node, cells: node.cells.map(cloneMathRow) };
    case "vecnorm":
      return { ...node, coords: node.coords.map(cloneMathRow) };
    case "vecdot":
      return {
        ...node,
        left: node.left.map(cloneMathRow),
        right: node.right.map(cloneMathRow),
      };
    case "logbase":
      return { ...node, base: cloneMathRow(node.base), arg: cloneMathRow(node.arg) };
    case "binom":
      return { ...node, n: cloneMathRow(node.n), k: cloneMathRow(node.k) };
    case "piecewise":
      return {
        ...node,
        cond: cloneMathRow(node.cond),
        thenRow: cloneMathRow(node.thenRow),
        elseRow: cloneMathRow(node.elseRow),
      };
    case "fn":
      return { ...node, args: node.args.map(cloneMathRow) };
  }
}

/**
 * Returns child MathRows of a composite MathNode in logical navigation order.
 */
export function getChildRows(node: MathNode): MathRow[] {
  switch (node.kind) {
    case "char":
    case "var":
    case "op":
      return [];
    case "frac":
      return [node.num, node.den];
    case "pow":
      return [node.base, node.exp];
    case "sqrt":
      return [node.radicand];
    case "nthroot":
      return [node.degree, node.radicand];
    case "abs":
    case "floor":
    case "ceil":
    case "paren":
      return [node.inner];
    case "integral":
      return [node.lower, node.upper, node.integrand];
    case "sum":
    case "prod":
      return [node.start, node.end, node.term];
    case "deriv":
      return [node.atPoint, node.body];
    case "matrix":
      return node.cells;
    case "vecnorm":
      return node.coords;
    case "vecdot":
      return [...node.left, ...node.right];
    case "logbase":
      return [node.base, node.arg];
    case "binom":
      return [node.n, node.k];
    case "piecewise":
      return [node.thenRow, node.cond, node.elseRow];
    case "fn":
      return node.args;
  }
}

export interface RowContext {
  row: MathRow;
  parentRow: MathRow | null;
  parentNode: MathNode | null;
  parentItemIndex: number; // index of parentNode in parentRow.items
  childRowIndex: number; // index of row in getChildRows(parentNode)
}

export function findRowContext(
  root: MathRow,
  targetRowId: string,
  parentRow: MathRow | null = null,
  parentNode: MathNode | null = null,
  parentItemIndex = -1,
  childRowIndex = -1,
): RowContext | null {
  if (root.id === targetRowId) {
    return {
      row: root,
      parentRow,
      parentNode,
      parentItemIndex,
      childRowIndex,
    };
  }
  for (let i = 0; i < root.items.length; i++) {
    const item = root.items[i];
    const children = getChildRows(item);
    for (let c = 0; c < children.length; c++) {
      const found = findRowContext(children[c], targetRowId, root, item, i, c);
      if (found) return found;
    }
  }
  return null;
}

export function collectAllRows(root: MathRow): MathRow[] {
  const result: MathRow[] = [root];
  function walk(r: MathRow) {
    for (const item of r.items) {
      for (const child of getChildRows(item)) {
        result.push(child);
        walk(child);
      }
    }
  }
  walk(root);
  return result;
}

export function countEmptySlots(root: MathRow): { count: number; firstEmptyRowId: string | null } {
  const allRows = collectAllRows(root);
  // If the root row itself is empty and has no children, that's 1 empty slot
  if (root.items.length === 0) {
    return { count: 1, firstEmptyRowId: root.id };
  }
  let count = 0;
  let firstEmptyRowId: string | null = null;
  for (const r of allRows) {
    if (r.id !== root.id && r.items.length === 0) {
      count++;
      if (!firstEmptyRowId) firstEmptyRowId = r.id;
    }
  }
  return { count, firstEmptyRowId };
}

/**
 * Cursor movement: Right Arrow
 */
export function moveCursorRight(root: MathRow, cursor: MathCursor): MathCursor {
  const ctx = findRowContext(root, cursor.rowId);
  if (!ctx) return { rowId: root.id, offset: root.items.length };

  const { row, parentRow, parentNode, parentItemIndex, childRowIndex } = ctx;
  const clampedOffset = Math.max(0, Math.min(cursor.offset, row.items.length));

  if (clampedOffset < row.items.length) {
    const nextItem = row.items[clampedOffset];
    const children = getChildRows(nextItem);
    if (children.length > 0) {
      return { rowId: children[0].id, offset: 0 };
    }
    return { rowId: row.id, offset: clampedOffset + 1 };
  }

  // At the end of current row: step to next sibling child row or exit parentNode
  if (parentNode && parentRow) {
    const siblings = getChildRows(parentNode);
    if (childRowIndex + 1 < siblings.length) {
      return { rowId: siblings[childRowIndex + 1].id, offset: 0 };
    }
    return { rowId: parentRow.id, offset: parentItemIndex + 1 };
  }

  return { rowId: row.id, offset: row.items.length };
}

/**
 * Cursor movement: Left Arrow
 */
export function moveCursorLeft(root: MathRow, cursor: MathCursor): MathCursor {
  const ctx = findRowContext(root, cursor.rowId);
  if (!ctx) return { rowId: root.id, offset: 0 };

  const { row, parentRow, parentNode, parentItemIndex, childRowIndex } = ctx;
  const clampedOffset = Math.max(0, Math.min(cursor.offset, row.items.length));

  if (clampedOffset > 0) {
    const prevItem = row.items[clampedOffset - 1];
    const children = getChildRows(prevItem);
    if (children.length > 0) {
      const lastChild = children[children.length - 1];
      return { rowId: lastChild.id, offset: lastChild.items.length };
    }
    return { rowId: row.id, offset: clampedOffset - 1 };
  }

  // At the start of current row: step to previous sibling child row or exit before parentNode
  if (parentNode && parentRow) {
    const siblings = getChildRows(parentNode);
    if (childRowIndex > 0) {
      const prevSibling = siblings[childRowIndex - 1];
      return { rowId: prevSibling.id, offset: prevSibling.items.length };
    }
    return { rowId: parentRow.id, offset: parentItemIndex };
  }

  return { rowId: row.id, offset: 0 };
}

/**
 * Cursor movement: Up / Down Arrows across 2D structures (fractions, limits, exponents, matrices, vectors, piecewise)
 */
export function moveCursorVertical(
  root: MathRow,
  cursor: MathCursor,
  direction: "up" | "down",
): MathCursor {
  let currRowId: string | null = cursor.rowId;

  while (currRowId) {
    const ctx = findRowContext(root, currRowId);
    if (!ctx || !ctx.parentNode) break;

    const { parentNode, childRowIndex } = ctx;

    if (parentNode.kind === "frac") {
      if (direction === "up" && childRowIndex === 1) {
        return { rowId: parentNode.num.id, offset: parentNode.num.items.length };
      }
      if (direction === "down" && childRowIndex === 0) {
        return { rowId: parentNode.den.id, offset: parentNode.den.items.length };
      }
    } else if (parentNode.kind === "pow") {
      if (direction === "up" && childRowIndex === 0) {
        return { rowId: parentNode.exp.id, offset: parentNode.exp.items.length };
      }
      if (direction === "down" && childRowIndex === 1) {
        return { rowId: parentNode.base.id, offset: parentNode.base.items.length };
      }
    } else if (parentNode.kind === "integral") {
      // children: [0: lower, 1: upper, 2: integrand]
      if (direction === "up" && (childRowIndex === 0 || childRowIndex === 2)) {
        return { rowId: parentNode.upper.id, offset: parentNode.upper.items.length };
      }
      if (direction === "down" && (childRowIndex === 1 || childRowIndex === 2)) {
        return { rowId: parentNode.lower.id, offset: parentNode.lower.items.length };
      }
    } else if (parentNode.kind === "sum" || parentNode.kind === "prod") {
      // children: [0: start, 1: end, 2: term]
      if (direction === "up" && (childRowIndex === 0 || childRowIndex === 2)) {
        return { rowId: parentNode.end.id, offset: parentNode.end.items.length };
      }
      if (direction === "down" && (childRowIndex === 1 || childRowIndex === 2)) {
        return { rowId: parentNode.start.id, offset: parentNode.start.items.length };
      }
    } else if (parentNode.kind === "binom") {
      if (direction === "up" && childRowIndex === 1) {
        return { rowId: parentNode.n.id, offset: parentNode.n.items.length };
      }
      if (direction === "down" && childRowIndex === 0) {
        return { rowId: parentNode.k.id, offset: parentNode.k.items.length };
      }
    } else if (parentNode.kind === "logbase") {
      if (direction === "down" && childRowIndex === 1) {
        return { rowId: parentNode.base.id, offset: parentNode.base.items.length };
      }
      if (direction === "up" && childRowIndex === 0) {
        return { rowId: parentNode.arg.id, offset: parentNode.arg.items.length };
      }
    } else if (parentNode.kind === "matrix") {
      const n = parentNode.size;
      const r = Math.floor(childRowIndex / n);
      const c = childRowIndex % n;
      if (direction === "up" && r > 0) {
        const target = parentNode.cells[(r - 1) * n + c];
        return { rowId: target.id, offset: target.items.length };
      }
      if (direction === "down" && r + 1 < n) {
        const target = parentNode.cells[(r + 1) * n + c];
        return { rowId: target.id, offset: target.items.length };
      }
    } else if (parentNode.kind === "vecnorm") {
      if (direction === "up" && childRowIndex > 0) {
        const target = parentNode.coords[childRowIndex - 1];
        return { rowId: target.id, offset: target.items.length };
      }
      if (direction === "down" && childRowIndex + 1 < parentNode.coords.length) {
        const target = parentNode.coords[childRowIndex + 1];
        return { rowId: target.id, offset: target.items.length };
      }
    } else if (parentNode.kind === "vecdot") {
      const dim = parentNode.dim;
      const isRight = childRowIndex >= dim;
      const vecIdx = childRowIndex % dim;
      const arr = isRight ? parentNode.right : parentNode.left;
      if (direction === "up" && vecIdx > 0) {
        const target = arr[vecIdx - 1];
        return { rowId: target.id, offset: target.items.length };
      }
      if (direction === "down" && vecIdx + 1 < dim) {
        const target = arr[vecIdx + 1];
        return { rowId: target.id, offset: target.items.length };
      }
    } else if (parentNode.kind === "piecewise") {
      // children: [0: thenRow, 1: cond, 2: elseRow]
      if (direction === "down" && (childRowIndex === 0 || childRowIndex === 1)) {
        return { rowId: parentNode.elseRow.id, offset: parentNode.elseRow.items.length };
      }
      if (direction === "up" && childRowIndex === 2) {
        return { rowId: parentNode.thenRow.id, offset: parentNode.thenRow.items.length };
      }
    }

    currRowId = ctx.parentRow ? ctx.parentRow.id : null;
  }

  return cursor;
}

/**
 * Tab / Shift+Tab jumps between slots (prioritizing empty slots if any exist, otherwise all child slots).
 */
export function moveCursorTab(root: MathRow, cursor: MathCursor, reverse = false): MathCursor {
  const allRows = collectAllRows(root);
  const slotRows = allRows.length > 1 ? allRows.slice(1) : allRows;
  const emptyRows = slotRows.filter((r) => r.items.length === 0);
  const pool = emptyRows.length > 0 ? emptyRows : slotRows;

  const curIdx = pool.findIndex((r) => r.id === cursor.rowId);
  if (curIdx === -1) {
    const target = reverse ? pool[pool.length - 1] : pool[0];
    return { rowId: target.id, offset: target.items.length };
  }
  const nextIdx = (curIdx + (reverse ? -1 : 1) + pool.length) % pool.length;
  const nextRow = pool[nextIdx];
  return { rowId: nextRow.id, offset: nextRow.items.length };
}

/**
 * Backspace at cursor: deletes atomic nodes, unwraps single-child structures when appropriate,
 * or removes empty composite structures.
 */
export function backspaceAtCursor(
  root: MathRow,
  cursor: MathCursor,
): { root: MathRow; cursor: MathCursor } {
  const nextRoot = cloneMathRow(root);
  const ctx = findRowContext(nextRoot, cursor.rowId);
  if (!ctx) return { root: nextRoot, cursor };

  const { row, parentRow, parentNode, parentItemIndex, childRowIndex } = ctx;
  const offset = Math.max(0, Math.min(cursor.offset, row.items.length));

  if (offset > 0) {
    const prevNode = row.items[offset - 1];
    const children = getChildRows(prevNode);
    if (children.length === 0) {
      row.items.splice(offset - 1, 1);
      return { root: nextRoot, cursor: { rowId: row.id, offset: offset - 1 } };
    }

    // If all child slots of prevNode are empty, delete prevNode
    const allEmpty = children.every((c) => c.items.length === 0);
    if (allEmpty) {
      row.items.splice(offset - 1, 1);
      return { root: nextRoot, cursor: { rowId: row.id, offset: offset - 1 } };
    }

    // Otherwise enter the last child row of prevNode at its end
    const lastChild = children[children.length - 1];
    return {
      root: nextRoot,
      cursor: { rowId: lastChild.id, offset: lastChild.items.length },
    };
  }

  // offset === 0 inside a child row of parentNode
  if (parentNode && parentRow) {
    const siblings = getChildRows(parentNode);
    const allEmpty = siblings.every((s) => s.items.length === 0);
    if (allEmpty) {
      parentRow.items.splice(parentItemIndex, 1);
      return {
        root: nextRoot,
        cursor: { rowId: parentRow.id, offset: parentItemIndex },
      };
    }

    // If single-inner wrapper (sqrt, paren, abs, floor, ceil) and we backspace at start -> unwrap inner items
    if (
      parentNode.kind === "sqrt" ||
      parentNode.kind === "paren" ||
      parentNode.kind === "abs" ||
      parentNode.kind === "floor" ||
      parentNode.kind === "ceil"
    ) {
      const innerItems = siblings[0].items;
      parentRow.items.splice(parentItemIndex, 1, ...innerItems);
      return {
        root: nextRoot,
        cursor: { rowId: parentRow.id, offset: parentItemIndex },
      };
    }

    // If fraction and we backspace at start of denominator -> unwrap num and den into parentRow
    if (parentNode.kind === "frac" && childRowIndex === 1) {
      const numItems = parentNode.num.items;
      const denItems = parentNode.den.items;
      parentRow.items.splice(parentItemIndex, 1, ...numItems, ...denItems);
      return {
        root: nextRoot,
        cursor: { rowId: parentRow.id, offset: parentItemIndex + numItems.length },
      };
    }

    // If power and we backspace at start of exp when exp is empty -> unwrap base into parentRow
    if (parentNode.kind === "pow" && childRowIndex === 1 && parentNode.exp.items.length === 0) {
      const baseItems = parentNode.base.items;
      parentRow.items.splice(parentItemIndex, 1, ...baseItems);
      return {
        root: nextRoot,
        cursor: { rowId: parentRow.id, offset: parentItemIndex + baseItems.length },
      };
    }

    // Otherwise step cursor left out of this child slot
    return {
      root: nextRoot,
      cursor: moveCursorLeft(nextRoot, cursor),
    };
  }

  return { root: nextRoot, cursor };
}

/**
 * Delete a specific node by its ID (e.g. clicking a small remove action or pressing Delete).
 */
export function deleteNodeById(
  root: MathRow,
  nodeId: string,
): { root: MathRow; cursor: MathCursor } {
  const nextRoot = cloneMathRow(root);
  const allRows = collectAllRows(nextRoot);
  for (const r of allRows) {
    const idx = r.items.findIndex((it) => it.id === nodeId);
    if (idx !== -1) {
      r.items.splice(idx, 1);
      return { root: nextRoot, cursor: { rowId: r.id, offset: idx } };
    }
  }
  return { root: nextRoot, cursor: { rowId: nextRoot.id, offset: nextRoot.items.length } };
}

/**
 * Extracts the immediately preceding operand in `row.items` before `offset`
 * (e.g., a contiguous number `12.5`, or a single variable/composite node)
 * so that pressing `/` or `^` naturally wraps the preceding term!
 */
function extractPrecedingOperand(row: MathRow, offset: number): {
  extracted: MathNode[];
  newOffset: number;
} {
  if (offset <= 0 || offset > row.items.length) {
    return { extracted: [], newOffset: offset };
  }
  const prev = row.items[offset - 1];
  if (prev.kind === "op") {
    return { extracted: [], newOffset: offset };
  }
  if (prev.kind === "char") {
    let start = offset - 1;
    while (start > 0 && row.items[start - 1].kind === "char") {
      start--;
    }
    const extracted = row.items.splice(start, offset - start);
    return { extracted, newOffset: start };
  }
  const extracted = row.items.splice(offset - 1, 1);
  return { extracted, newOffset: offset - 1 };
}

/**
 * Insert atomic node(s) at cursor position.
 */
export function insertNodesAtCursor(
  root: MathRow,
  cursor: MathCursor,
  nodes: MathNode[],
  focusRowIdAfter?: string,
  focusOffsetAfter?: number,
): { root: MathRow; cursor: MathCursor } {
  const nextRoot = cloneMathRow(root);
  const ctx = findRowContext(nextRoot, cursor.rowId);
  const targetRow = ctx ? ctx.row : nextRoot;
  const offset = ctx ? Math.max(0, Math.min(cursor.offset, targetRow.items.length)) : targetRow.items.length;

  targetRow.items.splice(offset, 0, ...nodes);

  if (focusRowIdAfter) {
    return {
      root: nextRoot,
      cursor: { rowId: focusRowIdAfter, offset: focusOffsetAfter ?? 0 },
    };
  }
  return {
    root: nextRoot,
    cursor: { rowId: targetRow.id, offset: offset + nodes.length },
  };
}

/**
 * Insert a 2D Fraction at cursor. If `wrapPreceding` is true and there is an operand
 * immediately to the left of the cursor, that operand becomes the numerator and cursor moves to denominator.
 */
export function insertFractionAtCursor(
  root: MathRow,
  cursor: MathCursor,
  wrapPreceding = true,
): { root: MathRow; cursor: MathCursor } {
  const nextRoot = cloneMathRow(root);
  const ctx = findRowContext(nextRoot, cursor.rowId);
  const targetRow = ctx ? ctx.row : nextRoot;
  const offset = ctx ? Math.max(0, Math.min(cursor.offset, targetRow.items.length)) : targetRow.items.length;

  let numItems: MathNode[] = [];
  let insertAt = offset;
  if (wrapPreceding) {
    const res = extractPrecedingOperand(targetRow, offset);
    numItems = res.extracted;
    insertAt = res.newOffset;
  }

  const numRow = createEmptyRow(numItems);
  const denRow = createEmptyRow([]);
  const fracNode: MathNode = {
    id: newMathId("frac"),
    kind: "frac",
    num: numRow,
    den: denRow,
  };

  targetRow.items.splice(insertAt, 0, fracNode);
  const nextFocusRow = numItems.length > 0 ? denRow : numRow;
  return {
    root: nextRoot,
    cursor: { rowId: nextFocusRow.id, offset: 0 },
  };
}

/**
 * Insert a 2D Power / Superscript at cursor. If there is a preceding operand, it becomes the base.
 * Optional `presetExp` (e.g. "2" for x², "3" for x³, "-1" for x⁻¹) pre-populates the exponent.
 */
export function insertPowerAtCursor(
  root: MathRow,
  cursor: MathCursor,
  presetExp?: string,
): { root: MathRow; cursor: MathCursor } {
  const nextRoot = cloneMathRow(root);
  const ctx = findRowContext(nextRoot, cursor.rowId);
  const targetRow = ctx ? ctx.row : nextRoot;
  const offset = ctx ? Math.max(0, Math.min(cursor.offset, targetRow.items.length)) : targetRow.items.length;

  const { extracted: baseItems, newOffset: insertAt } = extractPrecedingOperand(targetRow, offset);
  const expItems: MathNode[] = presetExp
    ? presetExp === "-1"
      ? [createOpNode("-"), ...createNumberNodes("1")]
      : createNumberNodes(presetExp)
    : [];

  const baseRow = createEmptyRow(baseItems);
  const expRow = createEmptyRow(expItems);
  const powNode: MathNode = {
    id: newMathId("pow"),
    kind: "pow",
    base: baseRow,
    exp: expRow,
  };

  targetRow.items.splice(insertAt, 0, powNode);

  if (baseItems.length === 0) {
    return { root: nextRoot, cursor: { rowId: baseRow.id, offset: 0 } };
  }
  if (expItems.length === 0) {
    return { root: nextRoot, cursor: { rowId: expRow.id, offset: 0 } };
  }
  return { root: nextRoot, cursor: { rowId: targetRow.id, offset: insertAt + 1 } };
}

/**
 * Serializes a 2D MathRow tree into an executable Lattice expression string.
 * Automatically inserts implicit multiplication `*` where two operands are juxtaposed.
 */
export function serializeMathRowToExpression(row: MathRow, emptyPlaceholder = ""): string {
  if (row.items.length === 0) {
    return emptyPlaceholder;
  }

  // Group contiguous 'char' items into number tokens first
  type GroupedItem =
    | { type: "number"; text: string }
    | { type: "op"; op: MathOp }
    | { type: "node"; node: MathNode };

  const grouped: GroupedItem[] = [];
  for (const item of row.items) {
    if (item.kind === "char") {
      const prev = grouped[grouped.length - 1];
      if (prev && prev.type === "number") {
        prev.text += item.char;
      } else {
        grouped.push({ type: "number", text: item.char });
      }
    } else if (item.kind === "op") {
      grouped.push({ type: "op", op: item.op });
    } else {
      grouped.push({ type: "node", node: item });
    }
  }

  const parts: string[] = [];
  for (let i = 0; i < grouped.length; i++) {
    const g = grouped[i];
    const prev = i > 0 ? grouped[i - 1] : null;

    // Implicit multiplication between two adjacent non-operator items (e.g. `2 flow`, `(a+b)(c+d)`, `2 sqrt(x)`)
    if (prev && prev.type !== "op" && g.type !== "op") {
      parts.push("*");
    }

    if (g.type === "number") {
      parts.push(g.text);
    } else if (g.type === "op") {
      parts.push(g.op);
    } else {
      parts.push(serializeMathNodeToExpression(g.node, emptyPlaceholder));
    }
  }

  return parts.join(" ");
}

function isSingleAtomicOrCallRow(row: MathRow): boolean {
  if (row.items.length === 0) return true;
  if (row.items.every((it) => it.kind === "char")) return true;
  if (row.items.length === 1) {
    const k = row.items[0].kind;
    return k !== "op" && k !== "frac" && k !== "pow";
  }
  return false;
}

function wrapOperand(row: MathRow, serialized: string): string {
  if (isSingleAtomicOrCallRow(row)) return serialized;
  return `(${serialized})`;
}

export function serializeMathNodeToExpression(node: MathNode, emptyPlaceholder = ""): string {
  const s = (r: MathRow) => serializeMathRowToExpression(r, emptyPlaceholder);

  switch (node.kind) {
    case "char":
      return node.char;
    case "var":
      return node.name;
    case "op":
      return node.op;
    case "frac":
      return `(${wrapOperand(node.num, s(node.num))} / ${wrapOperand(node.den, s(node.den))})`;
    case "pow":
      return `${wrapOperand(node.base, s(node.base))}^${wrapOperand(node.exp, s(node.exp))}`;
    case "sqrt":
      return `sqrt(${s(node.radicand)})`;
    case "nthroot":
      return `root(${s(node.degree)}, ${s(node.radicand)})`;
    case "abs":
      return `abs(${s(node.inner)})`;
    case "floor":
      return `floor(${s(node.inner)})`;
    case "ceil":
      return `ceil(${s(node.inner)})`;
    case "paren":
      return `(${s(node.inner)})`;
    case "integral":
      return `integral(${s(node.lower)}, ${s(node.upper)}, ${s(node.integrand)})`;
    case "sum":
      return `sum(${s(node.start)}, ${s(node.end)}, ${s(node.term)})`;
    case "prod":
      return `prod(${s(node.start)}, ${s(node.end)}, ${s(node.term)})`;
    case "deriv":
      return node.order === 2
        ? `deriv2(${s(node.atPoint)}, ${s(node.body)})`
        : `deriv(${s(node.atPoint)}, ${s(node.body)})`;
    case "matrix": {
      const fnPrefix =
        node.op === "det"
          ? `det${node.size}`
          : node.op === "trace"
          ? `mat${node.size}trace`
          : `fnorm${node.size}`;
      return `${fnPrefix}(${node.cells.map(s).join(", ")})`;
    }
    case "vecnorm":
      return `norm${node.dim}(${node.coords.map(s).join(", ")})`;
    case "vecdot":
      return `dot${node.dim}(${[...node.left.map(s), ...node.right.map(s)].join(", ")})`;
    case "logbase":
      return `logb(${s(node.base)}, ${s(node.arg)})`;
    case "binom":
      return `binom(${s(node.n)}, ${s(node.k)})`;
    case "piecewise":
      return `if(${s(node.cond)}, ${s(node.thenRow)}, ${s(node.elseRow)})`;
    case "fn":
      return `${node.fn}(${node.args.map(s).join(", ")})`;
  }
}

/**
 * Parses an expression string into a 2D `MathRow` tree for visual rendering and editing!
 */
interface RawTree {
  op: string;
  value?: string;
  args: RawTree[];
}

const BINARY_PRECEDENCE: Record<string, number> = {
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

function parseRawExpressionTree(source: string): RawTree | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  const tokens: string[] = [];
  const re =
    /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([a-zA-Z_][\w]*)|(>=|<=|==|!=|&&|\|\||[+*/^(),<>!%-]))/gy;
  let end = 0;
  while (end < trimmed.length) {
    re.lastIndex = end;
    const m = re.exec(trimmed);
    if (!m) {
      if (!trimmed.slice(end).trim()) break;
      return null;
    }
    tokens.push(m[1] || m[2] || m[3]);
    end = re.lastIndex;
  }

  let at = 0;
  const parse = (min = 0, depth = 0): RawTree => {
    if (depth > 40) throw new Error("Too deep");
    const tok = tokens[at++];
    if (!tok) throw new Error("Incomplete");
    let tree: RawTree;

    if (tok === "-" || tok === "+" || tok === "!") {
      tree = { op: "unary" + tok, args: [parse(7, depth + 1)] };
    } else if (tok === "(") {
      const inner = parse(0, depth + 1);
      if (tokens[at++] !== ")") throw new Error("Unclosed paren");
      tree = { op: "paren", args: [inner] };
    } else if (/^\d|^\./.test(tok)) {
      tree = { op: "number", value: tok, args: [] };
    } else if (/^[a-zA-Z_]/.test(tok)) {
      if (tokens[at] === "(") {
        at++;
        const args: RawTree[] = [];
        if (tokens[at] !== ")") {
          args.push(parse(0, depth + 1));
          while (tokens[at] === ",") {
            at++;
            args.push(parse(0, depth + 1));
          }
        }
        if (tokens[at++] !== ")") throw new Error("Unclosed call");
        tree = { op: "call", value: tok, args };
      } else {
        tree = { op: "variable", value: tok, args: [] };
      }
    } else {
      throw new Error("Unexpected token");
    }

    while (
      at < tokens.length &&
      (BINARY_PRECEDENCE[tokens[at]] || 0) >= min &&
      Object.prototype.hasOwnProperty.call(BINARY_PRECEDENCE, tokens[at])
    ) {
      const op = tokens[at++];
      const right = parse(BINARY_PRECEDENCE[op] + (op === "^" ? 0 : 1), depth + 1);
      tree = { op, args: [tree, right] };
    }
    return tree;
  };

  try {
    const root = parse();
    if (at !== tokens.length) return null;
    return root;
  } catch {
    return null;
  }
}

function unwrapOuterParen(t: RawTree): RawTree {
  let curr = t;
  while (curr.op === "paren" && curr.args.length === 1) {
    curr = curr.args[0];
  }
  return curr;
}

function rawTreeToMathNodes(t: RawTree): MathNode[] {
  if (t.op === "number") {
    return createNumberNodes(t.value || "0");
  }
  if (t.op === "variable") {
    return [createVarNode(t.value || "x")];
  }
  if (t.op === "paren") {
    const innerUnwrapped = unwrapOuterParen(t.args[0]);
    if (innerUnwrapped.op === "/" || innerUnwrapped.op === "^") {
      return rawTreeToMathNodes(innerUnwrapped);
    }
    return [
      {
        id: newMathId("paren"),
        kind: "paren",
        inner: createEmptyRow(rawTreeToMathNodes(innerUnwrapped)),
      },
    ];
  }
  if (t.op === "unary-") {
    return [createOpNode("-"), ...rawTreeToMathNodes(t.args[0])];
  }
  if (t.op === "unary+") {
    return rawTreeToMathNodes(t.args[0]);
  }
  if (t.op === "/") {
    const numTree = unwrapOuterParen(t.args[0]);
    const denTree = unwrapOuterParen(t.args[1]);
    return [
      {
        id: newMathId("frac"),
        kind: "frac",
        num: createEmptyRow(rawTreeToMathNodes(numTree)),
        den: createEmptyRow(rawTreeToMathNodes(denTree)),
      },
    ];
  }
  if (t.op === "^") {
    const baseTree = unwrapOuterParen(t.args[0]);
    const expTree = unwrapOuterParen(t.args[1]);
    return [
      {
        id: newMathId("pow"),
        kind: "pow",
        base: createEmptyRow(rawTreeToMathNodes(baseTree)),
        exp: createEmptyRow(rawTreeToMathNodes(expTree)),
      },
    ];
  }
  if (
    t.op === "+" ||
    t.op === "-" ||
    t.op === "*" ||
    t.op === "%" ||
    t.op === "==" ||
    t.op === "!=" ||
    t.op === "<" ||
    t.op === ">" ||
    t.op === "<=" ||
    t.op === ">=" ||
    t.op === "&&" ||
    t.op === "||"
  ) {
    return [
      ...rawTreeToMathNodes(t.args[0]),
      createOpNode(t.op as MathOp),
      ...rawTreeToMathNodes(t.args[1]),
    ];
  }
  if (t.op === "call") {
    const fn = t.value || "";
    const toRow = (arg: RawTree) => createEmptyRow(rawTreeToMathNodes(unwrapOuterParen(arg)));

    if (fn === "sqrt" && t.args.length === 1) {
      return [{ id: newMathId("sqrt"), kind: "sqrt", radicand: toRow(t.args[0]) }];
    }
    if (fn === "root" && t.args.length === 2) {
      return [
        {
          id: newMathId("nthroot"),
          kind: "nthroot",
          degree: toRow(t.args[0]),
          radicand: toRow(t.args[1]),
        },
      ];
    }
    if (fn === "pow" && t.args.length === 2) {
      return [
        {
          id: newMathId("pow"),
          kind: "pow",
          base: toRow(t.args[0]),
          exp: toRow(t.args[1]),
        },
      ];
    }
    if (fn === "abs" && t.args.length === 1) {
      return [{ id: newMathId("abs"), kind: "abs", inner: toRow(t.args[0]) }];
    }
    if (fn === "floor" && t.args.length === 1) {
      return [{ id: newMathId("floor"), kind: "floor", inner: toRow(t.args[0]) }];
    }
    if (fn === "ceil" && t.args.length === 1) {
      return [{ id: newMathId("ceil"), kind: "ceil", inner: toRow(t.args[0]) }];
    }
    if (fn === "integral" && t.args.length === 3) {
      return [
        {
          id: newMathId("int"),
          kind: "integral",
          lower: toRow(t.args[0]),
          upper: toRow(t.args[1]),
          integrand: toRow(t.args[2]),
          dVar: "t",
        },
      ];
    }
    if (fn === "sum" && t.args.length === 3) {
      return [
        {
          id: newMathId("sum"),
          kind: "sum",
          indexVar: "k",
          start: toRow(t.args[0]),
          end: toRow(t.args[1]),
          term: toRow(t.args[2]),
        },
      ];
    }
    if (fn === "prod" && t.args.length === 3) {
      return [
        {
          id: newMathId("prod"),
          kind: "prod",
          indexVar: "k",
          start: toRow(t.args[0]),
          end: toRow(t.args[1]),
          term: toRow(t.args[2]),
        },
      ];
    }
    if ((fn === "deriv" || fn === "deriv2") && t.args.length === 2) {
      return [
        {
          id: newMathId("deriv"),
          kind: "deriv",
          order: fn === "deriv2" ? 2 : 1,
          atPoint: toRow(t.args[0]),
          body: toRow(t.args[1]),
        },
      ];
    }
    if ((fn === "det2" || fn === "mat2trace" || fn === "fnorm2") && t.args.length === 4) {
      const op = fn === "det2" ? "det" : fn === "mat2trace" ? "trace" : "fnorm";
      return [
        {
          id: newMathId("mat"),
          kind: "matrix",
          op,
          size: 2,
          cells: t.args.map(toRow),
        },
      ];
    }
    if ((fn === "det3" || fn === "mat3trace" || fn === "fnorm3") && t.args.length === 9) {
      const op = fn === "det3" ? "det" : fn === "mat3trace" ? "trace" : "fnorm";
      return [
        {
          id: newMathId("mat"),
          kind: "matrix",
          op,
          size: 3,
          cells: t.args.map(toRow),
        },
      ];
    }
    if (fn === "norm2" && t.args.length === 2) {
      return [
        {
          id: newMathId("vnorm"),
          kind: "vecnorm",
          dim: 2,
          coords: t.args.map(toRow),
        },
      ];
    }
    if (fn === "norm3" && t.args.length === 3) {
      return [
        {
          id: newMathId("vnorm"),
          kind: "vecnorm",
          dim: 3,
          coords: t.args.map(toRow),
        },
      ];
    }
    if (fn === "dot2" && t.args.length === 4) {
      return [
        {
          id: newMathId("vdot"),
          kind: "vecdot",
          dim: 2,
          left: [toRow(t.args[0]), toRow(t.args[1])],
          right: [toRow(t.args[2]), toRow(t.args[3])],
        },
      ];
    }
    if (fn === "dot3" && t.args.length === 6) {
      return [
        {
          id: newMathId("vdot"),
          kind: "vecdot",
          dim: 3,
          left: [toRow(t.args[0]), toRow(t.args[1]), toRow(t.args[2])],
          right: [toRow(t.args[3]), toRow(t.args[4]), toRow(t.args[5])],
        },
      ];
    }
    if (fn === "logb" && t.args.length === 2) {
      return [
        {
          id: newMathId("logb"),
          kind: "logbase",
          base: toRow(t.args[0]),
          arg: toRow(t.args[1]),
        },
      ];
    }
    if (fn === "binom" && t.args.length === 2) {
      return [
        {
          id: newMathId("binom"),
          kind: "binom",
          n: toRow(t.args[0]),
          k: toRow(t.args[1]),
        },
      ];
    }
    if (fn === "if" && t.args.length === 3) {
      return [
        {
          id: newMathId("pw"),
          kind: "piecewise",
          cond: toRow(t.args[0]),
          thenRow: toRow(t.args[1]),
          elseRow: toRow(t.args[2]),
        },
      ];
    }
    return [
      {
        id: newMathId("fn"),
        kind: "fn",
        fn,
        args: t.args.map(toRow),
      },
    ];
  }
  return [];
}

export function parseExpressionToMathRow(source: string): MathRow {
  const raw = parseRawExpressionTree(source);
  if (!raw) {
    return createEmptyRow([]);
  }
  const unwrapped = unwrapOuterParen(raw);
  return createEmptyRow(rawTreeToMathNodes(unwrapped));
}
