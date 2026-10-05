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

# Print must call the absolute binary (PTOUCH_PRINT), not a decoy earlier on PATH.
decoy_marker="$TMP/decoy-ran"
argv_log="$TMP/ptouch-argv"
mkdir -p "$TMP/not-on-path"
cat >"$TMP/moved-tools/bin/ptouch-print" <<EOF
#!/bin/sh
echo decoy > "$decoy_marker"
exit 9
EOF
chmod 0755 "$TMP/moved-tools/bin/ptouch-print"
cat >"$TMP/not-on-path/ptouch-print" <<EOF
#!/bin/sh
printf '%s\n' "\$@" > "$argv_log"
exit 0
EOF
chmod 0755 "$TMP/not-on-path/ptouch-print"

print_out="$TMP/print-pngs"
mkdir -p "$print_out"
OUT_DIR="$print_out" PATH="/usr/bin:/bin" LOCKHAVEN_LABEL_VENV="" \
  PTOUCH_PRINT="$TMP/not-on-path/ptouch-print" PTOUCH_SERIAL="E75J012345" \
  "$TMP/moved-tools/print-asset-labels.sh" "$csv"

if [[ -f "$decoy_marker" ]]; then
  echo "print invoked the decoy ptouch-print instead of PTOUCH_PRINT" >&2
  exit 1
fi
if [[ ! -f "$argv_log" ]]; then
  echo "ptouch-print was not invoked; argv log missing" >&2
  exit 1
fi
argv="$(cat "$argv_log")"
printf '%s\n' "$argv"
for flag in "--timeout=30" "--serial" "E75J012345" "--precut" "--image"; do
  if ! printf '%s\n' "$argv" | grep -Fxq -- "$flag"; then
    echo "expected ptouch-print argv to include $flag" >&2
    echo "$argv" >&2
    exit 1
  fi
done
echo "bundle-field-label-tools smoke test ok (${pngs[0]})"
