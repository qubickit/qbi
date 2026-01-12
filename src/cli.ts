import { generateRegistry } from "./compiler/registry.js";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { compileContractHeader } from "./compiler/header-extractor.js";
import { validateQbiFile } from "./validate.js";
import { parseContractDefH } from "./compiler/contract-def.js";

async function main(argv: string[]) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "compile") {
    const args = parseArgs(rest);
    const contractPath = required(args, "--contract");
    const out = args.get("--out");
    const qpiPath = args.get("--qpi");
    const contractDefPath = args.get("--contract-def");
    const generatorVersion = await getPackageVersion();

    const source = await readFile(contractPath, "utf8");
    const contractName = basename(contractPath).replace(/\.h$/, "");

    const qpi = qpiPath ? await readFile(qpiPath, "utf8") : undefined;
    const sourceWithPrelude = qpi ? `${qpi}\n${source}` : source;

    let contractIndex: number | undefined;
    if (contractDefPath) {
      const defText = await readFile(contractDefPath, "utf8");
      const defs = parseContractDefH(defText);
      const byHeader = new Map(defs.map((d) => [basename(d.header), d.contractIndex] as const));
      contractIndex = byHeader.get(basename(contractPath));
    }

    const qbi = compileContractHeader(sourceWithPrelude, {
      contractName,
      contractIndex,
      contractPublicKeyHex: contractIndex !== undefined ? contractKeyHex(contractIndex) : undefined,
      sourcePath: contractPath,
      generatorVersion,
    });
    const text = `${JSON.stringify(qbi, null, 2)}\n`;
    if (out) {
      await writeFile(out, text, "utf8");
    } else {
      process.stdout.write(text);
    }
    return;
  }

  if (command === "compile-registry") {
    const args = parseArgs(rest);
    const contractDefPath = required(args, "--contract-def");
    const contractsDir = required(args, "--contracts-dir");
    const outDir = args.get("--out") ?? "registry";
    const sourceRepo = args.get("--source-repo");
    const sourceRevision = args.get("--source-revision");
    const generatorVersion = await getPackageVersion();

    await generateRegistry({
      contractDefPath,
      contractsDir,
      outDir,
      sourceRepo,
      sourceRevision,
      generatorVersion,
    });
    return;
  }

  if (command === "validate") {
    const args = parseArgs(rest);
    const file = args.get("--file");
    const dir = args.get("--dir");
    if (!file && !dir) throw new Error("Missing required arg: --file <path> or --dir <path>");
    if (file && dir) throw new Error("Use only one of: --file, --dir");

    const files: string[] = [];
    if (file) {
      files.push(file);
    } else {
      const entries = await readdir(dir!, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.endsWith(".qbi")) continue;
        files.push(join(dir!, e.name));
      }
      files.sort((a, b) => a.localeCompare(b));
    }

    const allErrors: string[] = [];
    for (const p of files) {
      const text = await readFile(p, "utf8");
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (err) {
        allErrors.push(`${p}: invalid JSON (${String(err)})`);
        continue;
      }
      const res = validateQbiFile(json);
      if (!res.ok) {
        for (const e of res.errors) allErrors.push(`${p}: ${e}`);
      }
    }

    if (allErrors.length) {
      for (const e of allErrors) console.error(e);
      process.exit(1);
    }

    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(rest: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]!;
    if (!key.startsWith("-")) continue;
    const value = rest[i + 1];
    if (!value || value.startsWith("-")) {
      out.set(key, "true");
      continue;
    }
    out.set(key, value);
    i++;
  }
  return out;
}

function required(args: Map<string, string>, key: string): string {
  const value = args.get(key);
  if (!value || value === "true") throw new Error(`Missing required arg: ${key}`);
  return value;
}

function printHelp() {
  // solc-like entrypoint: single binary with subcommands.
  console.log(`qbi (work-in-progress)

Commands:
  compile --contract <path> [--out <file>] [--qpi <qpi.h>] [--contract-def <contract_def.h>]
  compile-registry --contract-def <path> --contracts-dir <path> [--out <dir>] [--source-repo <url>] [--source-revision <sha>]
  validate (--file <path> | --dir <path>)

Examples (from repo root):
  qbi compile --contract temp/core/src/contracts/QUtil.h --qpi temp/core/src/contracts/qpi.h --contract-def temp/core/src/contract_core/contract_def.h > QUtil.qbi
  qbi compile-registry --contract-def temp/core/src/contract_core/contract_def.h --contracts-dir temp/core/src/contracts --out qbi/registry --source-repo https://github.com/qubic/core --source-revision <sha>
  qbi validate --dir qbi/registry
`);
}

function contractKeyHex(contractIndex: number): string {
  if (!Number.isInteger(contractIndex) || contractIndex < 0 || contractIndex > 0xffff_ffff) {
    throw new RangeError("contractIndex must fit in uint32");
  }
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(contractIndex), true);
  return Buffer.from(bytes).toString("hex");
}

async function getPackageVersion(): Promise<string | undefined> {
  try {
    const url = new URL("../package.json", import.meta.url);
    const text = await readFile(url, "utf8");
    const json = JSON.parse(text) as { version?: unknown };
    return typeof json.version === "string" ? json.version : undefined;
  } catch {
    return undefined;
  }
}

await main(process.argv.slice(2));
