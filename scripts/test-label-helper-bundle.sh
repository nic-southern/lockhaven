#!/usr/bin/env bash
# Smoke-test bundled label tools (system Python venv, no printer).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/field-bundle-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

"$ROOT/scripts/bundle-field-label-tools.sh" --system-python "$TMP/label-tools"

if [[ ! -x "$TMP/label-tools/bin/label-python" ]]; then
  echo "label-python missing" >&2
  exit 1
fi
if [[ ! -f "$TMP/label-tools/fonts/DejaVuSans.ttf" ]]; then
  echo "bundled DejaVu font missing" >&2
  exit 1
fi

# Relocate the tree to prove shebang paths are not required.
mv "$TMP/label-tools" "$TMP/moved-tools"

csv="$TMP/labels.csv"
CSV_PATH="$csv" python3 - <<'PY'
from pathlib import Path
import os

Path(os.environ["CSV_PATH"]).write_text(
    "schema_version,tag,serial,company_name,qr_text,site_name\n"
    '1,LH-TEST01,SN123,Acme,"LH-TEST01\nSN123",Warehouse\n',
    encoding="utf-8",
)
PY

out="$TMP/pngs"
mkdir -p "$out"
# Hide repo python / user PATH extras; helper must use bundled interpreter + fonts.
OUT_DIR="$out" PATH="/usr/bin:/bin" LOCKHAVEN_LABEL_VENV="" \
  "$TMP/moved-tools/print-asset-labels.sh" --dry-run "$csv"

shopt -s nullglob
pngs=("$out"/*-label.png)
if [[ ${#pngs[@]} -lt 1 ]]; then
  echo "expected a label PNG in $out" >&2
  exit 1
fi

"$TMP/moved-tools/bin/label-python" -c 'import qrcode; from PIL import Image'
echo "bundle-field-label-tools smoke test ok (${pngs[0]})"
