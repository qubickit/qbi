export type ContractDefEntry = Readonly<{
  name: string;
  contractIndex: number;
  header: string;
}>;

/**
 * Parse `contract_def.h` to build a mapping of `{ContractStateType, index, header}`.
 * Example stanza:
 *   #define QUTIL_CONTRACT_INDEX 4
 *   #define CONTRACT_INDEX QUTIL_CONTRACT_INDEX
 *   #define CONTRACT_STATE_TYPE QUTIL
 *   #include "contracts/QUtil.h"
 */
export function parseContractDefH(source: string): readonly ContractDefEntry[] {
  const lines = source.split(/\r?\n/);
  const entries: ContractDefEntry[] = [];

  let currentIndex: number | undefined;
  let currentStateType: string | undefined;
  let currentHeader: string | undefined;

  const flush = () => {
    if (
      currentIndex !== undefined &&
      currentStateType !== undefined &&
      currentHeader !== undefined
    ) {
      entries.push({
        name: currentStateType,
        contractIndex: currentIndex,
        header: currentHeader,
      });
    }
    currentIndex = undefined;
    currentStateType = undefined;
    currentHeader = undefined;
  };

  for (const line of lines) {
    const idx = line.match(/^\s*#define\s+([A-Z0-9_]+)_CONTRACT_INDEX\s+(\d+)\s*$/);
    if (idx) {
      flush();
      currentIndex = Number(idx[2]);
      continue;
    }
    const st = line.match(/^\s*#define\s+CONTRACT_STATE_TYPE\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (st) {
      currentStateType = st[1];
      continue;
    }
    const inc = line.match(/^\s*#include\s+"contracts\/([^"]+)"\s*$/);
    if (inc) {
      currentHeader = inc[1];
      continue;
    }
  }

  flush();
  return entries;
}

