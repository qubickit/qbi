import type { QbiEntry, QbiFile, QbiTypeRef } from "./qbi.js";
import { cppLayoutOf } from "./compiler/cpp-layout.js";

export type QbiValidationResult = Readonly<{
  ok: boolean;
  errors: readonly string[];
}>;

export function validateQbiFile(value: unknown): QbiValidationResult {
  const errors: string[] = [];

  if (!isObject(value)) return fail("QBI must be an object");

  if (value.qbiVersion !== "0.1") errors.push(`qbiVersion must be "0.1"`);

  if (!isObject(value.contract)) {
    errors.push("contract must be an object");
  } else {
    if (typeof value.contract.name !== "string" || value.contract.name.length === 0) {
      errors.push("contract.name must be a non-empty string");
    }
    if (value.contract.contractIndex !== undefined && !isUint(value.contract.contractIndex)) {
      errors.push("contract.contractIndex must be an integer >= 0");
    }
    if (
      value.contract.contractPublicKeyHex !== undefined &&
      !isHex(value.contract.contractPublicKeyHex, 64)
    ) {
      errors.push("contract.contractPublicKeyHex must be a 32-byte hex string");
    }
    if (value.contract.contractId !== undefined && typeof value.contract.contractId !== "string") {
      errors.push("contract.contractId must be a string");
    }
  }

  if (!Array.isArray(value.entries)) {
    errors.push("entries must be an array");
  } else {
    for (let i = 0; i < value.entries.length; i++) {
      validateEntry(value.entries[i], `entries[${i}]`, errors);
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [] };

  function fail(msg: string): QbiValidationResult {
    return { ok: false, errors: [msg] };
  }
}

function validateEntry(value: unknown, path: string, errors: string[]) {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }

  if (value.kind !== "function" && value.kind !== "procedure") {
    errors.push(`${path}.kind must be "function" or "procedure"`);
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    errors.push(`${path}.name must be a non-empty string`);
  }
  if (!isUint(value.inputType)) {
    errors.push(`${path}.inputType must be an integer >= 0`);
  }

  validateTypeRef(value.input, `${path}.input`, errors);
  validateTypeRef(value.output, `${path}.output`, errors);

  if (isUint(value.inputSize)) {
    const size = cppLayoutOf(value.input as QbiTypeRef).size;
    if (size !== value.inputSize) errors.push(`${path}.inputSize expected ${size}, got ${value.inputSize}`);
  } else if (value.inputSize !== undefined) {
    errors.push(`${path}.inputSize must be an integer >= 0`);
  }

  if (isUint(value.outputSize)) {
    const size = cppLayoutOf(value.output as QbiTypeRef).size;
    if (size !== value.outputSize)
      errors.push(`${path}.outputSize expected ${size}, got ${value.outputSize}`);
  } else if (value.outputSize !== undefined) {
    errors.push(`${path}.outputSize must be an integer >= 0`);
  }
}

function validateTypeRef(value: unknown, path: string, errors: string[]) {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const t = value.type;
  if (typeof t !== "string") {
    errors.push(`${path}.type must be a string`);
    return;
  }

  if (t === "nodata") {
    if (value.expectedSize !== undefined && !isUint(value.expectedSize)) {
      errors.push(`${path}.expectedSize must be an integer >= 0`);
    }
    return;
  }

  if (
    t === "u8" ||
    t === "u16" ||
    t === "u32" ||
    t === "u64" ||
    t === "i8" ||
    t === "i16" ||
    t === "i32" ||
    t === "i64" ||
    t === "bool" ||
    t === "m256i"
  ) {
    return;
  }

  if (t === "bytes") {
    if (!isUint(value.length)) errors.push(`${path}.length must be an integer >= 0`);
    return;
  }

  if (t === "array") {
    if (!isUint(value.length)) errors.push(`${path}.length must be an integer >= 0`);
    validateTypeRef(value.item, `${path}.item`, errors);
    return;
  }

  if (t === "struct") {
    if (!Array.isArray(value.fields)) {
      errors.push(`${path}.fields must be an array`);
      return;
    }
    for (let i = 0; i < value.fields.length; i++) {
      const f = value.fields[i];
      const fPath = `${path}.fields[${i}]`;
      if (!isObject(f)) {
        errors.push(`${fPath} must be an object`);
        continue;
      }
      if (typeof f.name !== "string" || f.name.length === 0) {
        errors.push(`${fPath}.name must be a non-empty string`);
      }
      validateTypeRef(f.typeRef, `${fPath}.typeRef`, errors);
    }
    return;
  }

  errors.push(`${path}.type is unknown: ${t}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUint(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length === length && /^[0-9a-f]+$/i.test(value);
}

