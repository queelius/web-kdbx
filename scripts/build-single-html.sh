#!/usr/bin/env bash
set -euo pipefail

# Produce dist/web-kdbx.html: a single self-contained HTML file with WASM
# inlined as base64. Approach A artifact (see design doc).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/pkg"
WWW="$ROOT/www"
OUT_DIR="$ROOT/dist"
OUT="$OUT_DIR/web-kdbx.html"

mkdir -p "$OUT_DIR"

# 1. Build via wasm-pack if WASM is missing or out of date.
if [[ ! -f "$PKG/web_kdbx_bg.wasm" ]] || [[ "$ROOT/Cargo.toml" -nt "$PKG/web_kdbx_bg.wasm" ]]; then
  "$ROOT/scripts/build.sh" --release
fi

# 2. Read JS sources and styles.
APP_JS="$(cat "$WWW/app.js")"
STYLES_CSS="$(cat "$WWW/styles.css")"

COMPONENTS=""
for f in "$WWW/components/"*.js; do
  COMPONENTS+="$(cat "$f")"$'\n'
done

# 3. Read wasm-pack JS and base64-encode the WASM.
WASM_JS="$(cat "$PKG/web_kdbx.js")"
WASM_B64="$(base64 -w0 "$PKG/web_kdbx_bg.wasm" 2>/dev/null || base64 < "$PKG/web_kdbx_bg.wasm" | tr -d '\n')"

# 4. Compose. The runtime decodes base64 and calls __wbg_init with bytes.
cat > "$OUT" <<EOF
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>web-kdbx</title>
<style>
$STYLES_CSS
</style>
</head>
<body>
<vault-app></vault-app>
<script>
window.__WEB_KDBX_WASM_B64__ = "$WASM_B64";
</script>
<script type="module">
$WASM_JS

const wasmBytes = Uint8Array.from(atob(window.__WEB_KDBX_WASM_B64__), c => c.charCodeAt(0));
await __wbg_init(wasmBytes);
globalThis.webKdbx = { Vault };

$COMPONENTS
</script>
</body>
</html>
EOF

echo "Wrote $OUT"
echo "Size: $(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT") bytes"
echo "Open via: file://$OUT"
