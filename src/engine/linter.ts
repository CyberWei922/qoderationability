import type { LintIssue } from '../types/contracts';
import type { Expr, LValue, PortDirection, SourceLoc, Stmt } from './ast';
import { evalExpr, toSigned, type ArrayMeta, type ElaboratedModule } from './simulator';

export interface ExpectedPortSpec {
  name: string;
  direction: PortDirection;
  width: number;
  optional?: boolean;
}

export const BOARD_PORT_SPECS: ExpectedPortSpec[] = [
  { name: 'clk', direction: 'input', width: 1 },
  { name: 'rst_n', direction: 'input', width: 1 },
  { name: 'key', direction: 'input', width: 4 },
  { name: 'sw', direction: 'input', width: 8 },
  { name: 'led', direction: 'output', width: 8 },
  { name: 'traffic', direction: 'output', width: 3 },
  { name: 'seg', direction: 'output', width: 16 },
  { name: 'tone', direction: 'output', width: 4, optional: true },
  { name: 'screen_x', direction: 'output', width: 4, optional: true },
  { name: 'screen_y', direction: 'output', width: 3, optional: true },
  { name: 'screen_data', direction: 'output', width: 8, optional: true },
  { name: 'screen_cmd', direction: 'output', width: 2, optional: true },
  { name: 'screen_color', direction: 'output', width: 8, optional: true },
];

const SCREEN_PORT_NAMES = ['screen_x', 'screen_y', 'screen_data', 'screen_cmd'] as const;
const EXPECTED_PORT_MAP = new Map(BOARD_PORT_SPECS.map((p) => [p.name, p]));

function collectLValueNames(lv: LValue, out: Set<string>): void {
  switch (lv.type) {
    case 'ident':
    case 'index':
    case 'slice':
    case 'indexed':
      out.add(lv.name);
      return;
    case 'concat':
      for (const item of lv.items) collectLValueNames(item, out);
      return;
  }
}

function collectLValueIndexReads(lv: LValue, out: Set<string>): void {
  switch (lv.type) {
    case 'ident':
      return;
    case 'index':
      collectExprReads(lv.index, out);
      return;
    case 'slice':
      collectExprReads(lv.msb, out);
      collectExprReads(lv.lsb, out);
      return;
    case 'indexed':
      for (const idx of lv.indices) collectExprReads(idx, out);
      if (lv.slice) {
        collectExprReads(lv.slice.msb, out);
        collectExprReads(lv.slice.lsb, out);
      }
      return;
    case 'concat':
      for (const item of lv.items) collectLValueIndexReads(item, out);
      return;
  }
}

function collectExprReads(expr: Expr, out: Set<string>): void {
  switch (expr.type) {
    case 'number':
      return;
    case 'ident':
      out.add(expr.name);
      return;
    case 'index':
      collectExprReads(expr.target, out);
      collectExprReads(expr.index, out);
      return;
    case 'slice':
      collectExprReads(expr.target, out);
      collectExprReads(expr.msb, out);
      collectExprReads(expr.lsb, out);
      return;
    case 'concat':
      for (const it of expr.items) collectExprReads(it, out);
      return;
    case 'repeat':
      collectExprReads(expr.count, out);
      for (const it of expr.items) collectExprReads(it, out);
      return;
    case 'unary':
      collectExprReads(expr.operand, out);
      return;
    case 'binary':
      collectExprReads(expr.left, out);
      collectExprReads(expr.right, out);
      return;
    case 'ternary':
      collectExprReads(expr.condition, out);
      collectExprReads(expr.thenExpr, out);
      collectExprReads(expr.elseExpr, out);
      return;
    case 'sysfn':
      collectExprReads(expr.arg, out);
      return;
  }
}

function isExprSigned(expr: Expr, elaborated: ElaboratedModule): boolean {
  switch (expr.type) {
    case 'number':
      return expr.signed;
    case 'ident': {
      const p = elaborated.params.get(expr.name);
      if (p) return p.signed;
      return elaborated.signals.get(expr.name)?.signed ?? false;
    }
    case 'sysfn':
      return expr.name === '$signed';
    case 'unary':
      return expr.op === '+' || expr.op === '-' || expr.op === '~'
        ? isExprSigned(expr.operand, elaborated)
        : false;
    case 'binary':
      return isExprSigned(expr.left, elaborated) && isExprSigned(expr.right, elaborated);
    case 'ternary':
      return isExprSigned(expr.thenExpr, elaborated) && isExprSigned(expr.elseExpr, elaborated);
    case 'index':
    case 'slice':
    case 'concat':
    case 'repeat':
      return false;
  }
}

function checkUnsignedArithShift(
  expr: Expr,
  elaborated: ElaboratedModule,
  issues: LintIssue[]
): void {
  switch (expr.type) {
    case 'number':
    case 'ident':
      return;
    case 'index':
      checkUnsignedArithShift(expr.target, elaborated, issues);
      checkUnsignedArithShift(expr.index, elaborated, issues);
      return;
    case 'slice':
      checkUnsignedArithShift(expr.target, elaborated, issues);
      checkUnsignedArithShift(expr.msb, elaborated, issues);
      checkUnsignedArithShift(expr.lsb, elaborated, issues);
      return;
    case 'concat':
      for (const it of expr.items) checkUnsignedArithShift(it, elaborated, issues);
      return;
    case 'repeat':
      checkUnsignedArithShift(expr.count, elaborated, issues);
      for (const it of expr.items) checkUnsignedArithShift(it, elaborated, issues);
      return;
    case 'unary':
      checkUnsignedArithShift(expr.operand, elaborated, issues);
      return;
    case 'sysfn':
      checkUnsignedArithShift(expr.arg, elaborated, issues);
      return;
    case 'ternary':
      checkUnsignedArithShift(expr.condition, elaborated, issues);
      checkUnsignedArithShift(expr.thenExpr, elaborated, issues);
      checkUnsignedArithShift(expr.elseExpr, elaborated, issues);
      return;
    case 'binary':
      if (expr.op === '>>>' && !isExprSigned(expr.left, elaborated)) {
        issues.push({
          code: 'UNSIGNED_ARITH_SHIFT',
          severity: 'warning',
          line: expr.loc.line,
          column: expr.loc.column,
          message: `第 ${expr.loc.line} 行对无符号数使用了算术右移 ">>>"，高位仍会补 0 而非符号扩展`,
          hint: '若需要符号扩展，请将操作数声明为 signed 或使用 $signed(...) 包裹；若意图补 0 请改用 ">>"。',
        });
      }
      checkUnsignedArithShift(expr.left, elaborated, issues);
      checkUnsignedArithShift(expr.right, elaborated, issues);
      return;
  }
}

function collectAllWrites(stmt: Stmt, out: Set<string>): void {
  switch (stmt.type) {
    case 'empty':
      return;
    case 'block':
      for (const s of stmt.statements) collectAllWrites(s, out);
      return;
    case 'assign':
      collectLValueNames(stmt.target, out);
      return;
    case 'if':
      collectAllWrites(stmt.thenBranch, out);
      if (stmt.elseBranch) collectAllWrites(stmt.elseBranch, out);
      return;
    case 'case':
      for (const item of stmt.items) collectAllWrites(item.body, out);
      if (stmt.defaultBranch) collectAllWrites(stmt.defaultBranch, out);
      return;
    case 'for':
      collectAllWrites(stmt.body, out);
      return;
  }
}

function intersectSets(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set();
  const result = new Set(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    for (const v of result) {
      if (!sets[i].has(v)) result.delete(v);
    }
  }
  return result;
}

/**
 * Checks a combinational statement for inferred latches and returns the set of
 * variables guaranteed to be assigned on every path through this statement.
 */
function checkCombLatches(
  stmt: Stmt,
  alreadyAssigned: Set<string>,
  issues: LintIssue[]
): Set<string> {
  switch (stmt.type) {
    case 'empty':
      return new Set(alreadyAssigned);

    case 'assign': {
      const next = new Set(alreadyAssigned);
      collectLValueNames(stmt.target, next);
      return next;
    }

    case 'block': {
      let current = new Set(alreadyAssigned);
      for (const s of stmt.statements) {
        current = checkCombLatches(s, current, issues);
      }
      return current;
    }

    case 'if': {
      const thenDef = checkCombLatches(stmt.thenBranch, alreadyAssigned, issues);
      if (!stmt.elseBranch) {
        const thenWrites = new Set<string>();
        collectAllWrites(stmt.thenBranch, thenWrites);
        const latched = Array.from(thenWrites).filter((v) => !alreadyAssigned.has(v));
        if (latched.length > 0) {
          issues.push({
            code: 'INFERRED_LATCH',
            severity: 'warning',
            line: stmt.loc.line,
            column: stmt.loc.column,
            message: `第 ${stmt.loc.line} 行组合块中的 if 语句缺少 else 分支，可能导致信号 ${latched.join(', ')} 综合出锁存器 (Latch)`,
            hint: '请补全 else 分支，或在 always @(*) 块开头为目标信号赋默认值。',
          });
        }
        return new Set(alreadyAssigned);
      }

      const elseDef = checkCombLatches(stmt.elseBranch, alreadyAssigned, issues);
      const allBranchWrites = new Set<string>();
      collectAllWrites(stmt.thenBranch, allBranchWrites);
      collectAllWrites(stmt.elseBranch, allBranchWrites);
      const bothDef = intersectSets([thenDef, elseDef]);
      const partial = Array.from(allBranchWrites).filter((v) => !bothDef.has(v));
      if (partial.length > 0) {
        issues.push({
          code: 'INFERRED_LATCH',
          severity: 'warning',
          line: stmt.loc.line,
          column: stmt.loc.column,
          message: `第 ${stmt.loc.line} 行 if/else 仅在部分分支中对 ${partial.join(', ')} 赋值，存在锁存器 (Latch) 隐患`,
          hint: '请确保 if 与 else 所有分支都对同一组合输出赋值，或在块开头设置默认值。',
        });
      }
      return bothDef;
    }

    case 'case': {
      const branchDefs: Set<string>[] = [];
      const allBranchWrites = new Set<string>();
      for (const item of stmt.items) {
        collectAllWrites(item.body, allBranchWrites);
        branchDefs.push(checkCombLatches(item.body, alreadyAssigned, issues));
      }
      if (!stmt.defaultBranch) {
        const latched = Array.from(allBranchWrites).filter((v) => !alreadyAssigned.has(v));
        if (latched.length > 0) {
          issues.push({
            code: 'INFERRED_LATCH',
            severity: 'warning',
            line: stmt.loc.line,
            column: stmt.loc.column,
            message: `第 ${stmt.loc.line} 行组合块中的 ${stmt.kind} 语句缺少 default 分支，信号 ${latched.join(', ')} 可能综合出锁存器 (Latch)`,
            hint: '请添加 default 分支覆盖未列举状态，或在组合块开头赋默认值。',
          });
        }
        return new Set(alreadyAssigned);
      }
      collectAllWrites(stmt.defaultBranch, allBranchWrites);
      branchDefs.push(checkCombLatches(stmt.defaultBranch, alreadyAssigned, issues));
      return intersectSets(branchDefs);
    }

    case 'for': {
      const next = new Set(alreadyAssigned);
      collectAllWrites(stmt.body, next);
      return next;
    }
  }
}

function isPureConstExpr(
  expr: Expr,
  params: Map<string, { value: number; width: number; signed: boolean }>
): boolean {
  switch (expr.type) {
    case 'number':
      return true;
    case 'ident':
      return params.has(expr.name);
    case 'unary':
      return isPureConstExpr(expr.operand, params);
    case 'binary':
      return isPureConstExpr(expr.left, params) && isPureConstExpr(expr.right, params);
    case 'ternary':
      return (
        isPureConstExpr(expr.condition, params) &&
        isPureConstExpr(expr.thenExpr, params) &&
        isPureConstExpr(expr.elseExpr, params)
      );
    case 'sysfn':
      return isPureConstExpr(expr.arg, params);
    default:
      return false;
  }
}

function tryEvalConstInt(
  expr: Expr,
  params: Map<string, { value: number; width: number; signed: boolean }>
): number | null {
  if (!isPureConstExpr(expr, params)) return null;
  const ev = evalExpr(expr, new Map(), new Map(), params);
  return ev.signed ? toSigned(ev.value, ev.width) : ev.value >>> 0;
}

function validateArrayAccess(
  meta: ArrayMeta,
  indices: Expr[],
  hasSlice: boolean,
  loc: SourceLoc,
  params: Map<string, { value: number; width: number; signed: boolean }>,
  issues: LintIssue[],
  reportedKeys: Set<string>
): void {
  if (meta.invalidReason) return;
  const dimsCount = meta.dimensions.length;
  const maxIndices = hasSlice ? dimsCount : dimsCount + 1;
  if (indices.length < dimsCount || indices.length > maxIndices) {
    const key = `dim:${meta.name}:${loc.line}`;
    if (!reportedKeys.has(key)) {
      reportedKeys.add(key);
      issues.push({
        code: 'ARRAY_BOUNDS_OR_DIM',
        severity: 'error',
        line: loc.line,
        column: loc.column,
        message: `第 ${loc.line} 行数组 "${meta.name}" 为 ${dimsCount} 维数组，但访问使用了 ${indices.length} 个下标`,
        hint: `请按声明维度访问数组元素（${dimsCount === 1 ? `${meta.name}[i]` : `${meta.name}[r][c]`}）。`,
      });
    }
    return;
  }

  for (let d = 0; d < dimsCount; d++) {
    const val = tryEvalConstInt(indices[d], params);
    if (val === null) continue;
    const dim = meta.dimensions[d];
    const min = Math.min(dim.start, dim.end);
    const max = Math.max(dim.start, dim.end);
    if (val < min || val > max) {
      const key = `oob:${meta.name}:${d}:${val}:${loc.line}`;
      if (!reportedKeys.has(key)) {
        reportedKeys.add(key);
        issues.push({
          code: 'ARRAY_BOUNDS_OR_DIM',
          severity: 'warning',
          line: loc.line,
          column: loc.column,
          message: `第 ${loc.line} 行数组 "${meta.name}" 第 ${d + 1} 维下标 ${val} 超出合法范围 [${min}..${max}]`,
          hint: `请确保下标处于 [${dim.start}:${dim.end}] 内，仿真器将对越界读返回 0 并忽略越界写。`,
        });
      }
    }
  }
}

function checkArrayExprAccess(
  expr: Expr,
  elaborated: ElaboratedModule,
  issues: LintIssue[],
  reportedKeys: Set<string>
): void {
  if (elaborated.arrays.size === 0) return;

  if (expr.type === 'index' || expr.type === 'slice') {
    let cur: Expr = expr;
    let hasSlice = false;
    const sliceExprs: Expr[] = [];
    if (cur.type === 'slice') {
      hasSlice = true;
      sliceExprs.push(cur.msb, cur.lsb);
      cur = cur.target;
    }
    const indices: Expr[] = [];
    while (cur.type === 'index') {
      indices.unshift(cur.index);
      cur = cur.target;
    }
    if (cur.type === 'ident' && elaborated.arrays.has(cur.name) && indices.length > 0) {
      validateArrayAccess(
        elaborated.arrays.get(cur.name)!,
        indices,
        hasSlice,
        expr.loc,
        elaborated.params,
        issues,
        reportedKeys
      );
      for (const idx of indices) checkArrayExprAccess(idx, elaborated, issues, reportedKeys);
      for (const s of sliceExprs) checkArrayExprAccess(s, elaborated, issues, reportedKeys);
      return;
    }
  }

  switch (expr.type) {
    case 'number':
    case 'ident':
      return;
    case 'index':
      checkArrayExprAccess(expr.target, elaborated, issues, reportedKeys);
      checkArrayExprAccess(expr.index, elaborated, issues, reportedKeys);
      return;
    case 'slice':
      checkArrayExprAccess(expr.target, elaborated, issues, reportedKeys);
      checkArrayExprAccess(expr.msb, elaborated, issues, reportedKeys);
      checkArrayExprAccess(expr.lsb, elaborated, issues, reportedKeys);
      return;
    case 'concat':
      for (const it of expr.items) checkArrayExprAccess(it, elaborated, issues, reportedKeys);
      return;
    case 'repeat':
      checkArrayExprAccess(expr.count, elaborated, issues, reportedKeys);
      for (const it of expr.items) checkArrayExprAccess(it, elaborated, issues, reportedKeys);
      return;
    case 'unary':
      checkArrayExprAccess(expr.operand, elaborated, issues, reportedKeys);
      return;
    case 'binary':
      checkArrayExprAccess(expr.left, elaborated, issues, reportedKeys);
      checkArrayExprAccess(expr.right, elaborated, issues, reportedKeys);
      return;
    case 'ternary':
      checkArrayExprAccess(expr.condition, elaborated, issues, reportedKeys);
      checkArrayExprAccess(expr.thenExpr, elaborated, issues, reportedKeys);
      checkArrayExprAccess(expr.elseExpr, elaborated, issues, reportedKeys);
      return;
    case 'sysfn':
      checkArrayExprAccess(expr.arg, elaborated, issues, reportedKeys);
      return;
  }
}

function checkArrayLValueAccess(
  lv: LValue,
  elaborated: ElaboratedModule,
  issues: LintIssue[],
  reportedKeys: Set<string>
): void {
  if (elaborated.arrays.size === 0) return;
  switch (lv.type) {
    case 'ident': {
      const meta = elaborated.arrays.get(lv.name);
      if (meta && !meta.invalidReason) {
        validateArrayAccess(meta, [], false, lv.loc, elaborated.params, issues, reportedKeys);
      }
      return;
    }
    case 'index': {
      const meta = elaborated.arrays.get(lv.name);
      if (meta) {
        validateArrayAccess(meta, [lv.index], false, lv.loc, elaborated.params, issues, reportedKeys);
      }
      checkArrayExprAccess(lv.index, elaborated, issues, reportedKeys);
      return;
    }
    case 'slice': {
      const meta = elaborated.arrays.get(lv.name);
      if (meta) {
        validateArrayAccess(meta, [], true, lv.loc, elaborated.params, issues, reportedKeys);
      }
      checkArrayExprAccess(lv.msb, elaborated, issues, reportedKeys);
      checkArrayExprAccess(lv.lsb, elaborated, issues, reportedKeys);
      return;
    }
    case 'indexed': {
      const meta = elaborated.arrays.get(lv.name);
      if (meta) {
        validateArrayAccess(
          meta,
          lv.indices,
          Boolean(lv.slice),
          lv.loc,
          elaborated.params,
          issues,
          reportedKeys
        );
      }
      for (const idx of lv.indices) checkArrayExprAccess(idx, elaborated, issues, reportedKeys);
      if (lv.slice) {
        checkArrayExprAccess(lv.slice.msb, elaborated, issues, reportedKeys);
        checkArrayExprAccess(lv.slice.lsb, elaborated, issues, reportedKeys);
      }
      return;
    }
    case 'concat':
      for (const item of lv.items) checkArrayLValueAccess(item, elaborated, issues, reportedKeys);
      return;
  }
}

export function lintVerilog(elaborated: ElaboratedModule): LintIssue[] {
  const issues: LintIssue[] = [];
  const { ast, signals, params, arrays } = elaborated;
  const reportedArrayKeys = new Set<string>();

  // 0. ARRAY_BOUNDS_OR_DIM: invalid array declarations
  for (const [, meta] of arrays) {
    if (meta.invalidReason) {
      issues.push({
        code: 'ARRAY_BOUNDS_OR_DIM',
        severity: 'error',
        line: meta.loc.line,
        column: meta.loc.column,
        message: meta.invalidReason,
        hint: '请使用 1D 或 2D 定长内部 reg 数组，且元素总数不超过 4096。',
      });
    }
  }

  // 1. PORT_MISMATCH: verify top module ports match virtual FPGA board interface
  const declaredPorts = new Map(
    Array.from(signals.values())
      .filter((s) => s.isPort)
      .map((s) => [s.name, s])
  );

  for (const spec of BOARD_PORT_SPECS) {
    const actual = declaredPorts.get(spec.name);
    if (!actual) {
      if (spec.optional) continue;
      issues.push({
        code: 'PORT_MISMATCH',
        severity: 'error',
        line: ast.loc.line,
        message: `顶层模块缺少虚拟开发板标准端口 "${spec.name}"（期望 ${spec.direction} ${spec.width} 位）`,
        hint: `请在 module ${ast.name}(...) 端口列表中补齐 ${spec.direction} ${spec.width > 1 ? `[${spec.width - 1}:0] ` : ''}${spec.name}。`,
      });
      continue;
    }
    if (actual.direction !== spec.direction) {
      const portAst = ast.ports.find((p) => p.name === spec.name);
      issues.push({
        code: 'PORT_MISMATCH',
        severity: 'error',
        line: portAst?.loc.line ?? ast.loc.line,
        message: `端口 "${spec.name}" 方向不匹配：当前为 ${actual.direction ?? '未指定'}，期望 ${spec.direction}`,
        hint: `请将 "${spec.name}" 修改为 ${spec.direction}。`,
      });
    }
    if (actual.width !== spec.width) {
      const portAst = ast.ports.find((p) => p.name === spec.name);
      issues.push({
        code: 'PORT_MISMATCH',
        severity: 'error',
        line: portAst?.loc.line ?? ast.loc.line,
        message: `端口 "${spec.name}" 位宽不匹配：当前为 ${actual.width} 位，虚拟板卡要求 ${spec.width} 位`,
        hint: `请将 "${spec.name}" 声明为 ${spec.width > 1 ? `[${spec.width - 1}:0]` : '1 位标量'}。`,
      });
    }
  }

  const declaredScreenPorts = SCREEN_PORT_NAMES.filter((name) => declaredPorts.has(name));
  if (
    (declaredScreenPorts.length > 0 || declaredPorts.has('screen_color')) &&
    declaredScreenPorts.length < SCREEN_PORT_NAMES.length
  ) {
    const missing = SCREEN_PORT_NAMES.filter((name) => !declaredPorts.has(name));
    issues.push({
      code: 'PORT_MISMATCH',
      severity: 'error',
      line: ast.loc.line,
      message: `启用 16×8 屏幕外设时缺少端口：${missing.join(', ')}`,
      hint: '请同时声明完整的 4 个屏幕基础端口：screen_x[3:0], screen_y[2:0], screen_data[7:0], screen_cmd[1:0]（可选附加 screen_color[7:0] 启用 256 色）。',
    });
  }

  for (const [portName] of declaredPorts) {
    if (!EXPECTED_PORT_MAP.has(portName)) {
      const portAst = ast.ports.find((p) => p.name === portName);
      issues.push({
        code: 'PORT_MISMATCH',
        severity: 'error',
        line: portAst?.loc.line ?? ast.loc.line,
        message: `端口 "${portName}" 不在虚拟 FPGA 开发板标准接口中`,
        hint: '请仅使用标准板卡端口：clk, rst_n, key[3:0], sw[7:0], led[7:0], traffic[2:0], seg[15:0]，以及可选端口 tone[3:0], screen_x[3:0], screen_y[2:0], screen_data[7:0], screen_cmd[1:0], screen_color[7:0]。',
      });
    }
  }

  // Track drivers and reads across continuous assigns, wire inits, and always blocks
  const continuousDrivers = new Map<string, { fullCount: number; lines: number[] }>();
  const alwaysDriverBlocks = new Map<string, Array<{ blockIdx: number; line: number }>>();
  const allDriven = new Set<string>();
  const allRead = new Set<string>();

  const recordContinuous = (lv: LValue, line: number) => {
    const names = new Set<string>();
    collectLValueNames(lv, names);
    const isWhole = lv.type === 'ident';
    for (const name of names) {
      allDriven.add(name);
      const entry = continuousDrivers.get(name) ?? { fullCount: 0, lines: [] };
      if (isWhole) entry.fullCount += 1;
      entry.lines.push(line);
      continuousDrivers.set(name, entry);
    }
  };

  for (const wi of elaborated.wireInits) {
    allDriven.add(wi.name);
    const entry = continuousDrivers.get(wi.name) ?? { fullCount: 0, lines: [] };
    entry.fullCount += 1;
    entry.lines.push(wi.value.loc.line);
    continuousDrivers.set(wi.name, entry);
    collectExprReads(wi.value, allRead);
    checkUnsignedArithShift(wi.value, elaborated, issues);
    checkArrayExprAccess(wi.value, elaborated, issues, reportedArrayKeys);
  }

  for (const a of ast.assigns) {
    recordContinuous(a.target, a.loc.line);
    collectLValueIndexReads(a.target, allRead);
    checkArrayLValueAccess(a.target, elaborated, issues, reportedArrayKeys);
    collectExprReads(a.value, allRead);
    checkUnsignedArithShift(a.value, elaborated, issues);
    checkArrayExprAccess(a.value, elaborated, issues, reportedArrayKeys);
  }

  // 2 & 3 & 4 & 6(shift): Inspect all always blocks
  const walkStmt = (
    stmt: Stmt,
    sensitivity: 'comb' | 'seq',
    blockIdx: number
  ): void => {
    switch (stmt.type) {
      case 'empty':
        return;
      case 'block':
        for (const s of stmt.statements) walkStmt(s, sensitivity, blockIdx);
        return;
      case 'assign': {
        if (sensitivity === 'seq' && stmt.kind === 'blocking') {
          issues.push({
            code: 'SEQ_BLOCKING_ASSIGN',
            severity: 'warning',
            line: stmt.loc.line,
            column: stmt.loc.column,
            message: `第 ${stmt.loc.line} 行时序 always 块中误用了阻塞赋值 "="`,
            hint: '时序逻辑寄存器更新应统一使用非阻塞赋值 "<="，避免仿真与综合不一致。',
          });
        }
        if (sensitivity === 'comb' && stmt.kind === 'nonblocking') {
          issues.push({
            code: 'COMB_NONBLOCKING_ASSIGN',
            severity: 'warning',
            line: stmt.loc.line,
            column: stmt.loc.column,
            message: `第 ${stmt.loc.line} 行组合 always 块中误用了非阻塞赋值 "<="`,
            hint: '组合逻辑 always @(*) / always_comb 中应使用阻塞赋值 "="。',
          });
        }

        const targets = new Set<string>();
        collectLValueNames(stmt.target, targets);
        collectLValueIndexReads(stmt.target, allRead);
        checkArrayLValueAccess(stmt.target, elaborated, issues, reportedArrayKeys);
        for (const name of targets) {
          allDriven.add(name);
          const list = alwaysDriverBlocks.get(name) ?? [];
          if (!list.some((d) => d.blockIdx === blockIdx)) {
            list.push({ blockIdx, line: stmt.loc.line });
            alwaysDriverBlocks.set(name, list);
          }
        }
        collectExprReads(stmt.value, allRead);
        checkUnsignedArithShift(stmt.value, elaborated, issues);
        checkArrayExprAccess(stmt.value, elaborated, issues, reportedArrayKeys);
        return;
      }
      case 'if':
        collectExprReads(stmt.condition, allRead);
        checkUnsignedArithShift(stmt.condition, elaborated, issues);
        checkArrayExprAccess(stmt.condition, elaborated, issues, reportedArrayKeys);
        walkStmt(stmt.thenBranch, sensitivity, blockIdx);
        if (stmt.elseBranch) walkStmt(stmt.elseBranch, sensitivity, blockIdx);
        return;
      case 'case':
        collectExprReads(stmt.expr, allRead);
        checkUnsignedArithShift(stmt.expr, elaborated, issues);
        checkArrayExprAccess(stmt.expr, elaborated, issues, reportedArrayKeys);
        for (const item of stmt.items) {
          for (const pat of item.patterns) {
            collectExprReads(pat, allRead);
            checkUnsignedArithShift(pat, elaborated, issues);
            checkArrayExprAccess(pat, elaborated, issues, reportedArrayKeys);
          }
          walkStmt(item.body, sensitivity, blockIdx);
        }
        if (stmt.defaultBranch) walkStmt(stmt.defaultBranch, sensitivity, blockIdx);
        return;
      case 'for':
        allDriven.add(stmt.varName);
        collectExprReads(stmt.init, allRead);
        collectExprReads(stmt.condition, allRead);
        checkUnsignedArithShift(stmt.init, elaborated, issues);
        checkUnsignedArithShift(stmt.condition, elaborated, issues);
        checkArrayExprAccess(stmt.init, elaborated, issues, reportedArrayKeys);
        checkArrayExprAccess(stmt.condition, elaborated, issues, reportedArrayKeys);
        walkStmt(stmt.body, sensitivity, blockIdx);
        return;
    }
  };

  ast.alwaysBlocks.forEach((block, idx) => {
    walkStmt(block.body, block.sensitivity, idx);
    if (block.sensitivity === 'comb') {
      checkCombLatches(block.body, new Set(), issues);
    }
  });

  // 5. UNDRIVEN_OR_UNASSIGNED: undriven outputs + read-but-never-assigned internals & arrays
  for (const [name, meta] of signals) {
    if (meta.isPort && meta.direction === 'output' && !allDriven.has(name)) {
      const portAst = ast.ports.find((p) => p.name === name);
      issues.push({
        code: 'UNDRIVEN_OR_UNASSIGNED',
        severity: 'warning',
        line: portAst?.loc.line ?? ast.loc.line,
        message: `输出端口 "${name}" 未被任何 assign 或 always 块驱动，将恒为 0`,
        hint: `请通过 assign ${name} = ... 或在 always 块中为 ${name} 赋值。`,
      });
    }
    if (!meta.isPort && allRead.has(name) && !allDriven.has(name) && !params.has(name)) {
      const sigAst = ast.signals.find((s) => s.name === name);
      issues.push({
        code: 'UNDRIVEN_OR_UNASSIGNED',
        severity: 'warning',
        line: sigAst?.loc.line ?? ast.loc.line,
        message: `内部信号 "${name}" 被读取但从未被赋值，仿真中将恒为 0`,
        hint: `请检查 "${name}" 是否遗漏了赋值语句或拼写错误。`,
      });
    }
  }
  for (const [name, meta] of arrays) {
    if (!meta.invalidReason && allRead.has(name) && !allDriven.has(name)) {
      issues.push({
        code: 'UNDRIVEN_OR_UNASSIGNED',
        severity: 'warning',
        line: meta.loc.line,
        message: `内部数组 "${name}" 被读取但从未被写入，仿真中元素将恒为 0`,
        hint: `请在复位或时序块中为 "${name}" 写入数据。`,
      });
    }
  }

  // 6. MULTI_DRIVER: multiple always blocks or mixed continuous + procedural
  for (const [name, blocks] of alwaysDriverBlocks) {
    if (blocks.length > 1) {
      issues.push({
        code: 'MULTI_DRIVER',
        severity: 'error',
        line: blocks[1].line,
        message: `信号 "${name}" 在多个 always 块中被同时驱动（第 ${blocks.map((b) => b.line).join('、')} 行）`,
        hint: `同一寄存器或变量只能由唯一一个 always 块驱动，请合并对 "${name}" 的赋值逻辑。`,
      });
    }
    if (continuousDrivers.has(name)) {
      const contLines = continuousDrivers.get(name)!.lines;
      issues.push({
        code: 'MULTI_DRIVER',
        severity: 'error',
        line: blocks[0].line,
        message: `信号 "${name}" 同时存在连续赋值（第 ${contLines[0]} 行）与过程块赋值（第 ${blocks[0].line} 行）`,
        hint: `请为 "${name}" 只保留一种驱动方式（assign 或单个 always 块）。`,
      });
    }
  }

  for (const [name, cont] of continuousDrivers) {
    if (cont.fullCount > 1) {
      issues.push({
        code: 'MULTI_DRIVER',
        severity: 'error',
        line: cont.lines[1],
        message: `信号 "${name}" 被多条 assign 连续赋值语句重复驱动（第 ${cont.lines.join('、')} 行）`,
        hint: `请移除重复的 assign，或改用位切片分别驱动不同比特位。`,
      });
    }
  }

  return issues;
}
