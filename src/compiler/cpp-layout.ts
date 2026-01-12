import type { QbiTypeRef } from "../qbi.js";

export type CppLayout = Readonly<{ size: number; align: number }>;

export function cppLayoutOf(typeRef: QbiTypeRef): CppLayout {
  switch (typeRef.type) {
    case "nodata":
      // C++ empty struct has sizeof==1, but encoding may be 0 bytes.
      return { size: Math.max(1, typeRef.expectedSize ?? 1), align: 1 };
    case "bool":
    case "u8":
    case "i8":
      return { size: 1, align: 1 };
    case "u16":
    case "i16":
      return { size: 2, align: 2 };
    case "u32":
    case "i32":
      return { size: 4, align: 4 };
    case "u64":
    case "i64":
      return { size: 8, align: 8 };
    case "bytes":
      return { size: assertPositiveInt(typeRef.length, "bytes.length"), align: 1 };
    case "m256i":
      // In Qubic core `m256i` is a union of u64/u32/u16/u8 (alignment == 8).
      return { size: 32, align: 8 };
    case "array": {
      const length = assertPositiveInt(typeRef.length, "array.length");
      const item = cppLayoutOf(typeRef.item);
      return { size: item.size * length, align: item.align };
    }
    case "struct": {
      let offset = 0;
      let structAlign = 1;
      for (const field of typeRef.fields) {
        const fieldLayout = cppLayoutOf(field.typeRef);
        offset = alignUp(offset, fieldLayout.align);
        offset += fieldLayout.size;
        structAlign = Math.max(structAlign, fieldLayout.align);
      }
      const size = alignUp(offset, structAlign);
      return { size: size === 0 ? 1 : size, align: structAlign };
    }
  }
}

function alignUp(value: number, alignment: number): number {
  if (alignment <= 1) return value;
  return Math.ceil(value / alignment) * alignment;
}

function assertPositiveInt(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return value;
}

