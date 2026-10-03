#!/usr/bin/env bash
# Build and install Dominic Radermacher's ptouch-print into ~/.local/bin.
# Supports Linux and macOS (Homebrew libusb/libgd/gettext/argp-standalone).
# Same binary Field expects.
#
# Usage:
#   ./scripts/install-ptouch-print.sh
#   PREFIX="$HOME/.local" ./scripts/install-ptouch-print.sh
#
# Upstream is dumb HTTP (gitweb). Do not use --depth 1 as the only clone:
# that fails with "dumb http transport does not support shallow capabilities".
# There is no public GitHub copy of this tree (clarkewd/ptouch-print 404s).
set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
SRC_DIR="${PTOUCH_SRC_DIR:-${TMPDIR:-/tmp}/ptouch-print-src}"
# Official source: https://dominic.familie-radermacher.ch/projekte/ptouch-print/
REPO_URL="${PTOUCH_REPO_URL:-https://git.familie-radermacher.ch/linux/ptouch-print.git}"
export GIT_TERMINAL_PROMPT=0

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

os="$(uname -s)"
echo "Installing ptouch-print for $os → $BIN_DIR"
echo "Source: $REPO_URL"

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

need git
need cmake
need make
need pkg-config

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

clone_repo() {
  local url="$1"
  local dest="$2"
  echo "Cloning $url → $dest"
  # Try a shallow clone first (GitHub/GitLab smart HTTP). Upstream gitweb is
  # dumb HTTP and rejects --depth; fall back to a full clone of the same URL.
  if git clone --depth 1 "$url" "$dest"; then
    return 0
  fi
  echo "Shallow clone failed (expected on dumb HTTP); retrying a full clone of the same URL." >&2
  rm -rf "$dest"
  git clone "$url" "$dest"
}

rm -rf "$SRC_DIR"
clone_repo "$REPO_URL" "$SRC_DIR"

mkdir -p "$SRC_DIR/build"
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
  echo "ptouch-print did not list a D460 model. Check the clone and rebuild." >&2
  exit 1
fi
echo
echo "Ensure $BIN_DIR is on PATH (Field also prepends ~/.local/bin and Homebrew bins)."
echo "Plug in the PT-D460BT / PT-D460BTVP over USB and run: ptouch-print --info"
