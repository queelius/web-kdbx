#!/usr/bin/env bash
# scripts/ci-audit-storage.sh
# L1 storage purity audit: enforce that localStorage writes are confined to
# www/storage.js, and forbid IndexedDB / OPFS / Service Worker / cookies.
#
# Exits 0 on pass, 1 on any violation.

set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

violations=0

# Check 1: localStorage writes outside www/storage.js
# Filter out comment-only lines to avoid false positives on documentation
echo "Checking localStorage write scope..."
ls_writes=$(grep -rEn 'localStorage\.(setItem|removeItem|clear)|localStorage\[' www/ \
    --include='*.js' \
    --exclude='storage.js' | grep -v '\/\/' || true)
if [ -n "$ls_writes" ]; then
    echo "FAIL: localStorage writes outside www/storage.js:"
    echo "$ls_writes"
    violations=$((violations + 1))
fi

# Check 2: forbidden persistence APIs anywhere in www/
echo "Checking forbidden persistence APIs..."
forbidden=$(grep -rEn 'indexedDB|navigator\.storage\.getDirectory|serviceWorker\.register|caches\.open|document\.cookie' www/ \
    --include='*.js' \
    --exclude-dir='__tests__' || true)
if [ -n "$forbidden" ]; then
    echo "FAIL: forbidden persistence API usage:"
    echo "$forbidden"
    violations=$((violations + 1))
fi

if [ "$violations" -gt 0 ]; then
    echo ""
    echo "Storage audit FAILED with $violations check(s) failing."
    exit 1
fi

echo "Storage audit PASSED."
