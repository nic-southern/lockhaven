#!/usr/bin/env bash
# Build and install Dominic Radermacher's ptouch-print into ~/.local/bin.
# Supports Linux and macOS (Homebrew libusb/libgd). Same binary Field expects.
#
# Usage:
#   ./scripts/install-ptouch-print.sh
#   PREFIX="$HOME/.local" ./scripts/install-ptouch-print.sh
set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
SRC_DIR="${PTOUCH_SRC_DIR:-${TMPDIR:-/tmp}/ptouch-print-src}"
REPO_URL="${PTOUCH_REPO_URL:-https://git.familie-radermacher.ch/linux/ptouch-print.git}"
# GitHub mirror (optional fallback) — set PTOUCH_REPO_URL to override.
MIRROR_URL="${PTOUCH_MIRROR_URL:-https://github.com/clarkewd/ptouch-print.git}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

os="$(uname -s)"
echo "Installing ptouch-print for $os → $BIN_DIR"

need git
need cmake
need make
need pkg-config

if [[ "$os" == "Darwin" ]]; then
  if ! pkg-config --exists libusb-1.0; then
    echo "libusb not found. On macOS: brew install libusb libgd cmake pkg-config" >&2
    exit 1
  fi
  if ! pkg-config --exists gdlib && ! pkg-config --exists gd; then
    echo "libgd not found. On macOS: brew install libgd" >&2
    exit 1
  fi
else
  if ! pkg-config --exists libusb-1.0; then
    echo "libusb-1.0 not found. Install libusb development headers." >&2
    exit 1
  fi
fi

rm -rf "$SRC_DIR"
mkdir -p "$SRC_DIR"
if ! git clone --depth 1 "$REPO_URL" "$SRC_DIR" 2>/dev/null; then
  echo "Primary clone failed; trying mirror $MIRROR_URL …" >&2
  rm -rf "$SRC_DIR"
  git clone --depth 1 "$MIRROR_URL" "$SRC_DIR"
fi

mkdir -p "$SRC_DIR/build"
cmake -S "$SRC_DIR" -B "$SRC_DIR/build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX"
cmake --build "$SRC_DIR/build" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
cmake --install "$SRC_DIR/build"

mkdir -p "$BIN_DIR"
if [[ ! -x "$BIN_DIR/ptouch-print" ]]; then
  # Some builds place the binary only in the build tree.
  if [[ -x "$SRC_DIR/build/ptouch-print" ]]; then
    install -m 755 "$SRC_DIR/build/ptouch-print" "$BIN_DIR/ptouch-print"
  else
    echo "ptouch-print binary not found after install." >&2
    exit 1
  fi
fi

echo
echo "Installed: $BIN_DIR/ptouch-print"
"$BIN_DIR/ptouch-print" --list-supported 2>/dev/null | head -40 || true
echo
echo "Ensure $BIN_DIR is on PATH (Field also prepends ~/.local/bin and Homebrew bins)."
echo "Plug in the PT-D460BT / PT-D460BTVP over USB and run: ptouch-print --info"
