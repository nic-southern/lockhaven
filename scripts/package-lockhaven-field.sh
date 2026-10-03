#!/usr/bin/env bash
# Package Lockhaven Field desktop artifacts after `flutter build`.
#
# Usage:
#   ./scripts/package-lockhaven-field.sh macos [app-path]
#   ./scripts/package-lockhaven-field.sh linux [bundle-dir]
#   ./scripts/package-lockhaven-field.sh windows [release-dir]
#
# Writes zip/tar.gz + sha256 into DIST_DIR (default: dist/field).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIND="${1:-}"
SRC="${2:-}"
DIST_DIR="${DIST_DIR:-$ROOT/dist/field}"
ARCH="$(uname -m)"
OS="$(uname -s)"

normalize_arch() {
  case "$1" in
    x86_64|amd64) echo amd64 ;;
    arm64|aarch64) echo arm64 ;;
    *) echo "$1" ;;
  esac
}

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
}

if [[ -z "$KIND" ]]; then
  usage >&2
  exit 2
fi

mkdir -p "$DIST_DIR"
DIST_DIR="$(cd "$DIST_DIR" && pwd)"

# Git Bash `pwd` is /d/foo; native Windows Python/PowerShell need D:/foo.
native_path() {
  local p="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$p"
    return 0
  fi
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      if [[ -d "$p" ]]; then
        (cd "$p" && pwd -W)
        return 0
      fi
      local dir base
      dir="$(dirname "$p")"
      base="$(basename "$p")"
      if [[ -d "$dir" ]]; then
        echo "$(cd "$dir" && pwd -W)/${base}"
        return 0
      fi
      ;;
  esac
  echo "$p"
}

bundle_ptouch_print() {
  local dest="$1"
  mkdir -p "$dest/bin"
  if ! command -v cmake >/dev/null 2>&1 || ! command -v pkg-config >/dev/null 2>&1; then
    echo "Skipping ptouch-print bundle (cmake/pkg-config missing)." >&2
    return 0
  fi
  if ! pkg-config --exists libusb-1.0; then
    echo "Skipping ptouch-print bundle (libusb not found)." >&2
    return 0
  fi
  PREFIX="$dest" "$ROOT/scripts/install-ptouch-print.sh" || {
    echo "ptouch-print build failed; Field will look on PATH / ~/.local/bin." >&2
    return 0
  }
  if [[ ! -x "$dest/bin/ptouch-print" ]]; then
    return 0
  fi
  if [[ "$OS" == "Darwin" ]] && command -v dylibbundler >/dev/null 2>&1; then
    mkdir -p "$dest/lib"
    dylibbundler -od -b -x "$dest/bin/ptouch-print" -d "$dest/lib" -p @executable_path/../lib || true
  elif [[ "$OS" == "Linux" ]] && command -v patchelf >/dev/null 2>&1; then
    mkdir -p "$dest/lib"
    local lib
    while read -r lib; do
      case "$lib" in
        /lib/*|/usr/lib/*|/lib64/*|/usr/lib64/*) continue ;;
      esac
      [[ -f "$lib" ]] || continue
      cp -a "$lib" "$dest/lib/" || true
    done < <(ldd "$dest/bin/ptouch-print" | awk '/=>/ {print $3}')
    patchelf --set-rpath '$ORIGIN/../lib' "$dest/bin/ptouch-print" || true
  fi
  echo "Bundled ptouch-print at $dest/bin/ptouch-print" >&2
}

sha256_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}' >"${path}.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}' >"${path}.sha256"
  else
    LOCKHAVEN_HASH_PATH="$(native_path "$path")" python3 - <<'PY'
import hashlib
import os
from pathlib import Path

src = Path(os.environ["LOCKHAVEN_HASH_PATH"])
digest = hashlib.sha256(src.read_bytes()).hexdigest()
src.with_name(src.name + ".sha256").write_text(digest + "\n", encoding="utf-8")
PY
  fi
}

case "$KIND" in
  macos)
    if [[ -z "$SRC" ]]; then
      SRC="$ROOT/apps/lockhaven-field/build/macos/Build/Products/Release/lockhaven_field.app"
    fi
    if [[ ! -d "$SRC" ]]; then
      echo "macOS .app not found: $SRC" >&2
      echo "Build with: cd apps/lockhaven-field && flutter build macos --release" >&2
      exit 1
    fi
    tools="$SRC/Contents/Resources/label-tools"
    "$ROOT/scripts/bundle-field-label-tools.sh" "$tools"
    bundle_ptouch_print "$tools"
    arch_tag="$(normalize_arch "$ARCH")"
    zip_name="lockhaven-field-macos-${arch_tag}.zip"
    staging="$(mktemp -d "${TMPDIR:-/tmp}/field-macos.XXXXXX")"
    cp -R "$SRC" "$staging/Lockhaven Field.app"
    # Gatekeeper: operators right-click Open; ad-hoc signed by Flutter.
    (
      cd "$staging"
      zip -qry "$DIST_DIR/$zip_name" "Lockhaven Field.app"
    )
    rm -rf "$staging"
    sha256_file "$DIST_DIR/$zip_name"
    echo "Wrote $DIST_DIR/$zip_name"
    ;;
  linux)
    if [[ -z "$SRC" ]]; then
      SRC="$ROOT/apps/lockhaven-field/build/linux/x64/release/bundle"
      if [[ ! -d "$SRC" && -d "$ROOT/apps/lockhaven-field/build/linux/arm64/release/bundle" ]]; then
        SRC="$ROOT/apps/lockhaven-field/build/linux/arm64/release/bundle"
      fi
    fi
    if [[ ! -d "$SRC" ]]; then
      echo "Linux bundle not found: $SRC" >&2
      echo "Build with: cd apps/lockhaven-field && flutter build linux --release" >&2
      exit 1
    fi
    staging="$(mktemp -d "${TMPDIR:-/tmp}/field-linux.XXXXXX")"
    mkdir -p "$staging/lockhaven-field"
    cp -a "$SRC"/. "$staging/lockhaven-field/"
    "$ROOT/scripts/bundle-field-label-tools.sh" "$staging/lockhaven-field/label-tools"
    bundle_ptouch_print "$staging/lockhaven-field/label-tools"
    arch_tag="$(normalize_arch "$ARCH")"
    tar_name="lockhaven-field-linux-${arch_tag}.tar.gz"
    tar -czf "$DIST_DIR/$tar_name" -C "$staging" lockhaven-field
    rm -rf "$staging"
    sha256_file "$DIST_DIR/$tar_name"
    echo "Wrote $DIST_DIR/$tar_name"
    ;;
  windows)
    if [[ -z "$SRC" ]]; then
      SRC="$ROOT/apps/lockhaven-field/build/windows/x64/runner/Release"
    fi
    if [[ ! -d "$SRC" ]]; then
      echo "Windows Release dir not found: $SRC" >&2
      exit 1
    fi
    zip_name="lockhaven-field-windows-amd64.zip"
    staging="$(mktemp -d "${TMPDIR:-/tmp}/field-win.XXXXXX")"
    mkdir -p "$staging/lockhaven-field"
    cp -a "$SRC"/. "$staging/lockhaven-field/"
    if command -v zip >/dev/null 2>&1; then
      (
        cd "$staging"
        zip -qry "$DIST_DIR/$zip_name" lockhaven-field
      )
    else
      # Native Windows Python cannot open Git Bash /d/... paths.
      export LOCKHAVEN_ZIP_ROOT
      export LOCKHAVEN_ZIP_OUT
      LOCKHAVEN_ZIP_ROOT="$(native_path "$staging/lockhaven-field")"
      LOCKHAVEN_ZIP_OUT="$(native_path "$DIST_DIR/$zip_name")"
      python3 - <<'PY'
import os
import zipfile
from pathlib import Path

root = Path(os.environ["LOCKHAVEN_ZIP_ROOT"])
out = Path(os.environ["LOCKHAVEN_ZIP_OUT"])
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for path in root.rglob("*"):
        zf.write(path, path.relative_to(root.parent))
PY
    fi
    rm -rf "$staging"
    sha256_file "$DIST_DIR/$zip_name"
    echo "Wrote $DIST_DIR/$zip_name"
    ;;
  *)
    echo "Unknown kind: $KIND (macos|linux|windows)" >&2
    exit 2
    ;;
esac
