#!/usr/bin/env bash
# Build and install ptouch-print into ~/.local/bin from the Lockhaven GitHub
# tree (third_party/ptouch-print). Same binary Field expects.
#
# Usage:
#   ./scripts/install-ptouch-print.sh
#   PREFIX="$HOME/.local" ./scripts/install-ptouch-print.sh
#
# Warehouse Mac (after this lands on main):
#   curl -fsSL -o install-ptouch-print.sh \
#     https://raw.githubusercontent.com/nic-southern/lockhaven/main/scripts/install-ptouch-print.sh // pragma: allowlist secret
#   chmod +x install-ptouch-print.sh
#   ./install-ptouch-print.sh
#
# Override the GitHub ref used when this script is not next to the vendor tree:
#   PTOUCH_LOCKHAVEN_REF=main ./install-ptouch-print.sh
set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
SRC_DIR="${PTOUCH_SRC_DIR:-${TMPDIR:-/tmp}/ptouch-print-src}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCKHAVEN_GITHUB="${LOCKHAVEN_GITHUB:-https://github.com/nic-southern/lockhaven}" # // pragma: allowlist secret
# Feature-branch tarball first so a curl of this file from the PR works before
# merge; then main (post-merge / after the feature branch is deleted).
LOCKHAVEN_VENDOR_REFS=(
  ${PTOUCH_LOCKHAVEN_REF:+"$PTOUCH_LOCKHAVEN_REF"}
  "cursor/vendor-ptouch-print-github-ef4f"
  "main"
)

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

prepend_path() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) PATH="$dir:$PATH" ;;
  esac
}

prepend_pkg_config() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  PKG_CONFIG_PATH="${dir}${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
}

prepend_cmake_prefix() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  CMAKE_PREFIX_PATH="${dir}${CMAKE_PREFIX_PATH:+;$CMAKE_PREFIX_PATH}"
}

copy_vendor_tree() {
  local from="$1"
  local dest="$2"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -a "$from"/. "$dest"/
}

find_local_vendor() {
  local candidate
  if [[ -n "${PTOUCH_VENDOR_DIR:-}" ]]; then
    printf '%s\n' "$PTOUCH_VENDOR_DIR"
    return 0
  fi
  for candidate in \
    "$SCRIPT_DIR/ptouch-print-src" \
    "$SCRIPT_DIR/../third_party/ptouch-print" \
    "$SCRIPT_DIR/third_party/ptouch-print"
  do
    if [[ -f "$candidate/CMakeLists.txt" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

fetch_github_vendor() {
  local dest="$1"
  need curl
  need tar
  local tmp ref url found
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  local seen="|"
  local -a refs=()
  local r
  for r in "${LOCKHAVEN_VENDOR_REFS[@]}"; do
    [[ -z "$r" ]] && continue
    [[ "$seen" == *"|$r|"* ]] && continue
    seen+="$r|"
    refs+=("$r")
  done
  for ref in "${refs[@]}"; do
    url="${LOCKHAVEN_GITHUB}/archive/refs/heads/${ref}.tar.gz"
    echo "Fetching vendored ptouch-print from ${LOCKHAVEN_GITHUB} (ref ${ref})"
    rm -rf "${tmp:?}"/*
    if ! curl -fsSL "$url" | tar -xz -C "$tmp"; then
      echo "Could not download $url" >&2
      continue
    fi
    found=""
    for cmake_file in "$tmp"/*/third_party/ptouch-print/CMakeLists.txt; do
      if [[ -f "$cmake_file" ]]; then
        found="$cmake_file"
        break
      fi
    done
    if [[ -n "$found" ]]; then
      copy_vendor_tree "$(dirname "$found")" "$dest"
      return 0
    fi
    echo "Archive for ref ${ref} did not contain third_party/ptouch-print." >&2
  done
  echo "Could not fetch ptouch-print from ${LOCKHAVEN_GITHUB}." >&2
  echo "Use a Lockhaven checkout, or set PTOUCH_LOCKHAVEN_REF to a branch that contains third_party/ptouch-print." >&2
  return 1
}

os="$(uname -s)"
echo "Installing ptouch-print for $os → $BIN_DIR"

if [[ "$os" == "Darwin" ]]; then
  brew_bin=""
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$candidate" ]]; then
      brew_bin="$candidate"
      break
    fi
  done
  if [[ -z "$brew_bin" ]] && command -v brew >/dev/null 2>&1; then
    brew_bin="$(command -v brew)"
  fi
  if [[ -n "$brew_bin" ]]; then
    brew_prefix="$("$brew_bin" --prefix)"
    prepend_path "$brew_prefix/bin"
    prepend_pkg_config "$brew_prefix/lib/pkgconfig"
    prepend_cmake_prefix "$brew_prefix"
    # gettext and argp-standalone are keg-only on Homebrew.
    for formula in gettext argp-standalone libusb libgd; do
      formula_prefix="$("$brew_bin" --prefix "$formula" 2>/dev/null || true)"
      if [[ -n "$formula_prefix" && -d "$formula_prefix" ]]; then
        prepend_path "$formula_prefix/bin"
        prepend_pkg_config "$formula_prefix/lib/pkgconfig"
        prepend_cmake_prefix "$formula_prefix"
      fi
    done
    export PATH PKG_CONFIG_PATH CMAKE_PREFIX_PATH
  fi
fi

need cmake
need make
need pkg-config
need git

if [[ "$os" == "Darwin" ]]; then
  if ! pkg-config --exists libusb-1.0; then
    echo "libusb not found. On macOS:" >&2
    echo "  brew install cmake libusb libgd pkg-config gettext argp-standalone" >&2
    exit 1
  fi
  if ! pkg-config --exists gdlib && ! pkg-config --exists gd; then
    echo "libgd not found. On macOS: brew install libgd" >&2
    exit 1
  fi
  if ! command -v msgfmt >/dev/null 2>&1; then
    echo "gettext (msgfmt) not found. On macOS: brew install gettext" >&2
    exit 1
  fi
else
  if ! pkg-config --exists libusb-1.0; then
    echo "libusb-1.0 not found. Install libusb development headers." >&2
    exit 1
  fi
fi

vendor=""
if vendor="$(find_local_vendor)"; then
  echo "Source: $vendor"
  copy_vendor_tree "$vendor" "$SRC_DIR"
else
  echo "Source: ${LOCKHAVEN_GITHUB} (vendored third_party/ptouch-print)"
  fetch_github_vendor "$SRC_DIR"
fi

if [[ ! -f "$SRC_DIR/CMakeLists.txt" ]]; then
  echo "Vendored ptouch-print tree is missing CMakeLists.txt" >&2
  exit 1
fi

mkdir -p "$SRC_DIR/build"
# gitversion.cmake writes version.h into the build dir; seed the snapshot.
if [[ -f "$SRC_DIR/version.h" ]]; then
  cp "$SRC_DIR/version.h" "$SRC_DIR/build/version.h"
fi
cmake_args=(
  -S "$SRC_DIR"
  -B "$SRC_DIR/build"
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_INSTALL_PREFIX="$PREFIX"
)
if [[ -n "${CMAKE_PREFIX_PATH:-}" ]]; then
  cmake_args+=(-DCMAKE_PREFIX_PATH="$CMAKE_PREFIX_PATH")
fi
cmake "${cmake_args[@]}"
cmake --build "$SRC_DIR/build" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
# CMakeLists.txt hard-sets CMAKE_INSTALL_PREFIX; --prefix wins at install time.
cmake --install "$SRC_DIR/build" --prefix "$PREFIX"

mkdir -p "$BIN_DIR"
if [[ ! -x "$BIN_DIR/ptouch-print" ]]; then
  if [[ -x "$SRC_DIR/build/ptouch-print" ]]; then
    install -m 755 "$SRC_DIR/build/ptouch-print" "$BIN_DIR/ptouch-print"
  else
    echo "ptouch-print binary not found after install." >&2
    exit 1
  fi
fi

echo
echo "Installed: $BIN_DIR/ptouch-print"
supported="$("$BIN_DIR/ptouch-print" --list-supported 2>/dev/null || true)"
if [[ -n "$supported" ]]; then
  echo "$supported" | head -40
fi
if ! echo "$supported" | grep -qiE 'D460'; then
  echo "ptouch-print did not list a D460 model. Check the vendored tree and rebuild." >&2
  exit 1
fi
echo
echo "Ensure $BIN_DIR is on PATH (Field also prepends ~/.local/bin and Homebrew bins)."
echo "Plug in the PT-D460BT / PT-D460BTVP over USB and run: ptouch-print --info"
