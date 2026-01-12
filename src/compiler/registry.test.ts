import { describe, expect, it } from "bun:test";
import { parseContractDefH } from "./contract-def.js";

describe("contract_def.h parser", () => {
  it("extracts contract indices and headers", () => {
    const src = `
#define QX_CONTRACT_INDEX 1
#define CONTRACT_INDEX QX_CONTRACT_INDEX
#define CONTRACT_STATE_TYPE QX
#include "contracts/Qx.h"

#define QUTIL_CONTRACT_INDEX 4
#define CONTRACT_INDEX QUTIL_CONTRACT_INDEX
#define CONTRACT_STATE_TYPE QUTIL
#include "contracts/QUtil.h"
`;
    const entries = parseContractDefH(src);
    expect(entries).toEqual([
      { name: "QX", contractIndex: 1, header: "Qx.h" },
      { name: "QUTIL", contractIndex: 4, header: "QUtil.h" },
    ]);
  });
});

