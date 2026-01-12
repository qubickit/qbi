# @qubic-labs/qbi

Qubic Binary Interface (QBI): ABI-like JSON specs + tooling for Qubic contracts.

Goal: provide a `solc`-like CLI to generate `.qbi` interface files from Qubic Core contract headers (best-effort).

To install dependencies:

```bash
bun install
```

## CLI

```bash
# Compile a single header (recommended: include qpi.h + contract_def.h)
qbi compile --contract ../temp/core/src/contracts/QUtil.h --qpi ../temp/core/src/contracts/qpi.h --contract-def ../temp/core/src/contract_core/contract_def.h --out QUtil.qbi

# Generate a registry for all core contracts
qbi compile-registry --contract-def ../temp/core/src/contract_core/contract_def.h --contracts-dir ../temp/core/src/contracts --out ./registry

# Validate generated files
qbi validate --dir ./registry
```

This generates `.qbi` files under `qbi/registry/` (contract index is taken from `contract_def.h`).
