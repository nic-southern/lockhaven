#!/usr/bin/env bash
# Install a relocatable label-print toolkit into DEST (Field .app Resources
# or Linux bundle). Private CPython + venv (Pillow/qrcode) + DejaVu fonts +
# print-asset-labels.sh. Does not require Homebrew/system Python at runtime.
#
# Usage:
#   ./scripts/bundle-field-label-tools.sh DEST_DIR
#   ./scripts/bundle-field-label-tools.sh --system-python DEST_DIR
#
# --system-python: use `python3 -m venv` instead of python-build-standalone
# (CI unit tests / offline). Shipped Mac/Linux Field artifacts use standalone.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQ_FILE="$SCRIPT_DIR/requirements-labels.txt"
CACHE_DIR="${LOCKHAVEN_TOOL_CACHE:-$SCRIPT_DIR/.cache}"
USE_SYSTEM_PYTHON=0
DEST=""

# Pinned python-build-standalone (install_only = relocatable CPython).
PBS_TAG="${LOCKHAVEN_PYTHON_STANDALONE_TAG:-20250818}"
PBS_VERSION="${LOCKHAVEN_PYTHON_STANDALONE_VERSION:-3.12.11}"
DEJAVU_VERSION="${LOCKHAVEN_DEJAVU_VERSION:-2.37}"
DEJAVU_URL="${LOCKHAVEN_DEJAVU_URL:-https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2}"

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --system-python)
      USE_SYSTEM_PYTHON=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
    *)
      if [[ -n "$DEST" ]]; then
        echo "Unexpected argument: $1" >&2
        exit 2
      fi
      DEST="$1"
      shift
      ;;
  esac
done

if [[ -z "$DEST" ]]; then
  usage >&2
  exit 2
fi

mkdir -p "$DEST" "$CACHE_DIR"
DEST="$(cd "$DEST" && pwd)"

standalone_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os:$arch" in
    Darwin:arm64) echo "aarch64-apple-darwin" ;;
    Darwin:x86_64) echo "x86_64-apple-darwin" ;;
    Linux:x86_64) echo "x86_64-unknown-linux-gnu" ;;
    Linux:aarch64|Linux:arm64) echo "aarch64-unknown-linux-gnu" ;;
    *)
      echo "No python-build-standalone target for $os/$arch." >&2
      return 1
      ;;
  esac
}

fetch() {
  local url="$1"
  local out="$2"
  if [[ -f "$out" && -s "$out" ]]; then
    return 0
  fi
  echo "Downloading $(basename "$out") …" >&2
  curl -fsSL --retry 4 --retry-delay 2 "$url" -o "$out.partial"
  mv "$out.partial" "$out"
}

install_standalone_python() {
  local target tarball url
  target="$(standalone_target)"
  tarball="$CACHE_DIR/cpython-${PBS_VERSION}+${PBS_TAG}-${target}-install_only.tar.gz"
  url="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/cpython-${PBS_VERSION}+${PBS_TAG}-${target}-install_only.tar.gz"
  fetch "$url" "$tarball"
  rm -rf "$DEST/python"
  mkdir -p "$DEST/python-extract"
  tar -xzf "$tarball" -C "$DEST/python-extract"
  if [[ -d "$DEST/python-extract/python" ]]; then
    mv "$DEST/python-extract/python" "$DEST/python"
  else
    # Some archives unpack a single top-level directory.
    local top
    top="$(find "$DEST/python-extract" -mindepth 1 -maxdepth 1 -type d | head -1)"
    mv "$top" "$DEST/python"
  fi
  rm -rf "$DEST/python-extract"
  if [[ ! -x "$DEST/python/bin/python3" ]]; then
    echo "Standalone python3 missing after extract." >&2
    exit 1
  fi
}

install_venv() {
  local py="$1"
  rm -rf "$DEST/venv"
  echo "Creating label venv with $py …" >&2
  "$py" -m venv "$DEST/venv"
  "$DEST/venv/bin/python" -m pip install --upgrade pip >/dev/null
  "$DEST/venv/bin/python" -m pip install -r "$REQ_FILE"
  "$DEST/venv/bin/python" -c 'import qrcode; from PIL import Image, ImageDraw, ImageFont'
}

install_fonts() {
  mkdir -p "$DEST/fonts"
  if [[ -f "$SCRIPT_DIR/label-fonts/DejaVuSans.ttf" ]]; then
    cp "$SCRIPT_DIR/label-fonts/DejaVuSans.ttf" "$SCRIPT_DIR/label-fonts/DejaVuSans-Bold.ttf" "$DEST/fonts/"
    return 0
  fi
  local archive="$CACHE_DIR/dejavu-fonts-ttf-${DEJAVU_VERSION}.tar.bz2"
  fetch "$DEJAVU_URL" "$archive"
  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/dejavu.XXXXXX")"
  tar -xjf "$archive" -C "$tmp"
  local found
  found="$(find "$tmp" -name 'DejaVuSans.ttf' | head -1)"
  if [[ -z "$found" ]]; then
    echo "DejaVuSans.ttf not found in $archive" >&2
    exit 1
  fi
  cp "$found" "$(dirname "$found")/DejaVuSans-Bold.ttf" "$DEST/fonts/"
  rm -rf "$tmp"
}

write_label_python() {
  mkdir -p "$DEST/bin"
  cat >"$DEST/bin/label-python" <<'EOF'
#!/bin/sh
# Relocatable launcher: bundled CPython + venv site-packages (no shebang paths).
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
if [ -x "$ROOT/python/bin/python3" ]; then
  PY="$ROOT/python/bin/python3"
elif [ -x "$ROOT/venv/bin/python" ]; then
  exec "$ROOT/venv/bin/python" "$@"
else
  echo "Bundled label Python is missing." >&2
  exit 1
fi
SP=""
for d in "$ROOT/venv/lib"/python*/site-packages; do
  if [ -d "$d" ]; then
    SP="$d"
    break
  fi
done
if [ -n "$SP" ]; then
  PYTHONPATH="$SP${PYTHONPATH:+:$PYTHONPATH}"
  export PYTHONPATH
fi
exec "$PY" "$@"
EOF
  chmod 0755 "$DEST/bin/label-python"
}

copy_helper_scripts() {
  cp "$SCRIPT_DIR/print-asset-labels.sh" "$DEST/print-asset-labels.sh"
  chmod 0755 "$DEST/print-asset-labels.sh"
  cp "$REQ_FILE" "$DEST/requirements-labels.txt"
  cp "$SCRIPT_DIR/install-ptouch-print.sh" "$DEST/install-ptouch-print.sh"
  chmod 0755 "$DEST/install-ptouch-print.sh"
}

if [[ "$USE_SYSTEM_PYTHON" -eq 1 ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required for --system-python." >&2
    exit 1
  fi
  install_venv python3
else
  install_standalone_python
  install_venv "$DEST/python/bin/python3"
fi

install_fonts
write_label_python
copy_helper_scripts

cat >"$DEST/README.txt" <<'EOF'
Lockhaven Field label tools (bundled)

This folder is the private print toolkit inside Field:
  - print-asset-labels.sh
  - CPython + venv with layout packages
  - DejaVu fonts
  - optional ptouch-print in bin/ (when the packager could build it)

Field looks here first. You do not need Homebrew Python.
If print still cannot find the tape printer tool, run install-ptouch-print.sh
once (needs cmake, libusb, and libgd on this computer).
EOF

echo "Bundled label tools at $DEST" >&2
"$DEST/bin/label-python" -c 'import qrcode; from PIL import ImageFont; print("label-python ok")'
