#!/usr/bin/env bash
# Copy the newest GitHub Actions Field packages into Hub's /install tree.
# Used by main CI so lockhaven-web keeps serving Field downloads without
# waiting on a Flutter build in this run.
set -euo pipefail

dest="${1:-apps/web/public/install}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

mkdir -p "$dest"

copied=0
for name in lockhaven-field-linux lockhaven-field-macos lockhaven-field-windows; do
  id="$(
    gh api "repos/${repo}/actions/artifacts?name=${name}&per_page=20" \
      --jq '[.artifacts[] | select(.expired == false)] | .[0].id // empty'
  )"
  if [ -z "$id" ]; then
    echo "No unexpired artifact named ${name}; skipping." >&2
    continue
  fi

  zip_path="$(mktemp "${TMPDIR:-/tmp}/${name}.XXXXXX.zip")"
  extract_dir="$(mktemp -d "${TMPDIR:-/tmp}/${name}.XXXXXX")"
  # Runner gh is older than the flag that writes the body to a file.
  # Stream the zip on stdout instead.
  gh api "repos/${repo}/actions/artifacts/${id}/zip" >"$zip_path"
  unzip -qo "$zip_path" -d "$extract_dir"
  while IFS= read -r -d '' file; do
    cp -f "$file" "$dest/"
    copied=$((copied + 1))
    echo "Copied $(basename "$file") from ${name} artifact ${id}."
  done < <(find "$extract_dir" -type f -name 'lockhaven-field-*' -print0)
  rm -rf "$zip_path" "$extract_dir"
done

if [ "$copied" -eq 0 ]; then
  echo "No Field desktop packages found. Hub will ship without Field installers until Actions → Field desktop succeeds." >&2
fi
