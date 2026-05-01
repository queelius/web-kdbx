#!/usr/bin/env bash
set -euo pipefail

# Build the WASM crate via wasm-pack into pkg/.
# Usage: ./scripts/build.sh [--release|--dev]

MODE="${1:---release}"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack not found. Install: cargo install wasm-pack" >&2
  exit 1
fi

wasm-pack build --target web "$MODE"

cat <<MSG
Built. Serve www/ and open in a browser:
  cd www && python3 -m http.server 8000
  open http://localhost:8000/
MSG
