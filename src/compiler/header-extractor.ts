import type { QbiEntry, QbiFile, QbiTypeRef } from "../qbi.js";
import { cppLayoutOf } from "./cpp-layout.js";

export type CompileOptions = Readonly<{
  contractName: string;
  contractIndex?: number;
  contractPublicKeyHex?: string;
  sourcePath?: string;
  sourceRepo?: string;
  sourceRevision?: string;
  generatorVersion?: string;
  includeGeneratedAt?: boolean;
}>;

export function compileContractHeader(
  headerSource: string,
  options: CompileOptions,
): QbiFile {
  const warnings: string[] = [];

  const constants = extractNumericConstants(headerSource);
  const aliases = extractTypeAliases(headerSource);
  const entries = extractRegisteredEntries(headerSource);

  const structCache = new Map<string, QbiTypeRef>();

  const compiled: QbiEntry[] = [];
  for (const entry of entries) {
    const inputStructName = `${entry.name}_input`;
    const outputStructName = `${entry.name}_output`;

    const inputStruct = extractStructBody(headerSource, inputStructName);
    const outputStruct = extractStructBody(headerSource, outputStructName);

    const inputTypeRef = inputStruct
      ? parseStructFields(inputStruct, {
          constants,
          aliases,
          warnings,
          headerSource,
          structCache,
        })
      : ({ type: "nodata" } satisfies QbiTypeRef);
    const outputTypeRef = outputStruct
      ? parseStructFields(outputStruct, {
          constants,
          aliases,
          warnings,
          headerSource,
          structCache,
        })
      : ({ type: "nodata" } satisfies QbiTypeRef);

    const inputLayout = cppLayoutOf(inputTypeRef);
    const outputLayout = cppLayoutOf(outputTypeRef);

    compiled.push({
      kind: entry.kind,
      name: entry.name,
      inputType: entry.inputType,
      input: normalizeNoData(inputTypeRef, inputLayout.size),
      output: normalizeNoData(outputTypeRef, outputLayout.size),
      inputSize: inputLayout.size,
      outputSize: outputLayout.size,
    });
  }

  compiled.sort((a, b) => a.inputType - b.inputType || a.name.localeCompare(b.name));

  return {
    qbiVersion: "0.1",
    contract: {
      name: options.contractName,
      contractIndex: options.contractIndex,
      contractPublicKeyHex: options.contractPublicKeyHex,
    },
    entries: compiled,
    meta: {
      source: options.sourcePath,
      sourceRepo: options.sourceRepo,
      sourceRevision: options.sourceRevision,
      ...(options.includeGeneratedAt === false ? {} : { generatedAt: new Date().toISOString() }),
      generator: "qbi (header-extractor)",
      generatorVersion: options.generatorVersion,
      ...(warnings.length ? { warnings } : {}),
    },
  };
}

function normalizeNoData(typeRef: QbiTypeRef, expectedSize: number): QbiTypeRef {
  if (typeRef.type !== "struct") return typeRef;
  if (typeRef.fields.length !== 0) return typeRef;
  return { type: "nodata", expectedSize };
}

type Registered = Readonly<{ kind: "function" | "procedure"; name: string; inputType: number }>;

function extractRegisteredEntries(source: string): readonly Registered[] {
  const out: Registered[] = [];

  const funcRe = /REGISTER_USER_FUNCTION\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(\d+)\s*\)\s*;/g;
  const procRe = /REGISTER_USER_PROCEDURE\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(\d+)\s*\)\s*;/g;

  for (const match of source.matchAll(funcRe)) {
    out.push({ kind: "function", name: match[1]!, inputType: Number(match[2]!) });
  }
  for (const match of source.matchAll(procRe)) {
    out.push({ kind: "procedure", name: match[1]!, inputType: Number(match[2]!) });
  }

  return out;
}

function extractNumericConstants(source: string): Map<string, number> {
  const map = new Map<string, number>([
    // qpi.h default; many contracts use it in constexpr expressions (e.g. `1024 * X_MULTIPLIER`).
    ["X_MULTIPLIER", 1],
  ]);
  const re = /constexpr\s+[A-Za-z0-9_:<>]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/g;
  for (const match of source.matchAll(re)) {
    const name = match[1]!;
    const expr = match[2]!.trim();
    const val = parseNumericExpr(expr, map);
    if (val !== undefined) map.set(name, val);
  }
  const defRe = /^\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*$/gm;
  for (const match of source.matchAll(defRe)) {
    const name = match[1]!;
    const expr = match[2]!.trim();
    const val = parseNumericExpr(expr, map);
    if (val !== undefined) map.set(name, val);
  }
  return map;
}

function parseNumericExpr(expr: string, constants: Map<string, number>): number | undefined {
  const tokens = tokenizeNumericExpr(expr);
  if (!tokens) return undefined;

  const output: (number | string)[] = [];
  const ops: string[] = [];

  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2 };

  for (const t of tokens) {
    if (typeof t === "number") {
      output.push(t);
      continue;
    }
    if (t.type === "ident") {
      const val = constants.get(t.value);
      if (val === undefined) return undefined;
      output.push(val);
      continue;
    }
    if (t.type === "op") {
      while (ops.length) {
        const top = ops[ops.length - 1]!;
        if (top === "(") break;
        if (prec[top]! >= prec[t.value]!) output.push(ops.pop()!);
        else break;
      }
      ops.push(t.value);
      continue;
    }
    if (t.type === "paren") {
      if (t.value === "(") ops.push("(");
      else {
        while (ops.length && ops[ops.length - 1] !== "(") output.push(ops.pop()!);
        if (!ops.length) return undefined;
        ops.pop();
      }
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(") return undefined;
    output.push(op);
  }

  const stack: number[] = [];
  for (const item of output) {
    if (typeof item === "number") {
      stack.push(item);
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) return undefined;
    if (item === "+") stack.push(a + b);
    else if (item === "-") stack.push(a - b);
    else if (item === "*") stack.push(a * b);
    else return undefined;
  }
  if (stack.length !== 1) return undefined;
  return stack[0];
}

type NumericToken =
  | number
  | Readonly<{ type: "ident"; value: string }>
  | Readonly<{ type: "op"; value: "+" | "-" | "*" }>
  | Readonly<{ type: "paren"; value: "(" | ")" }>;

function tokenizeNumericExpr(expr: string): readonly NumericToken[] | undefined {
  const out: NumericToken[] = [];
  const s = expr
    .replace(/\bULL\b|\bLL\b|\bUL\b|\bL\b|\bU\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Reject expressions with unsupported operators/functions.
  if (/[\/%]|div\s*\(|mod\s*\(/.test(s)) return undefined;

  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === " ") {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      out.push({ type: "paren", value: ch });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*") {
      out.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if (/\d/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /\d/.test(s[j]!)) j++;
      out.push(Number(s.slice(i, j)));
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j]!)) j++;
      out.push({ type: "ident", value: s.slice(i, j) });
      i = j;
      continue;
    }
    return undefined;
  }
  return out;
}

function extractStructBody(source: string, structName: string): string | undefined {
  const idx = source.indexOf(`struct ${structName}`);
  if (idx === -1) return undefined;
  const braceStart = source.indexOf("{", idx);
  if (braceStart === -1) return undefined;

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(braceStart + 1, i);
      }
    }
  }
  return undefined;
}

function parseStructFields(
  body: string,
  ctx: Readonly<{
    constants: Map<string, number>;
    aliases: Map<string, string>;
    warnings: string[];
    headerSource: string;
    structCache: Map<string, QbiTypeRef>;
  }>,
): QbiTypeRef {
  const fields: { name: string; typeRef: QbiTypeRef }[] = [];

  const statements = stripComments(body)
    .replace(/\r?\n/g, " ")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length);

  for (const stmt of statements) {
    if (/^[{}]+$/.test(stmt)) continue;
    if (stmt.includes("(")) continue;
    // Ignore nested structs/classes/enums/unions (best-effort).
    if (/^\s*(struct|class|enum|union)\b/.test(stmt)) continue;
    if (/^\s*#/.test(stmt)) continue;

    // Handle `T name[N]`
    const a = stmt.match(/^(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([A-Za-z0-9_]+)\s*]\s*$/);
    if (a) {
      const rawType = a[1]!.trim();
      const name = a[2]!;
      const lenToken = a[3]!;
      const len = parseLen(lenToken, ctx.constants);
      if (len === undefined) {
        ctx.warnings.push(`Could not resolve array length token: ${lenToken}`);
        continue;
      }
      const item = parseTypeRef(rawType, ctx);
      fields.push({ name, typeRef: { type: "array", length: len, item } });
      continue;
    }

    // Handle `T a, b, c`
    const m = stmt.match(
      /^(.+?)\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*$/,
    );
    if (m) {
      const rawType = m[1]!.trim();
      const rawNames = m[2]!.split(",").map((s) => s.trim());
      const typeRef = parseTypeRef(rawType, ctx);
      for (const name of rawNames) fields.push({ name, typeRef });
      continue;
    }

    ctx.warnings.push(`Unrecognized field statement: ${stmt}`);
  }

  return { type: "struct", fields };
}

function parseTypeRef(
  rawType: string,
  ctx: Readonly<{
    constants: Map<string, number>;
    aliases: Map<string, string>;
    warnings: string[];
    headerSource: string;
    structCache: Map<string, QbiTypeRef>;
  }>,
): QbiTypeRef {
  const t = rawType.replace(/^const\s+/, "").replace(/&$/, "").trim();
  const noNs = t.replace(/^QPI::/, "");

  const array = noNs.match(/^Array\s*<\s*([^,>]+)\s*,\s*([^>]+)\s*>\s*$/);
  if (array) {
    const itemType = array[1]!.trim();
    const lenToken = array[2]!.trim();
    const len = parseLen(lenToken, ctx.constants);
    if (len === undefined) {
      ctx.warnings.push(`Could not resolve Array length token: ${lenToken}`);
      return { type: "bytes", length: 0 };
    }
    return { type: "array", length: len, item: parseTypeRef(itemType, ctx) };
  }

  const bitArray = noNs.match(/^BitArray\s*<\s*([^>]+)\s*>\s*$/);
  if (bitArray) {
    const lenToken = bitArray[1]!.trim();
    const bits = parseLen(lenToken, ctx.constants);
    if (bits === undefined) {
      ctx.warnings.push(`Could not resolve BitArray length token: ${lenToken}`);
      return { type: "bytes", length: 0 };
    }
    const elements = Math.max(1, Math.ceil(bits / 64));
    return { type: "array", length: elements, item: { type: "u64" } };
  }

  const aliasMatch = noNs.match(/^(sint|uint)(8|16|32|64)_(\d+)$/);
  if (aliasMatch) {
    const signedness = aliasMatch[1]!;
    const width = aliasMatch[2]!;
    const len = Number(aliasMatch[3]!);
    if (Number.isInteger(len) && len >= 0) {
      const item: QbiTypeRef = {
        type: `${signedness === "uint" ? "u" : "i"}${width}` as
          | "u8"
          | "u16"
          | "u32"
          | "u64"
          | "i8"
          | "i16"
          | "i32"
          | "i64",
      };
      return { type: "array", length: len, item };
    }
  }

  const idAlias = noNs.match(/^id_(\d+)$/);
  if (idAlias) {
    const len = Number(idAlias[1]!);
    if (Number.isInteger(len) && len >= 0) {
      return { type: "array", length: len, item: { type: "m256i" } };
    }
  }

  const bitAlias = noNs.match(/^bit_(\d+)$/);
  if (bitAlias) {
    const bits = Number(bitAlias[1]!);
    if (Number.isInteger(bits) && bits >= 0) {
      const elements = Math.max(1, Math.ceil(bits / 64));
      return { type: "array", length: elements, item: { type: "u64" } };
    }
  }

  switch (noNs) {
    case "uint8":
    case "unsigned char":
      return { type: "u8" };
    case "sint8":
    case "signed char":
      return { type: "i8" };
    case "uint16":
    case "unsigned short":
      return { type: "u16" };
    case "sint16":
    case "signed short":
      return { type: "i16" };
    case "uint32":
    case "unsigned int":
      return { type: "u32" };
    case "sint32":
    case "signed int":
      return { type: "i32" };
    case "uint64":
    case "unsigned long long":
      return { type: "u64" };
    case "sint64":
    case "signed long long":
    case "long long":
      return { type: "i64" };
    case "bool":
    case "bit":
      return { type: "bool" };
    case "id":
    case "m256i":
      return { type: "m256i" };
    case "Asset":
      return {
        type: "struct",
        fields: [
          { name: "issuer", typeRef: { type: "m256i" } },
          { name: "assetName", typeRef: { type: "u64" } },
        ],
      };
    case "ProposalSingleVoteDataV1":
      return {
        type: "struct",
        fields: [
          { name: "proposalIndex", typeRef: { type: "u16" } },
          { name: "proposalType", typeRef: { type: "u16" } },
          { name: "proposalTick", typeRef: { type: "u32" } },
          { name: "voteValue", typeRef: { type: "i64" } },
        ],
      };
    case "ProposalMultiVoteDataV1":
      return {
        type: "struct",
        fields: [
          { name: "proposalIndex", typeRef: { type: "u16" } },
          { name: "proposalType", typeRef: { type: "u16" } },
          { name: "proposalTick", typeRef: { type: "u32" } },
          { name: "voteValues", typeRef: { type: "array", length: 8, item: { type: "i64" } } },
          { name: "voteCounts", typeRef: { type: "array", length: 8, item: { type: "u32" } } },
        ],
      };
    case "ProposalSummarizedVotingDataV1":
      return {
        type: "struct",
        fields: [
          { name: "proposalIndex", typeRef: { type: "u16" } },
          { name: "optionCount", typeRef: { type: "u16" } },
          { name: "proposalTick", typeRef: { type: "u32" } },
          { name: "totalVotesAuthorized", typeRef: { type: "u32" } },
          { name: "totalVotesCasted", typeRef: { type: "u32" } },
          // union: either optionVoteCount (8 u32) or scalarVotingResult (i64); represent as bytes to preserve size
          { name: "resultBytes", typeRef: { type: "bytes", length: 32 } },
        ],
      };
    case "ProposalDataYesNo":
      return { type: "bytes", length: 304 };
  }

  const proposalDataV1 = noNs.match(/^ProposalDataV1\s*<\s*(true|false)\s*>\s*$/);
  if (proposalDataV1) {
    // qpi.h has `static_assert(sizeof(ProposalDataV1<true>) == 256 + 8 + 64, ...)`.
    // The template parameter only changes behavior, not layout.
    return { type: "bytes", length: 328 };
  }

  const aliased = ctx.aliases.get(noNs);
  if (aliased && aliased !== noNs) {
    return parseTypeRef(aliased, ctx);
  }

  // Try to resolve a struct defined in the same header (e.g. Order, TableEntry, etc).
  const cached = ctx.structCache.get(noNs);
  if (cached) return cached;
  const body = extractStructBody(ctx.headerSource, noNs);
  if (body) {
    const ref = parseStructFields(body, ctx);
    ctx.structCache.set(noNs, ref);
    return ref;
  }

  ctx.warnings.push(`Unknown type: ${noNs} (treated as bytes[0])`);
  return { type: "bytes", length: 0 };
}

function parseLen(token: string, constants: Map<string, number>): number | undefined {
  const n = token.match(/^\d+$/) ? Number(token) : constants.get(token);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

function stripComments(source: string): string {
  // Remove /* */ and // comments (best-effort).
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function extractTypeAliases(source: string): Map<string, string> {
  const map = new Map<string, string>();

  // `typedef X Y;`
  const typedefRe = /^\s*typedef\s+([^;]+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;\s*$/gm;
  for (const match of source.matchAll(typedefRe)) {
    const typeExpr = match[1]!.trim();
    const name = match[2]!.trim();
    map.set(name, typeExpr);
  }

  // `using Y = X;`
  const usingRe = /^\s*using\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+?)\s*;\s*$/gm;
  for (const match of source.matchAll(usingRe)) {
    const name = match[1]!.trim();
    const typeExpr = match[2]!.trim();
    map.set(name, typeExpr);
  }

  return map;
}
