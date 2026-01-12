export type QbiVersion = "0.1";

export type QbiTypeRef =
  | Readonly<{ type: "nodata"; expectedSize?: number }>
  | Readonly<{ type: "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "bool" }>
  | Readonly<{ type: "bytes"; length: number }>
  | Readonly<{ type: "m256i" }>
  | Readonly<{ type: "array"; length: number; item: QbiTypeRef }>
  | Readonly<{ type: "struct"; fields: readonly QbiStructField[] }>;

export type QbiStructField = Readonly<{
  name: string;
  typeRef: QbiTypeRef;
}>;

export type QbiEntry = Readonly<{
  kind: "function" | "procedure";
  name: string;
  inputType: number;
  input: QbiTypeRef;
  output: QbiTypeRef;
  inputSize?: number;
  outputSize?: number;
}>;

export type QbiContract = Readonly<{
  name: string;
  contractIndex?: number;
  /** 32-byte hex string (little-endian u64 contractIndex, rest zeros) when known. */
  contractPublicKeyHex?: string;
  /** Optional identity string; left unset if generator cannot compute checksum. */
  contractId?: string;
}>;

export type QbiFile = Readonly<{
  qbiVersion: QbiVersion;
  contract: QbiContract;
  entries: readonly QbiEntry[];
  meta?: Readonly<{
    source?: string;
    /** Source repository URL (e.g. https://github.com/qubic/core) when known. */
    sourceRepo?: string;
    /** Source revision (e.g. git SHA) when known. */
    sourceRevision?: string;
    generatedAt?: string;
    generator?: string;
    generatorVersion?: string;
    warnings?: readonly string[];
  }>;
}>;
