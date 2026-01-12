import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { compileContractHeader } from "./header-extractor.js";
import { parseContractDefH } from "./contract-def.js";

export type GenerateRegistryOptions = Readonly<{
  contractDefPath: string;
  contractsDir: string;
  outDir: string;
  sourceRepo?: string;
  sourceRevision?: string;
  generatorVersion?: string;
}>;

export async function generateRegistry(options: GenerateRegistryOptions): Promise<void> {
  const contractDef = await readFile(options.contractDefPath, "utf8");
  const defs = parseContractDefH(contractDef);

  const headers = new Map<string, number>();
  for (const def of defs) {
    const headerBase = basename(def.header);
    headers.set(headerBase, def.contractIndex);
  }

  const contractsDir = resolve(options.contractsDir);
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true });

  const qpiPath = join(contractsDir, "qpi.h");
  const qpi = await readFile(qpiPath, "utf8");

  const files = await readdir(contractsDir);
  const contractHeaders = files
    .filter((f) => f.endsWith(".h"))
    .filter((f) => /^[A-Z].*\.h$/.test(f))
    .filter((f) => f !== "qpi.h");

  for (const file of contractHeaders) {
    const headerPath = join(contractsDir, file);
    const source = await readFile(headerPath, "utf8");
    const sourceWithQpi = `${qpi}\n${source}`;
    const contractName = file.replace(/\.h$/, "");
    const contractIndex = headers.get(file);
    const contractPublicKeyHex = contractIndex !== undefined ? contractKeyHex(contractIndex) : undefined;

    const qbi = compileContractHeader(sourceWithQpi, {
      contractName,
      contractIndex,
      contractPublicKeyHex,
      sourcePath: `contracts/${file}`,
      sourceRepo: options.sourceRepo,
      sourceRevision: options.sourceRevision,
      generatorVersion: options.generatorVersion,
      includeGeneratedAt: false,
    });

    const outPath = join(outDir, `${contractName}.qbi`);
    await writeFile(outPath, `${JSON.stringify(qbi, null, 2)}\n`, "utf8");
  }
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
