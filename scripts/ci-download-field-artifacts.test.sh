#!/usr/bin/env bash
# Offline check that CI reuses the newest Field Actions artifacts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

bin="$tmp/bin"
dest="$tmp/install"
mkdir -p "$bin" "$dest" "$tmp/payloads"

fake_zip() {
  local name="$1"
  local file="$2"
  local payload="$tmp/payloads/$name"
  mkdir -p "$payload/nested"
  printf 'field-package\n' >"$payload/nested/$file"
  (cd "$payload" && zip -qr "$tmp/$name.zip" .)
}

fake_zip lockhaven-field-linux lockhaven-field-linux-amd64.tar.gz
fake_zip lockhaven-field-macos lockhaven-field-macos-arm64.zip
# Expired / missing windows artifact: script should skip, not fail.

cat >"$bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=("$@")
joined="${args[*]}"

if [[ "$joined" == *"--output"* ]]; then
  echo "unknown flag: --output" >&2
  exit 1
fi

if [[ "$joined" == *"/zip"* ]]; then
  if [[ "$joined" == *"/101/zip"* ]]; then
    cat "$FAKE_GH_ROOT/lockhaven-field-linux.zip"
    exit 0
  fi
  if [[ "$joined" == *"/202/zip"* ]]; then
    cat "$FAKE_GH_ROOT/lockhaven-field-macos.zip"
    exit 0
  fi
  echo "unexpected zip id: $joined" >&2
  exit 1
fi

if [[ "$joined" == *"name=lockhaven-field-linux"* ]]; then
  echo 101
  exit 0
fi
if [[ "$joined" == *"name=lockhaven-field-macos"* ]]; then
  echo 202
  exit 0
fi
if [[ "$joined" == *"name=lockhaven-field-windows"* ]]; then
  echo
  exit 0
fi

echo "unexpected gh invocation: $joined" >&2
exit 1
EOF
chmod +x "$bin/gh"

export PATH="$bin:$PATH"
export GITHUB_REPOSITORY="example/lockhaven"
export FAKE_GH_ROOT="$tmp"

bash "$ROOT/scripts/ci-download-field-artifacts.sh" "$dest"

test -f "$dest/lockhaven-field-linux-amd64.tar.gz"
test -f "$dest/lockhaven-field-macos-arm64.zip"
test ! -e "$dest/lockhaven-field-windows-amd64.zip"
grep -qx 'field-package' "$dest/lockhaven-field-linux-amd64.tar.gz"
if grep -E -q 'gh api .*--output' "$ROOT/scripts/ci-download-field-artifacts.sh"; then
  echo "ci-download-field-artifacts.sh must not pass --output to gh api (runner gh lacks it)" >&2
  exit 1
fi
echo "ci-download-field-artifacts: ok"
